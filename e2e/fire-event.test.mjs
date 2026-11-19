// An event that's on now at a fire: the lights and banner at the fire, a seat kept for someone who's
// going and isn't there yet, and the fire's row in the sidebar saying what's on.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { call, closeBrowser, closeWhenDone, makeHearth, noErrors, openApp, sees, sitDown, startServer, until } from './lib.mjs';

let server;
before(async () => { server = await startServer(); });
after(async () => { await closeBrowser(); await server?.stop(); });

test('an event on now at the fire shows there and in the sidebar', async (t) => {
  const hearth = await makeHearth(server.base, ['Maya', 'Theo', 'Ines']);
  const [maya, theo, ines] = hearth.people;
  const { events } = await call(server.base, `/api/servers/${hearth.id}/events`, {
    body: { title: 'Sea of Thieves', startsAt: Date.now(), channelId: hearth.fireId }, token: maya.token,
  });
  await call(server.base, `/api/events/${events[0].id}/rsvp`, { body: { status: 'going' }, token: ines.token });

  const seats = [];
  closeWhenDone(t, seats);
  seats.push(await sitDown(server.base, hearth, maya), await sitDown(server.base, hearth, theo));
  const page = seats[0].page;

  // At the fire: the banner, and Ines's seat kept for her.
  await sees(page.locator('.fire-event-banner'), /On now\s*Sea of Thieves/i);
  assert.equal(await page.locator('.fire-event-lights svg').count(), 1);
  await sees(page.locator('.seat.saved .seat-status'), 'Saved for Ines');
  assert.equal(await page.locator('.seat.saved').count(), 1);

  // The banner opens the event.
  await page.locator('.fire-event-banner').click();
  await sees(page.locator('#modal-card h2'), 'Sea of Thieves');
  await page.keyboard.press('Escape');

  // Someone who isn't at the fire sees which fire it's on.
  const away = await openApp(server.base, ines);
  seats.push(away);
  await sees(away.page.locator('#fire-main .fire-event-line'), /Sea of Thieves\s*· on now/);
  await sees(away.page.locator(`#event-list [data-key="event-${events[0].id}"] .event-where`), 'On now at Campfire');

  // Once Ines sits down, her seat is hers and nothing is kept any more.
  await away.page.evaluate((id) => joinVoice(id), hearth.fireId);
  await until(() => page.locator('.seat.saved').count().then((n) => n === 0), 'the kept seat to go');
  await sees(page.locator('.seat .seat-name', { hasText: 'Ines' }), 'Ines');

  // The event is cancelled: the lights come down.
  await call(server.base, `/api/events/${events[0].id}`, { method: 'DELETE', token: maya.token });
  await until(() => page.locator('.fire-event').count().then((n) => n === 0), 'the lights to come down');
  noErrors(seats);
});
