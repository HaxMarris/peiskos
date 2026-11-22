import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { longestLit, mostAtOnce, sharedTime } from '../src/recap.ts';
import { caller, listening } from './helpers.ts';

const db = openDb(':memory:');
const app = createApp({ db, publicDir: '/nonexistent' });
let base = '';
listening(app, (url) => (base = url));
const call = caller(() => base);
const reg = async (username: string) => (await call('/api/register', { body: { username, password: 'password1' } })).data;
const HOUR = 3600_000;
const year = new Date().getUTCFullYear();
/** Noon on a day of this year, so a date never falls on the other side of midnight Eastern. */
const day = (month: number, d: number, hour = 17) => Date.UTC(year, month, d, hour);
const sat = (userId: number, serverId: number, channelId: number, start: number, hours: number) =>
  db.prepare('INSERT INTO voice_time (user_id, server_id, channel_id, started_at, ended_at) VALUES (?, ?, ?, ?, ?)').run(userId, serverId, channelId, start, start + hours * HOUR);
function socket(token: string) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?token=${token}`);
  const events: any[] = [];
  ws.on('message', (raw) => events.push(JSON.parse(String(raw))));
  const next = async (pred: (e: any) => boolean) => {
    for (let i = 0; i < 100; i++) {
      const at = events.findIndex(pred);
      if (at >= 0) return events.splice(at, 1)[0];
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('no such event');
  };
  return { ws, events, next };
}

test('how long a fire stayed lit, the most at once, and who you sat with', () => {
  const v = (userId: number, start: number, end: number, channelId = 1) => ({ userId, channelId, start, end });
  // 1 then 2 overlapping keep the fire lit 0..5; 3 arrives just as 2 leaves (still lit, no third person at once).
  const visits = [v(1, 0, 3), v(2, 2, 5), v(3, 5, 6), v(1, 10, 11), v(4, 0, 9, 2)];
  const lit = longestLit(visits)!;
  assert.deepEqual([lit.start, lit.end, lit.people.size], [0, 9, 1]);
  const at1 = longestLit(visits.filter((x) => x.channelId === 1))!;
  assert.deepEqual([at1.start, at1.end, [...at1.people].sort()], [0, 6, [1, 2, 3]]);
  assert.deepEqual(mostAtOnce(visits), { n: 2, at: 2 });
  assert.equal(mostAtOnce([v(1, 0, 5), v(1, 1, 3), v(2, 2, 4)]).n, 2);
  assert.deepEqual(sharedTime(visits, 2), [[1, 1]]);
  assert.deepEqual(sharedTime(visits, 4), []);
});

test('the year at the fire: the hearth, the fire, fish, the casino and you', async () => {
  const max = await reg('max');
  const sam = await reg('sam');
  const ana = await reg('ana');
  const s = (await call('/api/servers', { body: { name: 'Lodge' }, token: max.token })).data;
  for (const p of [sam, ana]) await call('/api/join', { body: { inviteCode: s.inviteCode }, token: p.token });
  const general = s.channels.find((c: any) => c.kind === 'text').id;
  const fire = (await call(`/api/servers/${s.id}/channels`, { body: { name: 'Fire', kind: 'voice' }, token: max.token })).data.channels.find((c: any) => c.name === 'Fire').id;
  const hello = (await call(`/api/channels/${general}/messages`, { body: { content: 'first!' }, token: sam.token })).data;
  await call(`/api/channels/${general}/messages`, { body: { content: 'hi sam' }, token: max.token });
  await call(`/api/channels/${general}/messages`, { body: { content: 'again' }, token: sam.token });
  await call(`/api/messages/${hello.id}/reactions`, { body: { emoji: '🔥' }, token: max.token });
  await call(`/api/messages/${hello.id}/reactions`, { body: { emoji: '🔥' }, token: sam.token });

  // One long night in March: max and sam together for 2 hours, ana joins for one. A short one in June.
  sat(max.user.id, s.id, fire, day(2, 3), 4);
  sat(sam.user.id, s.id, fire, day(2, 3) + HOUR, 2);
  sat(ana.user.id, s.id, fire, day(2, 3) + 1.5 * HOUR, 1);
  sat(sam.user.id, s.id, fire, day(5, 1), 1);
  // Last year's doesn't count.
  sat(ana.user.id, s.id, fire, Date.UTC(year - 1, 5, 1), 50);

  const best = db.prepare('INSERT INTO fishing_best (server_id, user_id, day, fish, size, score, stars, giant, idle, caught_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)');
  best.run(s.id, sam.user.id, `${year}-03-03`, 'minnow', 5, 90, 5, 0, day(2, 3));
  best.run(s.id, sam.user.id, `${year}-03-04`, 'minnow', 4, 50, 2, 0, day(2, 4));
  best.run(s.id, ana.user.id, `${year}-03-04`, 'goldtench', 60, 40, 3, 0, day(2, 4));
  db.prepare('INSERT INTO fishing_derby_entries (server_id, week, user_id, size, score, stars, caught_at, place) VALUES (?, ?, ?, 1, 1, 1, 0, 1)').run(s.id, `${year}-03-02`, sam.user.id);
  const item = db.prepare('INSERT INTO casino_items (user_id, server_id, skin_id, float, stattrak, value, created_at) VALUES (?, ?, ?, 0.2, 0, ?, ?)');
  item.run(max.user.id, s.id, 'kindling-milspec-0', 40, day(4, 1));
  item.run(sam.user.id, s.id, 'kindling-milspec-1', 900, day(4, 2));
  item.run(sam.user.id, s.id, 'kindling-milspec-0', 9999, Date.UTC(year - 1, 1, 1));
  db.prepare('INSERT INTO casino_found (user_id, server_id, skin_id, count, best_float, first_at) VALUES (?, ?, ?, 1, 0.2, ?)').run(max.user.id, s.id, 'kindling-milspec-0', day(4, 1));
  db.prepare('INSERT INTO casino_wallets (user_id, server_id, chips, created_at) VALUES (?, ?, ?, 0)').run(ana.user.id, s.id, 25_000);

  const r = (await call(`/api/servers/${s.id}/recap/${year}`, { token: max.token })).data;
  assert.equal(r.hearth, 'Lodge');
  assert.equal(r.messages, 3);
  assert.equal(r.busiestMonth.n, 3);
  assert.equal(Math.round(r.fire.hours), 8);
  assert.equal(r.fire.nights, 2);
  assert.deepEqual([r.fire.longest.day, r.fire.longest.hours, r.fire.longest.people], [`${year}-03-03`, 4, 3]);
  assert.deepEqual([r.fire.mostAtOnce.n, r.fire.mostAtOnce.day], [3, `${year}-03-03`]);
  assert.deepEqual(r.topFire.map((p: any) => p.name), ['max', 'sam', 'ana']);
  // The golden tench is worth more than any minnow, however good.
  assert.deepEqual([r.fish.days, r.fish.anglers, r.fish.best.fish, r.fish.best.name], [3, 2, 'Golden Tench', 'ana']);
  assert.deepEqual(r.fish.topAngler, { name: 'sam', days: 2 });
  assert.deepEqual(r.fish.derbyChamp, { name: 'sam', wins: 1 });
  assert.equal(r.casino.found, 1);
  assert.deepEqual([r.casino.best.name, r.casino.best.skin, r.casino.best.value], ['sam', 'P250 | Pinecone', 900]);
  assert.deepEqual(r.casino.chipLeader, { name: 'ana', chips: 25_000 });

  assert.equal(r.you.messages, 1);
  assert.equal(r.you.talkRank, 2);
  assert.equal(r.you.fireRank, 1);
  assert.equal(r.you.fireNights, 1);
  assert.deepEqual(r.you.satWith, { name: 'sam', hours: 2 });
  assert.equal(r.you.found, 1);
  assert.equal(r.you.bestSkin.skin, 'Glock-18 | Wool Sock');
  assert.equal(r.you.fishDays, 0);
  assert.equal(r.you.bestCatch, null);

  const theirs = (await call(`/api/servers/${s.id}/recap/${year}`, { token: sam.token })).data.you;
  assert.equal(theirs.reactionsGot, 1); // their own 🔥 doesn't count
  assert.equal(theirs.firstWords.content, 'first!');
  assert.equal(theirs.emoji.emoji, '🔥');
  assert.equal(theirs.topRoom, 'general');
  assert.equal(theirs.derbyWins, 1);
  assert.equal(theirs.bestCatch.fish, 'Minnow');
  assert.equal(theirs.bestCatch.stars, 5);

  // The older address gives the same.
  assert.equal((await call(`/api/servers/${s.id}/review/${year}`, { token: max.token })).data.fire.nights, 2);
  assert.equal((await call(`/api/servers/${s.id}/recap/1999`, { token: max.token })).status, 400);
  const outsider = await reg('outsider');
  assert.equal((await call(`/api/servers/${s.id}/recap/${year}`, { token: outsider.token })).status, 404);
});

test('a recap shown at a fire moves for everyone sitting there', async (t) => {
  const lea = await reg('lea');
  const tom = await reg('tom');
  const s = (await call('/api/servers', { body: { name: 'Camp' }, token: lea.token })).data;
  await call('/api/join', { body: { inviteCode: s.inviteCode }, token: tom.token });
  const fire = (await call(`/api/servers/${s.id}/channels`, { body: { name: 'Fire', kind: 'voice' }, token: lea.token })).data.channels.find((c: any) => c.name === 'Fire').id;

  assert.equal((await call('/api/voice/recap', { body: { year, card: 'open' }, token: lea.token })).status, 400);
  const a = socket(lea.token), b = socket(tom.token);
  t.after(() => { a.ws.close(); b.ws.close(); });
  for (const x of [a, b]) {
    await x.next((e) => e.type === 'ready');
    x.ws.send(JSON.stringify({ type: 'voice_join', channelId: fire }));
  }
  await a.next((e) => e.type === 'voice_state' && e.userIds.length === 2);

  assert.equal((await call('/api/voice/recap', { body: { year, card: 'Nope!' }, token: lea.token })).status, 400);
  assert.equal((await call('/api/voice/recap', { body: { year, card: 'fire' }, token: lea.token })).status, 200);
  const seen = await b.next((e) => e.type === 'recap');
  assert.deepEqual([seen.channelId, seen.serverId, seen.year, seen.card, seen.by], [fire, s.id, year, 'fire', lea.user.id]);
  // Anyone at the fire can move it on, and someone sitting down later picks up where it is.
  await call('/api/voice/recap', { body: { year, card: 'fish' }, token: tom.token });
  assert.equal((await a.next((e) => e.type === 'recap' && e.by === tom.user.id)).card, 'fish');
  assert.equal((await call('/api/voice/recap', { token: lea.token })).data.show.card, 'fish');
  await call('/api/voice/recap', { body: { stop: true }, token: lea.token });
  assert.equal((await b.next((e) => e.type === 'recap' && e.stop)).by, lea.user.id);
  assert.equal((await call('/api/voice/recap', { token: tom.token })).data.show, null);
});
