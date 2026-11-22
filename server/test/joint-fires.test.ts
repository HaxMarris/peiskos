// Joint fires: a fire on one Peiskos server (the host) that people on another server sit at.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { GUEST_BASE, cleanOrigin } from '../src/joint-fires.ts';
import { caller } from './helpers.ts';

// Each server has its own stand-in for LiveKit, which says who's in each room and records removals.
function fakeLiveKit() {
  const rooms = new Map<string, string[]>();
  const removed: { room: string; identity: string }[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const method = req.url!.split('/').pop()!;
      const body = JSON.parse(raw || '{}');
      if (method === 'RemoveParticipant') {
        removed.push({ room: body.room, identity: body.identity });
        rooms.set(body.room, (rooms.get(body.room) ?? []).filter((i) => i !== body.identity));
      }
      const answer =
        method === 'ListParticipants' ? { participants: (rooms.get(body.room) ?? []).map((identity) => ({ identity, state: 'ACTIVE' })) }
        : method === 'ListRooms' ? { rooms: [...rooms.keys()].map((name) => ({ name })) }
        : {};
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer));
    });
  });
  return { server, rooms, removed };
}

const secret = 'a-secret-that-is-at-least-32-characters-long';
const lkHost = fakeLiveKit();
const lkGuest = fakeLiveKit();
const hostVoice = { apiKey: 'hostkey', apiSecret: secret, apiUrl: '', url: 'wss://voice.host.example' };
const guestVoice = { apiKey: 'guestkey', apiSecret: secret + '-guest', apiUrl: '' };
const guestJoint = { servers: [] as string[], pollMs: 300 };
let hostApp: Server;
let guestApp: Server;
let offApp: Server;
let hostBase = '';
let guestBase = '';
let offBase = '';

const listen = async (app: Server) => {
  await new Promise<void>((r) => app.listen(0, r));
  return `http://localhost:${(app.address() as AddressInfo).port}`;
};
before(async () => {
  for (const lk of [lkHost, lkGuest]) await new Promise<void>((r) => lk.server.listen(0, r));
  hostVoice.apiUrl = `http://localhost:${(lkHost.server.address() as AddressInfo).port}`;
  guestVoice.apiUrl = `http://localhost:${(lkGuest.server.address() as AddressInfo).port}`;
  hostApp = createApp({ db: openDb(':memory:'), publicDir: '/nonexistent', voice: hostVoice, publicUrl: 'https://host.example', jointFires: { host: true } });
  hostBase = await listen(hostApp);
  // The guests' server lists the host by the address it calls it at.
  guestJoint.servers.push(hostBase);
  guestApp = createApp({ db: openDb(':memory:'), publicDir: '/nonexistent', voice: guestVoice, jointFires: guestJoint });
  guestBase = await listen(guestApp);
  offApp = createApp({ db: openDb(':memory:'), publicDir: '/nonexistent', voice: hostVoice, publicUrl: 'https://off.example' });
  offBase = await listen(offApp);
});
after(() => {
  for (const lk of [lkHost, lkGuest]) lk.server.close();
  for (const app of [hostApp, guestApp, offApp]) {
    app.closeAllConnections();
    app.close();
  }
});

const host = caller(() => hostBase);
const guest = caller(() => guestBase);
const off = caller(() => offBase);
const claimsOf = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
const signedBy = (token: string, key: string) => {
  const [h, p, sig] = token.split('.');
  return createHmac('sha256', key).update(`${h}.${p}`).digest('base64url') === sig;
};
/** LiveKit telling the host someone came or went in a room, signed the way LiveKit signs it. */
async function webhook(room: string) {
  const body = JSON.stringify({ event: 'participant_joined', room: { name: room } });
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const claims = b64({ iss: hostVoice.apiKey, exp: Math.floor(Date.now() / 1000) + 60, sha256: createHash('sha256').update(body).digest('base64') });
  const sig = createHmac('sha256', hostVoice.apiSecret).update(`${head}.${claims}`).digest('base64url');
  await fetch(`${hostBase}/api/livekit/webhook`, { method: 'POST', headers: { authorization: `Bearer ${head}.${claims}.${sig}` }, body });
}
const wait = async (ok: () => Promise<boolean> | boolean, every = 30) => {
  for (let i = 0; i < 9000 / every; i++) {
    if (await ok()) return;
    await new Promise((r) => setTimeout(r, every));
  }
  throw new Error('timed out');
};

test('only addresses an admin could mean count as servers to join', () => {
  assert.equal(cleanOrigin('https://peiskos.example/some/path'), 'https://peiskos.example');
  assert.equal(cleanOrigin('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(cleanOrigin('http://peiskos.example'), null); // plain http only on this machine
  assert.equal(cleanOrigin('https://user:pass@peiskos.example'), null);
  assert.equal(cleanOrigin('file:///etc/passwd'), null);
  assert.equal(cleanOrigin('not an address'), null);
});

test('joint fires are off unless the admin turns them on', async () => {
  const max = (await off('/api/register', { body: { username: 'max', password: 'password1' } })).data;
  const hearth = (await off('/api/servers', { body: { name: 'Den' }, token: max.token })).data;
  const fire = hearth.channels.find((c: any) => c.kind === 'voice');
  assert.deepEqual((await off('/api/config')).data.jointFires, { host: false, join: false });
  assert.equal((await off(`/api/channels/${fire.id}/joint`, { body: { label: 'Lake' }, token: max.token })).status, 404);
  assert.equal((await off('/api/joint/fire', { token: 'x'.repeat(43) })).status, 404);
  assert.equal((await off(`/api/servers/${hearth.id}/joint-fires`, { body: { code: 'https://host.example/joint#' + 'x'.repeat(43) }, token: max.token })).status, 404);
});

test('a fire shared between two servers', async () => {
  assert.deepEqual((await host('/api/config')).data.jointFires, { host: true, join: false });
  assert.deepEqual((await guest('/api/config')).data.jointFires, { host: false, join: true });

  // The host: Ash runs the Pines, Rue is a member there.
  const ash = (await host('/api/register', { body: { username: 'ash', password: 'password1' } })).data;
  const rue = (await host('/api/register', { body: { username: 'rue', password: 'password1' } })).data;
  const pines = (await host('/api/servers', { body: { name: 'Pines' }, token: ash.token })).data;
  await host('/api/join', { body: { inviteCode: pines.inviteCode }, token: rue.token });
  const campfire = pines.channels.find((c: any) => c.kind === 'voice');

  // Only people who can edit the hearth open a fire to another group.
  assert.equal((await host(`/api/channels/${campfire.id}/joint`, { body: { label: 'Lake crew' }, token: rue.token })).status, 403);
  assert.equal((await host(`/api/channels/${campfire.id}/joint`, { body: { label: ' ' }, token: ash.token })).status, 400);
  const opened = await host(`/api/channels/${campfire.id}/joint`, { body: { label: 'Lake crew' }, token: ash.token });
  assert.equal(opened.status, 200);
  const code: string = opened.data.code;
  assert.match(code, /^https:\/\/host\.example\/joint#[\w-]{43}$/);
  assert.deepEqual(opened.data.links.map((l: any) => [l.label, l.here]), [['Lake crew', 0]]);
  // The code is shown once: listing the fire's links never shows it again.
  const listed = (await host(`/api/channels/${campfire.id}/joint`, { token: ash.token })).data;
  assert.ok(!JSON.stringify(listed).includes(code.split('#')[1]));
  assert.equal((await host(`/api/channels/${campfire.id}/joint`, { token: rue.token })).status, 403);
  // The hearth sees that its fire is open to another group.
  const shared = (await host('/api/servers', { token: rue.token })).data.find((s: any) => s.id === pines.id).channels.find((c: any) => c.id === campfire.id);
  assert.equal(shared.voiceJoint.role, 'host');
  assert.equal(shared.voiceJoint.open, true);

  // The guests' server: Bo runs the Lake, Cy is a member there.
  const bo = (await guest('/api/register', { body: { username: 'bo', password: 'password1' } })).data;
  const cy = (await guest('/api/register', { body: { username: 'cy', password: 'password1' } })).data;
  const lake = (await guest('/api/servers', { body: { name: 'Lake' }, token: bo.token })).data;
  await guest('/api/join', { body: { inviteCode: lake.inviteCode }, token: cy.token });

  // The code names the host's public address; the guests' server only calls the address its admin listed.
  const atListed = code.replace('https://host.example', hostBase);
  assert.equal((await guest(`/api/servers/${lake.id}/joint-fires`, { body: { code }, token: bo.token })).status, 403);
  assert.equal((await guest(`/api/servers/${lake.id}/joint-fires`, { body: { code: 'https://elsewhere.example/joint#' + 'a'.repeat(43) }, token: bo.token })).status, 403);
  assert.equal((await guest(`/api/servers/${lake.id}/joint-fires`, { body: { code: 'nonsense' }, token: bo.token })).status, 400);
  assert.equal((await guest(`/api/servers/${lake.id}/joint-fires`, { body: { code: atListed }, token: cy.token })).status, 403);
  // A made-up code for a listed server: the host says no, and nothing is added.
  const madeUp = await guest(`/api/servers/${lake.id}/joint-fires`, { body: { code: `${hostBase}/joint#${'b'.repeat(43)}` }, token: bo.token });
  assert.equal(madeUp.status, 410);
  const added = await guest(`/api/servers/${lake.id}/joint-fires`, { body: { code: atListed, name: 'Pines fire' }, token: bo.token });
  assert.equal(added.status, 200);
  const joined = added.data.channels.find((c: any) => c.name === 'Pines fire');
  assert.equal(joined.kind, 'voice');
  assert.equal(joined.voiceJoint.role, 'guest');
  assert.equal(joined.voiceJoint.host, 'Pines · Campfire');
  assert.equal((await guest(`/api/servers/${lake.id}/joint-fires`, { body: { code: atListed }, token: bo.token })).status, 400); // already there

  // Cy sits down: the pass is for the host's LiveKit, as a guest, with a microphone only.
  const pass = await guest(`/api/channels/${joined.id}/voice`, { body: {}, token: cy.token });
  assert.equal(pass.status, 200);
  assert.equal(pass.data.url, 'wss://voice.host.example');
  assert.ok(signedBy(pass.data.token, hostVoice.apiSecret));
  const claims = claimsOf(pass.data.token);
  assert.equal(claims.iss, 'hostkey');
  assert.equal(claims.sub, pass.data.joint.identity);
  assert.ok(Number(claims.sub) >= GUEST_BASE);
  assert.equal(claims.name, 'cy');
  assert.deepEqual(claims.video.canPublishSources, ['microphone']);
  assert.equal(claims.video.room, `room-${campfire.id}`);
  assert.ok(claims.exp - claims.nbf <= 11 * 60);

  // LiveKit has them in the host's room (and Rue, who's from the host): the host seats the guest
  // with the group name it gave the code, under its own id range.
  lkHost.rooms.set(`room-${campfire.id}`, [String(rue.user.id), claims.sub]);
  await webhook(`room-${campfire.id}`);
  const seated = async () => (await host('/api/servers', { token: ash.token })).data.find((s: any) => s.id === pines.id).channels.find((c: any) => c.id === campfire.id);
  await wait(async () => (await seated()).voiceJoint?.people?.length === 1);
  const atHost = await seated();
  assert.deepEqual(atHost.voiceJoint.people, [{ identity: claims.sub, id: Number(claims.sub), name: 'cy', from: 'Lake crew' }]);
  assert.ok(atHost.voiceUsers.includes(Number(claims.sub)));

  // A guest identity LiveKit has that no open code stands behind is taken out.
  lkHost.rooms.get(`room-${campfire.id}`)!.push(String(GUEST_BASE + 999));
  await webhook(`room-${campfire.id}`);
  await wait(() => lkHost.removed.some((r) => r.identity === String(GUEST_BASE + 999)));

  // The guests' server asks the host who's there while someone in the hearth has Peiskos open.
  const open = new WebSocket(`${guestBase.replace('http', 'ws')}/ws?token=${bo.token}`);
  await new Promise((r) => open.once('open', r));
  // The guests' server learns who's at the host's fire: Rue as someone from the Pines, and Cy as one of its own.
  const lakeFire = async () => (await guest('/api/servers', { token: bo.token })).data.find((s: any) => s.id === lake.id).channels.find((c: any) => c.id === joined.id);
  await wait(async () => (await lakeFire()).voiceJoint?.people?.length === 2);
  const there = (await lakeFire()).voiceJoint.people;
  assert.deepEqual(there.find((p: any) => p.identity === String(rue.user.id)), { identity: String(rue.user.id), id: -rue.user.id, name: 'rue', from: 'Pines' });
  assert.deepEqual(there.find((p: any) => p.identity === claims.sub), { identity: claims.sub, id: cy.user.id, own: true });
  // People from elsewhere get ids below zero, so they never collide with someone's account here.
  assert.ok((await lakeFire()).voiceUsers.includes(-rue.user.id));

  // The host's moderators take a guest out; that guest can't sit back down with the code.
  assert.equal((await host(`/api/channels/${campfire.id}/guests/${claims.sub}/remove`, { body: {}, token: rue.token })).status, 403);
  assert.equal((await host(`/api/channels/${campfire.id}/guests/${claims.sub}/remove`, { body: {}, token: ash.token })).status, 200);
  await wait(() => lkHost.removed.some((r) => r.identity === claims.sub));
  const again = await guest(`/api/channels/${joined.id}/voice`, { body: {}, token: cy.token });
  assert.equal(again.status, 403);
  assert.equal(again.data.error, 'You were removed from this fire.');

  // Bo can still sit down; closing the code takes Bo out and ends it for the whole group.
  const boPass = await guest(`/api/channels/${joined.id}/voice`, { body: {}, token: bo.token });
  assert.equal(boPass.status, 200);
  const boId = claimsOf(boPass.data.token).sub;
  lkHost.rooms.set(`room-${campfire.id}`, [boId]);
  await webhook(`room-${campfire.id}`);
  await wait(async () => (await seated()).voiceJoint?.people?.length === 1);
  const linkId = listed.links[0].id;
  assert.equal((await host(`/api/joint/links/${linkId}`, { method: 'DELETE', token: rue.token })).status, 403);
  assert.equal((await host(`/api/joint/links/${linkId}`, { method: 'DELETE', token: ash.token })).status, 200);
  await wait(() => lkHost.removed.some((r) => r.identity === boId));
  const closed = await guest(`/api/channels/${joined.id}/voice`, { body: {}, token: bo.token });
  assert.equal(closed.status, 410);
  assert.equal(closed.data.error, 'The other group closed this joint fire.');
  // A request with the old code gets nothing from the host.
  assert.equal((await host('/api/joint/fire', { token: atListed.split('#')[1] })).status, 401);
  open.close();
});

test('a guest pass respects the fire\'s seats and asks for a name', async () => {
  const fox = (await host('/api/register', { body: { username: 'fox', password: 'password1' } })).data;
  const den = (await host('/api/servers', { body: { name: 'Den' }, token: fox.token })).data;
  const small = (await host(`/api/servers/${den.id}/channels`, { body: { name: 'Small', kind: 'voice' }, token: fox.token })).data.channels.find((c: any) => c.name === 'Small');
  await host(`/api/channels/${small.id}`, { method: 'PATCH', body: { userLimit: 2 }, token: fox.token });
  const secretOf = (await host(`/api/channels/${small.id}/joint`, { body: { label: 'Friends' }, token: fox.token })).data.code.split('#')[1];
  const ask = (id: unknown, name = 'Someone') => host('/api/joint/pass', { body: { id, name }, token: secretOf });
  assert.equal((await ask('../../x')).status, 400);
  const first = await ask('1', 'One‮\u0007');
  assert.equal(first.status, 200);
  assert.equal(claimsOf(first.data.token).name, 'One'); // bidi and control characters are dropped
  const second = await ask('2', 'Two');
  lkHost.rooms.set(`room-${small.id}`, [claimsOf(first.data.token).sub, claimsOf(second.data.token).sub]);
  // Seated once LiveKit's list is matched (the pass asks for that shortly).
  await wait(async () => (await host('/api/joint/fire', { token: secretOf })).data.people?.length === 2, 500);
  const third = await ask('3', 'Three');
  assert.equal(third.status, 403);
  assert.match(third.data.error, /full/);
  // Someone already sitting there can get a fresh pass.
  assert.equal((await ask('1', 'One')).status, 200);
});
