// Hearthland, the hearth map: walking into a fire's ring joins its call and walking out leaves it,
// someone who joined from the list sits at the fire, "Sit down" opens the fire view and comes back,
// and a new look shows for everyone.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { call, closeBrowser, closeWhenDone, makeHearth, noErrors, openApp, sees, sitDown, startServer, until } from './lib.mjs';

let server;
before(async () => { server = await startServer(); });
after(async () => { await closeBrowser(); await server?.stop(); });

/** Holds a key on the map until `done` is true in the page. */
async function walk(page, key, done, arg) {
  await page.locator('#map-canvas').focus();
  await page.keyboard.down(key);
  try {
    await page.waitForFunction(done, arg, { timeout: 8000 });
  } finally {
    await page.keyboard.up(key);
  }
}

test('walking into a fire on the map joins it, and walking out leaves', async (t) => {
  const hearth = await makeHearth(server.base, ['Maya', 'Theo']);
  const [maya, theo] = hearth.people;
  await call(server.base, `/api/servers/${hearth.id}`, { method: 'PATCH', body: { hearthland: true }, token: maya.token });

  const seats = [];
  closeWhenDone(t, seats);
  seats.push(await sitDown(server.base, hearth, theo)); // from the list, as today
  const me = await openApp(server.base, maya);
  seats.push(me);
  const page = me.page;

  await page.locator('#map-row').click();
  await sees(page.locator('#hearthland'), /Walk into a fire's ring/);
  assert.equal(await page.locator('#hearthland').getAttribute('class').then((c) => c.includes('hidden')), false);
  // Theo joined from the list, so he's drawn sitting at the fire.
  assert.equal(await page.evaluate(() => hlSeated(hlMapFires()[0]).map((p) => p.id)).then((ids) => ids.join()), String(theo.id));

  // Up the path into the Campfire's ring: in the call with Theo.
  await walk(page, 'ArrowUp', (id) => state.voice?.channelId === id && state.voice.connected, hearth.fireId);
  await sees(page.locator('#map-banner-text'), /Campfire · You're in the call with Theo/);
  // The map stays up; the fire view doesn't open by itself.
  assert.equal(await page.evaluate(() => hl.open && !state.stageOpen), true);

  // Sit down opens the fire view, and its back button comes back to the map.
  await page.locator('#map-act').click();
  await page.waitForFunction(() => state.stageOpen && !hl.open);
  await sees(page.locator('#stage-close'), 'Back to the map');
  await page.locator('#stage-close').click();
  await page.waitForFunction(() => hl.open && !state.stageOpen && state.voice);

  // Theo opens the map too and sees Maya standing there, not sitting.
  await seats[0].page.evaluate(() => { closeStage(); openMap(state.serverId); });
  await until(() => seats[0].page.evaluate((id) => hl.walkers.has(id), maya.id), 'Theo to see Maya on the map');

  // Back down the path and out of the ring: out of the call.
  await walk(page, 'ArrowDown', () => !state.voice);
  await sees(page.locator('#map-banner-text'), /Walk into a fire's ring/);
  await until(() => seats[0].page.evaluate((id) => !hl.walkers.get(id) || hl.walkers.get(id).ty > 20 * HL_T, maya.id), "Theo to see Maya walk away");
  noErrors(seats);
});

test('a new look shows on the map for everyone, and the map is off until a manager turns it on', async (t) => {
  const hearth = await makeHearth(server.base, ['Ines', 'Oskar']);
  const [ines, oskar] = hearth.people;
  const seats = [];
  closeWhenDone(t, seats);
  const a = await openApp(server.base, ines), b = await openApp(server.base, oskar);
  seats.push(a, b);
  assert.equal(await a.page.locator('#map-row').isVisible(), false);

  // Turned on from the hearth's settings.
  await a.page.evaluate(() => openEditBurrow(state.serverId));
  await a.page.locator('#burrow-map').check();
  await a.page.locator('#burrow-form button[type="submit"]').click();
  await sees(b.page.locator('#map-row'), /Hearth map/);

  await a.page.locator('#map-row').click();
  await a.page.locator('#map-look').click();
  await a.page.locator('#modal-card [data-key="hat"][data-val="crown"]').click();
  await a.page.locator('#look-save').click();
  await until(() => b.page.evaluate((id) => lookOf(id).hat === 'crown', ines.id), "Oskar to see Ines's crown");
  noErrors(seats);
});

test('low resource mode: turned on in Display, the map still walks, and voices are heard without distance', async (t) => {
  const hearth = await makeHearth(server.base, ['Kari']);
  const [kari] = hearth.people;
  await call(server.base, `/api/servers/${hearth.id}`, { method: 'PATCH', body: { hearthland: true }, token: kari.token });
  const seats = [];
  closeWhenDone(t, seats);
  const me = await openApp(server.base, kari);
  seats.push(me);
  const page = me.page;

  await page.evaluate(() => openAccount('settings'));
  await page.locator('#display-power').check();
  assert.deepEqual(await page.evaluate(() => [document.documentElement.dataset.power, document.documentElement.dataset.motion]), ['low', 'reduce']);
  assert.equal(await page.locator('#display-motion').isDisabled(), true);
  // Kept after a reload, from the first paint.
  await page.reload();
  await page.waitForFunction(() => typeof state !== 'undefined' && state.me && state.ws?.readyState === 1);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.power), 'low');

  await page.locator('#map-row').click();
  await sees(page.locator('#hearthland'), /Walk into a fire's ring/);
  assert.equal(await page.locator('#map-distance').isDisabled(), true);
  // Drawn less often, but walking still gets there.
  await walk(page, 'ArrowUp', (id) => state.voice?.channelId === id && state.voice.connected, hearth.fireId);
  assert.equal(await page.evaluate(() => mapHearing()), null);
  noErrors(seats);
});
