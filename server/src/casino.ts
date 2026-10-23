// The casino, in the games at the fire: Texas hold 'em (one table at each fire), blackjack, a slot
// machine and CS-style cases. Everything is played with chips, and chips are play money only: everyone
// starts with some, gets more for free every day, and they can't be bought or cashed out. One balance
// per person, used at every fire. The server deals, spins and opens everything, so nobody's app decides what it wins.
import { randomInt } from 'node:crypto';
import type { WebSocket } from 'ws';
import { inTransaction, type Db } from './db.ts';
import { allowance, type Json } from './http.ts';
import { PokerTable, MAX_SEATS, shuffledDeck, type Action, type Card } from './poker.ts';
import {
  CASES, RARITY_ODDS, SLOT_BETS, SLOT_LINES, SLOT_PAYS, SLOT_STRIPS, SLOT_TWO_CHERRIES, STATTRAK_CHANCE, STATTRAK_VALUE, WEARS,
  linePays, type Rarity, type Skin,
} from './casino-items.ts';

export const START_CHIPS = 10_000;
const DAILY_CHIPS = 1000;
const DAILY_MS = 20 * 3600_000;
const BROKE_CHIPS = 500; // when you're nearly out, you don't have to wait a whole day
const BROKE_BELOW = 100;
const BROKE_MS = 3600_000;
const MAX_ITEMS = 500;
/** How many cases can be opened at once. */
const CASE_COUNTS = [1, 2, 5, 10, 20];
const BLACKJACK_MIN = 10;
const BLACKJACK_MAX = 10_000;
export const POKER = { smallBlind: 10, bigBlind: 20, minBuyIn: 400, maxBuyIn: 4000 };
const AWAY_STAND_MS = 2 * 60_000; // offline this long at a table, and you get up (with your chips)
const SITTING_OUT_STAND_MS = 10 * 60_000;

type Channel = { id: number; serverId: number; kind: string };
type User = { id: number };
type Handler = (ctx: { user: User; params: string[]; body: Json }) => unknown;

export interface CasinoContext {
  db: Db;
  route: (method: string, path: string, handler: Handler) => void;
  fail: (status: number, message: string) => Error;
  channelById: (id: number) => Channel | undefined;
  /** Which fire (voice room) each person is at. */
  inVoice: Map<number, number>;
  usersInVoice: (channelId: number) => number[];
  isMember: (serverId: number, userId: number) => boolean;
  serverMemberIds: (serverId: number) => number[];
  isOnline: (userId: number) => boolean;
  sendTo: (userIds: Iterable<number>, event: Json) => void;
  /** Shorter waits, for tests. */
  timing?: { turnMs: number; awayTurnMs: number; pauseMs: number; dealMs: number };
  deck?: () => Card[];
}

type Wallet = { chips: number; atTable: number; blackjack: string | null; freeAt: number };
type BjHand = { cards: Card[]; bet: number; done: boolean; doubled: boolean; splitAces: boolean; result: string; paid: number };
type Blackjack = { deck: Card[]; dealer: Card[]; hands: BjHand[]; active: number; over: boolean; natural: boolean };

export function casino(ctx: CasinoContext) {
  const { db, route, fail } = ctx;
  const timing = ctx.timing ?? { turnMs: 30_000, awayTurnMs: 6_000, pauseMs: 5_000, dealMs: 1_200 };

  // Chips left at a table when the server stopped go back to their wallets.
  db.prepare('UPDATE casino_wallets SET chips = chips + at_table, at_table = 0 WHERE at_table > 0').run();

  // ---- the wallet

  const wallet = (userId: number): Wallet => {
    db.prepare('INSERT OR IGNORE INTO casino_wallets (user_id, chips, created_at) VALUES (?, ?, ?)').run(userId, START_CHIPS, Date.now());
    return db.prepare('SELECT chips, at_table AS atTable, blackjack, free_at AS freeAt FROM casino_wallets WHERE user_id = ?').get(userId) as Wallet;
  };
  /** When the next free chips come, and how many. */
  const freeChips = (w: Wallet) => {
    const daily = w.freeAt + DAILY_MS;
    if (w.chips + w.atTable < BROKE_BELOW && !openBlackjack(w)) {
      const broke = w.freeAt + BROKE_MS;
      if (broke < daily) return { at: broke, amount: Date.now() >= daily ? DAILY_CHIPS : BROKE_CHIPS };
    }
    return { at: daily, amount: DAILY_CHIPS };
  };
  const walletView = (userId: number) => {
    const w = wallet(userId);
    const free = freeChips(w);
    return { chips: w.chips, atTable: w.atTable, freeAt: free.at <= Date.now() ? 0 : free.at, freeAmount: free.amount };
  };
  const walletChanged = (userId: number) => ctx.sendTo([userId], { type: 'casino_wallet', wallet: walletView(userId) });
  /** Takes chips for a bet, or says there aren't enough. */
  const take = (userId: number, chips: number) => {
    wallet(userId);
    const r = db.prepare('UPDATE casino_wallets SET chips = chips - ? WHERE user_id = ? AND chips >= ?').run(chips, userId, chips);
    if (!r.changes) throw fail(400, "You don't have enough chips");
  };
  const give = (userId: number, chips: number) => {
    if (chips > 0) db.prepare('UPDATE casino_wallets SET chips = chips + ? WHERE user_id = ?').run(chips, userId);
  };
  const plays = allowance(30, 10);
  const play = (user: User) => {
    if (!plays.take(user.id)) throw fail(429, 'Slow down a little');
  };
  const wholeChips = (value: unknown, what: string) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) throw fail(400, `${what} has to be a whole number of chips`);
    return n;
  };

  route('GET', '/api/casino', ({ user }) => ({
    wallet: walletView(user.id),
    blackjack: blackjackView(wallet(user.id)),
    cases: CASES,
    rarityOdds: RARITY_ODDS,
    wears: WEARS,
    slots: { strips: SLOT_STRIPS, lines: SLOT_LINES, pays: SLOT_PAYS, twoCherries: SLOT_TWO_CHERRIES, bets: SLOT_BETS },
    poker: POKER,
    caseCounts: CASE_COUNTS,
    inventory: inventory(user.id),
    found: found(user.id),
  }));

  route('POST', '/api/casino/free', ({ user }) => {
    const w = wallet(user.id);
    const free = freeChips(w);
    if (free.at > Date.now()) throw fail(400, 'Your free chips aren\'t ready yet');
    db.prepare('UPDATE casino_wallets SET chips = chips + ?, free_at = ? WHERE user_id = ?').run(free.amount, Date.now(), user.id);
    walletChanged(user.id);
    return { wallet: walletView(user.id), got: free.amount };
  });

  route('GET', '/api/servers/:id/casino/leaders', ({ user, params }) => {
    const serverId = Number(params[0]);
    if (!ctx.isMember(serverId, user.id)) throw fail(404, 'Hearth not found');
    const ids = ctx.serverMemberIds(serverId);
    if (!ids.length) return [];
    return db
      .prepare(
        `SELECT w.user_id AS userId, w.chips + w.at_table AS chips,
           COALESCE((SELECT SUM(value) FROM casino_items i WHERE i.user_id = w.user_id), 0) AS items
         FROM casino_wallets w WHERE w.user_id IN (${ids.map(() => '?').join(',')})
         ORDER BY chips + items DESC LIMIT 10`,
      )
      .all(...ids);
  });

  // ---- slots

  route('POST', '/api/casino/slots', ({ user, body }) => {
    play(user);
    const bet = Number(body.bet);
    if (!SLOT_BETS.includes(bet)) throw fail(400, 'Pick one of the bets on the machine');
    take(user.id, bet);
    const stops = SLOT_STRIPS.map((strip) => randomInt(strip.length));
    const grid = stops.map((stop, r) => [0, 1, 2].map((row) => SLOT_STRIPS[r][(stop + row) % SLOT_STRIPS[r].length]));
    const wins = SLOT_LINES.flatMap((rows, line) => {
      const pays = linePays(rows.map((row, r) => grid[r][row]));
      return pays ? [{ line, pays: Math.floor(pays * bet) }] : [];
    });
    const won = wins.reduce((n, w) => n + w.pays, 0);
    give(user.id, won);
    walletChanged(user.id);
    return { stops, grid, wins, won, wallet: walletView(user.id) };
  });

  // ---- cases

  const skins = new Map<string, Skin>(CASES.flatMap((c) => c.skins.map((s) => [s.id, s] as const)));
  type ItemRow = { id: number; skinId: string; float: number; stattrak: number; value: number; createdAt: number };
  const itemView = (r: ItemRow) => ({ ...r, stattrak: !!r.stattrak });
  function inventory(userId: number) {
    return (
      db
        .prepare('SELECT id, skin_id AS skinId, float, stattrak, value, created_at AS createdAt FROM casino_items WHERE user_id = ? ORDER BY id DESC')
        .all(userId) as ItemRow[]
    ).map(itemView);
  }

  type FoundRow = { skinId: string; count: number; bestFloat: number; stattrak: number; firstAt: number };
  /** The collection book: each skin someone has ever unboxed, how many times, and the best float they got. */
  function found(userId: number) {
    return (
      db
        .prepare('SELECT skin_id AS skinId, count, best_float AS bestFloat, stattrak, first_at AS firstAt FROM casino_found WHERE user_id = ?')
        .all(userId) as FoundRow[]
    ).map((r) => ({ ...r, stattrak: !!r.stattrak }));
  }

  /** Opens one case, or several at once (CASE_COUNTS); paid for together. */
  route('POST', '/api/casino/cases/:code/open', ({ user, params, body }) => {
    play(user);
    const box = CASES.find((c) => c.id === params[0]);
    if (!box) throw fail(404, 'That case isn\'t here');
    const n = body.count === undefined ? 1 : Number(body.count);
    if (!CASE_COUNTS.includes(n)) throw fail(400, `Open ${CASE_COUNTS.join(', ')} at a time`);
    const count = (db.prepare('SELECT COUNT(*) AS n FROM casino_items WHERE user_id = ?').get(user.id) as { n: number }).n;
    if (count + n > MAX_ITEMS) throw fail(400, count >= MAX_ITEMS ? `Your inventory is full (${MAX_ITEMS} items). Sell some first.` : `That won't fit: your inventory holds ${MAX_ITEMS} items. Sell some first.`);
    const items = inTransaction(db, () => {
      take(user.id, box.price * n);
      return Array.from({ length: n }, () => unbox(user.id, box));
    });
    walletChanged(user.id);
    return { item: items[0], items, wallet: walletView(user.id), found: found(user.id) };
  });

  /** One skin out of a case, into the inventory and the collection book. */
  function unbox(userId: number, box: (typeof CASES)[number]) {
    // Rarity first, at CS's odds, then any skin of that rarity, then how worn it is.
    let roll = randomInt(10_000);
    const rarity = (Object.keys(RARITY_ODDS) as Rarity[]).find((r) => (roll -= RARITY_ODDS[r]) < 0)!;
    const pool = box.skins.filter((s) => s.rarity === rarity);
    const skin = pool[randomInt(pool.length)];
    let wearRoll = randomInt(100);
    const wear = WEARS.find((w) => (wearRoll -= w.chance) < 0)!;
    const float = Math.round((wear.min + (randomInt(1_000_000) / 1_000_000) * (wear.max - wear.min)) * 1e6) / 1e6;
    const stattrak = skin.kind !== 'gloves' && randomInt(100) < STATTRAK_CHANCE;
    const value = Math.max(1, Math.round(skin.value * wear.value * (stattrak ? STATTRAK_VALUE : 1)));
    const createdAt = Date.now();
    const r = db
      .prepare('INSERT INTO casino_items (user_id, skin_id, float, stattrak, value, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, skin.id, float, stattrak ? 1 : 0, value, createdAt);
    db.prepare(
      `INSERT INTO casino_found (user_id, skin_id, count, best_float, stattrak, first_at) VALUES (?, ?, 1, ?, ?, ?)
       ON CONFLICT (user_id, skin_id) DO UPDATE SET count = count + 1, best_float = MIN(best_float, excluded.best_float), stattrak = MAX(stattrak, excluded.stattrak)`,
    ).run(userId, skin.id, float, stattrak ? 1 : 0, createdAt);
    return itemView({ id: Number(r.lastInsertRowid), skinId: skin.id, float, stattrak: stattrak ? 1 : 0, value, createdAt });
  }

  /** Sells items back for what they're worth. */
  route('POST', '/api/casino/items/sell', ({ user, body }) => {
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isInteger).slice(0, MAX_ITEMS) : [];
    if (!ids.length) throw fail(400, 'Pick something to sell');
    let got = 0;
    for (const id of ids) {
      const item = db.prepare('DELETE FROM casino_items WHERE id = ? AND user_id = ? RETURNING value').get(id, user.id) as { value: number } | undefined;
      if (item) got += item.value;
    }
    give(user.id, got);
    walletChanged(user.id);
    return { got, wallet: walletView(user.id) };
  });

  // ---- blackjack: six decks, dealer stands on soft 17, blackjack pays 3 to 2, double on any two
  // cards, split once (split aces get one card each).

  const cardValue = (c: Card) => (c[0] === 'A' ? 11 : 'TJQK'.includes(c[0]) ? 10 : Number(c[0]));
  const total = (cards: Card[]) => {
    let sum = cards.reduce((n, c) => n + cardValue(c), 0);
    let aces = cards.filter((c) => c[0] === 'A').length;
    while (sum > 21 && aces--) sum -= 10;
    return sum;
  };
  const softTotal = (cards: Card[]) => {
    // Soft: an ace still counts as 11.
    let sum = cards.reduce((n, c) => n + cardValue(c), 0);
    let aces = cards.filter((c) => c[0] === 'A').length;
    while (sum > 21 && aces) {
      sum -= 10;
      aces--;
    }
    return aces > 0 && sum <= 21;
  };
  const isNatural = (cards: Card[]) => cards.length === 2 && total(cards) === 21;
  function openBlackjack(w: Wallet): Blackjack | null {
    const game = w.blackjack ? (JSON.parse(w.blackjack) as Blackjack) : null;
    return game && !game.over ? game : null;
  }
  function blackjackView(w: Wallet) {
    const game = w.blackjack ? (JSON.parse(w.blackjack) as Blackjack) : null;
    if (!game) return null;
    const dealer = game.over ? game.dealer : [game.dealer[0], '??'];
    const hand = game.hands[game.active];
    return {
      dealer,
      dealerTotal: game.over ? total(game.dealer) : cardValue(game.dealer[0]),
      hands: game.hands.map((h) => ({ cards: h.cards, bet: h.bet, total: total(h.cards), soft: softTotal(h.cards), done: h.done, result: h.result, paid: h.paid })),
      active: game.active,
      over: game.over,
      can: game.over || !hand
        ? null
        : {
            double: hand.cards.length === 2 && !hand.splitAces,
            split: game.hands.length === 1 && hand.cards.length === 2 && cardValue(hand.cards[0]) === cardValue(hand.cards[1]),
          },
    };
  }
  const saveBlackjack = (userId: number, game: Blackjack) =>
    db.prepare('UPDATE casino_wallets SET blackjack = ? WHERE user_id = ?').run(JSON.stringify(game), userId);

  /** The dealer plays out their hand (unless every hand is bust), then the bets are paid. */
  const settle = (userId: number, game: Blackjack) => {
    const live = game.hands.some((h) => total(h.cards) <= 21);
    const dealerNatural = isNatural(game.dealer);
    if (live && !game.natural) while (total(game.dealer) < 17) game.dealer.push(game.deck.pop()!);
    const d = total(game.dealer);
    let paid = 0;
    for (const h of game.hands) {
      const p = total(h.cards);
      const natural = game.hands.length === 1 && isNatural(h.cards);
      if (p > 21) h.result = 'bust';
      else if (natural && !dealerNatural) h.result = 'blackjack';
      else if (dealerNatural && !natural) h.result = 'lose';
      else if (d > 21 || p > d) h.result = 'win';
      else if (p === d) h.result = 'push';
      else h.result = 'lose';
      h.paid = h.result === 'blackjack' ? Math.floor(h.bet * 2.5) : h.result === 'win' ? h.bet * 2 : h.result === 'push' ? h.bet : 0;
      paid += h.paid;
    }
    game.over = true;
    give(userId, paid);
  };
  const advance = (userId: number, game: Blackjack) => {
    for (const h of game.hands) if (!h.done && total(h.cards) >= 21) h.done = true;
    const next = game.hands.findIndex((h) => !h.done);
    if (next >= 0) game.active = next;
    else settle(userId, game);
  };

  route('POST', '/api/casino/blackjack', ({ user, body }) => {
    play(user);
    const w = wallet(user.id);
    let game = openBlackjack(w);
    if (body.action === 'deal') {
      if (game) throw fail(400, 'Finish this hand first');
      const bet = wholeChips(body.bet, 'A bet');
      if (bet < BLACKJACK_MIN || bet > BLACKJACK_MAX) throw fail(400, `Bets are ${BLACKJACK_MIN} to ${BLACKJACK_MAX.toLocaleString('en')} chips`);
      take(user.id, bet);
      const deck = ctx.deck?.() ?? shuffledDeck(6);
      const p = [deck.pop()!];
      const d = [deck.pop()!];
      p.push(deck.pop()!);
      d.push(deck.pop()!);
      game = { deck, dealer: d, hands: [{ cards: p, bet, done: false, doubled: false, splitAces: false, result: '', paid: 0 }], active: 0, over: false, natural: false };
      // A blackjack on either side ends it right away.
      if (isNatural(p) || isNatural(d)) {
        game.natural = true;
        game.hands[0].done = true;
        settle(user.id, game);
      }
    } else {
      if (!game) throw fail(400, 'Deal a hand first');
      const hand = game.hands[game.active];
      if (body.action === 'hit') {
        hand.cards.push(game.deck.pop()!);
        if (total(hand.cards) >= 21) hand.done = true;
      } else if (body.action === 'stand') {
        hand.done = true;
      } else if (body.action === 'double') {
        if (hand.cards.length !== 2 || hand.splitAces) throw fail(400, 'You can only double on your first two cards');
        take(user.id, hand.bet);
        hand.bet *= 2;
        hand.doubled = true;
        hand.cards.push(game.deck.pop()!);
        hand.done = true;
      } else if (body.action === 'split') {
        if (game.hands.length !== 1 || hand.cards.length !== 2 || cardValue(hand.cards[0]) !== cardValue(hand.cards[1]))
          throw fail(400, 'You can split two cards of the same value, once');
        take(user.id, hand.bet);
        const aces = hand.cards[0][0] === 'A';
        game.hands = hand.cards.map((c) => ({ cards: [c, game!.deck.pop()!], bet: hand.bet, done: aces, doubled: false, splitAces: aces, result: '', paid: 0 }));
        game.active = 0;
      } else throw fail(400, 'Hit, stand, double or split');
      advance(user.id, game);
    }
    saveBlackjack(user.id, game);
    walletChanged(user.id);
    return { blackjack: blackjackView(wallet(user.id)), wallet: walletView(user.id) };
  });

  // ---- Texas hold 'em: one table at each fire, for up to eight of the people sitting there

  const tables = new Map<number, PokerTable>(); // voice room id -> its table
  const watching = new Map<WebSocket, { userId: number; channelId: number }>();
  const offlineSince = new Map<number, number>();
  const outSince = new Map<number, number>();

  /** The fire someone is sitting at, which is the only one whose table they can play at. */
  const fireOf = (channelId: number, userId: number) => {
    const channel = ctx.channelById(channelId);
    if (!channel || channel.kind !== 'voice' || ctx.inVoice.get(userId) !== channelId) throw fail(400, 'Join the fire to play poker there');
    return channel;
  };
  const tableEvent = (channelId: number, userId: number) => {
    const t = tables.get(channelId);
    return { type: 'poker', channelId, table: t ? t.view(userId) : emptyTable() };
  };
  const emptyTable = () => ({
    handNo: 0, smallBlind: POKER.smallBlind, bigBlind: POKER.bigBlind, button: -1, board: [], street: null, done: true, pot: 0,
    currentBet: 0, toAct: -1, deadline: 0, winners: [], seats: Array(MAX_SEATS).fill(null), options: null, log: [],
  });
  /** Everyone at the fire, and everyone sitting at its table, sees the table as it is now. */
  const tableChanged = (channelId: number) => {
    const t = tables.get(channelId);
    const ids = new Set<number>(ctx.usersInVoice(channelId));
    for (const w of watching.values()) if (w.channelId === channelId) ids.add(w.userId);
    for (const s of t?.seats ?? []) if (s) ids.add(s.userId);
    for (const id of ids) ctx.sendTo([id], tableEvent(channelId, id));
  };
  const tableOf = (channelId: number) => {
    let t = tables.get(channelId);
    if (!t) {
      t = new PokerTable({
        smallBlind: POKER.smallBlind,
        bigBlind: POKER.bigBlind,
        ...timing,
        isOnline: ctx.isOnline,
        cashOut: (userId, chips) => {
          db.prepare('UPDATE casino_wallets SET chips = chips + ?, at_table = 0 WHERE user_id = ?').run(chips, userId);
          walletChanged(userId);
        },
        settled: (stacks) => {
          for (const s of stacks) db.prepare('UPDATE casino_wallets SET at_table = ? WHERE user_id = ?').run(s.stack, s.userId);
        },
        changed: () => tableChanged(channelId),
        deck: ctx.deck,
      });
      tables.set(channelId, t);
    }
    return t;
  };
  const atTable = (userId: number) => [...tables].find(([, t]) => t.seatOf(userId) >= 0)?.[0];
  /** The table's rules broke (it isn't your turn, the seat's taken, ...): a plain error for the app. */
  const tableRule = <T>(fn: () => T) => {
    try {
      return fn();
    } catch (err) {
      if (err instanceof Error && err.constructor === Error) throw fail(400, err.message);
      throw err;
    }
  };

  route('POST', '/api/channels/:id/poker', ({ user, params, body }) => {
    const channel = fireOf(Number(params[0]), user.id);
    const action = String(body.action);
    if (action === 'sit') {
      const other = atTable(user.id);
      if (other !== undefined) throw fail(400, other === channel.id ? "You're already at this table" : "You're already at a table at another fire");
      const chips = wholeChips(body.buyIn, 'A buy-in');
      if (chips < POKER.minBuyIn || chips > POKER.maxBuyIn) throw fail(400, `Buy in for ${POKER.minBuyIn} to ${POKER.maxBuyIn} chips`);
      const seat = Number(body.seat);
      const t = tableOf(channel.id);
      if (!Number.isInteger(seat) || seat < 0 || seat >= MAX_SEATS || t.seats[seat]) throw fail(400, 'That seat is taken');
      take(user.id, chips);
      try {
        tableRule(() => t.sit(user.id, seat, chips));
      } catch (err) {
        give(user.id, chips);
        throw err;
      }
      walletChanged(user.id);
    } else if (action === 'stand') {
      tables.get(channel.id)?.stand(user.id);
    } else if (action === 'add') {
      const t = tables.get(channel.id);
      const s = t?.seats[t.seatOf(user.id)];
      if (!t || !s) throw fail(400, "You aren't at this table");
      const chips = wholeChips(body.chips, 'Chips');
      if (s.stack + chips > POKER.maxBuyIn) throw fail(400, `You can have up to ${POKER.maxBuyIn} chips at the table`);
      if (t.hand && !t.hand.done && s.inHand) throw fail(400, 'Wait for this hand to finish');
      take(user.id, chips);
      tableRule(() => t.addChips(user.id, chips));
      walletChanged(user.id);
    } else if (action === 'sitout' || action === 'back') {
      const t = tables.get(channel.id);
      if (!t) throw fail(400, "You aren't at this table");
      tableRule(() => t.setSittingOut(user.id, action === 'sitout'));
    } else if (['fold', 'check', 'call', 'raise', 'allin'].includes(action)) {
      const t = tables.get(channel.id);
      if (!t) throw fail(400, 'No hand going');
      tableRule(() => t.act(user.id, { action: action as Action['action'], to: Number(body.to) }));
    } else throw fail(400, 'Unknown move');
    return { ok: true };
  });

  // Every few seconds: people who left the fire, went offline or sat out for long get up, and tables
  // at fires that are gone close with everyone's chips going back.
  const sweep = () => {
    const now = Date.now();
    for (const [channelId, t] of tables) {
      const channel = ctx.channelById(channelId);
      if (channel?.kind !== 'voice') {
        t.close();
        tables.delete(channelId);
        continue;
      }
      for (const s of t.seats) {
        if (!s) continue;
        const online = ctx.isOnline(s.userId);
        if (online) offlineSince.delete(s.userId);
        else if (!offlineSince.has(s.userId)) offlineSince.set(s.userId, now);
        if (!s.sittingOut) outSince.delete(s.userId);
        else if (!outSince.has(s.userId)) outSince.set(s.userId, now);
        const gone = ctx.inVoice.get(s.userId) !== channelId;
        if (gone || now - (offlineSince.get(s.userId) ?? now) >= AWAY_STAND_MS || now - (outSince.get(s.userId) ?? now) >= SITTING_OUT_STAND_MS) {
          offlineSince.delete(s.userId);
          outSince.delete(s.userId);
          t.stand(s.userId);
        }
      }
      if (t.empty) tables.delete(channelId);
    }
  };
  const sweeper = setInterval(sweep, 15_000);
  sweeper.unref();

  return {
    /** The app is showing the casino at a fire (or stopped showing it): it hears about that fire's table. */
    watch(ws: WebSocket, userId: number, channelId: number | null) {
      watching.delete(ws);
      if (channelId === null) return;
      fireOf(channelId, userId);
      watching.set(ws, { userId, channelId });
      ctx.sendTo([userId], tableEvent(channelId, userId));
    },
    closed(ws: WebSocket) {
      watching.delete(ws);
    },
    /** Someone left a fire, so they get up from its table (after the hand, if they're in one). */
    left(channelId: number, userId: number) {
      for (const [ws, w] of watching) if (w.userId === userId && w.channelId === channelId) watching.delete(ws);
      tables.get(channelId)?.stand(userId);
    },
    sweep,
    stop() {
      clearInterval(sweeper);
      for (const t of tables.values()) t.stopTimers();
    },
  };
}
