// The hearth league at the fire: last season's champion on a pennant, which opens the standings.
// The seasons are calendar months, so the past one is written into the database directly.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { call, closeBrowser, closeWhenDone, makeHearth, noErrors, sees, sitDown, startServer } from './lib.mjs';

const dbFile = join(mkdtempSync(join(tmpdir(), 'peiskos-league-')), 'league.db');
let server;
before(async () => { server = await startServer({ DB_FILE: dbFile }); });
after(async () => { await closeBrowser(); await server?.stop(); });

test("last season's champion is on a pennant at the fire, and it opens the standings", async (t) => {
  const hearth = await makeHearth(server.base, ['Maya', 'Theo', 'Ines']);
  const [maya, theo, ines] = hearth.people;
  const db = new DatabaseSync(dbFile);
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(Date.now()).slice(0, 7);
  db.prepare("INSERT INTO league_seasons (server_id, month, number, champion_id, champion_points, settled) VALUES (?, '2000-01', 1, ?, 212, 1)").run(hearth.id, theo.id);
  db.prepare('INSERT INTO league_seasons (server_id, month, number) VALUES (?, ?, 2)').run(hearth.id, month);
  const point = db.prepare("INSERT INTO league_points (server_id, month, user_id, source, what, base, points, day, at) VALUES (?, ?, ?, ?, ?, ?, ?, '2000-01-01', 0)");
  point.run(hearth.id, month, maya.id, 'games', 'trivia', 30, 30);
  point.run(hearth.id, month, maya.id, 'fishing', 'derby', 10, 10);
  point.run(hearth.id, month, ines.id, 'casino', 'slots', 9, 9);
  db.close();

  const seats = [];
  closeWhenDone(t, seats);
  seats.push(await sitDown(server.base, hearth, maya));
  const page = seats[0].page;
  await sees(page.locator('.league-pennant'), /Theo\s*Season 1 champion/);

  await page.locator('.league-pennant').click();
  await sees(page.locator('#modal-card h2'), /^League in Cabin/);
  await sees(page.locator('.league-season-name'), 'Season 2');
  await sees(page.locator('.league-standings'), /Maya\s*40\s*points[\s\S]*Ines\s*9\s*points/);
  await sees(page.locator('.league-past'), /Theo\s*Season 1, January 2000, 212 points/);
  assert.equal(await page.locator('.league-standings .league-part').count(), 3, 'Maya has games and fishing, Ines has casino');

  // The owner turns it off: the pennant comes down.
  await page.locator('#league-on').uncheck();
  await sees(page.locator('.league-off'), /The league is off/);
  await page.keyboard.press('Escape');
  await page.locator('.league-pennant').waitFor({ state: 'detached' });
  assert.equal((await call(server.base, `/api/servers/${hearth.id}/league`, { token: maya.token })).on, false);
  noErrors(seats);
});
