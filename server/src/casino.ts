// The casino, in the games at the fire: Texas hold 'em (one table at each fire), blackjack, a slot
// machine and CS-style cases. Everything is played with chips, and chips are play money only: everyone
// starts with some, gets more for free every day, and they can't be bought or cashed out. Each hearth is its
// own casino: chips, skins and pets in one can't be used in another. The server deals, spins and opens
// everything, so nobody's app decides what it wins.
import { randomInt } from 'node:crypto';
import type { WebSocket } from 'ws';
import { inTransaction, type Db } from './db.ts';
import { allowance, type Json } from './http.ts';
import { PokerTable, MAX_SEATS, shuffledDeck, type Action, type Card } from './poker.ts';
import {
  CASES, PETS, RARITY_ODDS, SLOT_BETS, SLOT_LINES, SLOT_PAYS, SLOT_STRIPS, SLOT_TWO_CHERRIES, STATTRAK_CHANCE, STATTRAK_VALUE, WEARS,
  linePays, type Rarity, type Skin,
} from './casino-items.ts';

export const START_CHIPS = 10_000;
const DAILY_CHIPS = 1000;
const DAILY_MS = 20 * 3600_000;
const BROKE_CHIPS = 500; // when you're nearly out, you don't have to wait a whole day
const BROKE_BELOW = 100;
const BROKE_MS = 3600_000;
const MAX_ITEMS = 500;
const FLOAT_STEPS = 2 ** 47; // randomInt takes ranges up to 2^48
/** How many cases can be opened at once. */
const CASE_COUNTS = [1, 2, 5, 10, 20];
const BLACKJACK_MIN = 10;
const BLACKJACK_MAX = 10_000;
export const POKER = { smallBlind: 10, bigBlind: 20, minBuyIn: 400, maxBuyIn: 4000 };
const AWAY_STAND_MS = 2 * 60_000; // offline this long at a table, and you get up (with your chips)
const SITTING_OUT_STAND_MS = 10 * 60_000;
export const BATTLE_MAX_ROUNDS = 10;
const BATTLE_ROUND_MS = 5_500; // how long each round's reels take in the app
const BATTLE_KEEP_MS = 3 * 60_000; // a finished battle stays on the list this long
/** Trade up: this many skins of one rarity make one of the next rarity, from one of their cases. */
export const TRADE_UP_COUNT = 5;
const TRADE_UP_NEXT: Partial<Record<Rarity, Rarity>> = { milspec: 'restricted', restricted: 'classified', classified: 'covert', covert: 'rare' };
/** Upgrader: put up to this many skins on a better one; the chance is their worth over its, a little under. */
export const UPGRADE_MAX_ITEMS = 10;
const UPGRADE_EDGE = 0.92;
const UPGRADE_MAX_CHANCE = 0.8;
const PULLS_KEEP_MS = 3 * 24 * 3600_000; // the day's top pulls only need today, wherever today is

type Box = (typeof CASES)[number];
type Channel = { id: number; serverId: number; kind: string };
type User = { id: number };
type Handler = (ctx: { user: User; params: string[]; body: Json; url: URL }) => unknown;

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
  timing?: { turnMs: number; awayTurnMs: number; pauseMs: number; dealMs: number; battleRoundMs?: number };
  deck?: () => Card[];
}

type Wallet = { chips: number; atTable: number; inBattle: number; blackjack: string | null; freeAt: number };
type BjHand = { cards: Card[]; bet: number; done: boolean; doubled: boolean; splitAces: boolean; result: string; paid: number };
type Blackjack = { deck: Card[]; dealer: Card[]; hands: BjHand[]; active: number; over: boolean; natural: boolean };

export function casino(ctx: CasinoContext) {
  const { db, route, fail } = ctx;
  const timing = ctx.timing ?? { turnMs: 30_000, awayTurnMs: 6_000, pauseMs: 5_000, dealMs: 1_200 };

  // Chips left at a table when the server stopped go back to their wallets.
  db.prepare('UPDATE casino_wallets SET chips = chips + at_table, at_table = 0 WHERE at_table > 0').run();
  db.prepare('UPDATE casino_wallets SET chips = chips + in_battle, in_battle = 0 WHERE in_battle > 0').run();

  // ---- the wallet

  // Everything below is per person *in a hearth* (h, the hearth's id): chips, skins and the
  // collection book in one hearth can't be used in another, and every hearth starts you fresh.
  const wallet = (userId: number, h: number): Wallet => {
    db.prepare('INSERT OR IGNORE INTO casino_wallets (user_id, server_id, chips, created_at) VALUES (?, ?, ?, ?)').run(userId, h, START_CHIPS, Date.now());
    return db
      .prepare('SELECT chips, at_table AS atTable, in_battle AS inBattle, blackjack, free_at AS freeAt FROM casino_wallets WHERE user_id = ? AND server_id = ?')
      .get(userId, h) as Wallet;
  };
  /** When the next free chips come, and how many. */
  const freeChips = (w: Wallet) => {
    const daily = w.freeAt + DAILY_MS;
    if (w.chips + w.atTable + w.inBattle < BROKE_BELOW && !openBlackjack(w)) {
      const broke = w.freeAt + BROKE_MS;
      if (broke < daily) return { at: broke, amount: Date.now() >= daily ? DAILY_CHIPS : BROKE_CHIPS };
    }
    return { at: daily, amount: DAILY_CHIPS };
  };
  const walletView = (userId: number, h: number) => {
    const w = wallet(userId, h);
    const free = freeChips(w);
    return { chips: w.chips, atTable: w.atTable, inBattle: w.inBattle, freeAt: free.at <= Date.now() ? 0 : free.at, freeAmount: free.amount };
  };
  const walletChanged = (userId: number, h: number) => ctx.sendTo([userId], { type: 'casino_wallet', serverId: h, wallet: walletView(userId, h) });
  /** Takes chips for a bet, or says there aren't enough. */
  const take = (userId: number, h: number, chips: number) => {
    wallet(userId, h);
    const r = db.prepare('UPDATE casino_wallets SET chips = chips - ? WHERE user_id = ? AND server_id = ? AND chips >= ?').run(chips, userId, h, chips);
    if (!r.changes) throw fail(400, "You don't have enough chips");
  };
  const give = (userId: number, h: number, chips: number) => {
    if (chips > 0) db.prepare('UPDATE casino_wallets SET chips = chips + ? WHERE user_id = ? AND server_id = ?').run(chips, userId, h);
  };
  const plays = allowance(30, 10);
  const play = (user: User) => {
    if (!plays.take(user.id)) throw fail(429, 'Slow down a little');
  };
  /** The hearth whose casino this is: you have to be in it. */
  const hearth = (id: string, userId: number) => {
    const h = Number(id);
    if (!ctx.isMember(h, userId)) throw fail(404, 'Hearth not found');
    return h;
  };
  const wholeChips = (value: unknown, what: string) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) throw fail(400, `${what} has to be a whole number of chips`);
    return n;
  };

  route('GET', '/api/servers/:id/casino', ({ user, params }) => {
    const h = hearth(params[0], user.id);
    return {
      serverId: h,
      wallet: walletView(user.id, h),
      blackjack: blackjackView(wallet(user.id, h)),
      cases: CASES,
      rarityOdds: RARITY_ODDS,
      wears: WEARS,
      slots: { strips: SLOT_STRIPS, lines: SLOT_LINES, pays: SLOT_PAYS, twoCherries: SLOT_TWO_CHERRIES, bets: SLOT_BETS },
      poker: POKER,
      caseCounts: CASE_COUNTS,
      tradeUp: { count: TRADE_UP_COUNT, next: TRADE_UP_NEXT },
      upgrade: { maxItems: UPGRADE_MAX_ITEMS, edge: UPGRADE_EDGE, maxChance: UPGRADE_MAX_CHANCE },
      inventory: inventory(user.id, h),
      found: found(user.id, h),
      ...petsView(user.id, h),
    };
  });

  route('POST', '/api/servers/:id/casino/free', ({ user, params }) => {
    const h = hearth(params[0], user.id);
    const w = wallet(user.id, h);
    const free = freeChips(w);
    if (free.at > Date.now()) throw fail(400, 'Your free chips aren\'t ready yet');
    db.prepare('UPDATE casino_wallets SET chips = chips + ?, free_at = ? WHERE user_id = ? AND server_id = ?').run(free.amount, Date.now(), user.id, h);
    walletChanged(user.id, h);
    return { wallet: walletView(user.id, h), got: free.amount };
  });

  route('GET', '/api/servers/:id/casino/leaders', ({ user, params }) => {
    const h = hearth(params[0], user.id);
    const ids = ctx.serverMemberIds(h);
    if (!ids.length) return [];
    return db
      .prepare(
        `SELECT w.user_id AS userId, w.chips + w.at_table + w.in_battle AS chips,
           COALESCE((SELECT SUM(value) FROM casino_items i WHERE i.user_id = w.user_id AND i.server_id = w.server_id), 0) AS items
         FROM casino_wallets w WHERE w.server_id = ? AND w.user_id IN (${ids.map(() => '?').join(',')})
         ORDER BY chips + items DESC LIMIT 10`,
      )
      .all(h, ...ids);
  });

  /** The lowest floats anyone in the hearth has unboxed, best per skin, like a CS float list. */
  route('GET', '/api/servers/:id/casino/floats', ({ user, params }) => {
    const h = hearth(params[0], user.id);
    const ids = ctx.serverMemberIds(h);
    if (!ids.length) return [];
    return db
      .prepare(
        `SELECT user_id AS userId, skin_id AS skinId, best_float AS float FROM casino_found
         WHERE server_id = ? AND user_id IN (${ids.map(() => '?').join(',')})
         ORDER BY best_float ASC LIMIT 10`,
      )
      .all(h, ...ids);
  });

  // ---- slots

  route('POST', '/api/servers/:id/casino/slots', ({ user, params, body }) => {
    const h = hearth(params[0], user.id);
    play(user);
    const bet = Number(body.bet);
    if (!SLOT_BETS.includes(bet)) throw fail(400, 'Pick one of the bets on the machine');
    take(user.id, h, bet);
    const stops = SLOT_STRIPS.map((strip) => randomInt(strip.length));
    const grid = stops.map((stop, r) => [0, 1, 2].map((row) => SLOT_STRIPS[r][(stop + row) % SLOT_STRIPS[r].length]));
    const wins = SLOT_LINES.flatMap((rows, line) => {
      const pays = linePays(rows.map((row, r) => grid[r][row]));
      return pays ? [{ line, pays: Math.floor(pays * bet) }] : [];
    });
    const won = wins.reduce((n, w) => n + w.pays, 0);
    give(user.id, h, won);
    walletChanged(user.id, h);
    return { stops, grid, wins, won, wallet: walletView(user.id, h) };
  });

  // ---- cases

  const skins = new Map<string, Skin>(CASES.flatMap((c) => c.skins.map((s) => [s.id, s] as const)));
  type ItemRow = { id: number; skinId: string; float: number; stattrak: number; value: number; createdAt: number; locked?: number };
  const itemView = (r: ItemRow) => ({ ...r, stattrak: !!r.stattrak, locked: !!r.locked });
  function inventory(userId: number, h: number) {
    return (
      db
        .prepare('SELECT id, skin_id AS skinId, float, stattrak, value, created_at AS createdAt, locked FROM casino_items WHERE user_id = ? AND server_id = ? ORDER BY id DESC')
        .all(userId, h) as ItemRow[]
    ).map(itemView);
  }

  type FoundRow = { skinId: string; count: number; bestFloat: number; stattrak: number; firstAt: number };
  /** The collection book: each skin someone has ever unboxed, how many times, and the best float they got. */
  function found(userId: number, h: number) {
    return (
      db
        .prepare('SELECT skin_id AS skinId, count, best_float AS bestFloat, stattrak, first_at AS firstAt FROM casino_found WHERE user_id = ? AND server_id = ?')
        .all(userId, h) as FoundRow[]
    ).map((r) => ({ ...r, stattrak: !!r.stattrak }));
  }

  /** Opens one case, or several at once (CASE_COUNTS); paid for together. */
  route('POST', '/api/servers/:id/casino/cases/:code/open', ({ user, params, body }) => {
    const h = hearth(params[0], user.id);
    play(user);
    const box = CASES.find((c) => c.id === params[1]);
    if (!box) throw fail(404, 'That case isn\'t here');
    const n = body.count === undefined ? 1 : Number(body.count);
    if (!CASE_COUNTS.includes(n)) throw fail(400, `Open ${CASE_COUNTS.join(', ')} at a time`);
    const count = (db.prepare('SELECT COUNT(*) AS n FROM casino_items WHERE user_id = ? AND server_id = ?').get(user.id, h) as { n: number }).n;
    if (count + n > MAX_ITEMS) throw fail(400, count >= MAX_ITEMS ? `Your inventory is full (${MAX_ITEMS} items). Sell some first.` : `That won't fit: your inventory holds ${MAX_ITEMS} items. Sell some first.`);
    const items = inTransaction(db, () => {
      take(user.id, h, box.price * n);
      return Array.from({ length: n }, () => unbox(user.id, h, box));
    });
    walletChanged(user.id, h);
    return { item: items[0], items, wallet: walletView(user.id, h), found: found(user.id, h) };
  });

  /** One skin out of a case, into the inventory and the collection book. */
  const unbox = (userId: number, h: number, box: Box) => {
    const roll = rollCase(box);
    pulled(userId, h, roll);
    return keep(userId, h, roll, true);
  };
  /** For the day's top pulls. */
  const pulled = (userId: number, h: number, r: Roll) =>
    db.prepare('INSERT INTO casino_pulls (server_id, user_id, skin_id, float, stattrak, value, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(h, userId, r.skinId, r.float, r.stattrak ? 1 : 0, r.value, Date.now());

  /** The best skins out of cases in this hearth since `since` (the start of the asker's day), most valuable first. */
  route('GET', '/api/servers/:id/casino/pulls', ({ user, params, url }) => {
    const h = hearth(params[0], user.id);
    const since = Math.max(Number(url.searchParams.get('since')) || 0, Date.now() - 36 * 3600_000);
    return db
      .prepare(
        `SELECT user_id AS userId, skin_id AS skinId, float, stattrak, value, at FROM casino_pulls
         WHERE server_id = ? AND at >= ? ORDER BY value DESC, at LIMIT 10`,
      )
      .all(h, since)
      .map((r) => ({ ...(r as Json), stattrak: !!(r as { stattrak: number }).stattrak }));
  });

  type Roll = { skinId: string; float: number; stattrak: boolean; value: number };
  /** What a case gives, before it goes to anyone. */
  function rollCase(box: Box): Roll {
    // Rarity first, at CS's odds, then any skin of that rarity, then how worn it is.
    let roll = randomInt(10_000);
    const rarity = (Object.keys(RARITY_ODDS) as Rarity[]).find((r) => (roll -= RARITY_ODDS[r]) < 0)!;
    const pool = box.skins.filter((s) => s.rarity === rarity);
    const skin = pool[randomInt(pool.length)];
    let wearRoll = randomInt(100);
    const wear = WEARS.find((w) => (wearRoll -= w.chance) < 0)!;
    // The float to full precision, like CS: two skins almost never share one.
    const float = wear.min + (randomInt(FLOAT_STEPS) / FLOAT_STEPS) * (wear.max - wear.min);
    const stattrak = skin.kind !== 'gloves' && randomInt(100) < STATTRAK_CHANCE;
    const value = Math.max(1, Math.round(skin.value * wear.value * (stattrak ? STATTRAK_VALUE : 1)));
    return { skinId: skin.id, float, stattrak, value };
  }
  /** A skin into someone's inventory; into their collection book too if they opened it. */
  function keep(userId: number, h: number, { skinId, float, stattrak, value }: Roll, opened: boolean) {
    const createdAt = Date.now();
    const r = db
      .prepare('INSERT INTO casino_items (user_id, server_id, skin_id, float, stattrak, value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(userId, h, skinId, float, stattrak ? 1 : 0, value, createdAt);
    if (opened) found1(userId, h, { skinId, float, stattrak });
    return itemView({ id: Number(r.lastInsertRowid), skinId, float, stattrak: stattrak ? 1 : 0, value, createdAt });
  }
  /** Into the collection book. */
  function found1(userId: number, h: number, { skinId, float, stattrak }: { skinId: string; float: number; stattrak: boolean }) {
    db.prepare(
      `INSERT INTO casino_found (user_id, server_id, skin_id, count, best_float, stattrak, first_at) VALUES (?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT (user_id, server_id, skin_id) DO UPDATE SET count = count + 1, best_float = MIN(best_float, excluded.best_float), stattrak = MAX(stattrak, excluded.stattrak)`,
    ).run(userId, h, skinId, float, stattrak ? 1 : 0, Date.now());
  }

  /** Sells items back for what they're worth. */
  route('POST', '/api/servers/:id/casino/items/sell', ({ user, params, body }) => {
    const h = hearth(params[0], user.id);
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isInteger).slice(0, MAX_ITEMS) : [];
    if (!ids.length) throw fail(400, 'Pick something to sell');
    let got = 0;
    for (const id of ids) {
      const item = db
        .prepare('DELETE FROM casino_items WHERE id = ? AND user_id = ? AND server_id = ? AND locked = 0 RETURNING value')
        .get(id, user.id, h) as { value: number } | undefined;
      if (item) got += item.value;
    }
    give(user.id, h, got);
    walletChanged(user.id, h);
    return { got, wallet: walletView(user.id, h) };
  });

  /** Locks skins so they can't be sold (or traded up, or put on an upgrade) by accident, or unlocks them. */
  route('POST', '/api/servers/:id/casino/items/lock', ({ user, params, body }) => {
    const h = hearth(params[0], user.id);
    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isInteger).slice(0, MAX_ITEMS) : [];
    if (!ids.length) throw fail(400, 'Pick something to lock');
    const locked = body.locked === false ? 0 : 1;
    const set = db.prepare('UPDATE casino_items SET locked = ? WHERE id = ? AND user_id = ? AND server_id = ?');
    inTransaction(db, () => { for (const id of ids) set.run(locked, id, user.id, h); });
    return { ids, locked: !!locked };
  });

  /** Takes skins out of someone's inventory for a trade up or an upgrade: theirs, here, and not locked. */
  const spend = (userId: number, h: number, ids: number[]) => {
    const rows = ids.map((id) => db
      .prepare('SELECT id, skin_id AS skinId, float, stattrak, value, created_at AS createdAt, locked FROM casino_items WHERE id = ? AND user_id = ? AND server_id = ?')
      .get(id, userId, h) as ItemRow | undefined);
    if (rows.some((r) => !r)) throw fail(400, "Some of those skins aren't in your inventory any more");
    if (rows.some((r) => r!.locked)) throw fail(400, 'Unlock those skins first');
    for (const id of ids) db.prepare('DELETE FROM casino_items WHERE id = ?').run(id);
    return rows as ItemRow[];
  };
  const pickIds = (value: unknown, max: number) => {
    const ids = Array.isArray(value) ? [...new Set(value.map(Number).filter(Number.isInteger))] : [];
    if (ids.length > max) throw fail(400, `At most ${max} skins`);
    return ids;
  };
  const wearValue = (float: number) => (WEARS.find((w) => float < w.max) ?? WEARS[WEARS.length - 1]).value;
  const rollFloat = (min: number, max: number) => min + (randomInt(FLOAT_STEPS) / FLOAT_STEPS) * (max - min);

  /**
   * Trade up, like CS's contract: TRADE_UP_COUNT skins of one rarity for one of the next, from the case
   * of one of them (picked at random, so more from one case means better odds of that case). The new
   * skin's float is the average of theirs, and it's StatTrak if they all were.
   */
  route('POST', '/api/servers/:id/casino/tradeup', ({ user, params, body }) => {
    const h = hearth(params[0], user.id);
    play(user);
    const ids = pickIds(body.ids, TRADE_UP_COUNT);
    if (ids.length !== TRADE_UP_COUNT) throw fail(400, `A trade up takes ${TRADE_UP_COUNT} skins`);
    const item = inTransaction(db, () => {
      const given = spend(user.id, h, ids);
      const rarities = new Set(given.map((g) => skins.get(g.skinId)?.rarity));
      if (rarities.size !== 1) throw fail(400, 'The skins in a trade up have to be the same rarity');
      const next = TRADE_UP_NEXT[[...rarities][0]!];
      if (!next) throw fail(400, "Knives and gloves can't be traded up");
      const stattraks = new Set(given.map((g) => !!g.stattrak));
      if (stattraks.size !== 1) throw fail(400, "StatTrak™ and normal skins can't go in the same trade up");
      const from = given[randomInt(given.length)];
      const box = CASES.find((c) => c.skins.some((x) => x.id === from.skinId))!;
      const pool = box.skins.filter((x) => x.rarity === next);
      const skin = pool[randomInt(pool.length)];
      const float = given.reduce((n, g) => n + g.float, 0) / given.length;
      const stattrak = given[0].stattrak === 1 && skin.kind !== 'gloves';
      const value = Math.max(1, Math.round(skin.value * wearValue(float) * (stattrak ? STATTRAK_VALUE : 1)));
      return keep(user.id, h, { skinId: skin.id, float, stattrak, value }, true);
    });
    return { item, gave: ids, found: found(user.id, h) };
  });

  /**
   * Upgrader: put skins on a better one. The chance is what they're worth over what it's worth (times
   * UPGRADE_EDGE, at most UPGRADE_MAX_CHANCE). Win and it's yours, with a float in its wear; lose and they're gone.
   */
  route('POST', '/api/servers/:id/casino/upgrade', ({ user, params, body }) => {
    const h = hearth(params[0], user.id);
    play(user);
    const ids = pickIds(body.ids, UPGRADE_MAX_ITEMS);
    if (!ids.length) throw fail(400, 'Pick skins to put on it');
    const skin = skins.get(String(body.skinId));
    const wear = WEARS.find((w) => w.short === body.wear);
    if (!skin || !wear) throw fail(400, 'Pick a skin to go for');
    const stattrak = body.stattrak === true;
    if (stattrak && skin.kind === 'gloves') throw fail(400, "Gloves don't come in StatTrak™");
    const target = Math.max(1, Math.round(skin.value * wear.value * (stattrak ? STATTRAK_VALUE : 1)));
    const result = inTransaction(db, () => {
      const given = spend(user.id, h, ids);
      const put = given.reduce((n, g) => n + g.value, 0);
      if (put >= target) throw fail(400, 'Go for something worth more than what you put on');
      const chance = Math.min(UPGRADE_MAX_CHANCE, (put / target) * UPGRADE_EDGE);
      const roll = randomInt(1_000_000) / 1_000_000;
      const won = roll < chance;
      const item = won ? keep(user.id, h, { skinId: skin.id, float: rollFloat(wear.min, wear.max), stattrak, value: target }, true) : null;
      return { won, chance, roll, item };
    });
    return { ...result, gave: ids, found: found(user.id, h) };
  });

  // ---- premium pets: bought with chips, one by your seat at a time, at this hearth's fires

  const petsView = (userId: number, h: number) => ({
    pets: PETS,
    myPets: (db.prepare('SELECT pet_id AS id FROM casino_pets WHERE user_id = ? AND server_id = ?').all(userId, h) as { id: string }[]).map((r) => r.id),
    pet: (db.prepare('SELECT pet FROM casino_wallets WHERE user_id = ? AND server_id = ?').get(userId, h) as { pet: string | null } | undefined)?.pet ?? null,
  });
  /** Everyone in the hearth sees the pet by someone's seat change. */
  const petChanged = (userId: number, h: number, pet: string | null) =>
    ctx.sendTo(ctx.serverMemberIds(h), { type: 'casino_pet', serverId: h, userId, pet });

  route('POST', '/api/servers/:id/casino/pets/:code', ({ user, params }) => {
    const h = hearth(params[0], user.id);
    play(user);
    const pet = PETS.find((p) => p.id === params[1]);
    if (!pet) throw fail(404, 'No such pet');
    inTransaction(db, () => {
      if (db.prepare('SELECT 1 FROM casino_pets WHERE user_id = ? AND server_id = ? AND pet_id = ?').get(user.id, h, pet.id)) throw fail(400, 'You already have that one');
      take(user.id, h, pet.price);
      db.prepare('INSERT INTO casino_pets (user_id, server_id, pet_id, bought_at) VALUES (?, ?, ?, ?)').run(user.id, h, pet.id, Date.now());
      db.prepare('UPDATE casino_wallets SET pet = ? WHERE user_id = ? AND server_id = ?').run(pet.id, user.id, h);
    });
    walletChanged(user.id, h);
    petChanged(user.id, h, pet.id);
    return { wallet: walletView(user.id, h), ...petsView(user.id, h) };
  });

  /** Which of your pets sits by your seat here, or none. */
  route('PUT', '/api/servers/:id/casino/pet', ({ user, params, body }) => {
    const h = hearth(params[0], user.id);
    const id = typeof body.pet === 'string' ? body.pet : null;
    if (id !== null && !db.prepare('SELECT 1 FROM casino_pets WHERE user_id = ? AND server_id = ? AND pet_id = ?').get(user.id, h, id)) throw fail(400, "That pet isn't yours");
    wallet(user.id, h);
    db.prepare('UPDATE casino_wallets SET pet = ? WHERE user_id = ? AND server_id = ?').run(id, user.id, h);
    petChanged(user.id, h, id);
    return petsView(user.id, h);
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
  const saveBlackjack = (userId: number, h: number, game: Blackjack) =>
    db.prepare('UPDATE casino_wallets SET blackjack = ? WHERE user_id = ? AND server_id = ?').run(JSON.stringify(game), userId, h);

  /** The dealer plays out their hand (unless every hand is bust), then the bets are paid. */
  const settle = (userId: number, h: number, game: Blackjack) => {
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
    give(userId, h, paid);
  };
  const advance = (userId: number, h: number, game: Blackjack) => {
    for (const h of game.hands) if (!h.done && total(h.cards) >= 21) h.done = true;
    const next = game.hands.findIndex((h) => !h.done);
    if (next >= 0) game.active = next;
    else settle(userId, h, game);
  };

  route('POST', '/api/servers/:id/casino/blackjack', ({ user, params, body }) => {
    const h = hearth(params[0], user.id);
    play(user);
    const w = wallet(user.id, h);
    let game = openBlackjack(w);
    if (body.action === 'deal') {
      if (game) throw fail(400, 'Finish this hand first');
      const bet = wholeChips(body.bet, 'A bet');
      if (bet < BLACKJACK_MIN || bet > BLACKJACK_MAX) throw fail(400, `Bets are ${BLACKJACK_MIN} to ${BLACKJACK_MAX.toLocaleString('en')} chips`);
      take(user.id, h, bet);
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
        settle(user.id, h, game);
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
        take(user.id, h, hand.bet);
        hand.bet *= 2;
        hand.doubled = true;
        hand.cards.push(game.deck.pop()!);
        hand.done = true;
      } else if (body.action === 'split') {
        if (game.hands.length !== 1 || hand.cards.length !== 2 || cardValue(hand.cards[0]) !== cardValue(hand.cards[1]))
          throw fail(400, 'You can split two cards of the same value, once');
        take(user.id, h, hand.bet);
        const aces = hand.cards[0][0] === 'A';
        game.hands = hand.cards.map((c) => ({ cards: [c, game!.deck.pop()!], bet: hand.bet, done: aces, doubled: false, splitAces: aces, result: '', paid: 0 }));
        game.active = 0;
      } else throw fail(400, 'Hit, stand, double or split');
      advance(user.id, h, game);
    }
    saveBlackjack(user.id, h, game);
    walletChanged(user.id, h);
    return { blackjack: blackjackView(wallet(user.id, h)), wallet: walletView(user.id, h) };
  });

  // ---- Texas hold 'em: one table at each fire, for up to eight of the people sitting there

  const tables = new Map<number, PokerTable>(); // voice room id -> its table
  const watching = new Map<WebSocket, { userId: number; channelId: number }>();
  const offlineSince = new Map<number, number>();
  const outSince = new Map<number, number>();

  /** The fire someone is sitting at, which is the only one whose table they can play at. */
  const fireOf = (channelId: number, userId: number, what: 'poker' | 'battle' = 'poker') => {
    const channel = ctx.channelById(channelId);
    if (!channel || channel.kind !== 'voice' || ctx.inVoice.get(userId) !== channelId)
      throw fail(400, what === 'poker' ? 'Join the fire to play poker there' : 'Join the fire to battle there');
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
      const h = ctx.channelById(channelId)!.serverId;
      t = new PokerTable({
        smallBlind: POKER.smallBlind,
        bigBlind: POKER.bigBlind,
        ...timing,
        isOnline: ctx.isOnline,
        cashOut: (userId, chips) => {
          db.prepare('UPDATE casino_wallets SET chips = chips + ?, at_table = 0 WHERE user_id = ? AND server_id = ?').run(chips, userId, h);
          walletChanged(userId, h);
        },
        settled: (stacks) => {
          for (const s of stacks) db.prepare('UPDATE casino_wallets SET at_table = ? WHERE user_id = ? AND server_id = ?').run(s.stack, s.userId, h);
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
      take(user.id, channel.serverId, chips);
      try {
        tableRule(() => t.sit(user.id, seat, chips));
      } catch (err) {
        give(user.id, channel.serverId, chips);
        throw err;
      }
      walletChanged(user.id, channel.serverId);
    } else if (action === 'stand') {
      tables.get(channel.id)?.stand(user.id);
    } else if (action === 'add') {
      const t = tables.get(channel.id);
      const s = t?.seats[t.seatOf(user.id)];
      if (!t || !s) throw fail(400, "You aren't at this table");
      const chips = wholeChips(body.chips, 'Chips');
      if (s.stack + chips > POKER.maxBuyIn) throw fail(400, `You can have up to ${POKER.maxBuyIn} chips at the table`);
      if (t.hand && !t.hand.done && s.inHand) throw fail(400, 'Wait for this hand to finish');
      take(user.id, channel.serverId, chips);
      tableRule(() => t.addChips(user.id, chips));
      walletChanged(user.id, channel.serverId);
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


  // ---- case battles: two to four people at a fire open the same cases, round by round. Free for
  // all, the highest total takes every skin; in 2v2 (seats 0-1 against 2-3) the higher team's
  // total wins and its players split everything. Empty seats can take a bot, which pays nothing
  // and keeps nothing: if only bots win, everyone keeps what they opened themselves.

  type BattleSeat = { userId: number | null; bot: string | null; rolls: Roll[] };
  type Battle = {
    id: number; channelId: number; serverId: number; mode: 'ffa' | '2v2'; cases: string[]; cost: number; creator: number;
    seats: (BattleSeat | null)[]; startedAt: number; winners: number[]; won: Record<number, number>; createdAt: number;
    /** Only bots won, so everyone kept their own pulls. */
    kept?: boolean;
  };
  const battles = new Map<number, Battle>();
  let battleIds = 0;
  const BOTS = ['Ember Bot', 'Cinder Bot', 'Spark Bot', 'Ash Bot'];
  const battleRoundMs = ctx.timing?.battleRoundMs ?? BATTLE_ROUND_MS;

  const battleView = (b: Battle) => {
    const elapsed = b.startedAt ? Date.now() - b.startedAt : 0;
    return {
      id: b.id, mode: b.mode, cases: b.cases, cost: b.cost, creator: b.creator, createdAt: b.createdAt,
      seats: b.seats.map((s) => s && { userId: s.userId, bot: s.bot, rolls: b.startedAt ? s.rolls : [] }),
      started: !!b.startedAt, elapsed, roundMs: battleRoundMs,
      done: !!b.startedAt && elapsed >= b.cases.length * battleRoundMs,
      winners: b.winners, won: b.won, kept: !!b.kept,
    };
  };
  const battlesAt = (channelId: number) =>
    [...battles.values()].filter((b) => b.channelId === channelId).sort((a, b) => b.id - a.id).map(battleView);
  /** Everyone at the fire, and everyone looking at its casino, sees its battles as they are now. */
  const battlesChanged = (channelId: number) => {
    const ids = new Set<number>(ctx.usersInVoice(channelId));
    for (const w of watching.values()) if (w.channelId === channelId) ids.add(w.userId);
    ctx.sendTo(ids, { type: 'case_battles', channelId, battles: battlesAt(channelId) });
  };
  const battleOf = (userId: number) => [...battles.values()].find((b) => !b.startedAt && b.seats.some((s) => s?.userId === userId));
  const hold = (userId: number, h: number, chips: number) => {
    take(userId, h, chips);
    db.prepare('UPDATE casino_wallets SET in_battle = in_battle + ? WHERE user_id = ? AND server_id = ?').run(chips, userId, h);
  };
  const unhold = (userId: number, h: number, chips: number) => {
    db.prepare('UPDATE casino_wallets SET in_battle = in_battle - ?, chips = chips + ? WHERE user_id = ? AND server_id = ?').run(chips, chips, userId, h);
    walletChanged(userId, h);
  };
  /** Someone gets up from a battle that hasn't started, with their chips back; the battle goes if it was theirs. */
  const leaveBattle = (b: Battle, userId: number) => {
    if (b.creator === userId) {
      for (const s of b.seats) if (s?.userId) unhold(s.userId, b.serverId, b.cost);
      battles.delete(b.id);
    } else {
      const i = b.seats.findIndex((s) => s?.userId === userId);
      if (i < 0) return;
      b.seats[i] = null;
      unhold(userId, b.serverId, b.cost);
    }
    battlesChanged(b.channelId);
  };

  /** Every seat is filled: open everything now (the apps show it round by round) and pay out. */
  function startBattle(b: Battle) {
    const boxes = b.cases.map((id) => CASES.find((c) => c.id === id)!);
    const seats = b.seats as BattleSeat[];
    inTransaction(db, () => {
      for (const s of seats) s.rolls = boxes.map(rollCase);
      const total = (i: number) => seats[i].rolls.reduce((n, r) => n + r.value, 0);
      const sides = b.mode === '2v2' ? [[0, 1], [2, 3]] : seats.map((_, i) => [i]);
      const sideTotal = sides.map((side) => side.reduce((n, i) => n + total(i), 0));
      const best = Math.max(...sideTotal);
      b.winners = sides.filter((_, k) => sideTotal[k] === best).flat();
      // The winners' people split every skin, the most valuable first to whoever has the least so far.
      const takers = b.winners.filter((i) => seats[i].userId !== null);
      if (takers.length) {
        const pot = seats.flatMap((s) => s.rolls).sort((x, y) => y.value - x.value);
        for (const i of takers) b.won[i] = 0;
        for (const r of pot) {
          const i = takers.reduce((low, j) => (b.won[j] < b.won[low] ? j : low), takers[0]);
          b.won[i] += r.value;
          keep(seats[i].userId!, b.serverId, r, false);
        }
      } else {
        // A bot won: the people keep their own pulls instead of losing them.
        seats.forEach((s, i) => {
          if (s.userId === null) return;
          b.won[i] = s.rolls.reduce((n, r) => n + r.value, 0);
          for (const r of s.rolls) keep(s.userId, b.serverId, r, false);
        });
        b.kept = true;
      }
      for (const s of seats) {
        if (s.userId === null) continue;
        db.prepare('UPDATE casino_wallets SET in_battle = in_battle - ? WHERE user_id = ? AND server_id = ?').run(b.cost, s.userId, b.serverId);
        for (const r of s.rolls) {
          found1(s.userId, b.serverId, r);
          pulled(s.userId, b.serverId, r);
        }
      }
      b.startedAt = Date.now();
    });
    for (const s of seats) if (s.userId !== null) walletChanged(s.userId, b.serverId);
  }

  route('POST', '/api/channels/:id/battles', ({ user, params, body }) => {
    play(user);
    const { id: channelId, serverId } = fireOf(Number(params[0]), user.id, 'battle');
    const userId = user.id;
    if (battleOf(userId)) throw fail(400, "You're already waiting in a battle");
    const mode = body.mode === '2v2' ? '2v2' : 'ffa';
    const players = mode === '2v2' ? 4 : Number(body.players);
    if (![2, 3, 4].includes(players)) throw fail(400, 'A battle is for 2 to 4 players');
    const cases = Array.isArray(body.cases) ? body.cases.map(String) : [];
    if (!cases.length || cases.length > BATTLE_MAX_ROUNDS) throw fail(400, `Pick 1 to ${BATTLE_MAX_ROUNDS} cases`);
    if (cases.some((id) => !CASES.some((c) => c.id === id))) throw fail(400, "That case isn't here");
    const cost = cases.reduce((n, id) => n + CASES.find((c) => c.id === id)!.price, 0);
    hold(userId, serverId, cost);
    const b: Battle = {
      id: ++battleIds, channelId, serverId, mode, cases, cost, creator: userId, startedAt: 0, winners: [], won: {}, createdAt: Date.now(),
      seats: Array.from({ length: players }, (_, i) => (i === 0 ? { userId, bot: null, rolls: [] } : null)),
    };
    battles.set(b.id, b);
    walletChanged(userId, serverId);
    battlesChanged(channelId);
    return { battle: battleView(b) };
  });

  route('POST', '/api/channels/:id/battles/:battle', ({ user, params, body }) => {
    const channel = fireOf(Number(params[0]), user.id, 'battle');
    const b = battles.get(Number(params[1]));
    if (!b || b.channelId !== channel.id) throw fail(404, 'That battle is over');
    if (b.startedAt) throw fail(400, 'That battle has started');
    const action = String(body.action);
    const seat = Number(body.seat);
    const freeSeat = () => {
      if (!Number.isInteger(seat) || seat < 0 || seat >= b.seats.length || b.seats[seat]) throw fail(400, 'That seat is taken');
    };
    if (action === 'join') {
      play(user);
      if (battleOf(user.id)) throw fail(400, "You're already waiting in a battle");
      freeSeat();
      hold(user.id, b.serverId, b.cost);
      b.seats[seat] = { userId: user.id, bot: null, rolls: [] };
      walletChanged(user.id, b.serverId);
    } else if (action === 'bot') {
      if (b.creator !== user.id) throw fail(403, 'Only whoever started the battle can add bots');
      freeSeat();
      const used = new Set(b.seats.map((s) => s?.bot));
      b.seats[seat] = { userId: null, bot: BOTS.find((n) => !used.has(n)) ?? 'Bot', rolls: [] };
    } else if (action === 'kick') {
      if (b.creator !== user.id) throw fail(403, 'Only whoever started the battle can do that');
      const s = b.seats[seat];
      if (!s || s.userId === user.id) throw fail(400, 'Nobody to remove there');
      if (s.userId !== null) {
        leaveBattle(b, s.userId);
        return { ok: true };
      }
      b.seats[seat] = null;
    } else if (action === 'leave') {
      leaveBattle(b, user.id);
      return { ok: true };
    } else throw fail(400, 'Unknown move');
    if (b.seats.every(Boolean)) startBattle(b);
    battlesChanged(channel.id);
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
    db.prepare('DELETE FROM casino_pulls WHERE at < ?').run(now - PULLS_KEEP_MS);
    // Battles: people who left the fire get up; finished ones are cleared away after a while.
    for (const b of battles.values()) {
      if (b.startedAt) {
        if (now - b.startedAt > b.cases.length * battleRoundMs + BATTLE_KEEP_MS) {
          battles.delete(b.id);
          battlesChanged(b.channelId);
        }
        continue;
      }
      for (const s of b.seats) if (s?.userId && ctx.inVoice.get(s.userId) !== b.channelId) leaveBattle(b, s.userId);
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
      ctx.sendTo([userId], { type: 'case_battles', channelId, battles: battlesAt(channelId) });
    },
    closed(ws: WebSocket) {
      watching.delete(ws);
    },
    /** Someone left a fire, so they get up from its table (after the hand, if they're in one). */
    left(channelId: number, userId: number) {
      for (const [ws, w] of watching) if (w.userId === userId && w.channelId === channelId) watching.delete(ws);
      tables.get(channelId)?.stand(userId);
      const b = battleOf(userId);
      if (b?.channelId === channelId) leaveBattle(b, userId);
    },
    sweep,
    stop() {
      clearInterval(sweeper);
      for (const t of tables.values()) t.stopTimers();
      // Battles that hadn't started give their chips back.
      for (const b of battles.values()) if (!b.startedAt) for (const s of b.seats) if (s?.userId) unhold(s.userId, b.serverId, b.cost);
      battles.clear();
    },
  };
}
