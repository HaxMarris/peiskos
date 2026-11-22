import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { inspectMp4 } from '../src/mp4.ts';
import { caller, listening } from './helpers.ts';

const voice = { apiKey: 'devkey', apiSecret: 'a-secret-that-is-at-least-32-characters-long', apiUrl: 'http://localhost:9' };
const dir = mkdtempSync(join(tmpdir(), 'peiskos-theater-'));
const app = createApp({ db: openDb(':memory:'), publicDir: '/nonexistent', voice, uploadDir: join(dir, 'uploads'), minFreeDiskBytes: 0, movies: { maxBytes: 64 * 1024, storageBytes: 100 * 1024 } });
let base = '';
listening(app, (url) => (base = url));
const call = caller(() => base);

// ---- a small MP4, box by box: what Peiskos reads, with the codecs and length chosen by the test

const box = (type: string, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
};
const u32 = (...n: number[]) => Buffer.concat(n.map((v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v); return b; }));
function mp4({ video = 'avc1', profile = 100, audio = 'mp4a' as string | null, seconds = 90, width = 640, height = 360, mdat = 2000 } = {}) {
  const tkhd = (w: number, h: number) => box('tkhd', Buffer.alloc(76), u32(w * 65536, h * 65536));
  const hdlr = (kind: string) => box('hdlr', u32(0, 0), Buffer.from(kind, 'latin1'), Buffer.alloc(13));
  const stsd = (entry: Buffer) => box('minf', box('stbl', box('stsd', u32(0, 1), entry)));
  const visual = box(video, Buffer.alloc(78), box(video.startsWith('avc') ? 'avcC' : 'hvcC', Buffer.from([1, profile, 0, 30])));
  const tracks = [box('trak', tkhd(width, height), box('mdia', hdlr('vide'), stsd(visual)))];
  if (audio) tracks.push(box('trak', tkhd(0, 0), box('mdia', hdlr('soun'), stsd(box(audio, Buffer.alloc(28))))));
  const mvhd = box('mvhd', u32(0, 0, 0, 1000, seconds * 1000), Buffer.alloc(80));
  return Buffer.concat([box('ftyp', Buffer.from('isom', 'latin1'), u32(512)), box('moov', mvhd, ...tracks), box('mdat', Buffer.alloc(mdat, 7))]);
}

test('reading an MP4: H.264 and AAC pass, anything browsers might not play is turned away', async () => {
  const check = async (data: Buffer) => {
    const f = join(dir, `check-${Math.random()}.mp4`);
    writeFileSync(f, data);
    return inspectMp4(f).catch((err) => (err as Error).message);
  };
  assert.deepEqual(await check(mp4()), { duration: 90, width: 640, height: 360 });
  assert.deepEqual(await check(mp4({ audio: null, video: 'avc3' })), { duration: 90, width: 640, height: 360 });
  assert.match(String(await check(mp4({ video: 'hvc1' }))), /HEVC \(H\.265\)/);
  assert.match(String(await check(mp4({ profile: 110 }))), /High 10/);
  assert.match(String(await check(mp4({ audio: 'ac-3' }))), /AC-3/);
  assert.match(String(await check(mp4({ video: 'encv' }))), /copy-protected/);
  assert.match(String(await check(mp4({ seconds: 0 }))), /how long/);
  assert.match(String(await check(Buffer.from('not a movie at all'))), /isn't an MP4/);
  // Cut off partway: the index (moov) never arrived.
  const whole = mp4();
  assert.match(String(await check(Buffer.concat([whole.subarray(0, 24), Buffer.from([0, 0, 0x10, 0, 0x6d, 0x6f, 0x6f, 0x76, 1, 2])]))), /cut short/);
});

async function socket(token: string) {
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
  const send = (msg: unknown) => ws.send(JSON.stringify(msg));
  await next((e) => e.type === 'ready');
  return { ws, events, next, send };
}

let n = 0;
async function hearth() {
  const host = (await call('/api/register', { body: { username: `host${++n}`, password: 'password1' } })).data;
  const bob = (await call('/api/register', { body: { username: `bob${n}`, password: 'password1' } })).data;
  const server = (await call('/api/servers', { body: { name: 'Den' }, token: host.token })).data;
  await call('/api/join', { body: { inviteCode: server.inviteCode }, token: bob.token });
  const s = (await call(`/api/servers/${server.id}/channels`, { body: { name: 'Campfire', kind: 'voice' }, token: host.token })).data;
  return { host, bob, serverId: server.id, invite: server.inviteCode, fire: s.channels.find((c: any) => c.kind === 'voice').id };
}

const piece = (uploadId: string, token: string, at: number, data: Buffer) =>
  fetch(`${base}/api/movie-uploads/${uploadId}?at=${at}`, { method: 'PUT', headers: { authorization: `Bearer ${token}` }, body: data });

/** Sends a whole movie in two pieces, the way the app does. */
async function addMovie(serverId: number, token: string, data: Buffer, name = 'Night Hike.mp4') {
  const started = await call(`/api/servers/${serverId}/movies`, { body: { name, size: data.length }, token });
  if (started.status !== 200) return started;
  const half = Math.floor(data.length / 2);
  await piece(started.data.uploadId, token, 0, data.subarray(0, half));
  const res = await piece(started.data.uploadId, token, half, data.subarray(half));
  return { status: res.status, data: (await res.json()) as any };
}

test('adding a movie to the shelf: in pieces, checked, and watched a piece at a time', async () => {
  const { host, bob, serverId } = await hearth();
  const outsider = (await call('/api/register', { body: { username: `out${++n}`, password: 'password1' } })).data;
  const data = mp4();

  assert.equal((await call(`/api/servers/${serverId}/movies`, { body: { name: 'a', size: 10 }, token: outsider.token })).status, 404);
  assert.equal((await call(`/api/servers/${serverId}/movies`, { body: { name: 'a', size: 65 * 1024 }, token: host.token })).status, 413);

  // Pieces have to come in order; the server says where it got to.
  const started = (await call(`/api/servers/${serverId}/movies`, { body: { name: 'Night Hike.mp4', size: data.length }, token: host.token })).data;
  assert.equal((await piece(started.uploadId, bob.token, 0, data)).status, 404);
  assert.equal((await piece(started.uploadId, host.token, 0, data.subarray(0, 100))).status, 200);
  const skipped = await piece(started.uploadId, host.token, 500, data.subarray(500));
  assert.equal(skipped.status, 409);
  assert.equal(((await skipped.json()) as any).received, 100);
  const done = await piece(started.uploadId, host.token, 100, data.subarray(100));
  const movie = ((await done.json()) as any).movie;
  assert.equal(movie.name, 'Night Hike');
  assert.equal(movie.duration, 90);
  assert.equal(movie.width, 640);

  // Not an MP4: turned away at the first piece. HEVC: turned away once it's all there.
  const junk = (await call(`/api/servers/${serverId}/movies`, { body: { name: 'x.mkv', size: 5000 }, token: bob.token })).data;
  const refused = await piece(junk.uploadId, bob.token, 0, Buffer.alloc(100, 1));
  assert.equal(refused.status, 415);
  assert.equal((await piece(junk.uploadId, bob.token, 100, Buffer.alloc(100, 1))).status, 404);
  const hevc = await addMovie(serverId, bob.token, mp4({ video: 'hvc1' }));
  assert.equal(hevc.status, 415);
  assert.match(hevc.data.error, /HEVC/);

  const shelf = (await call(`/api/servers/${serverId}/movies`, { token: bob.token })).data;
  assert.deepEqual(shelf.movies.map((m: any) => m.id), [movie.id]);
  assert.equal(shelf.canAdd, true);
  assert.equal(shelf.canRemoveAny, false);

  // The player asks for a piece at a time.
  const part = await fetch(base + movie.url, { headers: { range: 'bytes=4-7' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-type'), 'video/mp4');
  assert.equal(Buffer.from(await part.arrayBuffer()).toString('latin1'), 'ftyp');

  // All movies together are capped: 100 KB here.
  const big = mp4({ mdat: 60 * 1024 });
  assert.equal((await addMovie(serverId, bob.token, big)).status, 200);
  assert.equal((await call(`/api/servers/${serverId}/movies`, { body: { name: 'more', size: big.length }, token: bob.token })).status, 507);

  // Whoever added it, or a host, can take it off the shelf; then it's gone.
  assert.equal((await call(`/api/movies/${movie.id}`, { method: 'DELETE', token: bob.token })).status, 403);
  assert.equal((await call(`/api/movies/${movie.id}`, { method: 'DELETE', token: host.token })).status, 200);
  assert.equal((await fetch(base + movie.url)).status, 404);
});

test('watching together: one movie per fire, in step, and stopped by whoever put it on or a host', async () => {
  const { host, bob, serverId, fire, invite } = await hearth();
  const movie = (await addMovie(serverId, bob.token, mp4())).data.movie;
  const h = await socket(host.token);
  const b = await socket(bob.token);
  b.send({ type: 'theater', action: 'start', movieId: movie.id });
  await b.next((e) => e.type === 'error' && /Join a fire/.test(e.error));
  for (const s of [h, b]) {
    s.send({ type: 'voice_join', channelId: fire });
    await s.next((e) => e.type === 'fireside_history');
  }
  b.send({ type: 'theater', action: 'start', movieId: 'nope' });
  await b.next((e) => e.type === 'error' && /gone/.test(e.error));
  b.send({ type: 'theater', action: 'start', movieId: movie.id });
  const on = await h.next((e) => e.type === 'theater_state' && e.state);
  assert.equal(on.state.movie.id, movie.id);
  assert.equal(on.state.playing, true);
  assert.equal(on.state.by, bob.user.id);

  h.send({ type: 'theater', action: 'pause' });
  assert.equal((await b.next((e) => e.type === 'theater_state' && !e.state.playing)).state.playing, false);
  h.send({ type: 'theater', action: 'seek', position: 9999 });
  assert.equal((await b.next((e) => e.type === 'theater_state' && e.state.position === 90)).state.position, 90);
  h.send({ type: 'theater', action: 'seek', position: 30 });
  await b.next((e) => e.type === 'theater_state' && e.state.position === 30);

  // Someone sitting down later sees it where everyone else is.
  const carol = (await call('/api/register', { body: { username: `carol${++n}`, password: 'password1' } })).data;
  await call('/api/join', { body: { inviteCode: invite }, token: carol.token });
  const c = await socket(carol.token);
  c.send({ type: 'voice_join', channelId: fire });
  assert.equal((await c.next((e) => e.type === 'theater_state')).state.position, 30);

  // Only Bob (who put it on) or the host stops it.
  c.send({ type: 'theater', action: 'stop' });
  await c.next((e) => e.type === 'error' && /Only whoever put it on/.test(e.error));
  c.send({ type: 'theater', action: 'start', movieId: movie.id });
  await c.next((e) => e.type === 'error' && /already on/.test(e.error));
  h.send({ type: 'theater', action: 'stop' });
  assert.equal((await b.next((e) => e.type === 'theater_state' && !e.state)).state, null);

  // Taking a movie off the shelf stops it where it's on.
  b.send({ type: 'theater', action: 'start', movieId: movie.id });
  await h.next((e) => e.type === 'theater_state' && e.state);
  await call(`/api/movies/${movie.id}`, { method: 'DELETE', token: bob.token });
  await h.next((e) => e.type === 'theater_state' && !e.state);

  // The fire goes out: nothing is on next time.
  const again = (await addMovie(serverId, bob.token, mp4())).data.movie;
  b.send({ type: 'theater', action: 'start', movieId: again.id });
  await h.next((e) => e.type === 'theater_state' && e.state);
  for (const s of [h, b, c]) s.send({ type: 'voice_leave' });
  await new Promise((r) => setTimeout(r, 100));
  h.events.length = 0;
  h.send({ type: 'voice_join', channelId: fire });
  await h.next((e) => e.type === 'fireside_history');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(h.events.some((e) => e.type === 'theater_state'), false);
  for (const s of [h, b, c]) s.ws.close();
});
