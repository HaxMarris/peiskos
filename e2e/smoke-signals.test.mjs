// Smoke Signals: sketchbooks going round the fire, drawn and guessed by real browsers, then turned page by page.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, fireWith, joinGame, noErrors, sees, startGame, startServer, until } from './lib.mjs';

let server;
before(async () => { server = await startServer(); });
after(async () => { await closeBrowser(); await server?.stop(); });

const panel = (seat) => seat.game().locator('#panel');
const task = (seat) => seat.game().locator('#playHead .task');
async function scribble(seat) {
  const box = await seat.game().locator('#page').boundingBox();
  await seat.page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await seat.page.mouse.down();
  await seat.page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 8 });
  await seat.page.mouse.up();
}
async function write(seat, text) {
  await seat.game().locator('#prompt').fill(text);
  await seat.game().locator('#prompt').press('Enter');
}
async function guess(seat, text) {
  await seat.game().locator('#guess').fill(text);
  await seat.game().locator('#guess').press('Enter');
}

test('Smoke Signals: three sketchbooks go round, nobody sees another page early, and the reveal turns them together', async (t) => {
  const { seats } = await fireWith(t, server.base, ['Maya', 'Theo', 'Ines'], { phone: ['Ines'] });
  const [maya, theo, ines] = seats;

  await startGame(maya, 'smokesignals');
  await sees(panel(maya), 'Smoke Signals needs 3 players');
  await joinGame(theo);
  await sees(panel(maya), 'Smoke Signals needs 3 players');
  await ines.page.clock.install(); // so her clock can run out too
  await joinGame(ines);
  await sees(panel(theo), 'Waiting for Maya to start.');
  assert.equal(await theo.game().getByRole('button', { name: 'Start' }).count(), 0, 'only the host can start');
  await maya.game().getByRole('button', { name: 'Start' }).click();

  // Page 1: everyone writes (Ines picks a suggestion), and nobody sees what the others wrote.
  await sees(panel(theo), 'Write something to draw');
  await write(maya, 'a cat on a bike');
  await write(theo, 'volcano picnic');
  await sees(panel(maya), 'You wrote a cat on a bike');
  await sees(panel(maya), 'Waiting on Ines.');
  assert.doesNotMatch(await panel(ines).innerText(), /cat on a bike|volcano/);
  const pick = ines.game().locator('.suggest .btn').first();
  const picked = (await pick.innerText()).trim();
  await pick.click();

  // Page 2: everyone draws someone else's prompt.
  const prompts = { Maya: 'a cat on a bike', Theo: 'volcano picnic', Ines: picked };
  const drawsFor = {};
  for (const s of seats) {
    const shown = await sees(task(s), /Draw this:/);
    const p = shown.replace('Draw this:', '').trim();
    const owner = Object.keys(prompts).find((n) => prompts[n] === p);
    assert.ok(owner && owner !== s.name, `${s.name} draws someone else's prompt (${p})`);
    drawsFor[s.name] = owner;
  }
  // Done with nothing drawn isn't sent.
  await theo.game().getByRole('button', { name: 'Done' }).click();
  await sees(theo.game().locator('#toast'), 'Draw something first.');
  for (const s of seats) {
    await scribble(s);
    await s.game().getByRole('button', { name: 'Done' }).click();
    if (s !== ines) await sees(panel(s), 'Drawing sent');
  }

  // Page 3: everyone guesses a drawing that's neither their own nor their own prompt's.
  for (const s of seats) {
    await sees(task(s), 'What is this drawing?');
    await until(() => s.game().locator('#page').evaluate(() => sc.strokes.size > 0), `${s.name} sees a drawing`);
    assert.doesNotMatch(await s.game().locator('body').innerText(), /cat on a bike|volcano picnic/);
  }
  await guess(maya, 'bicycle cat');
  await sees(panel(maya), 'You guessed bicycle cat');
  // Maya changes her mind before the others are done.
  await maya.game().getByRole('button', { name: 'Change guess' }).click();
  await guess(maya, 'cat cycling');
  await guess(theo, 'mountain lunch');
  // Ines types but doesn't send: the clock sends it.
  await ines.game().locator('#guess').fill('a guess from the clock');
  await ines.wait(45.5);
  await maya.wait(47);

  // The reveal, one page at a time; only the host turns them. The sketchbooks come in the order they went round.
  const title = await sees(theo.game().locator('h1'), /sketchbook$/);
  const first = title.replace("'s sketchbook", '').replace('Your sketchbook', 'Theo');
  await sees(maya.game().locator('h1'), first === 'Maya' ? 'Your sketchbook' : `${first}'s sketchbook`);
  await sees(theo.game().locator('.leaf'), `${prompts[first]} ${first === 'Theo' ? 'You' : first} wrote this`);
  assert.equal(await theo.game().locator('.leaf').count(), 1);
  await sees(theo.game().locator('.row'), 'Maya turns the pages.');
  await maya.game().getByRole('button', { name: 'Turn the page' }).click();
  const drewIt = Object.keys(drawsFor).find((n) => drawsFor[n] === first);
  await sees(ines.game().locator('.leaf').nth(1), `${drewIt === 'Ines' ? 'You' : drewIt} drew this`);
  await until(() => theo.game().locator('.leaf canvas').evaluate((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 100) return true;
    return false;
  }), 'the drawing is painted in the reveal');
  await maya.game().getByRole('button', { name: 'Turn the page' }).click();
  await sees(theo.game().locator('.leaf').nth(2), / guessed this$/);
  const guesses = await theo.game().locator('.leaf').nth(2).innerText();
  assert.match(guesses, /cat cycling|mountain lunch|a guess from the clock/);
  assert.equal(await theo.game().getByRole('button', { name: 'Save sketchbook' }).count(), 1);

  // Every sketchbook gets its turn, then back to the lobby.
  const seen = [guesses];
  for (const n of [2, 3]) {
    await maya.game().getByRole('button', { name: 'Next sketchbook' }).click();
    await sees(maya.game().locator('.bookhead'), `${n} of 3`);
    for (let i = 0; i < 2; i++) await maya.game().getByRole('button', { name: 'Turn the page' }).click();
    seen.push(await sees(theo.game().locator('.leaf').nth(2), / guessed this$/));
  }
  // Maya's changed guess replaced her first one, and Ines's typed guess went in when time ran out.
  const all = seen.join(' | ');
  for (const g of ['cat cycling', 'mountain lunch', 'a guess from the clock']) assert.ok(all.includes(g), `${g} is in a sketchbook: ${all}`);
  assert.ok(!all.includes('bicycle cat'));
  await sees(ines.game().locator('.row'), 'Maya can start another game.');
  await maya.game().getByRole('button', { name: 'Back to the lobby' }).click();
  await sees(panel(theo), 'Waiting for Maya to start.');
  noErrors(seats);
});

test('Smoke Signals: four players, someone leaves mid-game, and their pages show as missing', async (t) => {
  const { seats } = await fireWith(t, server.base, ['Maya', 'Theo', 'Ines', 'Omar']);
  const [maya, theo, ines, omar] = seats;
  await startGame(maya, 'smokesignals');
  for (const s of [theo, ines, omar]) await joinGame(s);
  await sees(maya.game().locator('.players'), /Maya.*Theo.*Ines.*Omar/);
  await maya.game().locator('#optDraw').selectOption('60');
  await maya.game().getByRole('button', { name: 'Start' }).click();

  // With an even count you draw your own prompt first, so four pages follow it.
  for (const s of seats) await write(s, `${s.name} prompt`);
  for (const s of seats) await sees(task(s), `Draw this: ${s.name} prompt`);
  await sees(maya.game().locator('#playHead'), 'Page 2 of 5');

  // Omar leaves while drawing: the page moves on without him once the rest are done.
  await omar.page.locator('#game-view-back').click();
  await omar.page.locator('#game-panel-leave').click();
  for (const s of [maya, theo, ines]) { await scribble(s); await s.game().getByRole('button', { name: 'Done' }).click(); }
  // Omar's sketchbook has no drawing yet, so its next page is another go at drawing his prompt.
  const next = await Promise.all([maya, theo, ines].map((s) => sees(s.game().locator('#playHead .task'), /What is this drawing\?|Draw this: Omar prompt/)));
  assert.equal(next.filter((x) => x.includes('Omar prompt')).length, 1);

  // Run the clock out on the rest of the pages, then check Omar's sketchbook.
  for (let i = 0; i < 3; i++) await maya.wait(61.6);
  await sees(maya.game().locator('h1'), /sketchbook/);
  let found = false;
  for (let b = 0; b < 4 && !found; b++) {
    const title = await maya.game().locator('h1').innerText();
    while (await maya.game().getByRole('button', { name: 'Turn the page' }).count()) await maya.game().getByRole('button', { name: 'Turn the page' }).click();
    if (title.startsWith('Omar')) {
      await sees(theo.game().locator('.leaf').nth(1), 'No drawing from Omar.');
      found = true;
      break;
    }
    await maya.game().getByRole('button', { name: 'Next sketchbook' }).click();
  }
  assert.ok(found, "Omar's sketchbook is in the reveal");
  noErrors(seats);
});
