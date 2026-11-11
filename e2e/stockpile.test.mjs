// Stockpile, played to the end by real browsers clicking real cards.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, fireWith, joinGame, leaveGame, noErrors, sees, startGame, startServer, until } from './lib.mjs';

let server;
before(async () => { server = await startServer(); });
after(async () => { await closeBrowser(); await server?.stop(); });

/** The table as one player's page shows it. Wilds are 0. */
const table = (seat) => seat.game().locator('#table').evaluate(() => {
  const $ = (id) => document.getElementById(id);
  const num = (c) => { const t = c.querySelector('.num')?.textContent; return t === '★' ? 0 : Number(t); };
  const top = (root) => { const cards = root.querySelectorAll('.card:not(.empty)'); return cards.length ? num(cards[cards.length - 1]) : null; };
  return {
    banner: $('turnBanner').textContent,
    log: $('logLine').textContent,
    hand: [...document.querySelectorAll('#hand .card')].map(num),
    stock: top($('myStock')),
    stockLeft: $('myStockCount').textContent,
    discards: [...document.querySelectorAll('#myDiscards .fan')].map(top),
    // What each middle pile takes next.
    next: [...document.querySelectorAll('#builds .pile-label')].map((l) => (l.textContent === 'start with 1' ? 1 : Number(l.textContent.replace('next: ', '')))),
    others: [...document.querySelectorAll('.opp')].map((o) => ({ name: o.querySelector('.pname').textContent, hand: Number(o.querySelector('.opp-hand').textContent.slice(1)), turn: o.classList.contains('turn') })),
    picked: document.querySelectorAll('.card.picked').length,
    over: !$('overlay').classList.contains('hidden'),
    title: $('overTitle').textContent,
  };
});
const changed = (seat, was) => until(async () => JSON.stringify(await table(seat)) !== JSON.stringify(was), `${seat.name}'s table to change`);

/** One whole turn: play everything that fits (stockpile first), then discard. */
async function playTurn(seat, turnNo) {
  const g = seat.game();
  for (let moves = 0; moves < 80; moves++) {
    const s = await table(seat);
    if (s.over || s.banner !== 'Your turn') return;
    const pileFor = (c) => (c === null ? -1 : c === 0 ? 0 : s.next.indexOf(c));
    const inHand = s.hand.findIndex((c) => pileFor(c) >= 0);
    const onDiscard = s.discards.findIndex((c) => pileFor(c) >= 0);
    if (pileFor(s.stock) >= 0) {
      await g.locator('#myStock .card').click();
      await g.locator('#builds .card').nth(pileFor(s.stock)).click();
    } else if (inHand >= 0) {
      await g.locator('#hand .card').nth(inHand).click();
      await g.locator('#builds .card').nth(pileFor(s.hand[inHand])).click();
    } else if (onDiscard >= 0) {
      // Clicked without moving the mouse there: resting on a pile opens a look at its cards, over the table.
      await g.locator('#myDiscards .fan').nth(onDiscard).dispatchEvent('click');
      await g.locator('#builds .card').nth(pileFor(s.discards[onDiscard])).click();
    } else if (s.hand.length) {
      await g.locator('#hand .card').last().click();
      await g.locator('#myDiscards .fan').nth(turnNo % 4).click();
    } else {
      await g.locator('#btnPass').click();
    }
    await changed(seat, s);
  }
  throw new Error(`${seat.name}'s turn never ended`);
}

/** Plays turns until the round is over (or `stop` says so). Returns who won, as each page names it. */
async function playOn(seats, stop = () => false) {
  for (let turn = 0; turn < 600; turn++) {
    const views = await Promise.all(seats.map(table));
    if (views.some((v) => v.over) || await stop(views, turn)) return views;
    const i = views.findIndex((v) => v.banner === 'Your turn');
    if (i < 0) { await new Promise((r) => setTimeout(r, 50)); continue; }
    await playTurn(seats[i], turn);
  }
  throw new Error('The round never ended');
}

test('Stockpile: a whole round by the rules, then a three-player round that people leave', async (t) => {
  const { seats } = await fireWith(t, server.base, ['Maya', 'Theo', 'Ines']);
  const [maya, theo, ines] = seats;

  await startGame(maya, 'stockpile');
  await sees(maya.game().locator('#lobbyStatus'), 'You need at least one more player.');
  assert.equal(await maya.game().locator('#btnStart').isDisabled(), true);
  await joinGame(theo);
  await sees(theo.game().locator('#lobbyStatus'), 'Waiting for the host to deal…');
  await sees(maya.game().locator('#lobbyPlayers'), /Maya\s*HOST\s*Theo/);
  assert.equal(await theo.game().locator('#btnStart').isVisible(), false);
  assert.equal(await theo.game().locator('#stockRow').isVisible(), false, 'only the host sets the stockpile size');
  await maya.game().locator('#stockSelect').selectOption('5');
  await maya.game().locator('#btnStart').click();

  // Dealt: five in each stockpile, a hand for whoever goes first, and nobody sees the other's hand.
  await sees(theo.game().locator('#turnBanner'), /turn/i);
  let [m, th] = [await table(maya), await table(theo)];
  assert.equal(m.stockLeft, '5 in your stockpile');
  assert.equal(th.stockLeft, '5 in your stockpile');
  const [first, second] = m.banner === 'Your turn' ? [maya, theo] : [theo, maya];
  const [f, s] = m.banner === 'Your turn' ? [m, th] : [th, m];
  assert.equal(f.hand.length, 5);
  assert.equal(s.banner, `${first.name}'s turn`);
  assert.deepEqual(s.others, [{ name: first.name, hand: 5, turn: true }]);
  await sees(first.game().locator('#logLine'), `${first.name} goes first`);

  // It isn't the other player's turn: their cards don't pick up.
  await second.game().locator('#myStock .card').click();
  assert.equal((await table(second)).picked, 0);
  // A card that doesn't fit a pile is turned down, and stays in your hand.
  const misfit = f.hand.findIndex((c) => c > 1);
  if (misfit >= 0) {
    await first.game().locator('#hand .card').nth(misfit).click();
    assert.equal((await table(first)).picked, 1);
    await first.game().locator('#builds .card').first().click();
    await sees(first.game().locator('.toast'), 'That pile needs a 1');
    assert.equal((await table(first)).hand.length, 5);
    await first.game().locator('#hand .card').nth(misfit).click(); // put it back down
  }

  // Ines sits down mid-round and watches.
  await joinGame(ines);
  await sees(ines.game().locator('#hint'), "You'll be dealt in next round.");
  assert.equal((await table(ines)).hand.length, 0);

  // Play it out. Someone empties their stockpile and wins.
  const end = await playOn([maya, theo]);
  const winner = end[0].title === 'You win!' ? maya : theo;
  const loser = winner === maya ? theo : maya;
  await sees(winner.game().locator('#overTitle'), 'You win!');
  await sees(loser.game().locator('#overTitle'), `${winner.name} wins`);
  await sees(ines.game().locator('#overTitle'), `${winner.name} wins`);
  await sees(loser.game().locator('#overSub'), `${winner.name} emptied their stockpile`);
  assert.equal(await theo.game().locator('#btnAgain').isVisible(), false, 'only the host deals again');

  // Back to the lobby, and a second round with all three.
  await maya.game().locator('#btnAgain').click();
  await sees(ines.game().locator('#lobbyPlayers'), /Maya\s*HOST\s*Theo\s*Ines\s*YOU/);
  await maya.game().locator('#btnStart').click();
  await sees(ines.game().locator('#turnBanner'), /turn/i);
  assert.equal((await table(ines)).others.length, 2);
  assert.equal((await table(ines)).stockLeft, '5 in your stockpile');

  // A few turns in, Theo leaves: the round carries on without him.
  await playOn(seats, (_, turn) => turn >= 4);
  await leaveGame(theo);
  await sees(maya.game().locator('#logLine'), 'Theo left');
  await until(async () => (await table(ines)).others.length === 1, 'Theo gone from the table');
  const live = await Promise.all([maya, ines].map(table));
  assert.equal(live.filter((v) => v.banner === 'Your turn').length, 1, "it's still exactly one player's turn");
  assert.equal(live.some((v) => v.over), false);
  // Then Ines leaves too, and the last one at the table has won.
  await leaveGame(ines);
  await sees(maya.game().locator('#overTitle'), 'You win!');
  await sees(maya.game().locator('#overSub'), 'Ines left');
  noErrors(seats);
});
