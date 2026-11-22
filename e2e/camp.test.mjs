// The camp grows: fish caught (like fire hours and games) put builds on the hearth map, the hearth
// is told when something goes up, and the camp panel shows the points, the next build and the season's goal.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { call, closeBrowser, closeWhenDone, makeHearth, noErrors, openApp, sees, startServer, until } from './lib.mjs';

let server;
before(async () => { server = await startServer(); });
after(async () => { await closeBrowser(); await server?.stop(); });

test('a camp builds up on the map, and the panel says what comes next', async (t) => {
  const hearth = await makeHearth(server.base, ['Maya', 'Theo']);
  const [maya, theo] = hearth.people;
  await call(server.base, `/api/servers/${hearth.id}`, { method: 'PATCH', body: { hearthland: true }, token: maya.token });
  // Theo fishes: each save adds what he's caught since the last, and 20 fish are a camp point.
  let rev = 0;
  const fish = async (saves) => {
    for (let i = 0; i < saves; i++, rev++) await call(server.base, `/api/servers/${hearth.id}/fishing`, { body: { save: { stats: { caught: (rev + 1) * 20 } }, rev }, token: theo.token });
  };
  await fish(16); // 16 points: a woodpile and a lantern path

  const seats = [];
  closeWhenDone(t, seats);
  const me = await openApp(server.base, maya);
  seats.push(me);
  const page = me.page;
  await page.locator('#map-row').click();
  await until(() => page.evaluate(() => hl.world?.camp?.startsWith('woodpile,lanterns|')), 'the woodpile and lanterns on the map');
  assert.equal(await page.evaluate(() => hl.world.solid(28, 16)), true); // the woodpile is in the way

  await page.locator('#map-camp').click();
  await sees(page.locator('#modal-card'), /16\s*camp points/);
  await sees(page.locator('#modal-card'), /Next: Rowboat at 30/);
  await sees(page.locator('#modal-card .camp-builds li.built').first(), /Woodpile/);
  await page.locator('#modal-card .modal-row [data-close]').click();

  // More fish: the rowboat goes up while she's looking, and she's told.
  await fish(14);
  await sees(page.locator('.toast').last(), /new rowboat/);
  await until(() => page.evaluate(() => hl.world?.camp?.startsWith('woodpile,lanterns,boat|')), 'the rowboat on the map');
  noErrors(seats);
});
