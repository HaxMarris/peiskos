import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';

const dir = mkdtempSync(join(tmpdir(), 'burrow-static-'));
const script = 'console.log("hello burrow");\n'.repeat(200);
writeFileSync(join(dir, 'index.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\' file:" /><title>Burrow</title>');
writeFileSync(join(dir, 'app.js'), script);
mkdirSync(join(dir, 'vendor', 'noto-emoji'), { recursive: true });
writeFileSync(join(dir, 'vendor', 'noto-emoji', '1f525.webp'), Buffer.from('RIFF\0\0\0\0WEBP'));
mkdirSync(join(dir, 'fonts'), { recursive: true });
writeFileSync(join(dir, 'fonts', 'nunito-sans.woff2'), Buffer.from('wOF2font'));
const app = createApp({ db: openDb(':memory:'), publicDir: dir });
let port = 0;

before(async () => {
  await new Promise<void>((r) => app.listen(0, r));
  port = (app.address() as AddressInfo).port;
});
after(() => {
  app.closeAllConnections();
  app.close();
});

// fetch() always asks for compression and unpacks it, so this asks with raw headers instead.
function get(path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: Record<string, any>; body: Buffer }>((resolve, reject) => {
    request({ port, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject).end();
  });
}

test('app files are compressed for browsers that accept it', async () => {
  const br = await get('/app.js', { 'accept-encoding': 'gzip, deflate, br' });
  assert.equal(br.headers['content-encoding'], 'br');
  assert.ok(br.body.length < script.length / 10);
  assert.equal(brotliDecompressSync(br.body).toString(), script);

  const gz = await get('/app.js', { 'accept-encoding': 'gzip' });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.equal(gunzipSync(gz.body).toString(), script);

  const plain = await get('/app.js', { 'accept-encoding': 'br;q=0' });
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.equal(plain.body.toString(), script);
  assert.equal(plain.headers['content-type'], 'text/javascript; charset=utf-8');
});

test('a browser that has the file already gets a 304, until the file changes', async () => {
  const first = await get('/app.js');
  assert.equal(first.headers['cache-control'], 'no-cache');
  const again = await get('/app.js', { 'if-none-match': first.headers.etag });
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0);

  writeFileSync(join(dir, 'app.js'), script + '// new version\n');
  const changed = await get('/app.js', { 'if-none-match': first.headers.etag });
  assert.equal(changed.status, 200);
  assert.match(changed.body.toString(), /new version/);
});

test('unknown paths get the app shell, and a missing shell is a 404', async () => {
  const page = await get('/some/room');
  assert.equal(page.status, 200);
  assert.match(page.body.toString(), /<title>Burrow/);

  const bare = createApp({ db: openDb(':memory:'), publicDir: join(dir, 'missing') });
  await new Promise<void>((r) => bare.listen(0, r));
  const res = await fetch(`http://localhost:${(bare.address() as AddressInfo).port}/`);
  assert.equal(res.status, 404);
  bare.close();
});

test('the privacy policy and terms are served with who runs the server', async () => {
  const other = createApp({
    db: openDb(':memory:'),
    publicDir: dir,
    publicUrl: 'https://chat.example.com',
    mail: { url: 'smtps://a:b@mail.example.com:465', from: 'Peiskos <hello@example.com>' },
    legal: { name: 'Sam <b>' },
    hosting: { dbFile: ':memory:', backupDir: dir, backupKeep: 7, dataDir: dir, admins: [] },
  });
  await new Promise<void>((r) => other.listen(0, r));
  try {
    const base = `http://localhost:${(other.address() as AddressInfo).port}`;
    const privacy = await fetch(`${base}/privacy`);
    assert.equal(privacy.status, 200);
    assert.match(privacy.headers.get('content-type')!, /text\/html/);
    const text = await privacy.text();
    assert.match(text, /Privacy policy/);
    assert.match(text, /chat\.example\.com, run by Sam &#60;b&#62;/);
    assert.match(text, /mailto:hello@example\.com/, 'falls back to the email the server sends from');
    assert.match(text, /last 7 days of copies/);
    const terms = await (await fetch(`${base}/terms/`)).text();
    assert.match(terms, /Terms of use/);
    assert.match(terms, /13 or older/);
    const safety = await (await fetch(`${base}/child-safety`)).text();
    assert.match(safety, /Child safety standards/);
    assert.match(safety, /mailto:hello@example\.com/);
    assert.match(safety, /Sam &#60;b&#62; is the point of contact/);
  } finally {
    other.closeAllConnections();
    other.close();
  }
  // Mail sent from a no-reply address: people are pointed at support@ on that domain instead.
  const noReply = createApp({
    db: openDb(':memory:'), publicDir: dir,
    mail: { url: 'smtps://a:b@mail.example.com:465', from: 'Peiskos <noreply@example.com>' },
  });
  await new Promise<void>((r) => noReply.listen(0, r));
  try {
    const page = await (await fetch(`http://localhost:${(noReply.address() as AddressInfo).port}/child-safety`)).text();
    assert.match(page, /mailto:support@example\.com/);
    assert.doesNotMatch(page, /noreply@/);
  } finally {
    noReply.closeAllConnections();
    noReply.close();
  }
  // With nothing set, the pages still work and say who to ask.
  const bare = await get('/privacy');
  assert.equal(bare.status, 200);
  assert.match(bare.body.toString(), /the person who runs this server/);
});

test('games at the fire can be framed by Peiskos itself, and the app by nobody', async () => {
  const appPage = await get('/');
  assert.equal(appPage.headers['x-frame-options'], 'DENY');
  assert.match(appPage.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(appPage.headers['content-security-policy'], /frame-src 'self'/);
  const game = await get('/games/melonbomber/');
  assert.equal(game.headers['x-frame-options'], 'SAMEORIGIN');
  assert.match(game.headers['content-security-policy'], /frame-ancestors 'self'/);
  assert.doesNotMatch(game.headers['content-security-policy'], /frame-ancestors 'none'/);
});

test('emoji pictures are sent as WebP and kept by the browser for a week', async () => {
  const res = await get('/vendor/noto-emoji/1f525.webp');
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'image/webp');
  assert.equal(res.headers['cache-control'], 'public, max-age=604800');
});

test('fonts are kept for a week too, so opening Peiskos does not check them every time', async () => {
  const res = await get('/fonts/nunito-sans.woff2');
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'public, max-age=604800');
  assert.equal((await get('/app.js')).headers['cache-control'], 'no-cache');
});

test("the page's own <meta> security policy is left out when served (the header carries it)", async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.ok(!res.body.toString().includes('http-equiv'), 'a <meta> policy stops browsers fetching the scripts in parallel');
  assert.match(String(res.headers['content-security-policy']), /script-src 'self'/);
});

test('JSON answers are compressed when they are big enough to be worth it', async () => {
  const { token } = await fetch(`http://localhost:${port}/api/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'packer', password: 'correct horse battery' }),
  }).then((r) => r.json()) as { token: string };
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const hearth = await fetch(`http://localhost:${port}/api/servers`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Packed' }) }).then((r) => r.json()) as { channels: { id: number; kind: string }[] };
  const room = hearth.channels.find((c) => c.kind === 'text')!.id;
  for (let i = 0; i < 12; i++)
    await fetch(`http://localhost:${port}/api/channels/${room}/messages`, { method: 'POST', headers: auth, body: JSON.stringify({ content: `message number ${i}` }) });

  const path = `/api/channels/${room}/messages?limit=50`;
  const plain = await get(path, { authorization: auth.authorization });
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.equal(plain.headers.vary, 'accept-encoding');
  assert.equal(JSON.parse(plain.body.toString()).length, 12);

  const br = await get(path, { authorization: auth.authorization, 'accept-encoding': 'gzip, deflate, br' });
  assert.equal(br.headers['content-encoding'], 'br');
  assert.equal(Number(br.headers['content-length']), br.body.length);
  assert.ok(br.body.length < plain.body.length / 2);
  assert.deepEqual(JSON.parse(brotliDecompressSync(br.body).toString()), JSON.parse(plain.body.toString()));

  const gz = await get(path, { authorization: auth.authorization, 'accept-encoding': 'gzip' });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.deepEqual(JSON.parse(gunzipSync(gz.body).toString()), JSON.parse(plain.body.toString()));

  // Turned down outright (q=0), it isn't used.
  const no = await get(path, { authorization: auth.authorization, 'accept-encoding': 'br;q=0, gzip;q=0' });
  assert.equal(no.headers['content-encoding'], undefined);

  // A short answer goes as it is.
  const small = await get('/api/config', { 'accept-encoding': 'gzip, deflate, br' });
  assert.equal(small.headers['content-encoding'], undefined);
  assert.ok(JSON.parse(small.body.toString()));
});
