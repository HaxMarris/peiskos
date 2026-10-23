import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { bestHand, PokerTable, type Card } from '../src/poker.ts';
import { START_CHIPS } from '../src/casino.ts';
import { CASES, SLOT_BETS, SLOT_LINES, SLOT_PAYS, SLOT_STRIPS, SLOT_TWO_CHERRIES, linePays } from '../src/casino-items.ts';

/** Cards come off the end of a deck, so the ones listed first are dealt first. */
const dealt = (...cards: Card[]) => () => [...cards].reverse();
let nextDeck: (() => Card[]) | null = null;

const db = openDb(':memory:');
const app = createApp({
  db,
  publicDir: '/nonexistent',
  // Voice on, so there are fires to sit at (nothing here talks to LiveKit).
  voice: { apiKey: 'devkey', apiSecret: 'a-secret-that-is-at-least-32-characters-long', apiUrl: 'http://127.0.0.1:9' },
  casino: { timing: { turnMs: 5000, awayTurnMs: 5000, pauseMs: 150, dealMs: 20 }, deck: () => (nextDeck ? nextDeck() : (null as never)) },
});
let base = '';
before(async () => {
  await new Promise<void>((r) => app.listen(0, r));
  base = `http://localhost:${(app.address() as AddressInfo).port}`;
});
after(() => {
  app.closeAllConnections();
  app.close();
});

async function call(path: string, opts: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, data: (await res.json()) as any };
}
function listen(token: string) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws?token=' + token);
  const events: any[] = [];
  ws.on('message', (d) => events.push(JSON.parse(String(d))));
  const ready = new Promise<void>((r) => ws.once('message', () => r()));
  return { ws, events, ready };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reg = async (username: string) => (await call('/api/register', { body: { username, password: 'password1' } })).data;

test('hands are ranked like poker hands', () => {
  const rank = (cards: string) => bestHand(cards.split(' '));
  assert.equal(rank('As Ks Qs Js Ts 2d 3c').name, 'Royal flush');
  assert.equal(rank('5h 4h 3h 2h Ah Kd Kc').name, 'Straight flush, Five high');
  assert.equal(rank('9c 9d 9h 9s 2c 3d 4h').name, 'Four of a kind, Nines');
  assert.equal(rank('Kc Kd Kh 7s 7c 2d 3h').name, 'Full house, Kings full of Sevens');
  assert.equal(rank('Ah 9h 6h 3h 2h Kd Kc').name, 'Flush, Ace high');
  assert.equal(rank('Ad 2c 3h 4s 5d 9c Kh').name, 'Straight, Five high');
  assert.equal(rank('6c 6d 6h Ks 2c 3d 9h').name, 'Three of a kind, Sixes');
  assert.equal(rank('Kc Kd 7h 7s 2c 3d 9h').name, 'Two pair, Kings and Sevens');
  assert.equal(rank('Qc Qd 7h 5s 2c 3d 9h').name, 'Pair of Queens');
  assert.equal(rank('Ac Jd 7h 5s 2c 3d 9h').name, 'Ace high');
  // Kickers and ties.
  assert.ok(rank('Ac Ad Kh 5s 2c').score > rank('As Ah Qh Js Tc').score);
  assert.equal(rank('Ac Ad Kh 5s 2c 3d 4h').score > rank('Ah As Kd 5c 2d 3s 4c').score, false);
  assert.ok(rank('Th Jh Qh Kh 9h').score > rank('Ac Ad Ah As Kd').score);
  assert.ok(rank('2c 3c 4c 5c 6c').score > rank('Ac 2d 3h 4s 5c').score); // six-high straight flush beats the wheel... and anything below
});

test('side pots: the short stack can only win what it covered', () => {
  const cashed = new Map<number, number>();
  const t = new PokerTable({
    smallBlind: 10, bigBlind: 20, turnMs: 60_000, awayTurnMs: 60_000, pauseMs: 60_000, dealMs: 0,
    isOnline: () => true, cashOut: (id, c) => cashed.set(id, c), settled: () => {}, changed: () => {},
    // Seat 0 gets aces, seat 1 kings, seat 2 queens; the board helps nobody.
    deck: dealt('Kh', 'Qh', 'Ah', 'Kd', 'Qd', 'Ad', 'x', '2c', '7s', '9d', 'x', '3c', 'x', '5s'),
  });
  t.sit(1, 0, 100);
  t.sit(2, 1, 500);
  t.sit(3, 2, 500);
  (t as any).startHand();
  // The button is seat 0, so seat 1 posts 10, seat 2 posts 20, and seat 0 acts first.
  assert.equal(t.hand!.toAct, 0);
  t.act(1, { action: 'allin' }); // 100
  t.act(2, { action: 'raise', to: 300 });
  t.act(3, { action: 'call' });
  // The rest of the hand: seat 1 and 2 check it down.
  while (!t.hand!.done) {
    const who = t.seats[t.hand!.toAct]!.userId;
    t.act(who, { action: 'check' });
  }
  // Aces win the main pot (100 from each of three); kings win the side pot (200 more from each of two).
  assert.equal(t.seats[0]!.stack, 300);
  assert.equal(t.seats[1]!.stack, 200 + 400);
  assert.equal(t.seats[2]!.stack, 200);
  assert.deepEqual(t.hand!.winners.sort(), [0, 1]);
  assert.equal(t.seats[0]!.handName, 'Pair of Aces');
  t.stopTimers();
});

test('an incomplete all-in raise does not reopen the betting', () => {
  const t = new PokerTable({
    smallBlind: 10, bigBlind: 20, turnMs: 60_000, awayTurnMs: 60_000, pauseMs: 60_000, dealMs: 0,
    isOnline: () => true, cashOut: () => {}, settled: () => {}, changed: () => {},
  });
  t.sit(1, 0, 1000);
  t.sit(2, 1, 1000);
  t.sit(3, 2, 130);
  (t as any).startHand();
  // Seat 0 (button) raises to 100; seat 1 calls; seat 2 (big blind) goes all in for 130, less than a full raise.
  t.act(1, { action: 'raise', to: 100 });
  t.act(2, { action: 'call' });
  t.act(3, { action: 'allin' });
  assert.equal(t.hand!.toAct, 0);
  assert.equal(t.view(1).options!.canRaise, false);
  assert.equal(t.view(1).options!.toCall, 30);
  assert.throws(() => t.act(1, { action: 'raise', to: 400 }), /can't raise/);
  t.act(1, { action: 'call' });
  t.act(2, { action: 'call' });
  assert.equal(t.hand!.street, 'flop');
  t.stopTimers();
});

test('slot lines pay with flames standing in', () => {
  assert.equal(linePays(['seven', 'seven', 'seven']), 20);
  assert.equal(linePays(['seven', 'flame', 'seven']), 20);
  assert.equal(linePays(['flame', 'flame', 'flame']), 100);
  assert.equal(linePays(['cherry', 'flame', 'lemon']), 0.5);
  assert.equal(linePays(['lemon', 'cherry', 'cherry']), 0);
});

test('the slot machine wins often and pays back nearly everything', () => {
  // Every stop of every reel, so these are the exact odds.
  const [a, b, c] = SLOT_STRIPS;
  let spins = 0, paid = 0, wins = 0, profits = 0;
  for (let x = 0; x < a.length; x++)
    for (let y = 0; y < b.length; y++)
      for (let z = 0; z < c.length; z++) {
        const grid = [x, y, z].map((stop, r) => [0, 1, 2].map((row) => SLOT_STRIPS[r][(stop + row) % SLOT_STRIPS[r].length]));
        const won = SLOT_LINES.reduce((n, rows) => n + linePays(rows.map((row, r) => grid[r][row])), 0);
        spins++;
        paid += won;
        if (won) wins++;
        if (won > 1) profits++;
      }
  const rtp = paid / spins;
  assert.ok(rtp > 0.97 && rtp < 1, `pays back ${rtp}`);
  assert.ok(wins / spins > 0.45, `wins ${wins / spins}`);
  assert.ok(profits / spins > 0.2, `profits ${profits / spins}`);
  // Every win on every bet is a whole number of chips, so nothing is rounded away.
  for (const bet of SLOT_BETS) for (const x of [SLOT_TWO_CHERRIES, ...Object.values(SLOT_PAYS)]) assert.ok(Number.isInteger(bet * x), `${bet} × ${x}`);
});

test('chips: slots, cases, blackjack and free chips', async () => {
  const max = await reg('maxc');
  const t = max.token;
  const lobby = (await call('/api/casino', { token: t })).data;
  assert.equal(lobby.wallet.chips, START_CHIPS);
  assert.equal(lobby.wallet.freeAt, 0);
  assert.equal(lobby.cases.length, 3);

  // Free chips once, then not again for a while.
  const free = await call('/api/casino/free', { token: t, body: {} });
  assert.equal(free.data.wallet.chips, START_CHIPS + 1000);
  assert.equal((await call('/api/casino/free', { token: t, body: {} })).status, 400);
  let chips = START_CHIPS + 1000;

  // A spin takes the bet and pays what the lines say.
  assert.equal((await call('/api/casino/slots', { token: t, body: { bet: 7 } })).status, 400);
  const spin = (await call('/api/casino/slots', { token: t, body: { bet: 100 } })).data;
  assert.equal(spin.grid.length, 3);
  const expected = spin.wins.reduce((n: number, w: any) => n + w.pays, 0);
  assert.equal(spin.won, expected);
  chips += spin.won - 100;
  assert.equal(spin.wallet.chips, chips);

  // A case: its price, and an item worth something that sells back.
  const box = CASES[0];
  const opened = (await call(`/api/casino/cases/${box.id}/open`, { token: t, body: {} })).data;
  chips -= box.price;
  assert.equal(opened.wallet.chips, chips);
  assert.ok(box.skins.some((s) => s.id === opened.item.skinId));
  assert.ok(opened.item.float >= 0 && opened.item.float <= 1);
  assert.equal((await call('/api/casino', { token: t })).data.inventory.length, 1);
  const sold = (await call('/api/casino/items/sell', { token: t, body: { ids: [opened.item.id] } })).data;
  chips += opened.item.value;
  assert.equal(sold.got, opened.item.value);
  assert.equal(sold.wallet.chips, chips);
  // The collection book keeps it after it's sold.
  assert.deepEqual(opened.found.map((f: any) => [f.skinId, f.count]), [[opened.item.skinId, 1]]);
  const after = (await call('/api/casino', { token: t })).data;
  assert.equal(after.inventory.length, 0);
  assert.equal(after.found[0].skinId, opened.item.skinId);
  assert.equal(after.found[0].bestFloat, opened.item.float);

  // Blackjack: 10 and 9 against a 7; standing on 19 beats the dealer's 17.
  nextDeck = dealt('Th', '7c', '9d', 'Ks', '5h');
  let hand = (await call('/api/casino/blackjack', { token: t, body: { action: 'deal', bet: 100 } })).data;
  assert.deepEqual(hand.blackjack.dealer, ['7c', '??']);
  assert.equal(hand.blackjack.hands[0].total, 19);
  assert.equal(hand.wallet.chips, chips - 100);
  assert.equal((await call('/api/casino/blackjack', { token: t, body: { action: 'deal', bet: 100 } })).status, 400);
  hand = (await call('/api/casino/blackjack', { token: t, body: { action: 'stand' } })).data;
  assert.equal(hand.blackjack.over, true);
  assert.equal(hand.blackjack.hands[0].result, 'win');
  chips += 100;
  assert.equal(hand.wallet.chips, chips);

  // A natural pays 3 to 2 straight away.
  nextDeck = dealt('Ah', '9c', 'Kd', '7s');
  hand = (await call('/api/casino/blackjack', { token: t, body: { action: 'deal', bet: 100 } })).data;
  assert.equal(hand.blackjack.over, true);
  assert.equal(hand.blackjack.hands[0].result, 'blackjack');
  chips += 150;
  assert.equal(hand.wallet.chips, chips);

  // Splitting eights against a 6: one hand busts, the other wins when the dealer busts.
  nextDeck = dealt('8h', '6c', '8d', 'Ts', '3c', 'Kd', '9h', 'Tc');
  hand = (await call('/api/casino/blackjack', { token: t, body: { action: 'deal', bet: 50 } })).data;
  assert.equal(hand.blackjack.can.split, true);
  hand = (await call('/api/casino/blackjack', { token: t, body: { action: 'split' } })).data;
  assert.equal(hand.wallet.chips, chips - 100);
  assert.deepEqual(hand.blackjack.hands.map((h: any) => h.cards), [['8h', '3c'], ['8d', 'Kd']]);
  hand = (await call('/api/casino/blackjack', { token: t, body: { action: 'hit' } })).data; // 8 3 9 = 20
  hand = (await call('/api/casino/blackjack', { token: t, body: { action: 'stand' } })).data;
  assert.equal(hand.blackjack.active, 1);
  hand = (await call('/api/casino/blackjack', { token: t, body: { action: 'stand' } })).data; // 18; dealer 6 T 2 T = 28
  assert.equal(hand.blackjack.over, true);
  assert.deepEqual(hand.blackjack.hands.map((h: any) => h.result), ['win', 'win']);
  chips += 100;
  assert.equal(hand.wallet.chips, chips);
  nextDeck = null;

  // Not enough chips.
  db.prepare('UPDATE casino_wallets SET chips = 20 WHERE user_id = ?').run(max.user.id);
  assert.equal((await call('/api/casino/slots', { token: t, body: { bet: 50 } })).status, 400);
  // Nearly broke: a smaller top-up comes after an hour instead of a day.
  db.prepare('UPDATE casino_wallets SET free_at = ? WHERE user_id = ?').run(Date.now() - 2 * 3600_000, max.user.id);
  const topUp = await call('/api/casino/free', { token: t, body: {} });
  assert.equal(topUp.data.got, 500);
});

test("hold 'em at the fire's table", async (t) => {
  const max = await reg('maxp');
  const sam = await reg('samp');
  const hearth = (await call('/api/servers', { body: { name: 'Card night' }, token: max.token })).data;
  await call('/api/join', { body: { inviteCode: hearth.inviteCode }, token: sam.token });
  const made = (await call(`/api/servers/${hearth.id}/channels`, { body: { name: 'Fire', kind: 'voice' }, token: max.token })).data;
  const room = made.channels.find((c: any) => c.kind === 'voice');
  const text = made.channels.find((c: any) => c.kind === 'text');
  // Only fires have a table.
  assert.equal((await call(`/api/channels/${text.id}/poker`, { body: { action: 'sit', seat: 0, buyIn: 1000 }, token: max.token })).status, 400);

  const m = listen(max.token);
  const s = listen(sam.token);
  t.after(() => {
    m.ws.close();
    s.ws.close();
  });
  await Promise.all([m.ready, s.ready]);
  // You have to be at the fire to sit at its table.
  assert.equal((await call(`/api/channels/${room.id}/poker`, { body: { action: 'sit', seat: 0, buyIn: 1000 }, token: max.token })).status, 400);
  m.ws.send(JSON.stringify({ type: 'voice_join', channelId: room.id }));
  s.ws.send(JSON.stringify({ type: 'voice_join', channelId: room.id }));
  await wait(100);
  m.ws.send(JSON.stringify({ type: 'casino', channelId: room.id }));
  await wait(100);
  assert.ok(m.events.some((e) => e.type === 'poker' && e.channelId === room.id && e.table.seats.every((x: any) => x === null)));

  // Max on the button with sevens, Sam with aces; nothing on the board.
  nextDeck = dealt('Ah', '7c', 'Ad', '7d', 'x', '2c', '9s', 'Jd', 'x', '4h', 'x', 'Kc');
  assert.equal((await call(`/api/channels/${room.id}/poker`, { body: { action: 'sit', seat: 0, buyIn: 300 }, token: max.token })).status, 400);
  assert.equal((await call(`/api/channels/${room.id}/poker`, { body: { action: 'sit', seat: 3, buyIn: 1000 }, token: max.token })).status, 200);
  assert.equal((await call(`/api/channels/${room.id}/poker`, { body: { action: 'sit', seat: 3, buyIn: 1000 }, token: sam.token })).status, 400);
  assert.equal((await call(`/api/channels/${room.id}/poker`, { body: { action: 'sit', seat: 5, buyIn: 1000 }, token: sam.token })).status, 200);
  assert.equal((await call('/api/casino', { token: max.token })).data.wallet.chips, START_CHIPS - 1000);
  assert.equal((await call('/api/casino', { token: max.token })).data.wallet.atTable, 1000);
  await wait(400); // the first hand deals

  const latest = (events: any[]) => events.filter((e) => e.type === 'poker').at(-1).table;
  let view = latest(s.events);
  assert.equal(view.handNo, 1);
  // Sam sees their own cards and only the backs of Max's.
  assert.deepEqual(view.seats[5].cards, ['Ah', 'Ad']);
  assert.deepEqual(view.seats[3].cards, ['??', '??']);
  // Heads up, the button (seat 3) posts the small blind and acts first.
  assert.equal(view.button, 3);
  assert.equal(view.toAct, 3);
  assert.equal((await call(`/api/channels/${room.id}/poker`, { body: { action: 'check' }, token: sam.token })).status, 400);
  await call(`/api/channels/${room.id}/poker`, { body: { action: 'raise', to: 100 }, token: max.token });
  await call(`/api/channels/${room.id}/poker`, { body: { action: 'call' }, token: sam.token });
  for (let i = 0; i < 6; i++) {
    await wait(60);
    view = latest(m.events);
    if (view.done) break;
    const who = view.seats[view.toAct].userId === max.user.id ? max.token : sam.token;
    await call(`/api/channels/${room.id}/poker`, { body: { action: 'check' }, token: who });
    await wait(30);
  }
  await wait(50);
  view = latest(m.events);
  assert.equal(view.done, true);
  assert.deepEqual(view.winners, [5]);
  assert.equal(view.seats[5].stack, 1100);
  assert.equal(view.seats[3].stack, 900);
  assert.deepEqual(view.seats[5].cards, ['Ah', 'Ad']); // shown at the showdown
  assert.match(view.log.at(-1), /won 200 with pair of Aces/);
  nextDeck = null;

  // Getting up between hands takes your stack back to your wallet.
  await call(`/api/channels/${room.id}/poker`, { body: { action: 'sitout' }, token: max.token });
  await wait(250);
  view = latest(m.events);
  if (!view.done) {
    // A new hand started before Max sat out: fold it, then get up.
    await call(`/api/channels/${room.id}/poker`, { body: { action: 'stand' }, token: max.token });
    while (!latest(m.events).done) await wait(50);
  } else await call(`/api/channels/${room.id}/poker`, { body: { action: 'stand' }, token: max.token });
  await wait(300);
  const w = (await call('/api/casino', { token: max.token })).data.wallet;
  assert.equal(w.atTable, 0);
  assert.ok([START_CHIPS - 100, START_CHIPS - 120].includes(w.chips), String(w.chips));

  // Leaderboard for the hearth.
  const leaders = (await call(`/api/servers/${hearth.id}/casino/leaders`, { token: sam.token })).data;
  assert.equal(leaders.length, 2);

  // Leaving the fire gets you up from its table, and your stack goes back to your wallet.
  const before = (await call('/api/casino', { token: sam.token })).data.wallet;
  assert.ok(before.atTable > 0);
  s.ws.send(JSON.stringify({ type: 'voice_leave' }));
  await wait(300);
  while (!latest(m.events).done) await wait(50);
  await wait(200);
  const after = (await call('/api/casino', { token: sam.token })).data.wallet;
  assert.equal(after.atTable, 0);
  assert.equal(after.chips, before.chips + before.atTable);
});

test('the chip reset happens once', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'peiskos-casino-')), 'chat.db');
  let d = openDb(file);
  // A database from before the reset: someone down to their last chips, mid blackjack hand.
  d.prepare("DELETE FROM app_secrets WHERE name = 'casino_reset_2026_10'").run();
  d.prepare("INSERT INTO users (username, password_hash, created_at) VALUES ('old', 'x', 0)").run();
  d.prepare("INSERT INTO casino_wallets (user_id, chips, at_table, blackjack, created_at) VALUES (1, 40, 300, '{}', 0)").run();
  d.close();
  d = openDb(file);
  assert.deepEqual({ ...(d.prepare('SELECT chips, at_table, blackjack FROM casino_wallets').get() as object) }, { chips: 10_000, at_table: 0, blackjack: null });
  d.prepare('UPDATE casino_wallets SET chips = 25').run();
  d.close();
  d = openDb(file);
  assert.equal((d.prepare('SELECT chips FROM casino_wallets').get() as { chips: number }).chips, 25);
  d.close();
});
