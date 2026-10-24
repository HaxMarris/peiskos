import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { MAX_SAVE_BYTES } from '../src/fishing.ts';

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
