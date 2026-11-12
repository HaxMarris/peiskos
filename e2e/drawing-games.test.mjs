// Sketch & Guess and Sketchpad, drawn with a real mouse and seen from the other browsers at the fire.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, fireWith, joinGame, leaveGame, noErrors, sees, startGame, startServer, until } from './lib.mjs';

let server;
before(async () => { server = await startServer(); });
after(async () => { await closeBrowser(); await server?.stop(); });

const PAPER = '#fffdf7';
const page = (seat) => seat.game().locator('#page');
/** Drags the mouse across the drawing, between two points given as shares of its width and height. */
async function drag(seat, [x1, y1], [x2, y2]) {
  const box = await page(seat).boundingBox();
  const at = (x, y) => [box.x + box.width * x, box.y + box.height * y];
  await seat.page.mouse.move(...at(x1, y1));
  await seat.page.mouse.down();
  await seat.page.mouse.move(...at(x2, y2), { steps: 8 });
  await seat.page.mouse.up();
}
/** How many strokes this copy of the drawing holds. */
const strokes = (seat) => page(seat).evaluate(() => sc.strokes.size);
/** The colour at one spot of this copy's drawing. */
const colourAt = (seat, [x, y]) => page(seat).evaluate((c, [fx, fy]) => {
  const d = c.getContext('2d').getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data;
  return '#' + [d[0], d[1], d[2]].map((n) => n.toString(16).padStart(2, '0')).join('');
}, [x, y]);
const everyoneHas = (seats, n) => until(async () => { const got = await Promise.all(seats.map(strokes)); return got.every((k) => k === n) || (() => { throw new Error(`strokes per copy: ${got}`); })(); }, `${n} stroke(s) on every copy`);

test('Sketch & Guess: the word stays with the drawer, the drawing reaches everyone, and guesses score', async (t) => {
  const { seats } = await fireWith(t, server.base, ['Maya', 'Theo', 'Ines'], { phone: ['Ines'] });
  const [maya, theo, ines] = seats;
  const feed = (seat) => seat.game().locator('#feed');
  const word = (seat) => seat.game().locator('#word');
  const guess = async (seat, text) => {
    await seat.game().locator('#guess').fill(text);
    await seat.game().locator('#guess').press('Enter');
  };
  const points = async (seat) => Object.fromEntries((await seat.game().locator('#scores li').evaluateAll((lis) => lis.map((li) => [li.firstChild.textContent, Number(li.lastChild.textContent)]))));
  const ours = ['campfire', 'blåbær', 'hot chocolate'];

  await startGame(maya, 'sketchguess');
  await sees(maya.game().locator('#lobbyNote'), 'Waiting for someone to join.');
  assert.equal(await maya.game().locator('#btnStart').isDisabled(), true);
  await joinGame(theo);
  await joinGame(ines);
  await sees(theo.game().locator('#lobbyNote'), 'Waiting for Maya to start.');
  assert.equal(await theo.game().locator('#btnStart').isVisible(), false, 'only the host can start');

  // Anyone playing can set the hearth's own words; the host plays with only those.
  await theo.game().locator('#btnWords').click();
  await theo.game().locator('#wordsBox').fill(['Campfire', ...ours.slice(1), '🔥', '  '].join('\n'));
  await theo.game().getByRole('button', { name: 'Save' }).click();
  await sees(theo.game().locator('#toast'), 'Saved 3 words');
  await maya.game().locator('#optRounds').selectOption('1');
  await maya.game().locator('#optTime').selectOption('60');
  await maya.game().locator('#optWords').selectOption('ours');
  await maya.game().locator('#btnStart').click();

  // ---- Maya's turn. Only she sees the words to pick from.
  await sees(maya.game().locator('#lobby'), 'Pick a word to draw');
  await sees(theo.game().locator('#lobby'), 'Maya is choosing a word');
  const choices = await maya.game().locator('.choices .btn').allInnerTexts();
  assert.deepEqual([...choices].sort(), [...ours].sort(), "the hearth's own words, tidied");
  assert.equal(await theo.game().locator('.choices .btn').count(), 0);
  const secret = choices[0];
  await maya.game().locator('.choices .btn').first().click();
  await sees(word(maya), secret);
  // The others get blanks, one per letter, and the word is nowhere on their page.
  for (const s of [theo, ines]) {
    await sees(word(s), /_/);
    assert.equal((await word(s).innerText()).replace(/[^_]/g, '').length, secret.replace(/ /g, '').length);
    assert.doesNotMatch(await s.game().locator('body').innerText(), new RegExp(secret, 'i'));
  }
  assert.equal(await maya.game().locator('#guess').isDisabled(), true, "the drawer can't guess");
  assert.equal(await maya.game().locator('#tools').isVisible(), true);
  assert.equal(await theo.game().locator('#tools').isVisible(), false, 'no drawing tools for a guesser');

  // A guesser's mouse doesn't draw.
  await drag(theo, [0.2, 0.2], [0.6, 0.6]);
  // The drawer's line reaches the others, in its colour.
  await maya.game().getByRole('button', { name: 'Red', exact: true }).click();
  await drag(maya, [0.2, 0.5], [0.8, 0.5]);
  await everyoneHas(seats, 1);
  for (const s of seats) {
    await until(async () => (await colourAt(s, [0.5, 0.5])) === '#e8453c', `${s.name} sees the red line`);
    assert.equal(await colourAt(s, [0.5, 0.2]), PAPER);
  }
  // Undo takes the last stroke back everywhere; Clear wipes the page.
  await drag(maya, [0.5, 0.1], [0.5, 0.9]);
  await everyoneHas(seats, 2);
  await maya.game().getByRole('button', { name: 'Undo' }).click();
  await everyoneHas(seats, 1);
  assert.equal(await colourAt(ines, [0.5, 0.2]), PAPER);
  await maya.game().getByRole('button', { name: 'Clear', exact: true }).click();
  await everyoneHas(seats, 0);
  assert.equal(await colourAt(theo, [0.5, 0.5]), PAPER);
  await drag(maya, [0.3, 0.3], [0.7, 0.7]);
  await everyoneHas(seats, 1);

  // A wrong guess is said to everyone.
  await guess(theo, 'banana');
  for (const s of seats) await sees(feed(s), 'Theo: banana');
  // A near miss would give the word away: only the guesser and the drawer see it.
  const near = secret.slice(0, -1) + 'x';
  await guess(theo, near);
  await sees(feed(theo), `"${near}" is close!`);
  await sees(feed(maya), `Theo: ${near}`);
  // The right word, however it's typed, scores; from then on Theo sees the word and Ines still doesn't.
  await guess(theo, `  ${secret.toUpperCase()}!`);
  for (const s of seats) await sees(feed(s), /Theo: got it \(\+\d+\)/);
  await sees(word(theo), secret);
  assert.doesNotMatch(await ines.game().locator('body').innerText(), new RegExp(secret, 'i'));
  assert.doesNotMatch(await feed(ines).innerText(), new RegExp(near, 'i'));
  // What Theo says now goes only to those who know the word, and can't contain it.
  await guess(theo, 'that was a hard one');
  await sees(feed(maya), 'Theo: that was a hard one');
  await guess(theo, `it is ${secret}`);
  // Theo's lines arrive in order, so once this one shows the one before it has been dealt with.
  await guess(theo, 'never mind');
  await sees(feed(maya), 'Theo: never mind');
  await maya.wait(10);
  await guess(ines, secret);
  // Everyone has it, so the turn ends and the word is shown.
  for (const s of seats) await sees(feed(s), `The word was "${secret}".`);
  assert.doesNotMatch(await feed(ines).innerText(), /hard one|it is|never mind/);
  assert.doesNotMatch(await feed(maya).innerText(), /it is/);
  const after1 = await points(ines);
  assert.equal(after1.Maya, 80, '40 to the drawer for each right guess');
  assert.ok(after1.Theo > after1.Ines && after1.Ines > 100, `the first and faster guess scores more: ${JSON.stringify(after1)}`);
  assert.deepEqual(await points(maya), after1);

  // ---- Theo's turn. He doesn't pick, so the first word is picked for him; nobody guesses it.
  await maya.wait(5.5);
  await sees(ines.game().locator('#lobby'), 'Theo is choosing a word');
  await everyoneHas(seats, 0);
  const offered = await theo.game().locator('.choices .btn').first().innerText();
  await maya.wait(15.5);
  await sees(word(theo), offered);
  await sees(word(ines), /^[_ ]+$/);
  assert.equal(await maya.game().locator('#guess').isDisabled(), false, 'the host guesses on other turns');
  // Half the time gone: one letter shows.
  await maya.wait(31);
  await until(async () => (await word(ines).innerText()).replace(/[_\s]/g, '').length === 1, 'a hint letter');
  await maya.wait(30);
  for (const s of seats) await sees(feed(s), `The word was "${offered}".`);
  assert.deepEqual(await points(theo), after1, "no points when nobody gets it");

  // ---- Ines's turn. She leaves, so the turn is over, and with it the only round.
  await maya.wait(5.5);
  await sees(maya.game().locator('#lobby'), 'Ines is choosing a word');
  await leaveGame(ines);
  await sees(feed(theo), "Ines left, so that turn's over.");
  await maya.wait(5.5);
  for (const s of [maya, theo]) await sees(s.game().locator('#lobby'), 'Final scores');
  // Ines's points still count, under her name.
  await sees(theo.game().locator('#lobby'), /🥇 Theo \d+ 🥈 Ines \d+ 🥉 Maya 80/);
  await maya.game().getByRole('button', { name: 'Play again' }).click();
  await sees(theo.game().locator('#lobbyNote'), 'Waiting for Maya to start.');
  noErrors(seats);
});

test('Sketchpad: everyone draws on one page, undo is your own, late joiners get the page, and only the host clears it', async (t) => {
  const { seats } = await fireWith(t, server.base, ['Maya', 'Theo', 'Ines']);
  const [maya, theo, ines] = seats;

  await startGame(maya, 'sketchpad');
  await joinGame(theo);
  await sees(maya.game().locator('#who'), '2 drawing');
  assert.equal(await theo.game().getByRole('button', { name: 'Clear page' }).isVisible(), false);

  // Each draws a line; both pages end up with both.
  await drag(maya, [0.1, 0.3], [0.9, 0.3]);
  await theo.game().getByRole('button', { name: 'Blue', exact: true }).click();
  await drag(theo, [0.1, 0.7], [0.9, 0.7]);
  await everyoneHas([maya, theo], 2);
  for (const s of [maya, theo]) {
    await until(async () => (await colourAt(s, [0.5, 0.7])) === '#3b82f6', `${s.name} sees Theo's blue line`);
    assert.equal(await colourAt(s, [0.5, 0.3]), '#1b1b1f');
  }

  // Undo takes back your own last stroke, never someone else's.
  await drag(maya, [0.5, 0.05], [0.5, 0.2]);
  await everyoneHas([maya, theo], 3);
  await theo.game().getByRole('button', { name: 'Undo' }).click();
  await everyoneHas([maya, theo], 2);
  assert.equal(await colourAt(maya, [0.5, 0.7]), PAPER, "Theo's line is gone");
  assert.equal(await colourAt(theo, [0.5, 0.3]), '#1b1b1f', "Maya's lines are still there");
  await theo.game().getByRole('button', { name: 'Undo' }).click(); // nothing of his left to undo
  await drag(theo, [0.2, 0.8], [0.8, 0.8]);
  await everyoneHas([maya, theo], 3);

  // Ines sits down late and gets the whole page.
  await joinGame(ines);
  await everyoneHas(seats, 3);
  await until(async () => (await colourAt(ines, [0.5, 0.8])) === '#3b82f6', 'Ines sees what was drawn before she came');
  await sees(theo.game().locator('#who'), '3 drawing');

  // The picture saves as a PNG through Peiskos.
  const [download] = await Promise.all([theo.page.waitForEvent('download'), theo.game().getByRole('button', { name: 'Save picture' }).click()]);
  assert.match(download.suggestedFilename(), /^sketchpad-\d{4}-\d\d-\d\d\.png$/);

  // The host clears the page for everyone, after being asked.
  maya.page.once('dialog', (d) => d.accept());
  await maya.game().getByRole('button', { name: 'Clear page' }).click();
  await everyoneHas(seats, 0);
  await sees(theo.game().locator('#toast'), 'Maya cleared the page');
  assert.equal(await colourAt(ines, [0.5, 0.8]), PAPER);

  // The host ending it ends it for everyone.
  await drag(ines, [0.3, 0.3], [0.6, 0.6]);
  await everyoneHas(seats, 1);
  maya.page.once('dialog', (d) => d.accept());
  await maya.game().locator('#btnLeave').click();
  for (const s of [theo, ines]) {
    await sees(s.toast(), 'Maya ended the game.');
    await until(async () => (await s.page.locator('#game-frame iframe').count()) === 0, 'the game closing');
  }
  noErrors(seats);
});
