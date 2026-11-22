// The camp grows: camp points from fire hours, games and fish; builds that stay up; season goals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { CAMP_BUILDS, FISH_PER_POINT, monthStart, seasonOf } from '../src/camp.ts';
import { caller, listening } from './helpers.ts';

const db = openDb(':memory:');
const app = createApp({ db, publicDir: '/nonexistent' });
let base = '';
listening(app, (url) => (base = url));
const call = caller(() => base);
const checkCamp = (id: number) => (app as unknown as { checkCamp: (id: number) => any }).checkCamp(id);

let n = 0;
const person = async (name: string) => (await call('/api/register', { body: { username: `${name}${++n}`, password: 'password1' } })).data;
async function hearth() {
  const host = await person('host');
  const bob = await person('bob');
  const server = (await call('/api/servers', { body: { name: 'Den' }, token: host.token })).data;
  await call('/api/join', { body: { inviteCode: server.inviteCode }, token: bob.token });
  const made = (await call(`/api/servers/${server.id}/channels`, { body: { name: 'Campfire', kind: 'voice' }, token: host.token })).data;
  const fire = made.channels.find((c: { kind: string }) => c.kind === 'voice');
  return { host, bob, server, fire };
}
/** Hours at a fire, as voice_time rows ending now. */
const sit = (userId: number, serverId: number, channelId: number, hours: number, endedAt = Date.now()) =>
  db.prepare('INSERT INTO voice_time (user_id, server_id, channel_id, started_at, ended_at) VALUES (?, ?, ?, ?, ?)').run(userId, serverId, channelId, endedAt - hours * 3600_000, endedAt);
function listen(token: string) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws?token=' + token);
  const events: any[] = [];
  ws.on('message', (d) => events.push(JSON.parse(String(d))));
  const ready = new Promise<void>((r) => ws.once('message', () => r()));
  return { ws, events, ready, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('a new camp has nothing built, and only its people can see it', async () => {
  const { host, server } = await hearth();
  const r = await call(`/api/servers/${server.id}/camp`, { token: host.token });
  assert.equal(r.status, 200);
  assert.equal(r.data.points, 0);
  assert.equal(r.data.builds.length, CAMP_BUILDS.length);
  assert.ok(r.data.builds.every((b: { built: boolean }) => !b.built));
  assert.equal(r.data.season.id, seasonOf(Date.now()).id);
  const stranger = await person('stranger');
  assert.equal((await call(`/api/servers/${server.id}/camp`, { token: stranger.token })).status, 404);
});

test('fire hours build the camp, and the hearth is told what went up', async () => {
  const { host, bob, server, fire } = await hearth();
  const sock = listen(bob.token);
  await sock.ready;
  sit(host.user.id, server.id, fire.id, 10);
  sit(bob.user.id, server.id, fire.id, 6);
  const r = await call(`/api/servers/${server.id}/camp`, { token: host.token });
  assert.equal(r.data.points, 16);
  assert.equal(r.data.from.hours, 16);
  assert.deepEqual(r.data.builds.filter((b: { built: boolean }) => b.built).map((b: { id: string }) => b.id), ['woodpile', 'lanterns']);
  await wait(50);
  const told = sock.events.find((e) => e.type === 'camp' && e.serverId === server.id);
  assert.deepEqual(told?.built, ['Woodpile', 'Lantern path']);
  // Checked again, nothing new: nobody is told twice.
  sock.events.length = 0;
  checkCamp(server.id);
  await wait(50);
  assert.equal(sock.events.filter((e) => e.type === 'camp').length, 0);
  sock.ws.close();
});

test('builds stay up when the points behind them go', async () => {
  const { host, bob, server, fire } = await hearth();
  sit(bob.user.id, server.id, fire.id, 6);
  assert.equal(checkCamp(server.id).builds[0].built, true);
  db.prepare('DELETE FROM voice_time WHERE user_id = ?').run(bob.user.id);
  const r = await call(`/api/servers/${server.id}/camp`, { token: host.token });
  assert.equal(r.data.points, 0);
  assert.equal(r.data.builds[0].built, true);
  assert.equal(r.data.builds[1].built, false);
});

test("the AFK fire's hours don't count", async () => {
  const { host, server } = await hearth();
  const made = (await call(`/api/servers/${server.id}/channels`, { body: { name: 'Away', kind: 'voice' }, token: host.token })).data;
  const afk = made.channels.find((c: { name: string }) => c.name === 'Away');
  await call(`/api/servers/${server.id}`, { method: 'PATCH', body: { afkChannelId: afk.id }, token: host.token });
  sit(host.user.id, server.id, afk.id, 30);
  assert.equal(checkCamp(server.id).points, 0);
});

test('fish count by what each save adds, a few at most per save', async () => {
  const { host, bob, server } = await hearth();
  const save = async (who: { token: string }, caught: number, rev: number) =>
    (await call(`/api/servers/${server.id}/fishing`, { body: { save: { stats: { caught } }, rev }, token: who.token })).data;
  await save(bob, 3, 0);
  await save(bob, 5, 1);
  await save(bob, 900, 2); // an edited or broken save: only 20 of these count
  await save(bob, 899, 3); // fewer than before adds nothing
  for (let i = 0; i < 4; i++) await save(host, (i + 1) * 20, i);
  const camp = checkCamp(server.id);
  assert.equal(camp.from.fish, 3 + 2 + 20 + 80);
  assert.equal(camp.points, Math.floor(105 / FISH_PER_POINT));
});

test("fish caught before the camp existed count toward its builds, but not this season's goal", async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { MIGRATIONS } = await import('../src/db.ts');
  const old = new DatabaseSync(':memory:');
  old.exec(`CREATE TABLE servers (id INTEGER PRIMARY KEY, kind TEXT); CREATE TABLE fishing_saves (user_id INTEGER, server_id INTEGER, data TEXT);
    INSERT INTO servers VALUES (1, 'burrow'), (2, 'dm');
    INSERT INTO fishing_saves VALUES (1, 1, '{"stats":{"caught":250}}'), (2, 1, '{"stats":{"caught":40}}'), (3, 1, 'not json'), (1, 2, '{"stats":{"caught":9}}');`);
  MIGRATIONS.find((m) => m.why.startsWith('Camp builds'))!.run(old as never);
  assert.deepEqual(old.prepare('SELECT server_id AS s, SUM(n) AS n, MAX(at) AS at FROM camp_activity GROUP BY server_id').all().map((r) => ({ ...r })), [{ s: 1, n: 290, at: 0 }]);
});

test('a game counts once two people have played it for a minute', async () => {
  const { host, bob, server, fire } = await hearth();
  const a = listen(host.token), b = listen(bob.token);
  await Promise.all([a.ready, b.ready]);
  a.send({ type: 'voice_join', channelId: fire.id });
  b.send({ type: 'voice_join', channelId: fire.id });
  await wait(80);
  const games = () => (db.prepare("SELECT COUNT(*) AS n FROM camp_activity WHERE server_id = ? AND kind = 'game'").get(server.id) as { n: number }).n;
  // Alone, or over quickly: not a game played together.
  a.send({ type: 'game', action: 'start', game: 'trivia' });
  b.send({ type: 'game', action: 'start', game: 'trivia' });
  await wait(50);
  a.send({ type: 'game', action: 'leave' });
  await wait(50);
  assert.equal(games(), 0);
  // A game that's been going a while: started, then its clock moved back a minute.
  const realNow = Date.now;
  a.send({ type: 'game', action: 'start', game: 'trivia' });
  b.send({ type: 'game', action: 'start', game: 'trivia' });
  await wait(50);
  Date.now = () => realNow() + 61_000;
  try {
    a.send({ type: 'game', action: 'leave' });
    await wait(50);
  } finally {
    Date.now = realNow;
  }
  assert.equal(games(), 1);
  a.ws.close(); b.ws.close();
});

test("meeting the season's goal leaves its keepsake", async () => {
  const { host, bob, server, fire } = await hearth();
  const season = seasonOf(Date.now());
  const first = checkCamp(server.id);
  // Two people: twice the per-person goal.
  assert.ok(first.season.goal > 0);
  assert.equal(first.season.met, false);
  if (first.season.key === 'winter' || first.season.key === 'autumn') sit(host.user.id, server.id, fire.id, first.season.goal);
  else if (first.season.key === 'spring') for (let i = 0; i < first.season.goal; i++) db.prepare("INSERT INTO camp_activity (server_id, kind, n, at) VALUES (?, 'game', 1, ?)").run(server.id, Date.now());
  else db.prepare("INSERT INTO camp_activity (server_id, kind, n, at) VALUES (?, 'fish', ?, ?)").run(server.id, first.season.goal, Date.now());
  const sock = listen(bob.token);
  await sock.ready;
  const done = checkCamp(server.id);
  assert.equal(done.season.met, true);
  assert.equal(done.keepsakes.length, 1);
  assert.equal(done.keepsakes[0].season, season.id);
  await wait(50);
  assert.equal(sock.events.find((e) => e.type === 'camp')?.met, done.season.name);
  sock.ws.close();
});

test('seasons run December to February, March to May, and so on, in Eastern time', () => {
  const at = (iso: string) => seasonOf(Date.parse(iso));
  assert.equal(at('2026-12-15T12:00:00Z').id, '2026-winter');
  assert.equal(at('2027-02-27T12:00:00Z').id, '2026-winter');
  assert.equal(at('2027-03-01T12:00:00Z').id, '2027-spring');
  // 2am UTC on 1 March is still 28 February in Eastern time.
  assert.equal(at('2027-03-01T02:00:00Z').id, '2026-winter');
  assert.equal(at('2026-11-22T12:00:00Z').id, '2026-autumn');
  assert.equal(monthStart(2026, 12), Date.parse('2026-12-01T05:00:00Z'));
  assert.equal(monthStart(2027, 6), Date.parse('2027-06-01T04:00:00Z'));
  const w = at('2026-12-15T12:00:00Z');
  assert.equal(w.start, Date.parse('2026-12-01T05:00:00Z'));
  assert.equal(w.end, Date.parse('2027-03-01T05:00:00Z'));
});
