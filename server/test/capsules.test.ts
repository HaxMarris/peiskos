import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { caller, listening } from './helpers.ts';

const db = openDb(':memory:');
const uploadDir = join(mkdtempSync(join(tmpdir(), 'peiskos-capsules-')), 'uploads');
const voice = { apiKey: 'devkey', apiSecret: 'a-secret-that-is-at-least-32-characters-long' };
const app = createApp({ db, publicDir: '/nonexistent', uploadDir, voice });
let base = '';
listening(app, (url) => (base = url));
const call = caller(() => base);

const upload = async (channelId: number, token: string, data: string | Uint8Array, name: string, type: string, voiceSeconds?: number) =>
  (await fetch(`${base}/api/channels/${channelId}/attachments`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`, 'content-type': type, 'x-filename': encodeURIComponent(name),
      ...(voiceSeconds ? { 'x-voice-seconds': String(voiceSeconds) } : {}),
    },
    body: data,
  })).json() as Promise<any>;

async function socket(token: string) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?token=${token}`);
  const events: any[] = [];
  ws.on('message', (raw) => events.push(JSON.parse(String(raw))));
  const next = async (pred: (e: any) => boolean) => {
    for (let i = 0; i < 100; i++) {
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

const DAY = 86400_000;
const reg = async (username: string) => (await call('/api/register', { body: { username, password: 'password1' } })).data;

test('a time capsule stays sealed until its day, then opens for everyone at its fire', async () => {
  const max = await reg('max'), sam = await reg('sam'), eve = await reg('eve');
  const hearth = (await call('/api/servers', { body: { name: 'Den' }, token: max.token })).data;
  await call('/api/join', { body: { inviteCode: hearth.inviteCode }, token: sam.token });
  const room = hearth.channels.find((c: any) => c.kind === 'text').id;
  const withFire = (await call(`/api/servers/${hearth.id}/channels`, { body: { name: 'Campfire', kind: 'voice' }, token: max.token })).data;
  const fire = withFire.channels.find((c: any) => c.kind === 'voice').id;

  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const photo = await upload(room, max.token, png, 'cabin.png', 'image/png');
  const note = await upload(room, max.token, 'OggS-pretend', 'voice-message.ogg', 'audio/ogg', 4.2);
  const opensAt = Date.now() + 30 * DAY;

  // Sealing needs something inside, a day ahead, and only your own unsent files from this room.
  assert.equal((await call(`/api/channels/${room}/capsules`, { body: { content: ' ', opensAt }, token: max.token })).status, 400);
  assert.equal((await call(`/api/channels/${room}/capsules`, { body: { content: 'hi', opensAt: Date.now() - DAY }, token: max.token })).status, 400);
  assert.equal((await call(`/api/channels/${room}/capsules`, { body: { content: 'hi', opensAt: Date.now() + 11 * 366 * DAY }, token: max.token })).status, 400);
  assert.equal((await call(`/api/channels/${room}/capsules`, { body: { content: 'hi', opensAt, attachmentIds: [photo.id] }, token: sam.token })).status, 400);
  assert.equal((await call(`/api/channels/${room}/capsules`, { body: { content: 'hi', opensAt }, token: eve.token })).status, 404);
  assert.equal((await call(`/api/channels/${fire}/capsules`, { body: { content: 'hi', opensAt }, token: max.token })).status, 400);

  const sealed = await call(`/api/channels/${room}/capsules`, {
    body: { content: 'Remember the cabin?', opensAt, attachmentIds: [photo.id, note.id], descriptions: { [photo.id]: 'The cabin in snow' } },
    token: max.token,
  });
  assert.equal(sealed.status, 200);
  assert.equal(sealed.data.fireId, fire);
  const id = sealed.data.id;

  // The hearth sees that it's there, and what kind of things are in it, but not what they are.
  const seen = (await call('/api/servers', { token: sam.token })).data.find((h: any) => h.id === hearth.id).capsules;
  assert.deepEqual(seen, [{ id, channelId: room, fireId: fire, authorId: max.user.id, createdAt: seen[0].createdAt, opensAt, photos: 1, voiceNotes: 1, files: 0 }]);
  assert.equal(JSON.stringify(seen).includes('cabin'), false);
  // Its files can't be fetched, or used in a message.
  assert.equal((await fetch(base + photo.url)).status, 404);
  assert.equal((await call(`/api/channels/${room}/messages`, { body: { content: 'x', attachmentIds: [photo.id] }, token: max.token })).status, 400);

  // Not before its day, even for whoever sealed it.
  const early = await call(`/api/capsules/${id}/open`, { body: {}, token: max.token });
  assert.equal(early.status, 403);
  assert.match(early.data.error, /sealed until/);

  db.prepare('UPDATE capsules SET opens_at = ? WHERE id = ?').run(Date.now() - 1000, id);
  // Only from its fire.
  const away = await call(`/api/capsules/${id}/open`, { body: {}, token: sam.token });
  assert.equal(away.status, 403);
  assert.match(away.data.error, /Join Campfire/);

  const s = await socket(sam.token), m = await socket(max.token);
  s.send({ type: 'voice_join', channelId: fire });
  await s.next((e) => e.type === 'voice_state' && e.userIds.includes(sam.user.id));
  m.send({ type: 'voice_join', channelId: fire });
  await m.next((e) => e.type === 'voice_state' && e.userIds.includes(max.user.id));

  const opened = await call(`/api/capsules/${id}/open`, { body: {}, token: sam.token });
  assert.equal(opened.status, 200);
  const msg = opened.data.message;
  // Posted in the room as its author, with its files, marked as a capsule.
  assert.equal(msg.authorId, max.user.id);
  assert.equal(msg.content, 'Remember the cabin?');
  assert.equal(msg.capsule.openedBy, sam.user.id);
  assert.equal(msg.capsule.opensAt < Date.now(), true);
  assert.deepEqual(msg.attachments.map((a: any) => a.name), ['cabin.png', 'voice-message.ogg']);
  assert.equal(msg.attachments[0].alt, 'The cabin in snow');
  assert.equal(msg.attachments[1].voiceSeconds, 4.2);
  assert.equal((await fetch(base + msg.attachments[0].url)).status, 200);
  // Everyone at the fire is told at once, to open it together.
  const told = await m.next((e) => e.type === 'capsule_opened');
  assert.equal(told.capsuleId, id);
  assert.equal(told.message.id, msg.id);
  await s.next((e) => e.type === 'capsule_opened');
  // Once only, and it's off the list.
  assert.equal((await call(`/api/capsules/${id}/open`, { body: {}, token: max.token })).status, 404);
  assert.deepEqual((await call('/api/servers', { token: sam.token })).data.find((h: any) => h.id === hearth.id).capsules, []);
  s.ws.close(); m.ws.close();
});

test('taking a sealed capsule back, and a hearth with no fire', async () => {
  const ann = await reg('ann'), bo = await reg('bo');
  const hearth = (await call('/api/servers', { body: { name: 'Shed' }, token: ann.token })).data;
  await call('/api/join', { body: { inviteCode: hearth.inviteCode }, token: bo.token });
  const room = hearth.channels.find((c: any) => c.kind === 'text').id;
  for (const c of hearth.channels.filter((c: any) => c.kind === 'voice')) await call(`/api/channels/${c.id}`, { method: 'DELETE', token: ann.token });

  const one = (await call(`/api/channels/${room}/capsules`, { body: { content: 'one', opensAt: Date.now() + DAY }, token: bo.token })).data;
  const two = (await call(`/api/channels/${room}/capsules`, { body: { content: 'two', opensAt: Date.now() + DAY }, token: bo.token })).data;
  assert.equal(one.fireId, null);

  // Whoever sealed it, or someone who manages messages (the host here), can throw it away.
  const other = await reg('cy');
  await call('/api/join', { body: { inviteCode: hearth.inviteCode }, token: other.token });
  assert.equal((await call(`/api/capsules/${one.id}`, { method: 'DELETE', token: other.token })).status, 403);
  assert.equal((await call(`/api/capsules/${one.id}`, { method: 'DELETE', token: bo.token })).status, 200);
  assert.equal((await call(`/api/capsules/${two.id}`, { method: 'DELETE', token: ann.token })).status, 200);

  // No fire to gather at: anyone in the room can open it once its day comes.
  const three = (await call(`/api/channels/${room}/capsules`, { body: { content: 'three', opensAt: Date.now() + DAY }, token: bo.token })).data;
  db.prepare('UPDATE capsules SET opens_at = ? WHERE id = ?').run(Date.now() - 1000, three.id);
  const opened = await call(`/api/capsules/${three.id}/open`, { body: {}, token: other.token });
  assert.equal(opened.status, 200);
  assert.equal(opened.data.message.content, 'three');
  assert.equal(opened.data.message.authorId, bo.user.id);
});
