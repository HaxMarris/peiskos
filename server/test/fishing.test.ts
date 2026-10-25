import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { MAX_SAVE_BYTES, cleanStatus, loadSpecies } from '../src/fishing.ts';

const db = openDb(':memory:');
const app = createApp({ db, publicDir: '/nonexistent' });
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
function listen(token: string) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws?token=' + token);
  const events: any[] = [];
  ws.on('message', (d) => events.push(JSON.parse(String(d))));
  const ready = new Promise<void>((r) => ws.once('message', () => r()));
  return { ws, events, ready };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reg = async (username: string) => (await call('/api/register', { body: { username, password: 'password1' } })).data;

test('the fishing save is per person per hearth, and an older device cannot overwrite a newer save', async () => {
  const a = await reg('angler');
  const b = await reg('lurker');
  const hearth = (await call('/api/servers', { body: { name: 'Lake' }, token: a.token })).data;
  const other = (await call('/api/servers', { body: { name: 'Sea' }, token: a.token })).data;
  const path = `/api/servers/${hearth.id}/fishing`;

  // Someone new has no save yet.
  assert.deepEqual((await call(path, { token: a.token })).data, { save: null, rev: 0, savedAt: 0 });

  const first = await call(path, { token: a.token, body: { save: { v: 2, coins: 10 }, rev: 0 } });
  assert.equal(first.status, 200);
  assert.equal(first.data.conflict, false);
  assert.equal(first.data.rev, 1);
  assert.deepEqual((await call(path, { token: a.token })).data.save, { v: 2, coins: 10 });

  // The phone saves next, from version 1...
  assert.equal((await call(path, { token: a.token, body: { save: { v: 2, coins: 50 }, rev: 1 } })).data.rev, 2);
  // ...so the desktop, still on version 1, gets the phone's save back instead of overwriting it.
  const stale = await call(path, { token: a.token, body: { save: { v: 2, coins: 11 }, rev: 1 } });
  assert.equal(stale.data.conflict, true);
  assert.equal(stale.data.rev, 2);
  assert.deepEqual(stale.data.save, { v: 2, coins: 50 });

  // Another hearth is a fresh start, and nobody outside a hearth can read or write its saves.
  assert.equal((await call(`/api/servers/${other.id}/fishing`, { token: a.token })).data.save, null);
  assert.equal((await call(path, { token: b.token })).status, 404);
  assert.equal((await call(path, { token: b.token, body: { save: { v: 2 }, rev: 0 } })).status, 404);

  // Only an object, and not a huge one.
  assert.equal((await call(path, { token: a.token, body: { save: [1, 2], rev: 2 } })).status, 400);
  assert.equal((await call(path, { token: a.token, body: { save: { v: 2 }, rev: -1 } })).status, 400);
  assert.equal((await call(path, { token: a.token, body: { save: { pad: 'x'.repeat(MAX_SAVE_BYTES) }, rev: 2 } })).status, 413);
  assert.deepEqual((await call(path, { token: a.token })).data.save, { v: 2, coins: 50 });
});

test('the game\'s fish are all read from its file', () => {
  const species = loadSpecies();
  assert.equal(species.size, 115);
  assert.deepEqual(species.get('leviathan'), { name: 'Ember Leviathan', min: 300, max: 900, base: 46000, rarity: 5 });
});

test("today's best keeps each person's most valuable catch", async () => {
  const a = await reg('pike_queen');
  const b = await reg('roach_king');
  const c = await reg('outsider');
  const hearth = (await call('/api/servers', { body: { name: 'Board' }, token: a.token })).data;
  await call('/api/join', { body: { inviteCode: hearth.inviteCode }, token: b.token });
  const path = `/api/servers/${hearth.id}/fishing`;
  const send = (token: string, c: object) => call(`${path}/catch`, { token, body: c });

  assert.deepEqual((await call(`${path}/board`, { token: a.token })).data.rows, []);

  // A roach (worth 4 at its smallest) at 90/100 and 2 stars, then a cheaper one that doesn't replace it.
  assert.equal((await send(b.token, { f: 'roach', s: 32.5, t: 90, q: 2 })).data.best, true);
  assert.equal((await send(b.token, { f: 'roach', s: 22.5, t: 50, q: 1 })).data.best, false);
  // A giant 5-star roach is worth more, even though nothing else changed.
  assert.equal((await send(b.token, { f: 'roach', s: 35, t: 100, q: 5, g: true })).data.best, true);
  // An Ember Leviathan is worth far more than any roach.
  assert.equal((await send(a.token, { f: 'leviathan', s: 660, t: 60, q: 3, idle: true })).data.best, true);
  assert.equal((await send(a.token, { f: 'leviathan', s: 360, t: 10, q: 1 })).data.best, false);

  const rows = (await call(`${path}/board`, { token: b.token })).data.rows;
  // 46000 x 1.1 x 1.5, and 4 x 1.5 x 5 x 3 for the giant.
  assert.deepEqual(rows.map((r: any) => [r.name, r.fish, r.worth, r.idle]), [['pike_queen', 'leviathan', 75900, 1], ['roach_king', 'roach', 90, 0]]);

  // Catches that don't add up, and people outside the hearth, are turned away.
  assert.equal((await send(a.token, { f: 'nessie', s: 10, t: 50, q: 3 })).status, 400);
  assert.equal((await send(a.token, { f: 'roach', s: 900, t: 100, q: 5 })).status, 400);
  assert.equal((await send(a.token, { f: 'roach', s: 35, t: 100, q: 6 })).status, 400);
  assert.equal((await send(c.token, { f: 'roach', s: 35, t: 100, q: 5 })).status, 404);
  assert.equal((await call(`${path}/board`, { token: c.token })).status, 404);
});

test('a status on the dock keeps only what the others need to see', () => {
  assert.equal(cleanStatus({ pond: 'mill', hat: '<b>', rod: 'glass' }), null);
  const st = cleanStatus({ pond: 'mill', hat: 'viking', rod: 'glass', phase: 'bite', bob: [1.4, 0.6], caught: { f: 'pike', s: 61.04, q: 4 }, secret: 'x' })!;
  assert.deepEqual({ ...st, caught: { ...st.caught, at: 0 } }, { pond: 'mill', hat: 'viking', rod: 'glass', phase: 'bite', bob: [1, 0.6], caught: { f: 'pike', s: 61, q: 4, at: 0 } });
  // Not fishing, so no bobber; a bad catch is left out.
  assert.deepEqual(cleanStatus({ pond: 'mill', hat: 'straw', rod: 'willow', phase: 'nap', bob: [0.5, 0.5], caught: { f: 'pike', s: 10, q: 9 } }), { pond: 'mill', hat: 'straw', rod: 'willow', phase: 'idle', bob: null, caught: null });
});

test('friends fishing at the same fire see each other on the dock', async (t) => {
  const a = await reg('dock_a');
  const b = await reg('dock_b');
  const hearth = (await call('/api/servers', { body: { name: 'Dock' }, token: a.token })).data;
  await call('/api/join', { body: { inviteCode: hearth.inviteCode }, token: b.token });
  const made = (await call(`/api/servers/${hearth.id}/channels`, { body: { name: 'Fire', kind: 'voice' }, token: a.token })).data;
  const room = made.channels.find((c: any) => c.kind === 'voice');
  const A = listen(a.token), B = listen(b.token);
  t.after(() => { A.ws.close(); B.ws.close(); });
  await Promise.all([A.ready, B.ready]);
  const status = { pond: 'mill', hat: 'viking', rod: 'glass', phase: 'wait', bob: [0.6, 0.65] };
  const docks = (x: { events: any[] }) => x.events.filter((e) => e.type === 'fishing_dock');

  // Not at a fire: nothing goes anywhere.
  A.ws.send(JSON.stringify({ type: 'fishing', status }));
  A.ws.send(JSON.stringify({ type: 'voice_join', channelId: room.id }));
  B.ws.send(JSON.stringify({ type: 'voice_join', channelId: room.id }));
  await wait(100);
  assert.equal(docks(B).length, 0);

  A.ws.send(JSON.stringify({ type: 'fishing', status }));
  await wait(100);
  assert.deepEqual(docks(B).map((e) => [e.userId, e.status.hat, e.status.phase]), [[a.user.id, 'viking', 'wait']]);
  assert.equal(docks(A).length, 0);

  // B opens the game too, and sees A already fishing.
  B.ws.send(JSON.stringify({ type: 'fishing', status: { ...status, hat: 'straw' } }));
  await wait(100);
  assert.deepEqual(docks(B).at(-1).userId, a.user.id);
  assert.deepEqual(docks(A).map((e) => [e.userId, e.status.hat]), [[b.user.id, 'straw']]);

  // A closes the game, then B leaves the fire: each goes off the other's dock.
  A.ws.send(JSON.stringify({ type: 'fishing', status: null }));
  await wait(100);
  assert.deepEqual(docks(B).at(-1), { type: 'fishing_dock', channelId: room.id, userId: a.user.id, status: null });
  B.ws.send(JSON.stringify({ type: 'voice_leave' }));
  await wait(100);
  assert.deepEqual(docks(A).at(-1), { type: 'fishing_dock', channelId: room.id, userId: b.user.id, status: null });
});
