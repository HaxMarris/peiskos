// Fireside Angler, the idle fishing game at the fire (client/games/fishing). The game itself runs in
// the app; the server keeps each person's save, one per hearth like the casino's chips, so it follows
// them from the desktop app to their phone.
//
// Two devices can have the game open at once, so every save says which version it started from (rev).
// A save from an older version is turned away with the newer one, and that device picks up from there
// instead of overwriting what the other one did.
//
// Each person's most valuable catch of the day also goes on the hearth's leaderboard. The game runs on the
// player's device, so the server can only check that a catch adds up: a real species, and a size
// that matches its score within that species' range.
//
// Each hearth also runs a weekly derby: one rare-or-better species at one water, Monday to Sunday
// Eastern. Everyone's longest hand-caught one counts, and the server settles the places once the
// week is over. The game pays its own prizes from those places, as it does every other coin.
import { readFileSync } from 'node:fs';
import type { Db } from './db.ts';
import { allowance, type Json } from './http.ts';

/** A save is the game's whole state as JSON; 264 fish, 30 hats and six nets of 20 fit in far less. */
export const MAX_SAVE_BYTES = 256 * 1024;

/** The leaderboard's day runs midnight to midnight, Eastern time. */
export const BOARD_TIME_ZONE = 'America/New_York';
export const boardDay = (t = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: BOARD_TIME_ZONE }).format(t);

type Species = { name: string; min: number; max: number; base: number; rarity: number };
/** The fish, read from the game itself so the two never drift apart: F('id', 'Name', min, max, base, rarity, ...). */
/** What a catch is worth on the leaderboard: the fish's own value, without anyone's upgrades or bonuses. */
export const boardWorth = (sp: Species, score: number, stars: number, giant: boolean, starMul: number[]) =>
  Math.round(sp.base * (0.5 + score / 100) * (starMul[stars - 1] ?? 1) * (giant ? 3 : 1));
/** The star multipliers, also read from the game: const STAR_MUL = [...]. */
export function loadStarMul(file = new URL('../../client/games/fishing/game.js', import.meta.url)): number[] {
  try {
    const m = readFileSync(file, 'utf8').match(/const STAR_MUL = \[([\d., ]+)\]/);
    const mul = m ? m[1].split(',').map(Number) : [];
    if (mul.length === 5 && mul.every((x) => Number.isFinite(x))) return mul;
  } catch { /* fall through */ }
  return [0.6, 1, 1.5, 2.5, 5];
}
export function loadSpecies(file = new URL('../../client/games/fishing/game.js', import.meta.url)): Map<string, Species> {
  const species = new Map<string, Species>();
  let src = '';
  try { src = readFileSync(file, 'utf8'); } catch { return species; }
  for (const m of src.matchAll(/\bF\('([a-z0-9]+)', '([^']+)', ([\d.]+), ([\d.]+), ([\d.]+), ([1-5]),/g)) {
    species.set(m[1], { name: m[2], min: Number(m[3]), max: Number(m[4]), base: Number(m[5]), rarity: Number(m[6]) });
  }
  return species;
}

/** The waters in walking order, and each one's regular fish (the timed legendaries are left out). */
export function loadPonds(file = new URL('../../client/games/fishing/game.js', import.meta.url)): { id: string; fish: { id: string; rarity: number }[] }[] {
  const ponds: { id: string; fish: { id: string; rarity: number }[] }[] = [];
  let src = '';
  try { src = readFileSync(file, 'utf8'); } catch { return ponds; }
  for (const line of src.split('\n')) {
    const p = line.match(/^ {2}\{ id: '([a-z]+)', name: '[^']+', cost: \d+, idle:/);
    if (p) ponds.push({ id: p[1], fish: [] });
    else if (ponds.length && line.startsWith('];')) break;
    else if (ponds.length) for (const m of line.matchAll(/\bF\('([a-z0-9]+)', '[^']+', [\d.]+, [\d.]+, [\d.]+, ([1-5]),/g)) ponds[ponds.length - 1].fish.push({ id: m[1], rarity: Number(m[2]) });
  }
  return ponds;
}

/** The Monday (Eastern) that starts the derby week t falls in, as YYYY-MM-DD. */
export function derbyWeek(t = Date.now()): string {
  const d = new Date(boardDay(t) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const addDays = (day: string, n: number) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** The moment an Eastern date starts (midnight is 04:00 or 05:00 UTC, depending on daylight saving). */
export function easternMidnight(day: string): number {
  for (const h of ['04', '05']) { const t = Date.parse(`${day}T${h}:00:00Z`); if (boardDay(t) === day && boardDay(t - 1) !== day) return t; }
  return Date.parse(`${day}T05:00:00Z`);
}

/** Rare fish half the weeks, epic 30%, legendary 20%: common and uncommon ones are too easy over a week. */
const DERBY_TIERS: [number, number][] = [[3, 0.5], [4, 0.3], [5, 0.2]];
function seeded(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = (h + 0x6d2b79f5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/**
 * This week's water and fish: the furthest water at least half the hearth's recent anglers have
 * opened (never last week's again, when there's another), and a rare, epic or legendary fish there.
 * No derby with fewer than two anglers.
 */
export function pickDerby(ponds: ReturnType<typeof loadPonds>, opened: string[][], last: string | null, seed: string): { pond: string; fish: string } | null {
  if (opened.length < 2 || !ponds.length) return null;
  const need = Math.ceil(opened.length / 2);
  let i = Math.max(0, ponds.map((p) => opened.filter((o) => o.includes(p.id)).length >= need).lastIndexOf(true));
  if (ponds[i].id === last && i > 0) i--;
  const rand = seeded(seed), pond = ponds[i];
  const tiers = DERBY_TIERS.filter(([r]) => pond.fish.some((f) => f.rarity === r));
  let roll = rand() * tiers.reduce((a, [, w]) => a + w, 0), tier = tiers[tiers.length - 1][0];
  for (const [r, w] of tiers) { roll -= w; if (roll <= 0) { tier = r; break; } }
  const pool = pond.fish.filter((f) => f.rarity === tier);
  return { pond: pond.id, fish: pool[Math.floor(rand() * pool.length)].id };
}
type Entry = { userId: number; size: number; stars: number; caughtAt: number };
/** Longest first; then more stars; then whoever landed theirs first. */
export const derbyOrder = (a: Entry, b: Entry) => b.size - a.size || b.stars - a.stars || a.caughtAt - b.caughtAt;

type User = { id: number };
type Handler = (ctx: { user: User; params: string[]; body: Json; url: URL }) => unknown;

export interface FishingContext {
  db: Db;
  route: (method: string, path: string, handler: Handler) => void;
  fail: (status: number, message: string) => Error;
  isMember: (serverId: number, userId: number) => boolean;
  now?: () => number;
}

type Row = { data: string; rev: number; savedAt: number };

export function fishing(ctx: FishingContext) {
  const { db, route, fail } = ctx;
  const saves = allowance(30, 2); // the game saves a second or so after you do something
  const catches = allowance(20, 1); // only a catch that beats your best of the day is sent
  const species = loadSpecies();
  const starMul = loadStarMul();
  const ponds = loadPonds();
  const clock = ctx.now ?? Date.now;
  const derbyEntries = allowance(20, 1);
  const worthOf = (r: { fish: string; score: number; stars: number; giant: number }) => {
    const sp = species.get(r.fish);
    return sp ? boardWorth(sp, r.score, r.stars, !!r.giant, starMul) : 0;
  };

  /** A catch the game reports, checked as far as the server can: a real fish, and a size that fits its score. */
  const checkCatch = (body: Json) => {
    const fish = String(body.f ?? '');
    const sp = species.get(fish);
    const size = Number(body.s), score = Number(body.t), stars = Number(body.q);
    if (!sp) throw fail(400, 'No such fish');
    if (!Number.isInteger(score) || score < 0 || score > 100 || !Number.isInteger(stars) || stars < 1 || stars > 5) throw fail(400, "That catch doesn't add up");
    // The game rounds the size to a tenth and the score to a whole number, so allow for both.
    const expected = sp.min + (score / 100) * (sp.max - sp.min);
    if (!Number.isFinite(size) || Math.abs(size - expected) > (sp.max - sp.min) * 0.006 + 0.1) throw fail(400, "That catch doesn't add up");
    return { fish, sp, size, score, stars, giant: body.g === true && score >= 98 };
  };

  const hearth = (id: string, userId: number) => {
    const h = Number(id);
    if (!ctx.isMember(h, userId)) throw fail(404, 'Hearth not found');
    return h;
  };
  const current = (userId: number, h: number) =>
    db.prepare('SELECT data, rev, saved_at AS savedAt FROM fishing_saves WHERE user_id = ? AND server_id = ?').get(userId, h) as Row | undefined;
  const view = (row: Row | undefined) => (row ? { save: JSON.parse(row.data), rev: row.rev, savedAt: row.savedAt } : { save: null, rev: 0, savedAt: 0 });

  // The server's clock comes along so timed fish follow it, not whatever the device's clock says.
  route('GET', '/api/servers/:id/fishing', ({ user, params }) => ({ ...view(current(user.id, hearth(params[0], user.id))), now: Date.now() }));

  route('POST', '/api/servers/:id/fishing', ({ user, params, body }) => {
    const h = hearth(params[0], user.id);
    if (!saves.take(user.id)) throw fail(429, 'Saving too often');
    const data = body.save;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw fail(400, 'Nothing to save');
    const json = JSON.stringify(data);
    if (Buffer.byteLength(json) > MAX_SAVE_BYTES) throw fail(413, 'That save is too big');
    const rev = Number(body.rev);
    if (!Number.isInteger(rev) || rev < 0) throw fail(400, 'Which version is this save from?');
    const row = current(user.id, h);
    if ((row?.rev ?? 0) !== rev) return { conflict: true, ...view(row) };
    const now = Date.now();
    if (row) db.prepare('UPDATE fishing_saves SET data = ?, rev = rev + 1, saved_at = ? WHERE user_id = ? AND server_id = ?').run(json, now, user.id, h);
    else db.prepare('INSERT INTO fishing_saves (user_id, server_id, data, rev, saved_at) VALUES (?, ?, ?, 1, ?)').run(user.id, h, json, now);
    return { conflict: false, rev: rev + 1, savedAt: now };
  });

  route('GET', '/api/servers/:id/fishing/board', ({ user, params }) => {
    const h = hearth(params[0], user.id);
    const day = boardDay();
    const rows = db.prepare(
      `SELECT b.user_id AS userId, COALESCE(m.nickname, u.display_name, u.username) AS name, b.fish, b.size, b.score, b.stars, b.giant, b.idle, b.caught_at AS caughtAt
       FROM fishing_best b JOIN users u ON u.id = b.user_id JOIN members m ON m.server_id = b.server_id AND m.user_id = b.user_id
       WHERE b.server_id = ? AND b.day = ?`,
    ).all(h, day) as { fish: string; score: number; stars: number; giant: number; caughtAt: number }[];
    // Most valuable first; a tie goes to whoever caught it first.
    const ranked = rows.map((r) => ({ ...r, worth: worthOf(r) })).sort((a, b) => b.worth - a.worth || a.caughtAt - b.caughtAt);
    return { day, timeZone: BOARD_TIME_ZONE, rows: ranked.slice(0, 25) };
  });

  route('POST', '/api/servers/:id/fishing/catch', ({ user, params, body }) => {
    const h = hearth(params[0], user.id);
    if (!catches.take(user.id)) throw fail(429, 'Catching too fast');
    const { fish, sp, size, score, stars, giant } = checkCatch(body);
    const day = boardDay();
    const best = db.prepare('SELECT fish, score, stars, giant FROM fishing_best WHERE server_id = ? AND day = ? AND user_id = ?').get(h, day, user.id) as
      { fish: string; score: number; stars: number; giant: number } | undefined;
    const better = !best || boardWorth(sp, score, stars, giant, starMul) > worthOf(best);
    if (better) {
      db.prepare(
        `INSERT INTO fishing_best (server_id, user_id, day, fish, size, score, stars, giant, idle, caught_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (server_id, day, user_id) DO UPDATE SET fish = excluded.fish, size = excluded.size, score = excluded.score, stars = excluded.stars,
           giant = excluded.giant, idle = excluded.idle, caught_at = excluded.caught_at`,
      ).run(h, user.id, day, fish, size, score, stars, giant ? 1 : 0, body.idle === true ? 1 : 0, Date.now());
      // Only today's board is ever shown; a week of old days is plenty to keep.
      db.prepare('DELETE FROM fishing_best WHERE server_id = ? AND day < ?').run(h, boardDay(Date.now() - 7 * 86400000));
    }
    return { day, best: better };
  });

  // ---- The weekly derby ----
  type DerbyRow = { week: string; pond: string; fish: string; settled: number; leadSaid: number };
  const derbyAt = (h: number, week: string) =>
    db.prepare('SELECT week, pond, fish, settled, lead_said AS leadSaid FROM fishing_derby WHERE server_id = ? AND week = ?').get(h, week) as DerbyRow | undefined;
  const entriesOf = (h: number, week: string) => (db.prepare(
    `SELECT e.user_id AS userId, COALESCE(m.nickname, u.display_name, u.username) AS name, e.size, e.stars, e.caught_at AS caughtAt, e.place
     FROM fishing_derby_entries e JOIN users u ON u.id = e.user_id LEFT JOIN members m ON m.server_id = e.server_id AND m.user_id = e.user_id
     WHERE e.server_id = ? AND e.week = ?`,
  ).all(h, week) as (Entry & { name: string; place: number | null })[]).sort(derbyOrder);
  const winsOf = (h: number) => new Map((db.prepare('SELECT user_id AS userId, COUNT(*) AS n FROM fishing_derby_entries WHERE server_id = ? AND place = 1 GROUP BY user_id').all(h) as { userId: number; n: number }[]).map((r) => [r.userId, r.n]));

  /** Finish every derby week that's over: everyone who entered gets their place. */
  const settle = (h: number, week: string) => {
    const open = db.prepare('SELECT week FROM fishing_derby WHERE server_id = ? AND settled = 0 AND week < ?').all(h, week) as { week: string }[];
    for (const d of open) {
      entriesOf(h, d.week).forEach((e, i) => db.prepare('UPDATE fishing_derby_entries SET place = ? WHERE server_id = ? AND week = ? AND user_id = ?').run(i + 1, h, d.week, e.userId));
      db.prepare('UPDATE fishing_derby SET settled = 1 WHERE server_id = ? AND week = ?').run(h, d.week);
    }
  };
  /** This week's derby, picked the first time anyone asks. */
  const thisDerby = (h: number, week: string, now: number) => {
    const have = derbyAt(h, week);
    if (have) return have;
    const opened = (db.prepare('SELECT data FROM fishing_saves WHERE server_id = ? AND saved_at >= ?').all(h, now - 14 * 86400000) as { data: string }[])
      .map((r) => { try { const p = JSON.parse(r.data).ponds; return Array.isArray(p) ? p.filter((x: unknown) => typeof x === 'string') : []; } catch { return []; } });
    const last = db.prepare('SELECT pond FROM fishing_derby WHERE server_id = ? AND week < ? ORDER BY week DESC LIMIT 1').get(h, week) as { pond: string } | undefined;
    const pick = pickDerby(ponds, opened, last?.pond ?? null, `${h}:${week}`);
    if (!pick) return null;
    db.prepare('INSERT OR IGNORE INTO fishing_derby (server_id, week, pond, fish) VALUES (?, ?, ?, ?)').run(h, week, pick.pond, pick.fish);
    return derbyAt(h, week)!;
  };

  route('GET', '/api/servers/:id/fishing/derby', ({ user, params }) => {
    const h = hearth(params[0], user.id);
    const now = clock(), week = derbyWeek(now);
    settle(h, week);
    const d = thisDerby(h, week, now), wins = winsOf(h);
    const rows = d ? entriesOf(h, week) : [];
    const mine = rows.findIndex((r) => r.userId === user.id);
    const prev = db.prepare('SELECT week, pond, fish FROM fishing_derby WHERE server_id = ? AND week < ? ORDER BY week DESC LIMIT 1').get(h, week) as { week: string; pond: string; fish: string } | undefined;
    const row = (r: Entry & { name: string }) => ({ userId: r.userId, name: r.name, size: r.size, stars: r.stars, wins: wins.get(r.userId) ?? 0 });
    // Where you finished in recent weeks: the game pays each one once and remembers which it paid.
    const awards = db.prepare(
      `SELECT e.week, e.place, e.size, d.pond, d.fish FROM fishing_derby_entries e JOIN fishing_derby d ON d.server_id = e.server_id AND d.week = e.week
       WHERE e.server_id = ? AND e.user_id = ? AND e.place IS NOT NULL AND e.week >= ? ORDER BY e.week`,
    ).all(h, user.id, addDays(week, -56));
    return {
      week, endsAt: easternMidnight(addDays(week, 7)), now,
      derby: d ? { pond: d.pond, fish: d.fish } : null,
      rows: rows.slice(0, 10).map(row),
      me: mine >= 0 ? { place: mine + 1, size: rows[mine].size, stars: rows[mine].stars } : null,
      last: prev ? { week: prev.week, pond: prev.pond, fish: prev.fish, top: entriesOf(h, prev.week).slice(0, 3).map(row) } : null,
      awards, wins: wins.get(user.id) ?? 0,
    };
  });

  route('POST', '/api/servers/:id/fishing/derby', ({ user, params, body }) => {
    const h = hearth(params[0], user.id);
    if (!derbyEntries.take(user.id)) throw fail(429, 'Catching too fast');
    const now = clock(), week = derbyWeek(now);
    const d = derbyAt(h, week);
    const { fish, size, score, stars } = checkCatch(body);
    if (!d || d.fish !== fish) throw fail(400, "That isn't this week's derby fish");
    if (body.idle === true) throw fail(400, "Idle rods don't count in the derby");
    const before = entriesOf(h, week);
    const had = before.find((e) => e.userId === user.id);
    const entry = { userId: user.id, size, stars, caughtAt: now };
    if (had && derbyOrder(entry, had) >= 0) return { best: false, place: before.indexOf(had) + 1, lead: false };
    db.prepare(
      `INSERT INTO fishing_derby_entries (server_id, week, user_id, size, score, stars, caught_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (server_id, week, user_id) DO UPDATE SET size = excluded.size, score = excluded.score, stars = excluded.stars, caught_at = excluded.caught_at`,
    ).run(h, week, user.id, size, score, stars, now);
    const after = entriesOf(h, week), place = after.findIndex((e) => e.userId === user.id) + 1;
    // Taking the lead from someone else is worth a line in the fireside chat, at most once an hour per hearth.
    const tookLead = place === 1 && before.length > 0 && before[0].userId !== user.id && now - d.leadSaid >= 3600000;
    if (tookLead) db.prepare('UPDATE fishing_derby SET lead_said = ? WHERE server_id = ? AND week = ?').run(now, h, week);
    return { best: true, place, lead: tookLead };
  });
}

// ---- Friends on the dock ----
// Everyone at a fire with the game open sits on the same dock when they fish the same water. Each
// game tells the fire what its angler is doing (which water, their hat and rod, whether a fish is
// biting, what they just landed), and Peiskos passes that on to the others at the fire. It's only
// kept in memory, like the fireside chat, and goes when they close the game or leave the fire.

/** What the others see of someone fishing. Anything else a game sends is dropped. */
export type DockStatus = {
  pond: string; hat: string; rod: string;
  phase: 'idle' | 'wait' | 'bite';
  bob: [number, number] | null;
  caught: { f: string; s: number; q: number; at: number } | null;
  /** Their last derby winner, mounted on a plaque, and how many derbies they've won. */
  trophy: { f: string; s: number } | null;
  wins: number;
};

const word = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9]{1,24}$/.test(v) ? v : null);
const unit = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null);

/** A game's status, cleaned up: only known fields, short ids, and the bobber on the screen. */
export function cleanStatus(raw: unknown): DockStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const pond = word(s.pond), hat = word(s.hat), rod = word(s.rod);
  if (!pond || !hat || !rod) return null;
  const phase = s.phase === 'wait' || s.phase === 'bite' ? s.phase : 'idle';
  const b = Array.isArray(s.bob) ? [unit(s.bob[0]), unit(s.bob[1])] : null;
  const bob: [number, number] | null = phase !== 'idle' && b && b[0] !== null && b[1] !== null ? [b[0], b[1]] : null;
  const c = s.caught as Record<string, unknown> | null | undefined;
  const f = c && word(c.f), size = c && Number(c.s), q = c && Number(c.q);
  const caught = f && Number.isFinite(size) && size! > 0 && Number.isInteger(q) && q! >= 1 && q! <= 5 ? { f, s: Math.round(size! * 10) / 10, q: q!, at: Date.now() } : null;
  const t = s.trophy as Record<string, unknown> | null | undefined;
  const tf = t && word(t.f), ts = t && Number(t.s);
  const trophy = tf && Number.isFinite(ts) && ts! > 0 ? { f: tf, s: Math.round(ts! * 10) / 10 } : null;
  const wins = Number.isInteger(s.wins) && (s.wins as number) > 0 ? Math.min(999, s.wins as number) : 0;
  return { pond, hat, rod, phase, bob, caught, trophy, wins };
}

export interface DockContext {
  inVoice: Map<number, number>;
  usersInVoice: (channelId: number) => number[];
  sendTo: (userIds: Iterable<number>, event: Json) => void;
}

export function fishingDock(ctx: DockContext) {
  const anglers = new Map<number, { channelId: number; ws: unknown; status: DockStatus }>();
  const updates = allowance(20, 2); // a cast, a bite and a catch are a few a minute

  const tell = (channelId: number, userId: number, status: DockStatus | null) =>
    ctx.sendTo(ctx.usersInVoice(channelId).filter((id) => id !== userId), { type: 'fishing_dock', channelId, userId, status } as unknown as Json);
  const drop = (userId: number) => {
    const a = anglers.get(userId);
    if (!a) return;
    anglers.delete(userId);
    tell(a.channelId, userId, null);
  };

  return {
    /** A game says what its angler is doing now, or (status null) that it closed. */
    handle(user: { id: number }, ws: unknown, msg: Json) {
      const channelId = ctx.inVoice.get(user.id);
      if (channelId === undefined) return;
      if (msg.status === null) {
        if (anglers.get(user.id)?.ws === ws) drop(user.id);
        return;
      }
      if (!updates.take(user.id)) return;
      const status = cleanStatus(msg.status);
      if (!status) return;
      const was = anglers.get(user.id);
      anglers.set(user.id, { channelId, ws, status });
      tell(channelId, user.id, status);
      // Just opened the game here: see who's already fishing at this fire.
      if (!was || was.channelId !== channelId || was.ws !== ws) {
        for (const [id, a] of anglers) if (id !== user.id && a.channelId === channelId) ctx.sendTo([user.id], { type: 'fishing_dock', channelId, userId: id, status: a.status } as unknown as Json);
      }
    },
    /** Someone left a fire, or the connection their game was on closed. */
    left: (userId: number) => drop(userId),
    closed: (userId: number, ws: unknown) => { if (anglers.get(userId)?.ws === ws) drop(userId); },
  };
}
