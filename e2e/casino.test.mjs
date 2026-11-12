// The casino at the fire: chips, blackjack, slots and cases on your own, and the poker table and
// case battles between friends. The cards and reels are random, so these check what must always
// hold: what each player may see, whose turn it is, and that chips add up.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { call, closeBrowser, fireWith, noErrors, sees, startServer, until } from './lib.mjs';

let server;
before(async () => { server = await startServer(); });
after(async () => { await closeBrowser(); await server?.stop(); });

const num = (text) => Number(String(text).replace(/[^\d-]/g, ''));
/** Opens the casino from the fire's game picker, on one of its tabs. */
async function openCasino(seat, tab) {
  await seat.page.click('#fire-game');
  await seat.page.click(`#modal-card [data-casino="${tab}"]`);
  await until(async () => /\d/.test(await seat.page.locator('#casino-chips').innerText()), `${seat.name}'s chips`);
}
const chips = async (seat) => num(await seat.page.locator('#casino-chips').innerText());
const hasChips = (seat, n) => until(async () => (await chips(seat)) === n, `${seat.name} to have ${n} chips`);
/** What the server says someone has: chips in hand, at the poker table and in a battle. */
const wallet = async (hearth, seat) => (await call(server.base, `/api/servers/${hearth.id}/casino`, { token: seat.token })).wallet;
/** Does something on the page and hands back the server's answer to it. */
async function answer(seat, path, act) {
  const [res] = await Promise.all([seat.page.waitForResponse((r) => r.url().includes(path) && r.request().method() === 'POST'), act()]);
  assert.equal(res.status(), 200, `${path}: ${await res.text()}`);
  return res.json();
}

test('chips on your own: free chips, a hand of blackjack, a spin of the slots, and a case opened and sold', async (t) => {
  const { hearth, seats } = await fireWith(t, server.base, ['Maya']);
  const [maya] = seats;
  const page = maya.page;
  await openCasino(maya, 'blackjack');
  let have = await chips(maya);
  assert.equal(have, 10_000, 'everyone starts with 10,000');

  // Free chips, once; then the button says when there's more.
  const free = page.locator('#casino-free');
  if (await free.isEnabled()) {
    const r = await answer(maya, '/casino/free', () => free.click());
    have += r.got;
    await hasChips(maya, have);
    await sees(maya.toast(), `+${r.got.toLocaleString()} chips.`);
  }
  await sees(free, /^More in /);
  assert.equal(await free.isDisabled(), true);

  // Blackjack: bet 150, stand on whatever comes, and the chips move by exactly what the hand paid.
  await sees(page.locator('#bj-msg'), 'Place a bet to start.');
  await page.click('[data-bj-bet="clear"]');
  await page.click('[data-bj="deal"]');
  await sees(maya.toast(), 'Bets start at 10 chips.');
  await page.click('[data-add="100"]');
  await page.click('[data-add="50"]');
  await sees(page.locator('.bet-amount'), '150');
  let r = await answer(maya, '/casino/blackjack', () => page.click('[data-bj="deal"]'));
  assert.equal(await page.locator('#bj-hands .bj-hand .pcard').count(), 2);
  if (!r.blackjack.over) {
    // The dealer's second card stays face down until you're done.
    assert.equal(await page.locator('#bj-dealer .pcard.back').count(), 1);
    await sees(page.locator('#bj-dealer-total'), /\+$/);
    await hasChips(maya, have - 150);
    r = await answer(maya, '/casino/blackjack', () => page.click('[data-bj="stand"]'));
  }
  assert.equal(r.blackjack.over, true);
  assert.equal(await page.locator('#bj-dealer .pcard.back').count(), 0);
  const [hand] = r.blackjack.hands;
  have += hand.paid - 150;
  await hasChips(maya, have);
  await sees(page.locator('#bj-msg'), hand.paid > 150 ? `You win ${hand.paid - 150}!` : hand.paid === 150 ? 'Push: your bet comes back.' : 'Dealer wins.');
  await sees(page.locator('#bj-dealer-total'), String(r.blackjack.dealerTotal));
  await sees(page.locator('[data-bj="deal"]'), 'Deal again');

  // Slots: the bet comes off at once, the win lands when the reels stop.
  await page.click('.casino-tabs [data-tab="slots"]');
  const bet = num(await page.locator('#slot-bet-led').innerText());
  r = await answer(maya, '/casino/slots', () => page.click('#slot-spin'));
  assert.equal(await page.locator('#slot-spin').isDisabled(), true, 'no second spin while the reels turn');
  await hasChips(maya, have - bet);
  have += r.won - bet;
  assert.equal(r.wallet.chips, have);
  await until(async () => page.locator('#slot-spin').isEnabled(), 'the reels to stop');
  await hasChips(maya, have);
  await until(async () => num(await page.locator('#slot-win').innerText()) === r.won, `the win meter to show ${r.won}`);
  await sees(page.locator('#slot-credits'), have.toLocaleString());

  // Cases: open the cheapest, sell what drops for what it says it's worth.
  await page.click('.casino-tabs [data-tab="cases"]');
  await page.click('[data-case="kindling"]');
  r = await answer(maya, '/cases/kindling/open', () => page.click('[data-open="kindling"]'));
  have -= 100;
  await hasChips(maya, have);
  const sell = page.locator(`#case-drop [data-sell="${r.item.id}"]`);
  await sell.waitFor({ timeout: 20000 });
  await sees(sell, `Sell for ${r.item.value.toLocaleString()}`);
  await sees(page.locator('#inv-count'), '1');
  await answer(maya, '/casino/items/sell', () => sell.click());
  have += r.item.value;
  await hasChips(maya, have);
  await page.click('[data-case-view="inventory"]');
  assert.equal(await page.locator('#cases-main [data-item]').count(), 0, 'sold, so not in the inventory');
  assert.equal((await wallet(hearth, maya)).chips, have);
  noErrors(seats);
});

test("hold 'em at the fire: only your own cards, one player's turn at a time, and every chip accounted for", async (t) => {
  const { hearth, seats } = await fireWith(t, server.base, ['Maya', 'Theo', 'Ines']);
  const [maya, theo, ines] = seats;
  const players = [maya, theo];
  for (const s of seats) await openCasino(s, 'poker');
  await sees(maya.page.locator('#poker-bar'), 'Pick a seat to play. Blinds 10/20');

  // Sitting down takes the buy-in out of your chips and everyone sees you at the table.
  const sit = async (seat, n) => {
    await seat.page.click(`[data-sit="${n}"]`);
    await sees(seat.page.locator('#buyin-n'), '2,000');
    await seat.page.click('#buyin-form button[type="submit"]');
    await hasChips(seat, 8000);
    await sees(seat.page.locator('#casino-at-table'), '+2,000 at the table');
  };
  await sit(maya, 0);
  await sees(ines.page.locator('#poker-seats .p-seat:not(.empty)'), /Maya\s+2,000/);
  await sees(maya.page.locator('#poker-bar'), 'Waiting for someone else to sit down.');
  assert.equal(await maya.page.locator('[data-sit]').count(), 0, 'one seat each');
  await sit(theo, 1);

  const table = (seat) => seat.page.evaluate(() => ({
    handNo: casino.table.handNo, toAct: casino.table.toAct, done: casino.table.done, pot: casino.table.pot,
    seats: casino.table.seats.map((s) => s && { userId: s.userId, stack: s.stack, bet: s.bet, cards: s.cards, folded: s.folded }),
    board: casino.table.board, winners: casino.table.winners,
  }));
  /** Every chip at the table: stacks, and during a hand the bets and the pot (which stay on show after they're paid out). */
  const onTable = async () => { const v = await table(ines); return v.seats.reduce((n, s) => n + (s ? s.stack + (v.done ? 0 : s.bet) : 0), v.done ? 0 : v.pot); };
  /** Whoever the page says is to act: the only one with moves to make. */
  const actor = async (handNo) => until(async () => {
    const v = await table(ines);
    if (v.handNo !== handNo || v.done) return 'done';
    const who = players.find((p) => v.seats[v.toAct]?.userId === p.id);
    return who && (await who.page.locator('[data-move="fold"]').count()) ? who : null;
  }, 'someone to act');

  // ---- Hand 1 is dealt. Each player sees their own two cards; the other's, and the watcher's view of both, are face down.
  await until(async () => (await table(ines)).handNo === 1, 'the first hand');
  for (const me of players) {
    const mine = me.page.locator('#poker-seats .p-seat.me .p-cards .pcard');
    await until(async () => (await mine.count()) === 2, `${me.name}'s cards`);
    assert.equal(await me.page.locator('#poker-seats .p-seat.me .pcard.back').count(), 0);
    assert.equal(await me.page.locator('#poker-seats .p-seat:not(.me) .pcard.back').count(), 2);
    const v = await table(me);
    const other = v.seats.find((s) => s && s.userId !== me.id);
    assert.deepEqual(other.cards, ['??', '??'], "the server doesn't send the other player's cards");
  }
  assert.equal(await ines.page.locator('#poker-seats .pcard.back').count(), 4);
  assert.deepEqual((await table(ines)).seats.filter(Boolean).map((s) => s.cards), [['??', '??'], ['??', '??']]);
  assert.equal(await onTable(), 4000);

  // One player has the move; the other waits. A fold gives the blinds to the other.
  let first = await actor(1);
  const waiting = players.find((p) => p !== first);
  assert.equal(await waiting.page.locator('[data-move="fold"], [data-move="call"], [data-move="check"]').count(), 0);
  await sees(waiting.page.locator('#poker-bar'), `Waiting for ${first.name}…`);
  await first.page.click('[data-move="fold"]');
  await until(async () => (await table(ines)).done, 'the hand to end');
  let v = await table(ines);
  assert.equal(v.seats[v.winners[0]].userId, waiting.id);
  assert.equal(await onTable(), 4000);
  await sees(ines.page.locator('#poker-seats .p-seat.won'), new RegExp(`${waiting.name}`));
  // Folded cards are never shown.
  assert.equal(await ines.page.locator('#poker-seats .p-cards .pcard:not(.back)').count(), 0);

  // ---- Hand 2: both check and call to the end, and the showdown turns the cards over for everyone.
  await until(async () => (await table(ines)).handNo === 2, 'the second hand', 15000);
  for (;;) {
    const who = await actor(2);
    if (who === 'done') break;
    const call = who.page.locator('[data-move="call"], [data-move="check"]');
    await call.click({ timeout: 2000 }).catch(() => {}); // the street may have moved on under the click
    await new Promise((r) => setTimeout(r, 150));
  }
  v = await table(ines);
  assert.equal(v.board.length, 5, 'all five cards on the board');
  for (const s of v.seats.filter(Boolean)) assert.doesNotMatch(s.cards.join(), /\?/, 'both hands are shown at the showdown');
  assert.equal(await ines.page.locator('#poker-board .pcard:not(.slot)').count(), 5);
  assert.equal(await ines.page.locator('#poker-seats .p-hand').count(), 2, 'each hand is named');
  assert.equal(await onTable(), 4000, 'the pot went to the winner, and nothing leaked');

  // Standing up brings what's left back to your chips.
  await until(async () => (await table(ines)).handNo === 3, 'the third hand', 15000);
  const leaver = await actor(3);
  await leaver.page.click('[data-move="stand"]');
  await leaver.page.click('[data-move="fold"]', { timeout: 2000 }).catch(() => {});
  const stayer = players.find((p) => p !== leaver);
  await until(async () => !(await table(ines)).seats.some((s) => s?.userId === leaver.id), `${leaver.name} to be up from the table`, 15000);
  await sees(stayer.page.locator('#poker-bar'), 'Waiting for someone else to sit down.', 15000);
  const [l, s] = [await wallet(hearth, leaver), await wallet(hearth, stayer)];
  assert.equal(l.atTable, 0);
  assert.equal(l.chips + s.chips + s.atTable, 20_000, 'between them, the two still have 20,000');
  await hasChips(leaver, l.chips);
  assert.equal((await wallet(hearth, ines)).chips, 10_000, 'watching costs nothing');
  noErrors(seats);
});

test('a case battle: both pay, both open the same case, and the higher total takes every skin', async (t) => {
  const { hearth, seats } = await fireWith(t, server.base, ['Maya', 'Theo', 'Ines']);
  const [maya, theo, ines] = seats;
  for (const s of seats) await openCasino(s, 'battles');

  // Maya makes a two-player battle over one Kindling Case (100 chips each).
  await maya.page.click('[data-battle-new]');
  await sees(maya.page.locator('#make-sum'), /1 round · everyone pays\s+100/);
  await maya.page.click('#make-go');
  const card = (seat) => seat.page.locator('.battle-card');
  await sees(card(theo), /Maya/);
  await sees(card(maya), 'Cancel battle');
  await hasChips(maya, 9900);
  await sees(maya.page.locator('#casino-at-table'), '+100 in a battle');
  await hasChips(theo, 10_000);

  // Theo takes the open seat, which fills the battle and starts it for everyone at the fire.
  await theo.page.click('[data-battle-join]');
  await hasChips(theo, 9900);
  for (const s of [maya, theo]) await s.page.locator('.battle-view').waitFor();
  await sees(maya.page.locator('.battle-view .case-head'), 'Round 1 of 1');
  assert.equal(await maya.page.locator('.b-col').count(), 2);
  // Ines can watch but isn't in it.
  await ines.page.click('[data-battle-watch]');
  await ines.page.locator('.battle-view').waitFor();

  // The reel stops: one skin each, totals shown, one winner who takes both.
  for (const s of seats) await sees(s.page.locator('.battle-view .case-head'), 'Done', 20000);
  // Read from Ines's screen, where both players go by name.
  const cols = await ines.page.locator('.b-col').evaluateAll((els) => els.map((c) => ({
    name: c.querySelector('.b-who b').textContent, total: Number(c.querySelector('.b-total').textContent.replace(/\D/g, '')),
    won: c.classList.contains('won'), items: c.querySelectorAll('.b-item').length,
  })));
  assert.deepEqual(cols.map((c) => c.items), [1, 1], 'one skin each');
  assert.equal(cols.filter((c) => c.won).length, 1);
  const best = cols.find((c) => c.won);
  const pot = cols[0].total + cols[1].total;
  assert.ok(best.total * 2 >= pot, `the higher total won: ${JSON.stringify(cols)}`);
  const winner = best.name === 'Maya' ? maya : theo;
  const loser = winner === maya ? theo : maya;
  await sees(winner.page.locator('.battle-end'), `You won ${pot.toLocaleString()} worth of skins. They're in your inventory.`);
  await sees(loser.page.locator('.battle-end'), `${winner.name} won it all.`);
  await sees(ines.page.locator('.battle-end'), `${winner.name} won it all.`);

  // The skins really moved: two in the winner's inventory, none in the loser's, and both are 100 chips down.
  const items = async (seat) => (await call(server.base, `/api/servers/${hearth.id}/casino`, { token: seat.token })).inventory;
  assert.equal((await items(winner)).length, 2);
  assert.equal((await items(loser)).length, 0);
  assert.equal((await items(winner)).reduce((n, i) => n + i.value, 0), pot);
  for (const s of [maya, theo]) {
    const w = await wallet(hearth, s);
    assert.deepEqual([w.chips, w.inBattle], [9900, 0]);
  }
  assert.equal((await wallet(hearth, ines)).chips, 10_000);
  noErrors(seats);
});
