// Spatial sound at a fire: the per-fire setting on the server, and the client's mixing math
// (client/js/spatial.js), which a map of the hearth can reuse with positions of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { caller, listening } from './helpers.ts';

const app = createApp({ db: openDb(':memory:'), publicDir: '/nonexistent' });
let base = '';
listening(app, (url) => (base = url));
const call = caller(() => base);

let n = 0;
const person = async (name: string) => (await call('/api/register', { body: { username: `${name}${++n}`, password: 'password1' } })).data;

test('a fire has spatial sound off until someone who manages rooms turns it on', async () => {
  const host = await person('host');
  const bob = await person('bob');
  const server = (await call('/api/servers', { body: { name: 'Den' }, token: host.token })).data;
  await call('/api/join', { body: { inviteCode: server.inviteCode }, token: bob.token });
  const made = (await call(`/api/servers/${server.id}/channels`, { body: { name: 'Campfire', kind: 'voice' }, token: host.token })).data;
  const fire = made.channels.find((c: any) => c.kind === 'voice');
  assert.equal(fire.spatialSound, false);

  const denied = await call(`/api/channels/${fire.id}`, { method: 'PATCH', body: { spatialSound: true }, token: bob.token });
  assert.equal(denied.status, 403);

  const on = await call(`/api/channels/${fire.id}`, { method: 'PATCH', body: { spatialSound: true }, token: host.token });
  assert.equal(on.status, 200);
  assert.equal(on.data.channels.find((c: any) => c.id === fire.id).spatialSound, true);
  // Everyone in the hearth sees it, so their apps mix the fire the same way.
  const seen = ((await call('/api/servers', { token: bob.token })).data as any[]).find((s) => s.id === server.id);
  assert.equal(seen.channels.find((c: any) => c.id === fire.id).spatialSound, true);

  // Text rooms don't take it.
  const room = made.channels.find((c: any) => c.kind === 'text');
  const text = await call(`/api/channels/${room.id}`, { method: 'PATCH', body: { spatialSound: true }, token: host.token });
  assert.equal(text.data.channels.find((c: any) => c.id === room.id).spatialSound, false);

  const off = await call(`/api/channels/${fire.id}`, { method: 'PATCH', body: { spatialSound: false }, token: host.token });
  assert.equal(off.data.channels.find((c: any) => c.id === fire.id).spatialSound, false);
});

function loadSpatial() {
  const sandbox: Record<string, any> = { window: {}, Math };
  const src = readFileSync(join(import.meta.dirname, '../../client/js/spatial.js'), 'utf8');
  runInNewContext(`${src}\n;Object.assign(globalThis, { hearFrom, fireLayout, fireSeats, FIRE_HEARING });`, sandbox);
  return sandbox;
}

test('at the fire, neighbours are beside you and the far side is quieter', () => {
  const { fireLayout, hearFrom, FIRE_HEARING } = loadSpatial();
  // Six seats from the top right, clockwise as drawn: 1 back right, 2 right, 3 front right,
  // 4 front left, 5 left, 6 back left.
  const ch = { voiceUsers: [1, 2, 3, 4, 5, 6], userLimit: 0 };
  const { spots, ear } = fireLayout(ch, 4); // sitting front left, facing the fire
  const at = (id: number) => hearFrom(ear, spots.get(id), FIRE_HEARING);
  // Facing the fire from the front, the seat on screen to your right is on your right.
  assert.ok(at(3).pan > 0.3, `seat 3 pan ${at(3).pan}`);
  assert.ok(at(5).pan < -0.3, `seat 5 pan ${at(5).pan}`);
  // Straight across is in front of you: centred, and the quietest.
  assert.ok(Math.abs(at(1).pan) < 0.01);
  for (const id of [2, 3, 5, 6]) assert.ok(at(1).gain < at(id).gain);
  assert.ok(Math.abs(at(1).gain - FIRE_HEARING.floor) < 1e-9);
  // Never fully in one ear, never silent.
  for (const id of [1, 2, 3, 5, 6]) {
    assert.ok(Math.abs(at(id).pan) <= FIRE_HEARING.width);
    assert.ok(at(id).gain >= FIRE_HEARING.floor && at(id).gain <= 1);
  }
});

test('you are seated even before the server lists you, and a seat limit sets the circle', () => {
  const { fireSeats } = loadSpatial();
  assert.equal(JSON.stringify(fireSeats({ voiceUsers: [7] }, 9)), JSON.stringify({ ids: [7, 9], total: 6 }));
  assert.equal(fireSeats({ voiceUsers: [1, 2], userLimit: 10 }, 1).total, 10);
  assert.equal(fireSeats({ voiceUsers: [1, 2], userLimit: 40 }, 1).total, 6);
});

test('out of range on a map, someone fades to nothing', () => {
  const { hearFrom } = loadSpatial();
  const ear = { x: 0, y: 0, fx: 0, fy: -1 }; // facing up the map
  const map = { near: 2, far: 10, floor: 0 };
  assert.equal(hearFrom(ear, { x: 1, y: 0 }, map).gain, 1);
  assert.equal(hearFrom(ear, { x: 12, y: 0 }, map).gain, 0);
  assert.ok(hearFrom(ear, { x: 5, y: 0 }, map).pan > 0.99); // to the right
});
