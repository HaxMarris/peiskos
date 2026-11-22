// Time capsules: sealing one from the + menu with a photo in it, the room saying it's waiting, and
// on its day, the chest by the fire opening it for everyone sitting there.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { closeBrowser, closeWhenDone, makeHearth, noErrors, openApp, sees, sitDown, startServer } from './lib.mjs';

// The server's database is opened here too, to bring a capsule's day forward.
const dbFile = join(mkdtempSync(join(tmpdir(), 'peiskos-capsule-db-')), 'e2e.db');
let server;
before(async () => { server = await startServer({ DB_FILE: dbFile }); });
after(async () => { await closeBrowser(); await server?.stop(); });

// Pictures for the pull request, when asked for.
const shots = process.env.E2E_SHOTS;
const shot = async (page, name) => {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, `${name}.png`) });
};

// A 2x2 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDK+mmyAAAAABJRU5ErkJggg==', 'base64');

test('a time capsule is sealed in a room and opened together at the fire', async (t) => {
  const hearth = await makeHearth(server.base, ['Maya', 'Theo']);
  const [maya, theo] = hearth.people;
  const seats = [];
  closeWhenDone(t, seats);

  // Maya writes something, adds a photo, and seals it from the + menu instead of sending it.
  const writer = await openApp(server.base, maya);
  seats.push(writer);
  const page = writer.page;
  await page.evaluate((id) => selectServer(id), hearth.id);
  await page.locator('#channel-list li', { hasText: 'general' }).first().click();
  await page.locator('#composer-input').fill('Remember the cabin trip? Same time next year.');
  await page.locator('#file-input').setInputFiles({ name: 'cabin.png', mimeType: 'image/png', buffer: PNG });
  await page.locator('#pending-files .pending').first().waitFor();
  await page.click('#plus-btn');
  await page.locator('.pop-menu button', { hasText: 'Seal a time capsule' }).click();
  await sees(page.locator('#modal-card h2'), 'Seal a time capsule');
  assert.equal(await page.locator('#capsule-text').inputValue(), 'Remember the cabin trip? Same time next year.');
  await sees(page.locator('.capsule-files'), '1 file from the message box goes in too');
  await page.locator('[data-years="5"]').click();
  await shot(page, 'seal-dialog');
  await page.click('#capsule-seal');
  await sees(writer.toast(), /Sealed\. It opens on/);
  // Nothing was sent, and the message box is empty again.
  assert.equal(await page.locator('#messages .line', { hasText: 'cabin trip' }).count(), 0);
  assert.equal(await page.locator('#composer-input').inputValue(), '');
  assert.equal(await page.locator('#pending-files .pending').count(), 0);
  await sees(page.locator('#capsule-note'), /A time capsule from Maya opens on/);
  await shot(page, 'room-note');

  // Its day comes.
  const db = new DatabaseSync(dbFile);
  db.prepare('UPDATE capsules SET opens_at = ?').run(Date.now() - 60_000);
  db.close();

  // At the fire, the chest is ready. Theo opens it, and both of them see what's inside.
  await writer.ctx.close();
  seats.length = 0;
  seats.push(await sitDown(server.base, hearth, maya), await sitDown(server.base, hearth, theo, { phone: true }));
  const [a, b] = seats;
  await sees(b.page.locator('.capsule-chest.ready'), 'Time capsule');
  await shot(a.page, 'chest-at-fire');
  await shot(b.page, 'phone-chest');
  await b.page.locator('.capsule-chest').click();
  await sees(b.page.locator('.capsule-row'), /From Maya/);
  await b.page.locator('.capsule-row button', { hasText: 'Open it for everyone here' }).click();
  for (const seat of seats) {
    await sees(seat.page.locator('.capsule-open h2'), 'From Maya');
    await sees(seat.page.locator('.capsule-open-when'), /Opened by (Theo|you)/);
    await sees(seat.page.locator('.capsule-open-content'), 'Remember the cabin trip?');
    await seat.page.locator('.capsule-open .att-image').waitFor();
  }
  await a.page.waitForTimeout(2200); // the opening plays out
  await shot(a.page, 'opened');
  await shot(b.page, 'phone-opened');
  // The chest is gone from the fire, and the room has the message, marked as a capsule.
  await b.page.locator('.capsule-chest').waitFor({ state: 'detached' });
  await a.page.keyboard.press('Escape');
  await a.page.evaluate((id) => selectServer(id), hearth.id);
  await a.page.locator('#channel-list li', { hasText: 'general' }).first().click();
  await sees(a.page.locator('#messages .line', { hasText: 'cabin trip' }).locator('.capsule-banner'), /Time capsule, sealed .*Opened by Theo/);
  await shot(a.page, 'in-the-room');
  noErrors(seats);
});
