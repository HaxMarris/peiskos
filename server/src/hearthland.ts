// Hearthland: a hearth as a map you walk around. The fires, the dock and the casino are places on
// it; walking into a fire's ring joins that fire's call (the app does that through the usual voice
// join). The server keeps two things here: a person's look (saved), and where everyone on a
// hearth's map is standing right now (in memory only, sent to the others on that map).
import type { WebSocket } from 'ws';
import type { Db } from './db.ts';
import { HttpError, type Json } from './http.ts';

type Handler = (ctx: { user: { id: number }; params: string[]; body: Json; url: URL }) => unknown;

// The map's size in tiles. It's the same for every hearth (client/js/hearthland.js draws it).
export const MAP_W = 44;
export const MAP_H = 30;

// What a character can wear. Colours are picked by number from the palettes in hearthland.js.
export const LOOK_PARTS = {
  skin: 6,
  hair: 8,
  topColor: 9,
  pants: 4,
  hairStyle: ['short', 'long', 'bun', 'spiky', 'bald'],
  top: ['tee', 'hoodie', 'jacket', 'sweater'],
  hat: ['none', 'beanie', 'cap', 'straw', 'antlers', 'crown'],
} as const;
export type Look = { skin: number; hair: number; topColor: number; pants: number; hairStyle: string; top: string; hat: string };

/** A look sent by an app, with every part checked; anything off is refused rather than guessed at. */
export function cleanLook(raw: unknown): Look {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (typeof raw !== 'object' || raw === null) throw new HttpError(400, 'Pick a look first');
  const num = (k: 'skin' | 'hair' | 'topColor' | 'pants') => {
    const v = r[k];
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) >= LOOK_PARTS[k]) throw new HttpError(400, "That look has a part Peiskos doesn't know");
    return v as number;
  };
  const word = (k: 'hairStyle' | 'top' | 'hat') => {
    const v = r[k];
    if (typeof v !== 'string' || !(LOOK_PARTS[k] as readonly string[]).includes(v)) throw new HttpError(400, "That look has a part Peiskos doesn't know");
    return v;
  };
  return { skin: num('skin'), hair: num('hair'), topColor: num('topColor'), pants: num('pants'), hairStyle: word('hairStyle'), top: word('top'), hat: word('hat') };
}

/** A saved look from the database, or null if there's none (or it no longer checks out). */
export function readLook(text: string | null | undefined): Look | null {
  if (!text) return null;
  try {
    return cleanLook(JSON.parse(text));
  } catch {
    return null;
  }
}

/** A spot on the map: where someone's feet are, in tiles, and whether they're walking. */
export function cleanSpot(raw: unknown): { x: number; y: number; moving: boolean } | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const x = Number(r.x), y = Number(r.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  // Rounded, so a position is a few bytes and nobody can stuff anything else in it.
  const round = (v: number, max: number) => Math.round(Math.min(max, Math.max(0, v)) * 100) / 100;
  return { x: round(x, MAP_W), y: round(y, MAP_H), moving: r.moving === true };
}

type Walker = { ws: WebSocket; x: number; y: number; moving: boolean };

export type HearthlandContext = {
  db: Db;
  route: (method: string, path: string, handler: Handler) => void;
  isMember: (serverId: number, userId: number) => boolean;
  sendTo: (userIds: Iterable<number>, event: Json) => void;
  userChanged: (userId: number) => unknown;
};

export function hearthland(ctx: HearthlandContext) {
  const { db, route, isMember, sendTo } = ctx;
  const maps = new Map<number, Map<number, Walker>>(); // hearth id -> user id -> where they stand
  const onMap = new Map<WebSocket, number>(); // each connection's map, if it's on one

  const mapOn = (serverId: number) =>
    !!(db.prepare("SELECT hearthland FROM servers WHERE id = ? AND kind = 'burrow'").get(serverId) as { hearthland: number } | undefined)?.hearthland;

  const others = (serverId: number, userId: number) => [...(maps.get(serverId)?.keys() ?? [])].filter((id) => id !== userId);

  /** Off the map they were on, telling the others there. Only the connection that's on it counts. */
  const leave = (userId: number, ws: WebSocket) => {
    const serverId = onMap.get(ws);
    if (serverId === undefined) return;
    onMap.delete(ws);
    const map = maps.get(serverId);
    if (map?.get(userId)?.ws !== ws) return;
    map.delete(userId);
    if (!map.size) maps.delete(serverId);
    sendTo(others(serverId, userId), { type: 'map_gone', serverId, userId });
  };

  route('PUT', '/api/me/look', ({ user, body }) => {
    const look = cleanLook(body.look);
    db.prepare('UPDATE users SET look = ? WHERE id = ?').run(JSON.stringify(look), user.id);
    ctx.userChanged(user.id);
    return { look };
  });

  return {
    /**
     * { type: 'map', serverId, x, y, moving } is where you stand on a hearth's map (the first one
     * puts you on it and sends back everyone already there); { type: 'map', serverId: null } leaves.
     */
    handle(user: { id: number }, ws: WebSocket, msg: Json) {
      const serverId = msg.serverId == null ? null : Number(msg.serverId);
      if (serverId === null) return leave(user.id, ws);
      const spot = cleanSpot(msg);
      if (!spot) return;
      if (!isMember(serverId, user.id) || !mapOn(serverId)) {
        leave(user.id, ws);
        throw new HttpError(404, "That hearth has no map, or you're not in it.");
      }
      if (onMap.get(ws) !== serverId) {
        leave(user.id, ws);
        // On another device's map already: this one takes over, and the other is told it's off.
        const was = maps.get(serverId)?.get(user.id);
        if (was && was.ws !== ws) {
          onMap.delete(was.ws);
          was.ws.send(JSON.stringify({ type: 'map_elsewhere', serverId }));
        }
        onMap.set(ws, serverId);
        let map = maps.get(serverId);
        if (!map) maps.set(serverId, (map = new Map()));
        map.set(user.id, { ws, ...spot });
        const walkers = [...map].filter(([id]) => id !== user.id).map(([id, w]) => ({ userId: id, x: w.x, y: w.y, moving: w.moving }));
        ws.send(JSON.stringify({ type: 'map_state', serverId, walkers }));
      } else Object.assign(maps.get(serverId)!.get(user.id)!, spot);
      sendTo(others(serverId, user.id), { type: 'map_move', serverId, userId: user.id, ...spot });
    },
    closed(userId: number, ws: WebSocket) {
      leave(userId, ws);
    },
    /** The map was turned off, or someone left the hearth: whoever it was is taken off it. */
    clear(serverId: number, userId?: number) {
      const map = maps.get(serverId);
      if (!map) return;
      for (const [id, w] of [...map]) {
        if (userId !== undefined && id !== userId) continue;
        if (!mapOn(serverId) || !isMember(serverId, id)) leave(id, w.ws);
      }
    },
  };
}
