import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';

// A stand-in for LiveKit's API that records what Burrow asks it to do.
const liveKitCalls: { method: string; body: any; claims: any; valid: boolean }[] = [];
const fakeLiveKit = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const [h, p, sig] = (req.headers.authorization ?? '').replace('Bearer ', '').split('.');
    liveKitCalls.push({
      method: req.url!.split('/').pop()!,
      body: JSON.parse(raw),
      claims: JSON.parse(Buffer.from(p, 'base64url').toString()),
      valid: createHmac('sha256', voice.apiSecret).update(`${h}.${p}`).digest('base64url') === sig,
    });
    const method = req.url!.split('/').pop()!;
    const answer =
      method === 'ListParticipants' ? { participants: (inLiveKit.get(JSON.parse(raw).room) ?? []).map((identity) => ({ identity, state: 'ACTIVE' })) }
      : method === 'ListRooms' ? { rooms: [...inLiveKit.keys()].map((name) => ({ name })) }
      : {};
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer));
  });
});
// Who the stand-in LiveKit says is in each room (room name -> identities).
const inLiveKit = new Map<string, string[]>();
const voice = { apiKey: 'devkey', apiSecret: 'a-secret-that-is-at-least-32-characters-long', apiUrl: '' };
const apps: Server[] = [];
const bases: string[] = [];

before(async () => {
  await new Promise<void>((r) => fakeLiveKit.listen(0, r));
  voice.apiUrl = `http://localhost:${(fakeLiveKit.address() as AddressInfo).port}`;
  for (const v of [voice, undefined]) {
    const app = createApp({ db: openDb(':memory:'), publicDir: '/nonexistent', voice: v });
    await new Promise<void>((r) => app.listen(0, r));
    apps.push(app);
    bases.push(`http://localhost:${(app.address() as AddressInfo).port}`);
  }
});
after(() => {
  fakeLiveKit.close();
  for (const app of apps) {
    app.closeAllConnections();
    app.close();
  }
});

async function call(base: string, path: string, opts: { body?: unknown; token?: string } = {}) {
  const res = await fetch(base + path, {
    method: opts.body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, data: (await res.json()) as any };
}

function socket(base: string, token: string) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?token=${token}`);
  const events: any[] = [];
  ws.on('message', (raw) => events.push(JSON.parse(String(raw))));
  const next = async (pred: (e: any) => boolean) => {
    for (let i = 0; i < 100; i++) {
      const i2 = events.findIndex(pred);
      if (i2 >= 0) return events.splice(i2, 1)[0];
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('timed out waiting for event');
  };
  return { ws, next };
}

test('voice rooms', async () => {
  const base = bases[0];
  assert.equal((await call(base, '/api/config')).data.voice, true);
  const max = (await call(base, '/api/register', { body: { username: 'max', password: 'password1' } })).data;
  const sam = (await call(base, '/api/register', { body: { username: 'sam', password: 'password2' } })).data;
  const server = (await call(base, '/api/servers', { body: { name: 'Den' }, token: max.token })).data;
  await call(base, '/api/join', { body: { inviteCode: server.inviteCode }, token: sam.token });

  const withVoice = (await call(base, `/api/servers/${server.id}/channels`, { body: { name: 'Game Night', kind: 'voice' }, token: max.token })).data;
  // Every new hearth starts with its Campfire; Game Night is the second fire.
  assert.deepEqual(withVoice.channels.filter((c: any) => c.kind === 'voice').map((c: any) => c.name), ['Campfire', 'Game Night']);
  const room = withVoice.channels.find((c: any) => c.name === 'Game Night');
  assert.deepEqual(room.voiceUsers, []);
  const general = withVoice.channels.find((c: any) => c.kind === 'text');

  // The token is a LiveKit JWT signed with our secret, for this room only.
  const { token, url } = (await call(base, `/api/channels/${room.id}/voice`, { body: {}, token: sam.token })).data;
  assert.equal(url, null);
  const [h, p, sig] = token.split('.');
  assert.equal(createHmac('sha256', voice.apiSecret).update(`${h}.${p}`).digest('base64url'), sig);
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.equal(claims.iss, 'devkey');
  assert.equal(claims.name, 'sam');
  assert.equal(claims.video.room, `room-${room.id}`);
  assert.equal(claims.video.roomJoin, true);
  assert.ok(claims.exp > Date.now() / 1000);

  assert.equal((await call(base, `/api/channels/${general.id}/voice`, { body: {}, token: sam.token })).status, 400);
  assert.equal((await call(base, `/api/channels/${room.id}/messages`, { body: { content: 'hi' }, token: sam.token })).status, 400);
  const outsider = (await call(base, '/api/register', { body: { username: 'eve', password: 'password3' } })).data;
  assert.equal((await call(base, `/api/channels/${room.id}/voice`, { body: {}, token: outsider.token })).status, 404);

  // Joining and leaving is broadcast, and shows up in the burrow summary.
  const maxWs = socket(base, max.token);
  await maxWs.next((e) => e.type === 'ready');
  const samWs = socket(base, sam.token);
  await samWs.next((e) => e.type === 'ready');
  samWs.ws.send(JSON.stringify({ type: 'voice_join', channelId: room.id }));
  const joined = await maxWs.next((e) => e.type === 'voice_state');
  assert.deepEqual(joined, { type: 'voice_state', channelId: room.id, userIds: [sam.user.id], muted: [], deafened: [], serverMuted: [], speaking: [] });
  const listed = (await call(base, '/api/servers', { token: max.token })).data[0];
  assert.deepEqual(listed.channels.find((c: any) => c.id === room.id).voiceUsers, [sam.user.id]);

  // Muting and deafening show for everyone in the burrow, not just the people in the room.
  samWs.ws.send(JSON.stringify({ type: 'voice_status', muted: true, deafened: true }));
  assert.deepEqual(await maxWs.next((e) => e.type === 'voice_state'),
    { type: 'voice_state', channelId: room.id, userIds: [sam.user.id], muted: [sam.user.id], deafened: [sam.user.id], serverMuted: [], speaking: [] });
  const flagged = (await call(base, '/api/servers', { token: max.token })).data[0].channels.find((c: any) => c.id === room.id);
  assert.deepEqual([flagged.voiceMuted, flagged.voiceDeafened], [[sam.user.id], [sam.user.id]]);
  samWs.ws.send(JSON.stringify({ type: 'voice_status', muted: true, deafened: false }));
  assert.deepEqual((await maxWs.next((e) => e.type === 'voice_state')).deafened, []);
  // Leaving forgets it; joining says it again.
  samWs.ws.send(JSON.stringify({ type: 'voice_leave' }));
  await maxWs.next((e) => e.type === 'voice_state' && e.userIds.length === 0);
  samWs.ws.send(JSON.stringify({ type: 'voice_join', channelId: room.id }));
  assert.deepEqual((await maxWs.next((e) => e.type === 'voice_state')).muted, []);
  // Not in a voice room: nothing to say.
  maxWs.ws.send(JSON.stringify({ type: 'voice_status', muted: true }));

  // Text rooms can't be joined as voice.
  samWs.ws.send(JSON.stringify({ type: 'voice_join', channelId: general.id }));
  await samWs.next((e) => e.type === 'error');

  // Closing the app takes you out of voice.
  samWs.ws.close();
  assert.deepEqual((await maxWs.next((e) => e.type === 'voice_state')).userIds, []);
  maxWs.ws.close();
});

test('fireside chat is only for the people at the fire, and goes out with the fire', async () => {
  const base = bases[0];
  const reg = async (username: string) => (await call(base, '/api/register', { body: { username, password: 'password1' } })).data;
  const [ash, bo, cy] = [await reg('ash'), await reg('bo'), await reg('cy')];
  const server = (await call(base, '/api/servers', { body: { name: 'Fireside' }, token: ash.token })).data;
  for (const u of [bo, cy]) await call(base, '/api/join', { body: { inviteCode: server.inviteCode }, token: u.token });
  const room = (await call(base, `/api/servers/${server.id}/channels`, { body: { name: 'Campfire', kind: 'voice' }, token: ash.token }))
    .data.channels.find((c: any) => c.kind === 'voice');
  const [a, b, c] = [socket(base, ash.token), socket(base, bo.token), socket(base, cy.token)];
  for (const s of [a, b, c]) await s.next((e) => e.type === 'ready');

  // Not at the fire: nothing to say there.
  a.ws.send(JSON.stringify({ type: 'fireside_send', content: 'hello?' }));
  await a.next((e) => e.type === 'error');

  a.ws.send(JSON.stringify({ type: 'voice_join', channelId: room.id }));
  assert.deepEqual(await a.next((e) => e.type === 'fireside_history'), { type: 'fireside_history', channelId: room.id, messages: [] });
  b.ws.send(JSON.stringify({ type: 'voice_join', channelId: room.id }));
  await b.next((e) => e.type === 'fireside_history');
  a.ws.send(JSON.stringify({ type: 'fireside_send', content: '  that jump was not my fault  ' }));
  const heard = await b.next((e) => e.type === 'fireside');
  assert.equal(heard.channelId, room.id);
  assert.deepEqual([heard.message.userId, heard.message.author, heard.message.content], [ash.user.id, 'ash', 'that jump was not my fault']);
  await a.next((e) => e.type === 'fireside'); // the sender gets it back too
  a.ws.send(JSON.stringify({ type: 'fireside_send', content: '   ' }));
  await a.next((e) => e.type === 'error');
  a.ws.send(JSON.stringify({ type: 'fireside_send', content: 'x'.repeat(1001) }));
  await a.next((e) => e.type === 'error');

  // Someone in the burrow but not at the fire never sees it, until they sit down.
  await new Promise((r) => setTimeout(r, 100));
  await assert.rejects(c.next((e) => e.type === 'fireside'));
  c.ws.send(JSON.stringify({ type: 'voice_join', channelId: room.id }));
  const caughtUp = await c.next((e) => e.type === 'fireside_history');
  assert.deepEqual(caughtUp.messages.map((m: any) => m.content), ['that jump was not my fault']);

  // Once everyone has left, the fire's chat is gone.
  for (const s of [a, b, c]) s.ws.send(JSON.stringify({ type: 'voice_leave' }));
  await a.next((e) => e.type === 'voice_state' && e.userIds.length === 0);
  b.ws.send(JSON.stringify({ type: 'voice_join', channelId: room.id }));
  assert.deepEqual((await b.next((e) => e.type === 'fireside_history')).messages, []);
  for (const s of [a, b, c]) s.ws.close();
});

test('removing, leaving or deleting disconnects people from LiveKit', async () => {
  const base = bases[0];
  const reg = async (username: string) => (await call(base, '/api/register', { body: { username, password: 'password1' } })).data;
  const host = await reg('host2');
  const kim = await reg('kim');
  const lee = await reg('lee');
  const server = (await call(base, '/api/servers', { body: { name: 'Camp' }, token: host.token })).data;
  for (const u of [kim, lee]) await call(base, '/api/join', { body: { inviteCode: server.inviteCode }, token: u.token });
  const room = (await call(base, `/api/servers/${server.id}/channels`, { body: { name: 'Talk', kind: 'voice' }, token: host.token })).data.channels.find(
    (c: any) => c.kind === 'voice',
  );
  const hostWs = socket(base, host.token);
  await hostWs.next((e) => e.type === 'ready');
  const kimWs = socket(base, kim.token);
  await kimWs.next((e) => e.type === 'ready');
  kimWs.ws.send(JSON.stringify({ type: 'voice_join', channelId: room.id }));
  await hostWs.next((e) => e.type === 'voice_state' && e.userIds.includes(kim.user.id));

  // Only calls for this test's room: a slow call left over from an earlier test can name the same user id.
  const ours = (c: any) => c.body.room === `room-${room.id}` || c.claims?.video?.room === `room-${room.id}`;
  const waitForCall = async (method: string, identity?: string) => {
    for (let i = 0; i < 100; i++) {
      const i2 = liveKitCalls.findIndex((c) => c.method === method && ours(c) && (identity === undefined || c.body.identity === identity));
      if (i2 >= 0) return liveKitCalls.splice(i2, 1)[0];
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`LiveKit never got ${method}`);
  };

  // Removed: off the room's list for everyone, and disconnected from LiveKit with an admin token.
  await call(base, `/api/servers/${server.id}/members/${kim.user.id}/remove`, { body: {}, token: host.token });
  assert.deepEqual((await hostWs.next((e) => e.type === 'voice_state')).userIds, []);
  const removed = await waitForCall('RemoveParticipant', String(kim.user.id));
  assert.equal(removed.valid, true);
  assert.equal(removed.body.room, `room-${room.id}`);
  assert.deepEqual(removed.claims.video, { room: `room-${room.id}`, roomAdmin: true, roomCreate: true });

  // Leaving does the same, even if the app never said it was in voice.
  await call(base, `/api/servers/${server.id}/leave`, { body: {}, token: lee.token });
  assert.equal((await waitForCall('RemoveParticipant', String(lee.user.id))).body.room, `room-${room.id}`);

  // Deleting the voice room closes it for everyone.
  const res = await fetch(`${base}/api/channels/${room.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${host.token}` } });
  assert.equal(res.status, 200);
  assert.equal((await waitForCall('DeleteRoom')).body.room, `room-${room.id}`);
  hostWs.ws.close();
  kimWs.ws.close();
});

test('voice is off without LiveKit settings', async () => {
  const base = bases[1];
  assert.equal((await call(base, '/api/config')).data.voice, false);
  const max = (await call(base, '/api/register', { body: { username: 'max', password: 'password1' } })).data;
  const server = (await call(base, '/api/servers', { body: { name: 'Den' }, token: max.token })).data;
  const withVoice = (await call(base, `/api/servers/${server.id}/channels`, { body: { name: 'Talk', kind: 'voice' }, token: max.token })).data;
  const room = withVoice.channels.find((c: any) => c.kind === 'voice');
  assert.equal((await call(base, `/api/channels/${room.id}/voice`, { body: {}, token: max.token })).status, 503);
});

// A webhook the way LiveKit sends one: the body, and a JWT in Authorization that carries the body's hash.
function webhook(base: string, event: unknown, change: { secret?: string; claims?: Record<string, unknown>; header?: Record<string, unknown>; body?: string } = {}) {
  const body = JSON.stringify(event);
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT', ...change.header });
  const payload = b64({ iss: voice.apiKey, nbf: now - 5, exp: now + 300, sha256: createHash('sha256').update(body).digest('base64'), ...change.claims });
  const sig = createHmac('sha256', change.secret ?? voice.apiSecret).update(`${head}.${payload}`).digest('base64url');
  return fetch(`${base}/api/livekit/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/webhook+json', authorization: `${head}.${payload}.${sig}` },
    body: change.body ?? body,
  });
}

test('LiveKit webhooks: only signed ones count, and the fire then shows who LiveKit says is there', async () => {
  const base = bases[0];
  const app = apps[0] as Server & { sweepFires(): Promise<void>; checkFire(channelId: number, secondLook?: boolean): Promise<void> };
  const reg = async (username: string) => (await call(base, '/api/register', { body: { username, password: 'password1' } })).data;
  const host = await reg('hook-host');
  const ana = await reg('hook-ana');
  const bo = await reg('hook-birk');
  const stranger = await reg('hook-stranger');
  const server = (await call(base, '/api/servers', { body: { name: 'Hooks' }, token: host.token })).data;
  for (const u of [ana, bo]) await call(base, '/api/join', { body: { inviteCode: server.inviteCode }, token: u.token });
  const fires = (await call(base, `/api/servers/${server.id}/channels`, { body: { name: 'Second', kind: 'voice' }, token: host.token })).data.channels.filter((c: any) => c.kind === 'voice');
  const [fire, second] = fires;
  const name = `room-${fire.id}`;
  const hostWs = socket(base, host.token);
  await hostWs.next((e) => e.type === 'ready');
  const seen = async () => (await call(base, '/api/servers', { token: host.token })).data.find((s: any) => s.id === server.id).channels.find((c: any) => c.id === fire.id).voiceUsers;
  const joined = (identity: number) => ({ event: 'participant_joined', room: { name }, participant: { identity: String(identity) }, id: 'EV_1', createdAt: Math.floor(Date.now() / 1000) });

  // Anything not signed by our LiveKit is turned away, and changes nothing.
  inLiveKit.set(name, [String(ana.user.id)]);
  assert.equal((await webhook(base, joined(ana.user.id), { secret: 'someone-elses-secret-that-is-long-enough' })).status, 401);
  assert.equal((await webhook(base, joined(ana.user.id), { body: JSON.stringify(joined(bo.user.id)) })).status, 401); // body changed on the way
  assert.equal((await webhook(base, joined(ana.user.id), { claims: { exp: Math.floor(Date.now() / 1000) - 10 } })).status, 401);
  assert.equal((await webhook(base, joined(ana.user.id), { claims: { iss: 'another-key' } })).status, 401);
  assert.equal((await webhook(base, joined(ana.user.id), { header: { alg: 'none' } })).status, 401);
  assert.equal((await fetch(`${base}/api/livekit/webhook`, { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await webhook(bases[1], joined(ana.user.id))).status, 404); // voice is off there
  assert.deepEqual(await seen(), []);

  // Ana's app joined LiveKit without ever saying so: the webhook gets her announced to the hearth.
  assert.equal((await webhook(base, joined(ana.user.id))).status, 200);
  assert.deepEqual((await hostWs.next((e) => e.type === 'voice_state' && e.channelId === fire.id)).userIds, [ana.user.id]);
  // The same webhook again (LiveKit retries, or someone replays it) changes nothing.
  assert.equal((await webhook(base, joined(ana.user.id))).status, 200);
  await app.checkFire(fire.id);
  assert.deepEqual(await seen(), [ana.user.id]);

  // What counts is LiveKit's own list, not what the webhook claims: Bo is named but isn't there.
  await webhook(base, joined(bo.user.id));
  await app.checkFire(fire.id);
  assert.deepEqual(await seen(), [ana.user.id]);

  // She leaves LiveKit: off the list for everyone.
  inLiveKit.set(name, []);
  await webhook(base, { ...joined(ana.user.id), event: 'participant_left' });
  assert.deepEqual((await hostWs.next((e) => e.type === 'voice_state' && e.channelId === fire.id)).userIds, []);

  // Someone whose app said it sat down stays, even while LiveKit doesn't have them (reconnecting).
  const boWs = socket(base, bo.token);
  await boWs.next((e) => e.type === 'ready');
  boWs.ws.send(JSON.stringify({ type: 'voice_join', channelId: fire.id }));
  await hostWs.next((e) => e.type === 'voice_state' && e.userIds.includes(bo.user.id));
  await webhook(base, { ...joined(bo.user.id), event: 'participant_left' });
  await app.checkFire(fire.id);
  assert.deepEqual(await seen(), [bo.user.id]);

  // A webhook that never arrived is caught by the sweep, which asks LiveKit which rooms are open.
  inLiveKit.set(name, [String(bo.user.id), String(ana.user.id)]);
  await app.sweepFires();
  assert.deepEqual((await seen()).sort(), [ana.user.id, bo.user.id].sort());
  inLiveKit.set(name, [String(bo.user.id)]);
  await app.sweepFires();
  assert.deepEqual(await seen(), [bo.user.id]);

  // Someone in LiveKit who isn't in the hearth is taken out of LiveKit, not shown.
  liveKitCalls.length = 0;
  inLiveKit.set(name, [String(bo.user.id), String(stranger.user.id), 'not-a-number']);
  await webhook(base, joined(stranger.user.id));
  await app.checkFire(fire.id);
  for (let i = 0; i < 100 && liveKitCalls.filter((c) => c.method === 'RemoveParticipant').length < 2; i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(liveKitCalls.filter((c) => c.method === 'RemoveParticipant').map((c) => c.body.identity).sort(), ['not-a-number', String(stranger.user.id)].sort());
  assert.deepEqual(await seen(), [bo.user.id]);

  // Bo turns up in a second fire in LiveKit while his app sits at the first. The first look waits
  // (he may be changing fires); still in both at the second, he's moved, his app is told, and
  // LiveKit takes him out of the first.
  inLiveKit.set(name, [String(bo.user.id)]);
  inLiveKit.set(`room-${second.id}`, [String(bo.user.id)]);
  liveKitCalls.length = 0;
  await app.checkFire(second.id);
  assert.deepEqual(await seen(), [bo.user.id]);
  await app.checkFire(second.id, true);
  assert.equal((await boWs.next((e) => e.type === 'voice_elsewhere')).channelId, second.id);
  assert.deepEqual(await seen(), []);
  for (let i = 0; i < 100 && !liveKitCalls.some((c) => c.method === 'RemoveParticipant'); i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(liveKitCalls.filter((c) => c.method === 'RemoveParticipant').map((c) => [c.body.room, c.body.identity]), [[name, String(bo.user.id)]]);

  // His app closes without LiveKit letting go: the sweep keeps him shown until LiveKit says he left.
  inLiveKit.delete(name);
  boWs.ws.close();
  await hostWs.next((e) => e.type === 'presence' && e.userId === bo.user.id && !e.online).catch(() => {});
  await app.sweepFires();
  const at = async (id: number) => (await call(base, '/api/servers', { token: host.token })).data.find((s: any) => s.id === server.id).channels.find((c: any) => c.id === id).voiceUsers;
  assert.deepEqual(await at(second.id), [bo.user.id]);
  inLiveKit.delete(`room-${second.id}`);
  await app.sweepFires();
  assert.deepEqual(await at(second.id), []);

  // However many webhooks arrive at once, one look at the fire is waiting, not one each.
  liveKitCalls.length = 0;
  await Promise.all([app.checkFire(fire.id), app.checkFire(fire.id), app.checkFire(fire.id)]);
  assert.equal(liveKitCalls.filter((c) => c.method === 'ListParticipants').length, 1);

  // A full fire stays full: a pass taken while there was room doesn't seat someone through LiveKit.
  const limit = await fetch(`${base}/api/channels/${fire.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${host.token}` }, body: JSON.stringify({ userLimit: 1 }) });
  assert.equal(limit.status, 200);
  inLiveKit.set(name, [String(ana.user.id)]);
  await app.checkFire(fire.id);
  assert.deepEqual(await seen(), [ana.user.id]);
  liveKitCalls.length = 0;
  inLiveKit.set(name, [String(ana.user.id), String(bo.user.id)]);
  await app.checkFire(fire.id);
  for (let i = 0; i < 100 && !liveKitCalls.some((c) => c.method === 'RemoveParticipant'); i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(liveKitCalls.filter((c) => c.method === 'RemoveParticipant').map((c) => [c.body.room, c.body.identity]), [[name, String(bo.user.id)]]);
  assert.deepEqual(await seen(), [ana.user.id]);
  // The host manages voice, so there's a seat for them all the same.
  inLiveKit.set(name, [String(ana.user.id), String(host.user.id)]);
  await app.checkFire(fire.id);
  assert.deepEqual((await seen()).sort(), [ana.user.id, host.user.id].sort());
  inLiveKit.delete(name);
  await app.sweepFires();
  hostWs.ws.close();
});
