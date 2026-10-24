import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';

// A stand-in for Google: it hands out access tokens for a correctly signed request, keeps the
// alerts it's sent, and says a token is gone when told to.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const sent: { path: string; authorization: string; body: any }[] = [];
const goneTokens = new Set<string>();
let tokensGiven = 0;
let googleUrl = '';
const google = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url === '/token') {
      const assertion = new URLSearchParams(body).get('assertion') ?? '';
      const [head, claims, signature] = assertion.split('.');
      const ok = verify('sha256', Buffer.from(`${head}.${claims}`), publicKey, Buffer.from(signature, 'base64url'));
      const c = JSON.parse(Buffer.from(claims, 'base64url').toString());
      if (!ok || c.iss !== 'peiskos@peiskos-test.iam.gserviceaccount.com' || c.aud !== `${googleUrl}/token` || !/firebase\.messaging/.test(c.scope)) {
        return res.writeHead(400).end(JSON.stringify({ error: 'invalid_grant' }));
      }
      tokensGiven++;
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'ya29.test', expires_in: 3599 }));
    }
    const message = JSON.parse(body);
    sent.push({ path: req.url!, authorization: String(req.headers.authorization), body: message });
    if (goneTokens.has(message.message.token)) {
      return res.writeHead(404).end(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }));
    }
    res.writeHead(200).end(JSON.stringify({ name: 'projects/peiskos-test/messages/1' }));
  });
});

let app: Server;
let base = '';
before(async () => {
  await new Promise<void>((r) => google.listen(0, r));
  googleUrl = `http://localhost:${(google.address() as AddressInfo).port}`;
  const serviceAccount = {
    type: 'service_account',
    project_id: 'peiskos-test',
    client_email: 'peiskos@peiskos-test.iam.gserviceaccount.com',
    private_key: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    token_uri: `${googleUrl}/token`,
  };
  app = createApp({
    db: openDb(':memory:'),
    publicDir: '/nonexistent',
    // Base64 on one line, the way .env.example says to paste it.
    fcm: { serviceAccount: Buffer.from(JSON.stringify(serviceAccount)).toString('base64'), apiUrl: googleUrl },
  });
  await new Promise<void>((r) => app.listen(0, r));
  base = `http://localhost:${(app.address() as AddressInfo).port}`;
});
after(() => {
  google.closeAllConnections();
  google.close();
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

test('the Android app gets alerts through Firebase, with an access token from the service account', async () => {
  const [ann, bob] = [
    (await call('/api/register', { body: { username: 'ann', password: 'password1', email: 'ann@example.com' } })).data,
    (await call('/api/register', { body: { username: 'bob', password: 'password1', email: 'bob@example.com' } })).data,
  ];
  const server = (await call('/api/servers', { body: { name: 'Den' }, token: ann.token })).data;
  await call('/api/join', { body: { inviteCode: server.inviteCode }, token: bob.token });
  const room = server.channels.find((c: any) => c.kind === 'text').id;

  assert.equal((await call('/api/push/fcm', { body: { token: 'no spaces allowed' }, token: bob.token })).status, 400);
  const token = 'dQw4w9WgXcQ:APA91b' + 'x'.repeat(140);
  const r = await call('/api/push/fcm', { body: { token }, token: bob.token });
  assert.equal(r.status, 200);
  assert.equal(r.data.sending, true);

  await call(`/api/channels/${room}/messages`, { body: { content: '@bob you there?' }, token: ann.token });
  await wait(300);
  assert.equal(sent.length, 1);
  const push = sent[0];
  assert.equal(push.path, '/v1/projects/peiskos-test/messages:send');
  assert.equal(push.authorization, 'Bearer ya29.test');
  const m = push.body.message;
  assert.equal(m.token, token);
  assert.equal(m.notification.title, 'ann in #general (Den)');
  assert.equal(m.notification.body, '@bob you there?');
  assert.equal(m.android.notification.channel_id, 'messages');
  assert.equal(m.android.notification.tag, `room-${room}`);
  assert.equal(m.android.notification.notification_count, 1);
  // Firebase only carries text in data.
  assert.deepEqual(Object.keys(m.data).sort(), ['channelId', 'messageId']);
  assert.equal(m.data.channelId, String(room));

  // The access token is reused, not fetched for every alert.
  await call(`/api/channels/${room}/messages`, { body: { content: '@bob still there?' }, token: ann.token });
  await wait(300);
  assert.equal(sent.length, 2);
  assert.equal(tokensGiven, 1);

  // Once Google says the app is gone, the token is forgotten.
  goneTokens.add(token);
  await call(`/api/channels/${room}/messages`, { body: { content: '@bob again' }, token: ann.token });
  await wait(300);
  sent.length = 0;
  await call(`/api/channels/${room}/messages`, { body: { content: '@bob and again' }, token: ann.token });
  await wait(300);
  assert.equal(sent.length, 0);
});
