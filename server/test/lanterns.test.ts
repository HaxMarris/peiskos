import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { caller, listening } from './helpers.ts';

// No voice server here: the app only needs to be told who sits where, which its own websocket does.
const app = createApp({ db: openDb(':memory:'), publicDir: '/nonexistent', uploadDir: join(mkdtempSync(join(tmpdir(), 'peiskos-lantern-')), 'uploads') });
let base = '';
listening(app, (b) => (base = b));
const call = caller(() => base);

let n = 0;
async function people(...names: string[]) {
  const out: any[] = [];
  for (const name of names) out.push((await call('/api/register', { body: { username: `${name}${++n}`, password: 'password1' } })).data);
  return out;
}
async function hearth(host: any, ...others: any[]) {
  const server = (await call('/api/servers', { body: { name: 'Den' }, token: host.token })).data;
  for (const o of others) await call('/api/join', { body: { inviteCode: server.inviteCode }, token: o.token });
  await call(`/api/servers/${server.id}/channels`, { body: { name: 'Campfire', kind: 'voice' }, token: host.token });
  const s = (await call(`/api/servers/${server.id}/channels`, { body: { name: 'Back Porch', kind: 'voice' }, token: host.token })).data;
  const [fire, porch] = s.channels.filter((c: any) => c.kind === 'voice').map((c: any) => c.id);
  return { server: s, fire, porch };
}

async function listen(url: string, headers: Record<string, string> = {}) {
  const ws = new WebSocket(url, { headers });
  const events: any[] = [];
  ws.on('message', (raw) => events.push(JSON.parse(String(raw))));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  const next = async (pred: (e: any) => boolean) => {
    for (let i = 0; i < 100; i++) {
      const at = events.findIndex(pred);
      if (at >= 0) return events.splice(at, 1)[0];
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('timed out waiting for event');
  };
  return { ws, events, next, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}
const person = (token: string) => listen(`${base.replace('http', 'ws')}/ws?token=${token}`);
const lamp = (key: string) => listen(`${base.replace('http', 'ws')}/lantern`, { authorization: `Bearer ${key}` });
const light = (e: any) => e.type === 'light';

async function pairedLantern(owner: any, name = 'Shelf') {
  const made = await call('/api/lanterns', { body: { name }, token: owner.token });
  assert.equal(made.status, 200);
  assert.match(made.data.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  // Typed in lower case and without the dash still works.
  const paired = await call('/api/lanterns/pair', { body: { code: made.data.code.replace('-', '').toLowerCase() } });
  assert.equal(paired.status, 200);
  return { id: made.data.lantern.id as number, key: paired.data.key as string, code: made.data.code as string };
}

test('a lantern pairs once with its code, and only its key opens its connection', async () => {
  const [ann] = await people('ann');
  const { id, key, code } = await pairedLantern(ann);
  // The code is used up.
  assert.equal((await call('/api/lanterns/pair', { body: { code } })).status, 403);
  // A made-up key is turned away.
  await assert.rejects(lamp('not-a-key'));
  const l = await lamp(key);
  await l.next((e) => e.type === 'hello' && e.name === 'Shelf');
  assert.deepEqual(await l.next(light), { type: 'light', level: 179, glow: false, flicker: false, people: 0 });
  const list = (await call('/api/lanterns', { token: ann.token })).data;
  assert.equal(list.lanterns[0].online, true);
  assert.equal(list.lanterns[0].paired, true);

  // A new code is for setting it up again (or passing it on): the old key stops working.
  const again = await call(`/api/lanterns/${id}/code`, { body: {}, token: ann.token });
  assert.equal(again.status, 200);
  await new Promise<void>((r) => (l.ws.readyState === WebSocket.CLOSED ? r() : l.ws.once('close', () => r())));
  await assert.rejects(lamp(key));
});

test('a lantern glows for friends at its fires and flickers while they talk, as its owner set it', async () => {
  const [ann, bob, cat] = await people('ann', 'bob', 'cat');
  const { fire, porch } = await hearth(ann, bob, cat);
  const { id, key } = await pairedLantern(ann);
  const fires = (await call('/api/lanterns', { token: ann.token })).data.fires;
  assert.deepEqual(fires.map((f: any) => [f.id, f.serverName]), [[fire, 'Den'], [porch, 'Den']]);

  const l = await lamp(key);
  await l.next(light);
  const b = await person(bob.token);
  await b.next((e) => e.type === 'ready');
  b.send({ type: 'voice_join', channelId: fire });
  assert.deepEqual(await l.next(light), { type: 'light', level: 179, glow: true, flicker: false, people: 1 });
  b.send({ type: 'voice_speaking', speaking: true });
  assert.equal((await l.next(light)).flicker, true);
  b.send({ type: 'voice_speaking', speaking: false });
  assert.equal((await l.next(light)).flicker, false);

  // Talk only: dark while bob just sits there, lit while he talks.
  await call(`/api/lanterns/${id}`, { method: 'PATCH', body: { lightWhen: 'talk', brightness: 40 }, token: ann.token });
  assert.deepEqual(await l.next(light), { type: 'light', level: 102, glow: false, flicker: false, people: 1 });
  b.send({ type: 'voice_speaking', speaking: true });
  assert.deepEqual(await l.next(light), { type: 'light', level: 102, glow: false, flicker: true, people: 1 });

  // At the fire only: talking makes no difference.
  await call(`/api/lanterns/${id}`, { method: 'PATCH', body: { lightWhen: 'fire' }, token: ann.token });
  assert.deepEqual(await l.next(light), { type: 'light', level: 102, glow: true, flicker: false, people: 1 });

  // Only the Back Porch: bob at the Campfire doesn't count.
  await call(`/api/lanterns/${id}`, { method: 'PATCH', body: { allFires: false, fireIds: [porch, 999999] }, token: ann.token });
  assert.equal((await l.next(light)).glow, false);
  assert.deepEqual((await call('/api/lanterns', { token: ann.token })).data.lanterns[0].fireIds, [porch]);
  const c = await person(cat.token);
  await c.next((e) => e.type === 'ready');
  c.send({ type: 'voice_join', channelId: porch });
  assert.equal((await l.next(light)).glow, true);

  // Its owner sitting down doesn't light their own lamp.
  c.send({ type: 'voice_leave' });
  assert.equal((await l.next(light)).glow, false);
  const a = await person(ann.token);
  await a.next((e) => e.type === 'ready');
  a.send({ type: 'voice_join', channelId: porch });
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!l.events.some(light));

  // Off is off.
  c.send({ type: 'voice_join', channelId: porch });
  assert.equal((await l.next(light)).people, 1);
  await call(`/api/lanterns/${id}`, { method: 'PATCH', body: { enabled: false }, token: ann.token });
  assert.deepEqual(await l.next(light), { type: 'light', level: 102, glow: false, flicker: false, people: 0 });

  // The blink to find it, and removing it closes its connection.
  assert.equal((await call(`/api/lanterns/${id}/blink`, { body: {}, token: ann.token })).status, 200);
  await l.next((e) => e.type === 'blink');
  assert.equal((await call(`/api/lanterns/${id}`, { method: 'DELETE', token: ann.token })).status, 200);
  await l.next((e) => e.type === 'forget');
  await new Promise<void>((r) => (l.ws.readyState === WebSocket.CLOSED ? r() : l.ws.once('close', () => r())));
  assert.equal((await call(`/api/lanterns/${id}/blink`, { body: {}, token: ann.token })).status, 404);
  for (const s of [a, b, c]) s.ws.close();
});

test('settings are checked', async () => {
  const [ann] = await people('ann');
  const { id } = await pairedLantern(ann);
  const patch = (body: unknown) => call(`/api/lanterns/${id}`, { method: 'PATCH', body, token: ann.token });
  assert.equal((await patch({ lightWhen: 'always' })).status, 400);
  assert.equal((await patch({ name: '   ' })).status, 400);
  assert.equal((await patch({ fireIds: 'all' })).status, 400);
  assert.equal((await patch({ brightness: 'loud' })).status, 400);
  assert.equal((await patch({ brightness: 500 })).data.lantern.brightness, 100);
  assert.equal((await patch({ brightness: 0 })).data.lantern.brightness, 5);
  for (let i = 1; i < 10; i++) assert.equal((await call('/api/lanterns', { body: { name: `L${i}` }, token: ann.token })).status, 200);
  assert.equal((await call('/api/lanterns', { body: { name: 'One too many' }, token: ann.token })).status, 400);
});

// Last: the wrong codes here use up this address's tries for the tests above.
test('wrong codes are limited, and lanterns are private to their owner', async () => {
  const [ann, bob] = await people('ann', 'bob');
  const { id } = await pairedLantern(ann);
  assert.equal((await call(`/api/lanterns/${id}`, { method: 'PATCH', body: { enabled: false }, token: bob.token })).status, 404);
  assert.equal((await call(`/api/lanterns/${id}`, { method: 'DELETE', token: bob.token })).status, 404);
  assert.deepEqual((await call('/api/lanterns', { token: bob.token })).data.lanterns, []);
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await call('/api/lanterns/pair', { body: { code: 'AAAA-AAAA' } })).status;
  assert.equal(last, 429);
});
