// Hearthland: the hearth map's setting, everyone's look, and where people stand on the map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { cleanLook, cleanSpot, MAP_W } from '../src/hearthland.ts';
import { caller, listening } from './helpers.ts';

const app = createApp({ db: openDb(':memory:'), publicDir: '/nonexistent' });
let base = '';
listening(app, (url) => (base = url));
const call = caller(() => base);

let n = 0;
const person = async (name: string) => (await call('/api/register', { body: { username: `${name}${++n}`, password: 'password1' } })).data;
function listen(token: string) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws?token=' + token);
  const events: any[] = [];
  ws.on('message', (d) => events.push(JSON.parse(String(d))));
  const ready = new Promise<void>((r) => ws.once('message', () => r()));
  return { ws, events, ready, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LOOK = { skin: 2, hair: 1, topColor: 0, pants: 0, hairStyle: 'short', top: 'hoodie', hat: 'none' };

async function hearth() {
  const host = await person('host');
  const bob = await person('bob');
  const server = (await call('/api/servers', { body: { name: 'Den' }, token: host.token })).data;
  await call('/api/join', { body: { inviteCode: server.inviteCode }, token: bob.token });
  return { host, bob, server };
}

test('a hearth has no map until its managers turn it on', async () => {
  const { host, bob, server } = await hearth();
  assert.equal(server.hearthland, false);
  const denied = await call(`/api/servers/${server.id}`, { method: 'PATCH', body: { hearthland: true }, token: bob.token });
  assert.equal(denied.status, 403);
  const on = await call(`/api/servers/${server.id}`, { method: 'PATCH', body: { hearthland: true }, token: host.token });
  assert.equal(on.status, 200);
  assert.equal(on.data.hearthland, true);
  const seen = ((await call('/api/servers', { token: bob.token })).data as any[]).find((s) => s.id === server.id);
  assert.equal(seen.hearthland, true);
});

test('a look is checked part by part, saved, and shown to the people in your hearths', async () => {
  const { host, bob, server } = await hearth();
  assert.equal((await call('/api/me/look', { method: 'PUT', body: { look: { ...LOOK, hat: 'jetpack' } }, token: bob.token })).status, 400);
  assert.equal((await call('/api/me/look', { method: 'PUT', body: { look: { ...LOOK, skin: 99 } }, token: bob.token })).status, 400);
  assert.equal((await call('/api/me/look', { method: 'PUT', body: { look: 'red' }, token: bob.token })).status, 400);

  const watch = listen(host.token);
  await watch.ready;
  const saved = await call('/api/me/look', { method: 'PUT', body: { look: { ...LOOK, hat: 'antlers', extra: '<b>' } }, token: bob.token });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.look, { ...LOOK, hat: 'antlers' });
  await wait(50);
  const update = watch.events.find((e) => e.type === 'user_updated' && e.user.id === bob.user.id);
  assert.deepEqual(update?.user.look, { ...LOOK, hat: 'antlers' });
  const members = ((await call('/api/servers', { token: host.token })).data as any[]).find((s) => s.id === server.id).members;
  assert.deepEqual(members.find((m: any) => m.id === bob.user.id).look, { ...LOOK, hat: 'antlers' });
  assert.equal(members.find((m: any) => m.id === host.user.id).look, null);
  watch.ws.close();
});

test('where people stand goes to the others on that map, and they vanish when they leave', async () => {
  const { host, bob, server } = await hearth();
  const a = listen(host.token), b = listen(bob.token);
  await Promise.all([a.ready, b.ready]);

  // No map yet: refused.
  a.send({ type: 'map', serverId: server.id, x: 10, y: 10 });
  await wait(50);
  assert.ok(a.events.some((e) => e.type === 'error'));

  await call(`/api/servers/${server.id}`, { method: 'PATCH', body: { hearthland: true }, token: host.token });
  a.send({ type: 'map', serverId: server.id, x: 10, y: 10 });
  await wait(50);
  assert.deepEqual(a.events.find((e) => e.type === 'map_state')?.walkers, []);

  b.send({ type: 'map', serverId: server.id, x: 12.345, y: 999, moving: true });
  await wait(50);
  assert.deepEqual(b.events.find((e) => e.type === 'map_state')?.walkers, [{ userId: host.user.id, x: 10, y: 10, moving: false }]);
  const moved = a.events.find((e) => e.type === 'map_move' && e.userId === bob.user.id);
  assert.deepEqual({ x: moved.x, y: moved.y, moving: moved.moving }, { x: 12.35, y: 30, moving: true });

  b.send({ type: 'map', serverId: null });
  await wait(50);
  assert.ok(a.events.some((e) => e.type === 'map_gone' && e.userId === bob.user.id));

  // Turning the map off takes everyone off it.
  b.send({ type: 'map', serverId: server.id, x: 5, y: 5 });
  await wait(50);
  await call(`/api/servers/${server.id}`, { method: 'PATCH', body: { hearthland: false }, token: host.token });
  await wait(50);
  assert.ok(b.events.some((e) => e.type === 'map_gone' && e.userId === host.user.id));
  const before = b.events.length;
  a.send({ type: 'map', serverId: server.id, x: 6, y: 6 });
  await wait(50);
  assert.ok(!b.events.slice(before).some((e) => e.type === 'map_move'));
  a.ws.close();
  b.ws.close();
});

test('people outside the hearth cannot get on its map', async () => {
  const { host, server } = await hearth();
  await call(`/api/servers/${server.id}`, { method: 'PATCH', body: { hearthland: true }, token: host.token });
  const eve = await person('eve');
  const e = listen(eve.token), a = listen(host.token);
  await Promise.all([e.ready, a.ready]);
  a.send({ type: 'map', serverId: server.id, x: 10, y: 10 });
  e.send({ type: 'map', serverId: server.id, x: 10, y: 10 });
  await wait(80);
  assert.ok(!e.events.some((x) => x.type === 'map_state'));
  assert.ok(!a.events.some((x) => x.type === 'map_move'));
  e.ws.close();
  a.ws.close();
});

test('spots are clamped to the map and rounded', () => {
  assert.deepEqual(cleanSpot({ x: -4, y: 1.23456, moving: 'yes' }), { x: 0, y: 1.23, moving: false });
  assert.equal(cleanSpot({ x: 'a', y: 1 }), null);
  assert.equal(cleanSpot({ x: 1e9, y: 1 })?.x, MAP_W);
  assert.deepEqual(cleanLook(LOOK), LOOK);
});
