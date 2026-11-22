import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { caller } from './helpers.ts';

// LiveKit is only asked to take people out of rooms here, and whisper.cpp is a stand-in that
// says the same line for any audio.
const fakeLiveKit = createServer((_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{}'));
let whisperCalls = 0;
const fakeWhisper = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    whisperCalls++;
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      text: 'hello by the fire',
      segments: [{ start: 1.0, end: 2.5, text: ' hello by the fire' }, { start: 3, end: 4, text: '[BLANK_AUDIO]' }],
    }));
  });
});
const voice = { apiKey: 'devkey', apiSecret: 'a-secret-that-is-at-least-32-characters-long', apiUrl: '' };
const work = mkdtempSync(join(tmpdir(), 'peiskos-tapes-'));
const uploadDir = join(work, 'uploads');
let app: Server & { tapes: any };
let base = '';
let audio: Buffer;

before(async () => {
  await new Promise<void>((r) => fakeLiveKit.listen(0, r));
  await new Promise<void>((r) => fakeWhisper.listen(0, r));
  voice.apiUrl = `http://localhost:${(fakeLiveKit.address() as AddressInfo).port}`;
  // What an app's recorder sends: Opus in WebM.
  const file = join(work, 'voice.webm');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=6', '-c:a', 'libopus', '-b:a', '32k', '-f', 'webm', file]);
  audio = readFileSync(file);
  app = createApp({
    db: openDb(':memory:'), publicDir: '/nonexistent', voice, uploadDir,
    tapes: {
      whisperUrl: `http://localhost:${(fakeWhisper.address() as AddressInfo).port}`,
      timing: { askMs: 3000, clipDelayMs: 150, endGraceMs: 300, askAgainMs: 0 },
    },
  }) as any;
  await new Promise<void>((r) => app.listen(0, r));
  base = `http://localhost:${(app.address() as AddressInfo).port}`;
});
after(() => {
  fakeLiveKit.close();
  fakeWhisper.close();
  app.closeAllConnections();
  app.close();
});

const call = caller(() => base);

async function socket(token: string) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?token=${token}`);
  const events: any[] = [];
  ws.on('message', (raw) => events.push(JSON.parse(String(raw))));
  const next = async (pred: (e: any) => boolean) => {
    for (let i = 0; i < 150; i++) {
      const at = events.findIndex(pred);
      if (at >= 0) return events.splice(at, 1)[0];
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('timed out waiting for event');
  };
  const send = (msg: unknown) => ws.send(JSON.stringify(msg));
  await next((e) => e.type === 'ready');
  return { ws, events, next, send };
}

let n = 0;
async function people(...names: string[]) {
  const out: any[] = [];
  for (const name of names) out.push((await call('/api/register', { body: { username: `${name}${++n}`, password: 'password1' } })).data);
  return out;
}
async function fireWith(host: any, ...others: any[]) {
  const server = (await call('/api/servers', { body: { name: 'Den' }, token: host.token })).data;
  for (const o of others) await call('/api/join', { body: { inviteCode: server.inviteCode }, token: o.token });
  const s = (await call(`/api/servers/${server.id}/channels`, { body: { name: 'Campfire', kind: 'voice' }, token: host.token })).data;
  return { server: s, fire: s.channels.find((c: any) => c.kind === 'voice').id as number };
}
async function sitDown(person: any, fire: number) {
  const s = await socket(person.token);
  s.send({ type: 'voice_join', channelId: fire });
  await s.next((e) => e.type === 'tape_state' && e.channelId === fire);
  return s;
}
/** Sends audio the way an app does: a part in pieces, in order. */
async function sendAudio(person: any, tapeId: number, part: string, bytes = audio, pieces = 4) {
  const size = Math.ceil(bytes.length / pieces);
  const statuses: number[] = [];
  for (let i = 0; i < pieces; i++) {
    const res = await fetch(`${base}/api/tapes/${tapeId}/audio?part=${part}&seq=${i}&elapsed=${(i + 1) * 1500}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${person.token}`, 'content-type': 'audio/webm;codecs=opus' },
      body: bytes.subarray(i * size, (i + 1) * size),
    });
    statuses.push(res.status);
    await res.arrayBuffer();
  }
  return statuses;
}
const tapeState = (s: any, pred: (tape: any) => boolean) => s.next((e: any) => e.type === 'tape_state' && pred(e.tape));

test('a fire is taped only once everyone there says yes', async () => {
  const [host, bob] = await people('host', 'bob');
  const { fire } = await fireWith(host, bob);
  const h = await sitDown(host, fire);
  const b = await sitDown(bob, fire);

  h.send({ type: 'tape', action: 'ask', keep: 'all' });
  const asked = await tapeState(b, (t) => t?.phase === 'asking');
  assert.deepEqual(asked.tape.yes, [host.user.id]);
  b.send({ type: 'tape', action: 'answer', yes: false });
  assert.match((await h.next((e) => e.type === 'tape_note')).text, /said no, so nothing is taped/);
  await tapeState(h, (t) => t === null);

  // Asked again, and nobody answers in time.
  h.send({ type: 'tape', action: 'ask', keep: 'all' });
  await tapeState(b, (t) => t?.phase === 'asking');
  assert.match((await h.next((e) => e.type === 'tape_note' && /answered/.test(e.text))).text, /Not everyone answered/);

  // Nothing can be sent to a tape that isn't running.
  h.send({ type: 'tape', action: 'ask', keep: 'all' });
  await tapeState(b, (t) => t?.phase === 'asking');
  b.send({ type: 'tape', action: 'answer', yes: true });
  const taping = await tapeState(h, (t) => t?.phase === 'taping');
  assert.deepEqual(taping.tape.yes.sort(), [host.user.id, bob.user.id].sort());
  h.send({ type: 'tape', action: 'stop' });
  await tapeState(b, (t) => t === null);
  h.ws.close();
  b.ws.close();
});

test('people on the tape send their own audio; clips cut the last 30 seconds; the tape is mixed when it stops', async () => {
  const [host, bob, carol] = await people('host', 'bob', 'carol');
  const { fire } = await fireWith(host, bob, carol);
  const h = await sitDown(host, fire);
  const b = await sitDown(bob, fire);
  h.send({ type: 'tape', action: 'ask', keep: 'all' });
  await tapeState(b, (t) => t?.phase === 'asking');
  b.send({ type: 'tape', action: 'answer', yes: true });
  const { tape } = await tapeState(h, (t) => t?.phase === 'taping');

  // Carol sits down while it's going: she's asked, and says no, so nothing of hers is taken.
  const c = await socket(carol.token);
  c.send({ type: 'voice_join', channelId: fire });
  const seen = await tapeState(c, (t) => t?.phase === 'taping');
  assert.equal(seen.tape.yes.includes(carol.user.id), false);
  c.send({ type: 'tape', action: 'answer', yes: false });
  assert.match((await h.next((e) => e.type === 'tape_note' && /isn't on the tape/.test(e.text))).text, /carol\d+ isn't on the tape/);
  assert.deepEqual(await sendAudio(carol, tape.id, 'carol-part'), [403, 403, 403, 403]);

  // Bob's app sends his voice; a piece sent twice is taken once, and a part can't start midway.
  assert.deepEqual(await sendAudio(bob, tape.id, 'bob-part-1'), [200, 200, 200, 200]);
  assert.deepEqual(await sendAudio(bob, tape.id, 'bob-part-1', audio.subarray(0, 10), 1), [200]);
  const midway = await fetch(`${base}/api/tapes/${tape.id}/audio?part=bob-part-2&seq=3&elapsed=100`, {
    method: 'POST', headers: { authorization: `Bearer ${bob.token}`, 'content-type': 'audio/webm' }, body: audio.subarray(0, 100),
  });
  assert.equal(midway.status, 409);
  const wrongType = await fetch(`${base}/api/tapes/${tape.id}/audio?part=bob-part-3&seq=0&elapsed=100`, {
    method: 'POST', headers: { authorization: `Bearer ${bob.token}`, 'content-type': 'text/plain' }, body: 'hi',
  });
  assert.equal(wrongType.status, 415);

  // Clip that: only people on the tape can.
  c.send({ type: 'tape', action: 'clip' });
  assert.match((await c.next((e) => e.type === 'error')).error, /not on this tape/);
  b.send({ type: 'tape', action: 'clip' });
  assert.match((await h.next((e) => e.type === 'tape_note' && /clipped/.test(e.text))).text, /bob\d+ clipped that/);
  const { clip } = await b.next((e) => e.type === 'tape_clip');
  assert.equal(clip.state, 'ready');
  assert.ok(clip.endMs - clip.startMs <= 30_000);
  const clipFile = await fetch(base + clip.url);
  assert.equal(clipFile.headers.get('content-type'), 'audio/mp4');
  assert.ok((await clipFile.arrayBuffer()).byteLength > 2048);

  h.send({ type: 'tape', action: 'stop' });
  assert.match((await c.next((e) => e.type === 'tape_note' && /stopped/.test(e.text))).text, /host\d+ stopped the tape/);
  const ready = await b.next((e) => e.type === 'tape_ready');
  assert.equal(ready.state, 'ready');
  // Carol wasn't on it, so she isn't told; she can still see it, as anyone who can see the fire can.
  assert.equal(c.events.some((e) => e.type === 'tape_ready'), false);
  const list = (await call(`/api/channels/${fire}/tapes`, { token: carol.token })).data;
  const t = list.tapes.find((x: any) => x.id === tape.id);
  assert.equal(t.state, 'ready');
  assert.deepEqual(t.people.map((p: any) => p.id).sort(), [host.user.id, bob.user.id].sort());
  assert.equal(t.clips.length, 1);
  assert.equal(t.canDelete, false);
  const whole = await fetch(base + t.url, { headers: { range: 'bytes=0-99' } });
  assert.equal(whole.status, 206);
  assert.equal((await whole.arrayBuffer()).byteLength, 100);

  // Overnight, each person's own audio gets its words; whisper's quiet markers are left out.
  assert.equal((await call(`/api/tapes/${tape.id}`, { token: bob.token })).data.transcript.state, 'waiting');
  while (await app.tapes.transcribeNext(true)) { /* next */ }
  assert.equal(whisperCalls, 1);
  const read = (await call(`/api/tapes/${tape.id}`, { token: bob.token })).data.transcript;
  assert.equal(read.state, 'ready');
  assert.equal(read.lines.length, 1);
  assert.equal(read.lines[0].userId, bob.user.id);
  assert.equal(read.lines[0].text, 'hello by the fire');
  const clipRead = (await call(`/api/tape-clips/${clip.id}`, { token: carol.token })).data.transcript;
  const inClip = read.lines[0].end > clip.startMs && read.lines[0].at < clip.endMs;
  assert.equal(clipRead.lines.length, inClip ? 1 : 0);

  // Only people on it (or who manage voice) can delete it.
  assert.equal((await call(`/api/tapes/${tape.id}`, { method: 'DELETE', token: carol.token })).status, 403);
  assert.equal((await call(`/api/tapes/${tape.id}`, { method: 'DELETE', token: bob.token })).status, 200);
  assert.equal((await fetch(base + t.url)).status, 404);
  assert.equal((await fetch(base + clip.url)).status, 404);
  for (const s of [h, b, c]) s.ws.close();
});

test('a tape that keeps only clips loses everything else when it stops, and anyone can take themselves off', async () => {
  const [host, bob] = await people('host', 'bob');
  const { fire } = await fireWith(host, bob);
  const h = await sitDown(host, fire);
  const b = await sitDown(bob, fire);
  h.send({ type: 'tape', action: 'ask', keep: 'clips' });
  await tapeState(b, (t) => t?.phase === 'asking');
  b.send({ type: 'tape', action: 'answer', yes: true });
  const { tape } = await tapeState(h, (t) => t?.phase === 'taping');
  assert.equal(tape.keep, 'clips');
  await sendAudio(bob, tape.id, 'bob-only-clips');
  await sendAudio(host, tape.id, 'host-only-clips');
  await new Promise((r) => setTimeout(r, 1500)); // a clip of a second and a half
  b.send({ type: 'tape', action: 'clip' });
  const { clip } = await h.next((e) => e.type === 'tape_clip');
  assert.equal(clip.state, 'ready');
  h.send({ type: 'tape', action: 'stop' });
  await b.next((e) => e.type === 'tape_ready');
  await app.tapes.settled();

  const t = (await call(`/api/tapes/${tape.id}`, { token: host.token })).data.tape;
  assert.equal(t.url, null);
  assert.equal(t.clips[0].state, 'ready');
  // Left: the clip, and each person's part of it (for the transcript). Their whole recordings are gone.
  assert.equal(readdirSync(join(uploadDir, 'tapes')).filter((f) => f.endsWith('.webm')).length, 0);
  while (await app.tapes.transcribeNext(true)) { /* next */ }
  const words = (await call(`/api/tape-clips/${clip.id}`, { token: host.token })).data.transcript;
  assert.deepEqual(words.lines.map((l: any) => l.userId).sort(), [host.user.id, bob.user.id].sort());

  // Bob takes himself off: his part of the clip is cut out, and he's no longer listed.
  const left = (await call(`/api/tapes/${tape.id}/leave`, { body: {}, token: bob.token })).data.tape;
  assert.deepEqual(left.people.map((p: any) => p.id), [host.user.id]);
  await app.tapes.settled();
  while (await app.tapes.transcribeNext(true)) { /* next */ }
  const after = (await call(`/api/tape-clips/${clip.id}`, { token: host.token })).data;
  assert.equal(after.clip.state, 'ready');
  assert.deepEqual(after.transcript.lines.map((l: any) => l.userId), [host.user.id]);
  h.ws.close();
  b.ws.close();
});

test('the tape stops when nobody on it is left at the fire, and the asker leaving calls it off', async () => {
  const [host, bob] = await people('host', 'bob');
  const { fire } = await fireWith(host, bob);
  const h = await sitDown(host, fire);
  const b = await sitDown(bob, fire);
  h.send({ type: 'tape', action: 'ask', keep: 'all' });
  await tapeState(b, (t) => t?.phase === 'asking');
  h.send({ type: 'voice_leave' });
  assert.match((await b.next((e) => e.type === 'tape_note')).text, /called off/);

  // Alone at the fire, asking starts it straight away.
  b.send({ type: 'tape', action: 'ask', keep: 'all' });
  const { tape } = await tapeState(b, (t) => t?.phase === 'taping');
  b.send({ type: 'voice_leave' });
  await app.tapes.settled();
  await new Promise((r) => setTimeout(r, 400));
  await app.tapes.settled();
  // Nothing was sent, so there's nothing to keep.
  const t = (await call(`/api/tapes/${tape.id}`, { token: bob.token })).data.tape;
  assert.equal(t.state, 'empty');
  h.ws.close();
  b.ws.close();
});
