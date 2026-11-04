import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';

// Fixes from the November 2026 end-to-end test: a fire in every new hearth, names nobody new can
// take, invisible or flipped text, and saying why a hearth went away.
const db = openDb(':memory:');
const voice = { apiKey: 'devkey', apiSecret: 'a-secret-that-is-at-least-32-characters-long', apiUrl: 'http://127.0.0.1:9' };
const app = createApp({ db, publicDir: '/nonexistent', voice, hosting: { admins: ['support'] } as never });
let base = '';
before(async () => {
  await new Promise<void>((r) => app.listen(0, r));
  base = `http://localhost:${(app.address() as AddressInfo).port}`;
});
after(() => {
  app.closeAllConnections();
  app.close();
});

async function call(path: string, opts: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, data: (await res.json()) as any };
}
const register = (username: string) => call('/api/register', { body: { username, password: 'password1' } });
let n = 0;
const reg = async (name: string) => (await register(`${name}${++n}`)).data;

test('a new hearth starts with a Campfire next to general', async () => {
  const host = await reg('host');
  const s = (await call('/api/servers', { body: { name: 'Den' }, token: host.token })).data;
  assert.deepEqual(s.channels.map((c: any) => [c.name, c.kind]), [['general', 'text'], ['Campfire', 'voice']]);
});

test('reserved usernames, unless ADMIN_USERS names one', async () => {
  for (const name of ['admin', 'Admin', 'deleted', 'PEISKOS', 'everyone']) {
    const r = await register(name);
    assert.equal(r.status, 409, name);
    assert.equal(r.data.error, 'That username is reserved');
  }
  // "support" is reserved, but this server's ADMIN_USERS lists it, so its owner can claim it.
  assert.equal((await register('support')).status, 200);
  const amy = await reg('amy');
  assert.equal((await call('/api/me/username', { body: { username: 'system', password: 'password1' }, token: amy.token })).status, 409);
});

test("a name you give up is held for 30 days, except for you", async () => {
  const kim = (await register('kim')).data;
  assert.equal((await call('/api/me/username', { body: { username: 'kimberly', password: 'password1' }, token: kim.token })).status, 200);
  assert.equal((await register('Kim')).status, 409);
  // Changing your mind gets it back.
  assert.equal((await call('/api/me/username', { body: { username: 'kim', password: 'password1' }, token: kim.token })).status, 200);
  // A deleted account's name waits too.
  const lou = (await register('lou')).data;
  assert.equal((await call('/api/me', { method: 'DELETE', body: { password: 'password1' }, token: lou.token })).status, 200);
  assert.equal((await register('lou')).status, 409);
  // Once the hold runs out, it's free.
  db.prepare("UPDATE app_settings SET value = json_set(value, '$.until', 0) WHERE key = 'held_name:lou'").run();
  assert.equal((await register('lou')).status, 200);
});

test('invisible messages are empty, and direction overrides are taken out', async () => {
  const host = await reg('host');
  const s = (await call('/api/servers', { body: { name: 'Den' }, token: host.token })).data;
  const general = s.channels[0].id;
  const post = (content: string) => call(`/api/channels/${general}/messages`, { body: { content }, token: host.token });
  for (const content of ['​', ' ​⁠ ', '﻿\nㅤ', '‮']) {
    const r = await post(content);
    assert.equal(r.status, 400, JSON.stringify(content));
    assert.equal(r.data.error, 'Message is empty');
  }
  const flipped = await post('see ‮gnp.exe');
  assert.equal(flipped.data.content, 'see gnp.exe');
  // Emoji joined with zero-width joiners stay as they are.
  assert.equal((await post('👨‍👩‍👧')).data.content, '👨‍👩‍👧');
  const edited = await call(`/api/messages/${flipped.data.id}`, { method: 'PATCH', body: { content: '⁧hi⁩' }, token: host.token });
  assert.equal(edited.data.content, 'hi');
  assert.equal((await call(`/api/messages/${flipped.data.id}`, { method: 'PATCH', body: { content: '​' }, token: host.token })).status, 400);
  // Names too.
  assert.equal((await call('/api/me', { method: 'PATCH', body: { displayName: 'Ada‮' }, token: host.token })).data.displayName, 'Ada');
  assert.equal((await call('/api/servers', { body: { name: '​' }, token: host.token })).status, 400);
});

test('being removed or banned, or the hearth being deleted, says why', async () => {
  const host = await reg('host');
  const amy = await reg('amy');
  const bea = await reg('bea');
  const s = (await call('/api/servers', { body: { name: 'Den' }, token: host.token })).data;
  for (const p of [amy, bea]) await call('/api/join', { body: { inviteCode: s.inviteCode }, token: p.token });
  const listen = async (token: string) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?token=${token}`);
    const events: any[] = [];
    ws.on('message', (raw) => events.push(JSON.parse(String(raw))));
    await new Promise((r) => ws.once('open', r));
    const gone = async () => {
      for (let i = 0; i < 100; i++) {
        const e = events.find((x) => x.type === 'server_deleted');
        if (e) return e;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error('no server_deleted');
    };
    return { ws, gone };
  };
  const a = await listen(amy.token);
  await call(`/api/servers/${s.id}/members/${amy.user.id}/remove`, { body: { ban: true }, token: host.token });
  assert.equal((await a.gone()).reason, 'banned');
  a.ws.close();
  const b = await listen(bea.token);
  await call(`/api/servers/${s.id}/leave`, { body: {}, token: host.token });
  assert.equal((await b.gone()).reason, 'deleted');
  b.ws.close();
});

test("renaming over and over doesn't hold on to every name passed through", async () => {
  const ivy = await reg('ivy');
  for (const name of ['ivy-one', 'ivy-two', 'ivy-three']) {
    assert.equal((await call('/api/me/username', { body: { username: name, password: 'password1' }, token: ivy.token })).status, 200);
  }
  // Only the name just given up is held; the ones before it are free again.
  assert.equal((await register('ivy-one')).status, 200);
  assert.equal((await register('ivy-two')).status, 409);
});
