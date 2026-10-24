// Fireside Angler, the idle fishing game at the fire (client/games/fishing). The game itself runs in
// the app; the server keeps each person's save, one per hearth like the casino's chips, so it follows
// them from the desktop app to their phone.
//
// Two devices can have the game open at once, so every save says which version it started from (rev).
// A save from an older version is turned away with the newer one, and that device picks up from there
// instead of overwriting what the other one did.
import type { Db } from './db.ts';
import { allowance, type Json } from './http.ts';

/** A save is the game's whole state as JSON; 115 fish, 21 hats and six nets of 20 fit in far less. */
export const MAX_SAVE_BYTES = 256 * 1024;

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
}
