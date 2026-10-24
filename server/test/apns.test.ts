import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { createServer as createH2Server } from 'node:http2';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';

// A stand-in for Apple's push service: it keeps what it's sent, and says a token is gone when told to.
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const p8 = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const sent: { path: string; headers: Record<string, unknown>; body: any }[] = [];
const goneTokens = new Set<string>();
const fakeApple = createH2Server((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    sent.push({ path: req.url, headers: req.headers, body: JSON.parse(body) });
    const token = req.url.split('/').pop()!;
    if (goneTokens.has(token)) return res.writeHead(410).end(JSON.stringify({ reason: 'Unregistered' }));
    res.writeHead(200).end();
  });
});

const sessions = new Set<{ destroy(): void }>();
fakeApple.on('session', (s) => sessions.add(s));

let app: Server;
let base = '';
before(async () => {
  await new Promise<void>((r) => fakeApple.listen(0, r));
  app = createApp({
    db: openDb(':memory:'),
    publicDir: '/nonexistent',
    // Base64 on one line, the way .env.example says to paste it.
    apns: { key: Buffer.from(p8).toString('base64'), keyId: 'KEY1234567', teamId: 'TEAM123456', topic: 'app.peiskos', host: `http://localhost:${(fakeApple.address() as AddressInfo).port}` },
  });
  await new Promise<void>((r) => app.listen(0, r));
  base = `http://localhost:${(app.address() as AddressInfo).port}`;
});
after(() => {
  for (const s of sessions) s.destroy();
  fakeApple.close();
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
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('the iPhone app gets alerts through Apple, signed with the APNs key', async () => {
  const [ann, bob] = [
    (await call('/api/register', { body: { username: 'ann', password: 'password1', email: 'ann@example.com' } })).data,
    (await call('/api/register', { body: { username: 'bob', password: 'password1', email: 'bob@example.com' } })).data,
  ];
  const server = (await call('/api/servers', { body: { name: 'Den' }, token: ann.token })).data;
  await call('/api/join', { body: { inviteCode: server.inviteCode }, token: bob.token });
  const room = server.channels.find((c: any) => c.kind === 'text').id;

  assert.equal((await call('/api/push/apns', { body: { token: 'not-a-token' }, token: bob.token })).status, 400);
  const token = 'ab'.repeat(32);
  const r = await call('/api/push/apns', { body: { token }, token: bob.token });
  assert.equal(r.status, 200);
  assert.equal(r.data.sending, true);

  await call(`/api/channels/${room}/messages`, { body: { content: '@bob you there?' }, token: ann.token });
  await wait(200);
  assert.equal(sent.length, 1);
  const push = sent[0];
  assert.equal(push.path, `/3/device/${token}`);
  assert.equal(push.headers['apns-topic'], 'app.peiskos');
  assert.equal(push.headers['apns-push-type'], 'alert');
  assert.equal(push.body.aps.alert.title, 'ann in #general (Den)');
  assert.equal(push.body.aps.alert.body, '@bob you there?');
  assert.equal(push.body.aps.badge, 1);
  assert.equal(push.body.aps.sound, 'default');
  assert.equal(push.body.channelId, room);
  // The token is Apple's ES256 JWT, from this team and key.
  const [head, claims, signature] = String(push.headers.authorization).replace('bearer ', '').split('.');
  assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url').toString()), { alg: 'ES256', kid: 'KEY1234567' });
  assert.equal(JSON.parse(Buffer.from(claims, 'base64url').toString()).iss, 'TEAM123456');
  assert.ok(verify('sha256', Buffer.from(`${head}.${claims}`), { key: createPublicKey(privateKey), dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));

  // Once Apple says the app is gone, the token is forgotten.
  goneTokens.add(token);
  await call(`/api/channels/${room}/messages`, { body: { content: '@bob again' }, token: ann.token });
  await wait(200);
  sent.length = 0;
  await call(`/api/channels/${room}/messages`, { body: { content: '@bob and again' }, token: ann.token });
  await wait(200);
  assert.equal(sent.length, 0);
});
