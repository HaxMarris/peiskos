// Fireside Angler, the idle fishing game at the fire (client/games/fishing). The game itself runs in
// the app; the server keeps each person's save, one per hearth like the casino's chips, so it follows
// them from the desktop app to their phone.
//
// Two devices can have the game open at once, so every save says which version it started from (rev).
// A save from an older version is turned away with the newer one, and that device picks up from there
// instead of overwriting what the other one did.
//
// Each person's biggest catch of the day also goes on the hearth's leaderboard. The game runs on the
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

type Species = { name: string; min: number; max: number; rarity: number };
/** The fish, read from the game itself so the two never drift apart: F('id', 'Name', min, max, base, rarity, ...). */
export function loadSpecies(file = new URL('../../client/games/fishing/game.js', import.meta.url)): Map<string, Species> {
  const species = new Map<string, Species>();
  let src = '';
  try { src = readFileSync(file, 'utf8'); } catch { return species; }
  for (const m of src.matchAll(/\bF\('([a-z0-9]+)', '([^']+)', ([\d.]+), ([\d.]+), [\d.]+, ([1-5]),/g)) {
    species.set(m[1], { name: m[2], min: Number(m[3]), max: Number(m[4]), rarity: Number(m[5]) });
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
    ).all(h, day) as { fish: string; score: number; stars: number; caughtAt: number }[];
    // Biggest for its species first; then more stars, a rarer fish, and whoever caught it first.
    const rarity = (f: string) => species.get(f)?.rarity ?? 0;
    rows.sort((a, b) => b.score - a.score || b.stars - a.stars || rarity(b.fish) - rarity(a.fish) || a.caughtAt - b.caughtAt);
    return { day, timeZone: BOARD_TIME_ZONE, rows: rows.slice(0, 25) };
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
    const best = db.prepare('SELECT score, stars FROM fishing_best WHERE server_id = ? AND day = ? AND user_id = ?').get(h, day, user.id) as { score: number; stars: number } | undefined;
    const better = !best || score > best.score || (score === best.score && stars > best.stars);
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
