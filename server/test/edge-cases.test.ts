import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';

// Edge cases from the October 2026 audit: bots after they're removed, half-saved changes,
// someone at the fire on two devices, and the like.
const uploadDir = mkdtempSync(join(tmpdir(), 'peiskos-edges-'));
const db = openDb(':memory:');
// No LiveKit server behind it: the calls to it fail quietly, which is fine here.
const voice = { apiKey: 'devkey', apiSecret: 'a-secret-that-is-at-least-32-characters-long', apiUrl: 'http://127.0.0.1:9' };
const app = createApp({ db, publicDir: '/nonexistent', uploadDir, voice });
let base = '';
before(async () => {
  await new Promise<void>((r) => app.listen(0, r));
  base = `http://localhost:${(app.address() as AddressInfo).port}`;
});
after(() => {
  app.closeAllConnections();
  app.close();
  rmSync(uploadDir, { recursive: true, force: true });
});

async function call(path: string, opts: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, data: (await res.json()) as any };
}
let n = 0;
const reg = async (name: string) => (await call('/api/register', { body: { username: `${name}${++n}`, password: 'password1' } })).data;
const burrowWith = async (host: any, ...others: any[]) => {
  const server = (await call('/api/servers', { body: { name: 'Den' }, token: host.token })).data;
  for (const p of others) await call('/api/join', { body: { inviteCode: server.inviteCode }, token: p.token });
  return server;
};
async function socket(token: string) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?token=${token}`);
  const events: any[] = [];
  ws.on('message', (raw) => events.push(JSON.parse(String(raw))));
  const next = async (pred: (e: any) => boolean) => {
    for (let i = 0; i < 100; i++) {
      const i2 = events.findIndex(pred);
      if (i2 >= 0) return events.splice(i2, 1)[0];
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('timed out waiting for event');
  };
  const send = (msg: unknown) => ws.send(JSON.stringify(msg));
  await next((e) => e.type === 'ready');
  return { ws, events, next, send };
}
const fireOf = async (host: any, server: any) => {
  const s = (await call(`/api/servers/${server.id}/channels`, { body: { name: 'Campfire', kind: 'voice' }, token: host.token })).data;
  return s.channels.find((c: any) => c.kind === 'voice').id as number;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('the desktop and phone apps can send PUT (fire looks, pets, the thing you bring)', async () => {
  const res = await fetch(base + '/api/me/fire', { method: 'OPTIONS' });
  assert.match(res.headers.get('access-control-allow-methods') ?? '', /\bPUT\b/);
});

test('@name pings that person, not someone whose name only starts the same', async () => {
  const [max, sam] = [await reg('max'), await reg('sam')];
  const server = await burrowWith(max, sam);
  const room = server.channels[0].id;
  const name = sam.user.username;
  for (const content of [`hi @${name}-bot`, `see @${name}.old`, `hey @${name}.`, `@${name}, you there?`])
    await call(`/api/channels/${room}/messages`, { body: { content }, token: max.token });
  const inbox = (await call('/api/mentions', { token: sam.token })).data.messages.map((m: any) => m.content);
  assert.deepEqual(inbox.sort(), [`@${name}, you there?`, `hey @${name}.`].sort());
});

test('removing a bot from a hearth retires it, webhook and all', async () => {
  const max = await reg('max');
  const s = await burrowWith(max);
  const room = s.channels[0].id;
  const hook = (await call(`/api/channels/${room}/webhooks`, { body: { name: 'GitHub' }, token: max.token })).data;
  const path = new URL(hook.url).pathname;
  const bot = (await call(`/api/servers/${s.id}/bots`, { body: { name: 'Dice' }, token: max.token })).data;
  await call(`/api/servers/${s.id}/members/${hook.webhooks[0].userId}/remove`, { body: {}, token: max.token });
  await call(`/api/servers/${s.id}/members/${bot.botId}/remove`, { body: {}, token: max.token });
  assert.equal((await call(path, { body: { content: 'still here?' } })).status, 404);
  assert.equal((await call('/api/me', { token: bot.token })).status, 401);
  const left = (await call(`/api/servers/${s.id}/bots`, { token: max.token })).data;
  assert.equal(left.bots.length + left.webhooks.length, 0);
});

test("a webhook can't post in an archived room", async () => {
  const max = await reg('max');
  const s = await burrowWith(max);
  const room = s.channels[0].id;
  await call(`/api/servers/${s.id}/channels`, { body: { name: 'other' }, token: max.token });
  const hook = (await call(`/api/channels/${room}/webhooks`, { body: { name: 'CI' }, token: max.token })).data;
  await call(`/api/channels/${room}`, { method: 'PATCH', body: { archived: true }, token: max.token });
  assert.equal((await call(new URL(hook.url).pathname, { body: { content: 'x' } })).status, 403);
});

test("a deleted hearth's bots stop working", async () => {
  const max = await reg('max');
  const s = await burrowWith(max);
  const bot = (await call(`/api/servers/${s.id}/bots`, { body: { name: 'Dice' }, token: max.token })).data;
  assert.equal((await call('/api/me', { token: bot.token })).status, 200);
  await call(`/api/servers/${s.id}/leave`, { body: {}, token: max.token });
  assert.equal((await call('/api/me', { token: bot.token })).status, 401);
});

test("bots can't be made host, friended or messaged directly", async () => {
  const max = await reg('max');
  const s = await burrowWith(max);
  const bot = (await call(`/api/servers/${s.id}/bots`, { body: { name: 'Dice' }, token: max.token })).data;
  assert.equal((await call(`/api/servers/${s.id}/transfer`, { body: { userId: bot.botId }, token: max.token })).status, 400);
  assert.equal((await call('/api/friends', { body: { userId: bot.botId }, token: max.token })).status, 404);
  assert.equal((await call('/api/dms', { body: { userId: bot.botId }, token: max.token })).status, 403);
});

test("the last room people can write in can't be deleted, leaving only archived ones", async () => {
  const max = await reg('max');
  const s = await burrowWith(max);
  const general = s.channels[0].id;
  const other = (await call(`/api/servers/${s.id}/channels`, { body: { name: 'old' }, token: max.token })).data.channels.find((c: any) => c.name === 'old').id;
  await call(`/api/channels/${other}`, { method: 'PATCH', body: { archived: true }, token: max.token });
  assert.equal((await call(`/api/channels/${general}`, { method: 'DELETE', token: max.token })).status, 400);
  // The archived one can still go.
  assert.equal((await call(`/api/channels/${other}`, { method: 'DELETE', token: max.token })).status, 200);
});

test('a room change with one bad field saves none of it', async () => {
  const max = await reg('max');
  const s = await burrowWith(max);
  const room = s.channels[0].id;
  const bad = await call(`/api/channels/${room}`, { method: 'PATCH', body: { name: 'renamed', topic: 'x'.repeat(500) }, token: max.token });
  assert.equal(bad.status, 400);
  const now = (await call('/api/servers', { token: max.token })).data.find((x: any) => x.id === s.id);
  assert.equal(now.channels[0].name, 'general');
});

test('a profile change with one bad field saves none of it', async () => {
  const max = await reg('max');
  const bad = await call('/api/me', { method: 'PATCH', body: { displayName: 'Maxi', status: 'sleeping' }, token: max.token });
  assert.equal(bad.status, 400);
  assert.equal((await call('/api/me', { token: max.token })).data.displayName, null);
});

test("messages in an archived room can't be edited, nor while timed out", async () => {
  const [max, sam] = [await reg('max'), await reg('sam')];
  const s = await burrowWith(max, sam);
  const room = s.channels[0].id;
  await call(`/api/servers/${s.id}/channels`, { body: { name: 'other' }, token: max.token });
  const m = (await call(`/api/channels/${room}/messages`, { body: { content: 'first' }, token: sam.token })).data;
  await call(`/api/servers/${s.id}/members/${sam.user.id}/timeout`, { body: { minutes: 10 }, token: max.token });
  assert.equal((await call(`/api/messages/${m.id}`, { method: 'PATCH', body: { content: 'sneaky' }, token: sam.token })).status, 403);
  await call(`/api/servers/${s.id}/members/${sam.user.id}/timeout`, { body: { minutes: 0 }, token: max.token });
  await call(`/api/channels/${room}`, { method: 'PATCH', body: { archived: true }, token: max.token });
  assert.equal((await call(`/api/messages/${m.id}`, { method: 'PATCH', body: { content: 'later' }, token: sam.token })).status, 403);
});

test("someone blocked can't ring you", async () => {
  const [max, sam] = [await reg('max'), await reg('sam')];
  await burrowWith(max, sam);
  const dm = (await call('/api/dms', { body: { userId: sam.user.id }, token: max.token })).data;
  await call('/api/blocks', { body: { userId: max.user.id }, token: sam.token });
  assert.equal((await call(`/api/dms/${dm.id}/call`, { body: {}, token: max.token })).status, 403);
});

test('leaving a group conversation takes you out of its call', async () => {
  const [max, sam, ann] = [await reg('max'), await reg('sam'), await reg('ann')];
  await burrowWith(max, sam, ann);
  const group = (await call('/api/dms', { body: { userIds: [sam.user.id, ann.user.id] }, token: max.token })).data;
  const { channelId } = (await call(`/api/dms/${group.id}/call`, { body: {}, token: max.token })).data;
  const m = await socket(max.token);
  const s = await socket(sam.token);
  m.send({ type: 'voice_join', channelId });
  s.send({ type: 'voice_join', channelId });
  await s.next((e) => e.type === 'voice_state' && e.userIds.length === 2);
  await call(`/api/servers/${group.id}/leave`, { body: {}, token: max.token });
  await s.next((e) => e.type === 'voice_state' && e.userIds.length === 1 && e.userIds[0] === sam.user.id);
  m.ws.close();
  s.ws.close();
});

test('at the fire on one device: that device going offline takes you out, even with another one open', async () => {
  const [max, sam] = [await reg('max'), await reg('sam')];
  const server = await burrowWith(max, sam);
  const fire = await fireOf(max, server);
  const desktop = await socket(max.token);
  const phone = await socket(max.token);
  const watcher = await socket(sam.token);
  desktop.send({ type: 'voice_join', channelId: fire });
  await watcher.next((e) => e.type === 'voice_state' && e.userIds.includes(max.user.id));
  // The phone isn't at the fire, so it can't get up from it (or mute) on the desktop's behalf.
  phone.send({ type: 'voice_leave' });
  phone.send({ type: 'voice_status', muted: true });
  await wait(150);
  assert.ok(!watcher.events.some((e) => e.type === 'voice_state' && (!e.userIds.includes(max.user.id) || e.muted.includes(max.user.id))));
  desktop.ws.close();
  await watcher.next((e) => e.type === 'voice_state' && !e.userIds.includes(max.user.id));
  phone.ws.close();
  watcher.ws.close();
});

test('sitting down on a second device tells the first one to get up', async () => {
  const max = await reg('max');
  const server = await burrowWith(max);
  const fire = await fireOf(max, server);
  const desktop = await socket(max.token);
  const phone = await socket(max.token);
  desktop.send({ type: 'voice_join', channelId: fire });
  await desktop.next((e) => e.type === 'voice_state' && e.userIds.includes(max.user.id));
  phone.send({ type: 'voice_join', channelId: fire });
  await desktop.next((e) => e.type === 'voice_elsewhere');
  // The first device leaving afterwards doesn't take the second one out.
  desktop.send({ type: 'voice_leave' });
  desktop.ws.close();
  await wait(150);
  const s = (await call('/api/servers', { token: max.token })).data.find((x: any) => x.id === server.id);
  assert.deepEqual(s.channels.find((c: any) => c.id === fire).voiceUsers, [max.user.id]);
  phone.ws.close();
});
