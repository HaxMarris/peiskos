import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';

const uploadDir = join(mkdtempSync(join(tmpdir(), 'burrow-uploads-')), 'uploads');
const app = createApp({ db: openDb(':memory:'), publicDir: '/nonexistent', uploadDir, maxUploadBytes: 1000 });
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

const upload = (channelId: number, token: string, data: string | Uint8Array, name: string, type: string) =>
  fetch(`${base}/api/channels/${channelId}/attachments`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': type, 'x-filename': encodeURIComponent(name) },
    body: data,
  });

test('uploading, sending and downloading files', async () => {
  assert.equal((await call('/api/config')).data.maxUploadBytes, 1000);
  const max = (await call('/api/register', { body: { username: 'max', password: 'password1' } })).data;
  const sam = (await call('/api/register', { body: { username: 'sam', password: 'password2' } })).data;
  const server = (await call('/api/servers', { body: { name: 'Den' }, token: max.token })).data;
  const room = server.channels[0].id;

  // Only members can upload, and size is limited.
  assert.equal((await upload(room, sam.token, 'x', 'a.txt', 'text/plain')).status, 404);
  assert.equal((await upload(room, max.token, 'x'.repeat(1001), 'big.bin', 'application/octet-stream')).status, 413);

  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const pic = await (await upload(room, max.token, png, 'cabin photo.png', 'image/png')).json() as any;
  assert.equal(pic.name, 'cabin photo.png');
  assert.equal(pic.size, png.length);
  const page = await (await upload(room, max.token, '<script>alert(1)</script>', '../evil.html', 'text/html')).json() as any;
  assert.equal(page.name, '.._evil.html');

  // Not downloadable until sent in a message.
  assert.equal((await fetch(base + pic.url)).status, 404);

  // Someone else can't send your upload.
  await call('/api/join', { body: { inviteCode: server.inviteCode }, token: sam.token });
  assert.equal((await call(`/api/channels/${room}/messages`, { body: { attachmentIds: [pic.id] }, token: sam.token })).status, 400);

  // Files keep the order they were attached in, not the order they finished uploading.
  const msg = (await call(`/api/channels/${room}/messages`, { body: { content: '', attachmentIds: [page.id, pic.id] }, token: max.token })).data;
  assert.deepEqual(msg.attachments.map((a: any) => a.name), ['.._evil.html', 'cabin photo.png']);
  // Already used.
  assert.equal((await call(`/api/channels/${room}/messages`, { body: { attachmentIds: [pic.id] }, token: max.token })).status, 400);
  // Plain empty messages are still refused.
  assert.equal((await call(`/api/channels/${room}/messages`, { body: { content: '  ' }, token: max.token })).status, 400);

  const history = (await call(`/api/channels/${room}/messages`, { token: sam.token })).data;
  assert.equal(history[0].attachments.length, 2);

  // Images show inline; anything else is a download that can't run in the page.
  const img = await fetch(base + pic.url);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.match(img.headers.get('content-disposition')!, /^inline/);
  assert.deepEqual(new Uint8Array(await img.arrayBuffer()), png);
  const html = await fetch(base + page.url);
  assert.equal(html.headers.get('content-type'), 'application/octet-stream');
  assert.match(html.headers.get('content-disposition')!, /^attachment/);
  assert.match(html.headers.get('content-security-policy')!, /sandbox/);
  await html.text();

  // Deleting the message deletes its files.
  assert.equal(readdirSync(uploadDir).length, 2);
  await call(`/api/messages/${msg.id}`, { method: 'DELETE', token: max.token });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(readdirSync(uploadDir).length, 0);
  assert.equal((await fetch(base + pic.url)).status, 404);
});

test('the apps may send every header the client sets', async () => {
  // The desktop and phone apps talk to the server cross-origin, so the browser asks first which
  // headers are allowed; one missing from the list makes the whole request fail.
  const clientDir = join(import.meta.dirname, '../../client/js');
  const used = new Set<string>();
  for (const f of readdirSync(clientDir)) {
    const code = readFileSync(join(clientDir, f), 'utf8');
    for (const [, name] of code.matchAll(/setRequestHeader\('([\w-]+)'/g)) used.add(name.toLowerCase());
  }
  assert.ok(used.has('x-width'));
  const res = await fetch(`${base}/api/channels/1/attachments`, { method: 'OPTIONS' });
  const allowed = String(res.headers.get('access-control-allow-headers')).split(',').map((h) => h.trim());
  for (const name of used) assert.ok(allowed.includes(name), `${name} isn't allowed cross-origin`);
});

// Sent files have no limit of their own, so a day's uploads are capped, uploads still coming in
// count against the files-waiting limit, and nothing comes in while the disk is nearly full.
async function otherApp(options: { dailyUploadBytes?: number; minFreeDiskBytes?: number }) {
  const dir = join(mkdtempSync(join(tmpdir(), 'burrow-uploads-')), 'uploads');
  const other = createApp({ db: openDb(':memory:'), publicDir: '/nonexistent', uploadDir: dir, maxUploadBytes: 1000, ...options });
  await new Promise<void>((r) => other.listen(0, r));
  const url = `http://localhost:${(other.address() as AddressInfo).port}`;
  const post = async (path: string, body: unknown, token?: string) =>
    (await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })).json() as Promise<any>;
  const me = await post('/api/register', { username: 'una', password: 'password1' });
  const room = (await post('/api/servers', { name: 'Den' }, me.token)).channels[0].id;
  const send = (body: BodyInit, init: RequestInit = {}) =>
    fetch(`${url}/api/channels/${room}/attachments`, { method: 'POST', headers: { authorization: `Bearer ${me.token}`, 'content-type': 'application/octet-stream' }, body, ...init });
  const stop = () => { other.closeAllConnections(); other.close(); };
  return { send, stop, room, token: me.token, post };
}

test('uploads: a day has a limit, sent files included', async () => {
  const o = await otherApp({ dailyUploadBytes: 2500 });
  try {
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) ids.push(((await (await o.send(new Uint8Array(1000))).json()) as any).id);
    // Sending them doesn't free up the day's allowance.
    await o.post(`/api/channels/${o.room}/messages`, { content: 'files', attachmentIds: ids }, o.token);
    assert.equal((await o.send(new Uint8Array(400))).status, 200);
    const over = await o.send(new Uint8Array(400));
    assert.equal(over.status, 429);
    assert.match(((await over.json()) as any).error, /today/);
  } finally { o.stop(); }
});

test('uploads: many started at once still count against the files waiting', async () => {
  const o = await otherApp({});
  try {
    const slow = () => o.send(new ReadableStream({ async pull(c) { await new Promise((r) => setTimeout(r, 300)); c.enqueue(new Uint8Array(10)); c.close(); } }), { duplex: 'half' } as RequestInit);
    const statuses = await Promise.all(Array.from({ length: 40 }, () => slow().then((r) => r.status)));
    assert.equal(statuses.filter((s) => s === 200).length, 30);
  } finally { o.stop(); }
});

test('uploads: none while the disk is nearly full', async () => {
  const o = await otherApp({ minFreeDiskBytes: Number.MAX_SAFE_INTEGER });
  try {
    assert.equal((await o.send(new Uint8Array(10))).status, 507);
  } finally { o.stop(); }
});
