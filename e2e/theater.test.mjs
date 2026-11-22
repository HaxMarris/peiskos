// The movie theater at the fire: adding a movie to the shelf, playing it for everyone, pausing
// from another window, stopping it and taking it off the shelf.
//
// Playwright's Chromium has no H.264, so the browser here can't decode the movie; Peiskos asks
// before adding a file the browser can't play, and the test says yes. What's checked is what each
// friend's screen says about the movie, which comes from the server, not the picture itself.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { closeBrowser, fireWith, noErrors, sees, startServer, until } from './lib.mjs';

let server;
before(async () => { server = await startServer(); });
after(async () => { await closeBrowser(); await server?.stop(); });

const movie = join(import.meta.dirname, 'fixtures', 'countdown.mp4');

test('movie night: add a movie, play it for everyone, pause from another window, stop and remove it', async (t) => {
  const { seats } = await fireWith(t, server.base, ['Maya', 'Theo']);
  const [maya, theo] = seats;

  await maya.page.click('#fire-theater');
  await sees(maya.page.locator('#theater-shelf-note'), 'No movies on the shelf yet');
  await maya.page.setInputFiles('#theater-file', movie);
  // Asked only where this browser can't play H.264.
  const asked = maya.page.locator('#ask-yes');
  await until(async () => (await asked.isVisible()) || (await maya.page.locator('#theater-movies li').count()) > 0, 'the movie or a question');
  if (await asked.isVisible()) await asked.click();
  await sees(maya.page.locator('#theater-movies'), /countdown\s+1 min, added by you/);
  assert.equal(await maya.page.locator('#theater-shelf').getAttribute('data-phase'), 'idle');

  await theo.page.click('#fire-theater');
  await sees(theo.page.locator('#theater-movies'), 'added by Maya');
  // Theo didn't add it and isn't a host, so there's no Remove for him.
  assert.equal(await theo.page.locator('#theater-movies .danger-link').count(), 0);

  await maya.page.click('#theater-movies .theater-movie');
  for (const seat of seats) await sees(seat.page.locator('#theater-title'), 'countdown');
  await sees(theo.page.locator('#theater-by'), 'Put on by Maya');
  assert.equal(await theo.page.locator('#theater-stop').isVisible(), false);
  assert.equal(await maya.page.locator('#theater-stop').isVisible(), true);

  // Theo pauses: it's paused for Maya too.
  await theo.page.click('#theater-toggle');
  await until(async () => (await maya.page.locator('#theater-toggle').getAttribute('title')) === 'Play for everyone', 'paused for Maya');

  // Back at the fire, the bar says what's on.
  await theo.page.click('#theater-back');
  await sees(theo.page.locator('#theater-panel'), /countdown\s+Paused at 0:0\d/);

  await maya.page.click('#theater-stop');
  await sees(maya.page.locator('#theater-shelf-note'), 'Pick a movie');
  await until(async () => !(await theo.page.locator('#theater-panel').isVisible()), "Theo's bar to go");

  await maya.page.click('#theater-movies .danger-link');
  await maya.page.click('#ask-yes');
  await sees(maya.page.locator('#theater-shelf-note'), 'No movies on the shelf yet');
  noErrors(seats);
});
