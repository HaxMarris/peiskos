import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { MAX_SAVE_BYTES, loadSpecies } from '../src/fishing.ts';

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
  assert.deepEqual(species.get('leviathan'), { name: 'Ember Leviathan', min: 300, max: 900, rarity: 5 });
});

test("today's biggest keeps each person's best catch, ranked by size for its species", async () => {
  const a = await reg('pike_queen');
  const b = await reg('roach_king');
  const c = await reg('outsider');
  const hearth = (await call('/api/servers', { body: { name: 'Board' }, token: a.token })).data;
  await call('/api/join', { body: { inviteCode: hearth.inviteCode }, token: b.token });
  const path = `/api/servers/${hearth.id}/fishing`;
  const send = (token: string, c: object) => call(`${path}/catch`, { token, body: c });

  assert.deepEqual((await call(`${path}/board`, { token: a.token })).data.rows, []);

  // Common roach (10-35 cm) at 90/100, then a worse one that doesn't replace it.
  assert.equal((await send(b.token, { f: 'roach', s: 32.5, t: 90, q: 2 })).data.best, true);
  assert.equal((await send(b.token, { f: 'roach', s: 22.5, t: 50, q: 5 })).data.best, false);
  // An Ember Leviathan (300-900 cm) at 60/100 is huge, but small for a leviathan.
  assert.equal((await send(a.token, { f: 'leviathan', s: 660, t: 60, q: 3 })).data.best, true);

  let rows = (await call(`${path}/board`, { token: b.token })).data.rows;
  assert.deepEqual(rows.map((r: any) => [r.name, r.fish, r.score]), [['roach_king', 'roach', 90], ['pike_queen', 'leviathan', 60]]);

  // A tie on size goes to more stars.
  await send(a.token, { f: 'leviathan', s: 840, t: 90, q: 4, g: false, idle: true });
  rows = (await call(`${path}/board`, { token: a.token })).data.rows;
  assert.deepEqual(rows.map((r: any) => [r.name, r.stars, r.idle]), [['pike_queen', 4, 1], ['roach_king', 2, 0]]);

  // Catches that don't add up, and people outside the hearth, are turned away.
  assert.equal((await send(a.token, { f: 'nessie', s: 10, t: 50, q: 3 })).status, 400);
  assert.equal((await send(a.token, { f: 'roach', s: 900, t: 100, q: 5 })).status, 400);
  assert.equal((await send(a.token, { f: 'roach', s: 35, t: 100, q: 6 })).status, 400);
  assert.equal((await send(c.token, { f: 'roach', s: 35, t: 100, q: 5 })).status, 404);
  assert.equal((await call(`${path}/board`, { token: c.token })).status, 404);
});
