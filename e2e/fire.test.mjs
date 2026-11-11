// Starting, joining, leaving and ending a game at the fire, as Peiskos's own screens show it; and a
// match of Melon Bomber getting from the host's browser to a friend's.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, fireWith, joinGame, leaveGame, noErrors, sees, startGame, startServer, until } from './lib.mjs';

let server;
before(async () => { server = await startServer(); });
after(async () => { await closeBrowser(); await server?.stop(); });

const bar = (seat) => seat.page.locator('#game-panel');
const open = (seat) => seat.page.locator('#game-panel-open');
const playing = (seat) => seat.page.locator('#game-frame iframe').count();

test("a game at the fire: the picker, the fire's game bar, a full game, and how it ends", async (t) => {
  const { seats } = await fireWith(t, server.base, ['Maya', 'Theo', 'Ines', 'Noor', 'Omar']);
  const [maya, theo, ines, noor, omar] = seats;

  // Nothing going: no game bar, and the picker offers every game.
  assert.equal(await bar(theo).isVisible(), false);
  await maya.page.click('#fire-game');
  assert.deepEqual(await maya.page.locator('#modal-card [data-game] b').allInnerTexts(),
    ['Melon Bomber', 'Stockpile', 'Sketch & Guess', 'Fireside Trivia', 'Odd One Out', 'Same Page', 'Sketchpad']);
  await maya.page.keyboard.press('Escape');

  // Maya starts Melon Bomber (four players): the others hear about it and can join from the bar.
  await startGame(maya, 'melonbomber', { clock: false });
  await sees(theo.page.locator('#fire-notes'), 'Maya started Melon Bomber');
  await sees(bar(theo), /Melon Bomber\s+Started by Maya · 1 of 4 playing/);
  await sees(open(theo), 'Join');
  await sees(bar(maya), 'Started by you · 1 of 4 playing');
  await sees(maya.page.locator('#game-panel-leave'), 'End game');
  // With a game going, the picker offers that one, not a second game.
  await theo.page.click('#fire-game');
  assert.equal(await theo.page.locator('#modal-card [data-game]').count(), 0);
  await sees(theo.page.locator('#modal-card [data-join]'), /Melon Bomber\s+Started by Maya · 1 of 4 playing\s+Join/);
  await theo.page.click('#modal-card [data-join]');
  await theo.page.locator('#game-frame iframe').waitFor();
  await sees(theo.game().locator('#lobbyPlayerList'), /Maya.*Theo/s);
  await joinGame(ines);
  await joinGame(noor);
  await sees(maya.game().locator('#lobbyPlayerList'), /Maya.*Theo.*Ines.*Noor/s);

  // Full: the fifth friend can't get in until someone leaves.
  await sees(bar(omar), '4 of 4 playing');
  await sees(open(omar), 'Full');
  assert.equal(await open(omar).isDisabled(), true);
  await leaveGame(noor);
  assert.equal(await playing(noor), 0);
  await sees(open(omar), 'Join');
  await sees(open(noor), 'Join');
  await joinGame(omar);
  await sees(maya.game().locator('#lobbyPlayerList'), /Maya.*Theo.*Ines.*Omar/s);
  assert.doesNotMatch(await maya.game().locator('#lobbyPlayerList').innerText(), /Noor/);
  await sees(open(noor), 'Full');

  // Back to the fire and back to the game: the same page, not a fresh one.
  await theo.game().locator('body').evaluate(() => { window.stillHere = true; });
  await theo.page.click('#game-view-back');
  assert.equal(await theo.page.locator('#game-frame').isVisible(), false);
  await sees(open(theo), 'Back to the game');
  await open(theo).click();
  assert.equal(await theo.page.locator('#game-frame').isVisible(), true);
  assert.equal(await theo.game().locator('body').evaluate(() => window.stillHere), true);

  // Ines's connection drops (she reloads): she's out of the game, and everyone's count says so.
  await ines.page.reload();
  await sees(bar(theo), '3 of 4 playing');
  await sees(maya.game().locator('#lobbyPlayerList'), /Maya.*Theo.*Omar/s);
  assert.doesNotMatch(await maya.game().locator('#lobbyPlayerList').innerText(), /Ines/);

  // Theo gets up from the fire: out of the game too.
  await theo.page.click('#voice-leave');
  await sees(bar(omar), '2 of 4 playing');
  assert.equal(await playing(theo), 0);

  // The host leaves the fire, and the game is over for everyone still in it.
  await maya.page.click('#voice-leave');
  await sees(omar.toast(), 'Maya ended the game.');
  await until(async () => (await playing(omar)) === 0, "Omar's game closing");
  for (const s of [omar, noor]) await until(async () => !(await bar(s).isVisible()), 'the game bar going away');

  // The fire is free again: Omar starts another game, and he's its host.
  await startGame(omar, 'samepage');
  await sees(bar(noor), /Same Page\s+Started by Omar · 1 of 12 playing/);
  noErrors(seats);
});

test('Melon Bomber: the host starts a match and it plays on a friend\'s screen', async (t) => {
  const { seats } = await fireWith(t, server.base, ['Maya', 'Theo']);
  const [maya, theo] = seats;
  await startGame(maya, 'melonbomber', { clock: false });
  await joinGame(theo);
  await sees(theo.game().locator('#lobbyStatus'), /Waiting for host to start/);
  assert.equal(await theo.game().locator('#btnStartMatch').isVisible(), false);
  await maya.game().locator('#btnStartMatch').click();
  for (const s of seats) {
    await s.game().locator('#gameWrap').waitFor({ state: 'visible' });
    await sees(s.game().locator('#hudPlayers'), s === maya ? /You.*Theo/s : /Maya.*You/s);
  }
  // The clock on Theo's screen comes from the host's game, so it only moves if the match is reaching him.
  const clock = () => theo.game().locator('#hudTimer').innerText();
  const was = await clock();
  await until(async () => (await clock()) !== was, "the match clock moving on Theo's screen", 20000);
  // The host quitting ends it for both.
  await maya.game().locator('#btnQuit').click();
  await sees(theo.toast(), 'Maya ended the game.');
  noErrors(seats);
});
