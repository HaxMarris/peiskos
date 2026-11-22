// Meet-up: planning an event with a place on the map, sharing where you are on the way, everyone
// going seeing how far off you are, and sharing turning itself off once you get there.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { call, closeBrowser, closeWhenDone, makeHearth, noErrors, openApp, sees, startServer, until } from './lib.mjs';

let server;
before(async () => { server = await startServer(); });
after(async () => { await closeBrowser(); await server?.stop(); });

// The pier, a spot about 1 km north of it, and one right next to it.
const PIER = { latitude: 59.9139, longitude: 10.7522 };
const KM_NORTH = { latitude: 59.9229, longitude: 10.7522 };
const AT_PIER = { latitude: 59.91395, longitude: 10.75225 };

test('meet up on the way to an event', async (t) => {
  const hearth = await makeHearth(server.base, ['Maya', 'Theo']);
  const [maya, theo] = hearth.people;
  const seats = [];
  closeWhenDone(t, seats);
  const m = await openApp(server.base, maya, { phone: true });
  const th = await openApp(server.base, theo);
  seats.push(m, th);
  await m.ctx.grantPermissions(['geolocation'], { origin: server.base });
  await m.ctx.setGeolocation({ ...KM_NORTH, accuracy: 15 });

  // Maya plans it with a Google Maps link for the place.
  await m.page.evaluate((id) => openEventEditor(id, null), hearth.id);
  await m.page.fill('#ev-title', 'Fish and chips');
  const soon = new Date(Date.now() + 30 * 60e3);
  const local = new Date(soon.getTime() - soon.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
  await m.page.fill('#ev-when', local);
  await m.page.fill('#ev-place-name', 'The pier');
  await m.page.fill('#ev-place-at', 'not a place');
  await m.page.click('#event-form button[type=submit]');
  await sees(m.page.locator('#modal-error'), /isn't on the map/);
  await m.page.fill('#ev-place-at', `https://www.google.com/maps/place/The+Pier/@59.91,10.75,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d${PIER.latitude}!4d${PIER.longitude}`);
  await m.page.click('#event-form button[type=submit]');
  await sees(m.page.locator('#modal-card h2'), 'Fish and chips');
  await sees(m.page.locator('#modal-card .meetup-place'), /The pier\s*Open in Maps/);
  const ev = await m.page.evaluate((id) => state.servers.get(id).events.find((e) => e.title === 'Fish and chips'), hearth.id);
  assert.deepEqual([ev.placeLat, ev.placeLng], [PIER.latitude, PIER.longitude]);

  // Theo is going too, and opens the meet-up.
  await call(server.base, `/api/events/${ev.id}/rsvp`, { body: { status: 'going' }, token: theo.token });
  await th.page.evaluate(([s, e]) => openEvent(s, e), [hearth.id, ev.id]);
  await th.page.click('#ev-meetup');
  await sees(th.page.locator('#meetup-view h2'), 'Meet up for Fish and chips');
  await sees(th.page.locator(`.meetup-row[data-user="${maya.id}"]`), /Maya.*Not sharing/s);

  // Maya shares.
  await m.page.evaluate(([s, e]) => openEvent(s, e), [hearth.id, ev.id]);
  await m.page.click('#ev-meetup');
  await m.page.click('#meet-share');
  await sees(m.page.locator('#meetup-chip'), 'Sharing your location for Fish and chips');
  await sees(th.page.locator(`.meetup-row[data-user="${maya.id}"]`), /(1\.0 km|0\.6 mi) north/);
  assert.equal(await th.page.locator('.meetup-radar .meet-dot').count(), 1);

  // She gets there: she shows as here, and her sharing turns off.
  await m.page.waitForTimeout(5200);
  await m.ctx.setGeolocation({ ...AT_PIER, accuracy: 10 });
  await sees(th.page.locator(`.meetup-row[data-user="${maya.id}"]`), /Here/);
  await until(() => m.page.locator('#meetup-chip').count().then((n) => n === 0), 'the sharing chip to go');
  await sees(m.toast(), "You're there. Sharing turned off.");
  noErrors(seats);
});
