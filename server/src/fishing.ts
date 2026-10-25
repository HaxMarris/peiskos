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
import { readFileSync } from 'node:fs';
import type { Db } from './db.ts';
import { allowance, type Json } from './http.ts';

/** A save is the game's whole state as JSON; 115 fish, 21 hats and six nets of 20 fit in far less. */
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

type User = { id: number };
type Handler = (ctx: { user: User; params: string[]; body: Json; url: URL }) => unknown;

export interface FishingContext {
  db: Db;
  route: (method: string, path: string, handler: Handler) => void;
  fail: (status: number, message: string) => Error;
  isMember: (serverId: number, userId: number) => boolean;
}

type Row = { data: string; rev: number; savedAt: number };

export function fishing(ctx: FishingContext) {
  const { db, route, fail } = ctx;
  const saves = allowance(30, 2); // the game saves a second or so after you do something
  const catches = allowance(20, 1); // only a catch that beats your best of the day is sent
  const species = loadSpecies();
  const starMul = loadStarMul();
  const worthOf = (r: { fish: string; score: number; stars: number; giant: number }) => {
    const sp = species.get(r.fish);
    return sp ? boardWorth(sp, r.score, r.stars, !!r.giant, starMul) : 0;
  };

  const hearth = (id: string, userId: number) => {
    const h = Number(id);
    if (!ctx.isMember(h, userId)) throw fail(404, 'Hearth not found');
    return h;
  };
  const current = (userId: number, h: number) =>
    db.prepare('SELECT data, rev, saved_at AS savedAt FROM fishing_saves WHERE user_id = ? AND server_id = ?').get(userId, h) as Row | undefined;
  const view = (row: Row | undefined) => (row ? { save: JSON.parse(row.data), rev: row.rev, savedAt: row.savedAt } : { save: null, rev: 0, savedAt: 0 });

  route('GET', '/api/servers/:id/fishing', ({ user, params }) => view(current(user.id, hearth(params[0], user.id))));

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
    const fish = String(body.f ?? '');
    const sp = species.get(fish);
    const size = Number(body.s), score = Number(body.t), stars = Number(body.q);
    if (!sp) throw fail(400, 'No such fish');
    if (!Number.isInteger(score) || score < 0 || score > 100 || !Number.isInteger(stars) || stars < 1 || stars > 5) throw fail(400, "That catch doesn't add up");
    // The game rounds the size to a tenth and the score to a whole number, so allow for both.
    const expected = sp.min + (score / 100) * (sp.max - sp.min);
    if (!Number.isFinite(size) || Math.abs(size - expected) > (sp.max - sp.min) * 0.006 + 0.1) throw fail(400, "That catch doesn't add up");
    const giant = body.g === true && score >= 98;
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
  return { pond, hat, rod, phase, bob, caught };
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
