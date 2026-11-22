// The hearth league: points from games at the fire, the derby and the casino, a season a month,
// its champion's trophy and banner.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { isFinalNight, league, seasonEnds } from '../src/league.ts';
import { caller } from './helpers.ts';

const fakeLiveKit = createServer((_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{}'));
const voice = { apiKey: 'devkey', apiSecret: 'a-secret-that-is-at-least-32-characters-long', apiUrl: '' };
const db = openDb(':memory:');
let clock = Date.parse('2026-11-10T18:00:00Z');
let app: Server;
let base = '';

before(async () => {
  await new Promise<void>((r) => fakeLiveKit.listen(0, r));
  voice.apiUrl = `http://localhost:${(fakeLiveKit.address() as AddressInfo).port}`;
  const uploadDir = join(mkdtempSync(join(tmpdir(), 'peiskos-league-')), 'uploads');
  app = createApp({ db, publicDir: '/nonexistent', voice, uploadDir, league: { now: () => clock } });
  await new Promise<void>((r) => app.listen(0, r));
  base = `http://localhost:${(app.address() as AddressInfo).port}`;
});
after(() => {
  fakeLiveKit.close();
  app.closeAllConnections();
  app.close();
});

const call = caller(() => base);

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
async function people(...names: string[]) {
  const out: any[] = [];
  for (const name of names) out.push((await call('/api/register', { body: { username: `${name}${++n}`, password: 'password1' } })).data);
  return out;
}
async function hearth(host: any, ...others: any[]) {
  const server = (await call('/api/servers', { body: { name: 'Den' }, token: host.token })).data;
  for (const o of others) await call('/api/join', { body: { inviteCode: server.inviteCode }, token: o.token });
  const s = (await call(`/api/servers/${server.id}/channels`, { body: { name: 'Campfire', kind: 'voice' }, token: host.token })).data;
  return { id: server.id as number, fire: s.channels.find((c: any) => c.kind === 'voice').id as number };
}
const standings = async (id: number, token: string) => (await call(`/api/servers/${id}/league`, { token })).data;

test('championship night is the last day of the month, Eastern', () => {
  assert.equal(isFinalNight(Date.parse('2026-11-30T15:00:00Z')), true);
  assert.equal(isFinalNight(Date.parse('2026-12-01T03:00:00Z')), true); // still the 30th in New York
  assert.equal(isFinalNight(Date.parse('2026-12-01T06:00:00Z')), false);
  assert.equal(isFinalNight(Date.parse('2026-11-29T15:00:00Z')), false);
  assert.equal(seasonEnds('2026-11'), Date.parse('2026-12-01T05:00:00Z'));
  assert.equal(seasonEnds('2026-12'), Date.parse('2027-01-01T05:00:00Z'));
});

test("a game's host sends the result: places give points, once a minute per fire", async () => {
  clock = Date.parse('2026-11-10T18:00:00Z');
  const [host, bob, carol, dan] = await people('host', 'bob', 'carol', 'dan');
  const { id, fire } = await hearth(host, bob, carol, dan);
  const [h, b, c, d] = await Promise.all([host, bob, carol, dan].map((p) => socket(p.token)));
  for (const s of [h, b, c, d]) {
    s.send({ type: 'voice_join', channelId: fire });
    await s.next((ev) => ev.type === 'fireside_history');
  }
  h.send({ type: 'game', action: 'start', game: 'trivia' });
  await b.next((ev) => ev.type === 'game_state' && ev.game);
  for (const s of [b, c]) s.send({ type: 'game', action: 'start', game: 'trivia' });
  await h.next((ev) => ev.type === 'game_state' && ev.game?.players.length === 3);

  // A player can't send it, and Dan (at the fire but not playing) doesn't count.
  const scores = [{ id: host.user.id, score: 900 }, { id: bob.user.id, score: 400 }, { id: carol.user.id, score: 100 }, { id: dan.user.id, score: 5000 }];
  b.send({ type: 'game', action: 'result', standings: scores });
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual((await standings(id, host.token)).standings, []);

  h.send({ type: 'game', action: 'result', standings: scores });
  assert.equal((await h.next((ev) => ev.type === 'league_points')).points, 3);
  assert.equal((await c.next((ev) => ev.type === 'league_points')).points, 1);
  const table = await standings(id, bob.token);
  assert.deepEqual(table.standings.map((r: any) => [r.userId, r.points, r.games]), [[host.user.id, 3, 3], [bob.user.id, 2, 2], [carol.user.id, 1, 1]]);
  assert.equal(table.season.number, 1);
  assert.equal(table.on, true);
  assert.equal(table.canChange, false);

  // Another one straight away doesn't count; a minute on it does. Everyone level is 1 point each.
  const level = [{ id: host.user.id, score: 0 }, { id: bob.user.id, score: 0 }];
  h.send({ type: 'game', action: 'result', standings: level });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal((await standings(id, host.token)).standings[0].points, 3);
  clock += 61_000;
  h.send({ type: 'game', action: 'result', standings: level });
  await h.next((ev) => ev.type === 'league_points');
  assert.deepEqual((await standings(id, host.token)).standings.map((r: any) => r.points), [4, 3, 1]);
  for (const s of [h, b, c, d]) s.ws.close();
});

test('casino wins and derby places count, up to a cap a day, and double on championship night', async () => {
  const [host, bob] = await people('host', 'bob');
  const { id } = await hearth(host, bob);
  let t = Date.parse('2026-11-12T18:00:00Z');
  const lg = league({
    db, route: () => {}, fail: (_s, m) => new Error(m), sendServerUpdate: () => {},
    isMember: () => true, isBurrow: () => true, can: () => true, channelById: () => ({ serverId: id }), now: () => t,
  });
  for (let i = 0; i < 14; i++) lg.casinoWin(id, bob.user.id, 'slots');
  lg.derbyPlaced(id, [{ userId: host.user.id, place: 1 }, { userId: bob.user.id, place: 2 }]);
  clock = t;
  let table = await standings(id, host.token);
  assert.deepEqual(table.standings.map((r: any) => [r.userId, r.casino, r.fishing]), [[bob.user.id, 10, 6], [host.user.id, 0, 10]]);
  assert.deepEqual(table.rules.cap, { games: 40, fishing: 20, casino: 10 });

  // The 30th: a win is worth 2, and the cap still counts 10 wins.
  t = Date.parse('2026-11-30T18:00:00Z');
  for (let i = 0; i < 12; i++) lg.casinoWin(id, host.user.id, 'blackjack');
  clock = t;
  table = await standings(id, host.token);
  assert.equal(table.season.finalNight, true);
  assert.deepEqual(table.standings.map((r: any) => [r.userId, r.points]), [[host.user.id, 30], [bob.user.id, 16]]);
});

test("once the month is over its champion gets a trophy and the hearth's banner, and the owner can turn it off", async () => {
  const [host, bob, stranger] = await people('host', 'bob', 'stranger');
  const { id, fire } = await hearth(host, bob);
  clock = Date.parse('2026-11-20T18:00:00Z');
  const lg = league({
    db, route: () => {}, fail: (_s, m) => new Error(m), sendServerUpdate: () => {},
    isMember: () => true, isBurrow: () => true, can: () => true, channelById: () => ({ serverId: id }), now: () => clock,
  });
  lg.gameResult(fire, 'trivia', new Set([host.user.id, bob.user.id]), [{ id: host.user.id, score: 1 }, { id: bob.user.id, score: 9 }]);
  const before = (await call('/api/servers', { token: host.token })).data.find((s: any) => s.id === id);
  assert.deepEqual(before.league, { on: true, champion: null, finalNight: false });

  clock = Date.parse('2026-12-02T18:00:00Z');
  const after = (await call('/api/servers', { token: host.token })).data.find((s: any) => s.id === id);
  assert.equal(after.league.champion.userId, bob.user.id);
  assert.equal(after.league.champion.season, 1);
  const table = await standings(id, host.token);
  assert.equal(table.season.number, 2);
  assert.deepEqual(table.past.map((p: any) => [p.number, p.championId, p.points]), [[1, bob.user.id, 3]]);

  const card = (await call(`/api/users/${bob.user.id}`, { token: host.token })).data;
  assert.deepEqual(card.trophies.map((x: any) => [x.serverId, x.season, x.hearth]), [[id, 1, 'Den']]);

  // Someone who isn't in the hearth can't see its league.
  assert.equal((await call(`/api/servers/${id}/league`, { token: stranger.token })).status, 404);

  assert.equal((await call(`/api/servers/${id}/league`, { method: 'PUT', body: { on: false }, token: bob.token })).status, 403);
  assert.equal((await call(`/api/servers/${id}/league`, { method: 'PUT', body: { on: false }, token: host.token })).data.on, false);
  lg.casinoWin(id, host.user.id, 'slots');
  assert.deepEqual((await standings(id, host.token)).standings, []);
});
