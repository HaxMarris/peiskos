// Lanterns: small lamps (an ESP32 and a ring of LEDs) that glow when friends are at a fire, and
// flicker while someone there talks. Each one belongs to one person and follows the fires they
// pick. A lamp only ever hears "on, how bright, flickering or not", never who is there or what
// they say, so one left on a shelf gives nothing away beyond "someone is at the fire".
import { randomBytes, randomInt } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { Channel, Handler } from './app.ts';
import { type Db, tokenHash } from './db.ts';
import { HttpError, type Json } from './http.ts';

export interface LanternContext {
  canSee: (channel: Channel, userId: number) => boolean;
  channelById: (id: number) => Channel | undefined;
  checkTries: (keys: string[], limit: number) => void;
  db: Db;
  failedTry: (keys: string[], windowMs?: number) => void;
  now: () => number;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => number;
  speaking: Set<number>;
  usersInVoice: (channelId: number) => number[];
}

export const MAX_LANTERNS = 10;
const LIGHT_WHEN = ['fire', 'talk', 'both'] as const;
type LightWhen = (typeof LIGHT_WHEN)[number];
const CODE_MS = 15 * 60_000;
// No 0/O, 1/I/L or U: it's read off a phone and typed into a small setup page.
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

type Row = {
  id: number; user_id: number; name: string; token: string | null; pair_code: string | null; pair_until: number | null;
  enabled: number; light_when: LightWhen; all_fires: number; fire_ids: string; brightness: number;
  created_at: number; last_seen_at: number | null;
};
type Light = { level: number; glow: boolean; flicker: boolean; people: number };
type Lamp = { ws: WebSocket; id: number; userId: number; fires: Set<number>; sent: string };

export function lanterns(ctx: LanternContext) {
  const { canSee, channelById, checkTries, db, failedTry, now, route, speaking, usersInVoice } = ctx;

  const lamps = new Map<number, Lamp>(); // lantern id -> its connection, while it's online
  const rowById = (id: number) => db.prepare('SELECT * FROM lanterns WHERE id = ?').get(id) as Row | undefined;
  const fireIdsOf = (row: Row) => {
    try {
      const ids = JSON.parse(row.fire_ids);
      return Array.isArray(ids) ? ids.filter(Number.isInteger) as number[] : [];
    } catch {
      return [];
    }
  };

  /** Every fire in a hearth this person can see. Direct-message calls aren't fires. */
  const firesFor = (userId: number) =>
    (db
      .prepare(
        `SELECT c.id FROM channels c JOIN servers s ON s.id = c.server_id JOIN members m ON m.server_id = s.id AND m.user_id = ?
         WHERE c.kind = 'voice' AND s.kind = 'burrow' ORDER BY s.id, c.position, c.id`,
      )
      .all(userId) as { id: number }[])
      .map((r) => channelById(r.id))
      .filter((c): c is Channel => !!c && canSee(c, userId));

  /** The fires this lantern follows, of the ones its owner can still see. */
  const watched = (row: Row) => {
    const mine = firesFor(row.user_id).map((c) => c.id);
    if (row.all_fires) return new Set(mine);
    const picked = new Set(fireIdsOf(row));
    return new Set(mine.filter((id) => picked.has(id)));
  };

  /** What the lamp should show. Its owner doesn't count: their lamp is for when they're away. */
  const lightFor = (row: Row, fires: Set<number>): Light => {
    let people = 0;
    let talking = false;
    for (const fire of fires)
      for (const id of usersInVoice(fire)) {
        if (id === row.user_id) continue;
        people++;
        if (speaking.has(id)) talking = true;
      }
    const on = !!row.enabled;
    const glow = on && people > 0 && row.light_when !== 'talk';
    const flicker = on && talking && row.light_when !== 'fire';
    return { level: Math.round((row.brightness / 100) * 255), glow, flicker, people: on ? people : 0 };
  };

  const show = (lamp: Lamp, row = rowById(lamp.id)) => {
    if (!row) return;
    const light = JSON.stringify({ type: 'light', ...lightFor(row, lamp.fires) });
    if (light === lamp.sent || lamp.ws.readyState !== WebSocket.OPEN) return;
    lamp.sent = light;
    lamp.ws.send(light);
  };

  /** Someone sat down, got up or started or stopped talking at a fire. */
  const fireChanged = (channelId: number | undefined) => {
    if (channelId === undefined) return;
    for (const lamp of lamps.values()) if (lamp.fires.has(channelId)) show(lamp);
  };

  /** Rooms, roles or hearths changed under a lamp: work out its fires again. */
  const refresh = (lamp: Lamp) => {
    const row = rowById(lamp.id);
    if (!row || row.token === null) return drop(lamp.id, 'Removed');
    lamp.fires = watched(row);
    show(lamp, row);
  };
  // Leaving a hearth or losing a private fire isn't announced to this module, so lamps look again
  // now and then. Sitting down and talking are pushed straight away (fireChanged).
  const refreshTimer = setInterval(() => {
    for (const lamp of lamps.values()) refresh(lamp);
  }, 60_000);
  refreshTimer.unref();

  const json = (row: Row) => ({
    id: row.id,
    name: row.name,
    paired: row.token !== null,
    online: lamps.has(row.id),
    lastSeenAt: lamps.has(row.id) ? now() : row.last_seen_at,
    enabled: !!row.enabled,
    lightWhen: row.light_when,
    allFires: !!row.all_fires,
    fireIds: fireIdsOf(row),
    brightness: row.brightness,
    codeUntil: row.token === null && (row.pair_until ?? 0) > now() ? row.pair_until : null,
    // What it's showing right now, so the settings can show it too.
    light: lamps.has(row.id) ? lightFor(row, lamps.get(row.id)!.fires) : null,
  });

  const mine = (userId: number, id: number) => {
    const row = rowById(id);
    if (!row || row.user_id !== userId) throw new HttpError(404, 'That lantern is gone.');
    return row;
  };

  /** Tells a connected lamp its key is no longer good, so it forgets it and waits to be set up again. */
  const drop = (id: number, reason: string) => {
    const lamp = lamps.get(id);
    if (!lamp) return;
    if (lamp.ws.readyState === WebSocket.OPEN) lamp.ws.send(JSON.stringify({ type: 'forget' }));
    lamp.ws.close(4001, reason);
  };

  /** A fresh setup code for a lantern. Its old key stops working, so a lamp can be passed on. */
  const newCode = (id: number) => {
    let code = '';
    for (let i = 0; i < 8; i++) code += CODE_LETTERS[randomInt(CODE_LETTERS.length)];
    const until = now() + CODE_MS;
    db.prepare('UPDATE lanterns SET token = NULL, pair_code = ?, pair_until = ? WHERE id = ?').run(tokenHash(code), until, id);
    drop(id, 'Set up again');
    return `${code.slice(0, 4)}-${code.slice(4)}`;
  };
  const cleanCode = (v: unknown) => (typeof v === 'string' ? v.toUpperCase().replace(/[^A-Z0-9]/g, '') : '');
  const cleanName = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 32) : '');

  route('GET', '/api/lanterns', ({ user }) => {
    const rows = db.prepare('SELECT * FROM lanterns WHERE user_id = ? ORDER BY id').all(user.id) as Row[];
    const names = db.prepare('SELECT name FROM servers WHERE id = ?');
    return {
      lanterns: rows.map(json),
      fires: firesFor(user.id).map((c) => ({
        id: c.id,
        name: c.name,
        serverId: c.serverId,
        serverName: (names.get(c.serverId) as { name: string } | undefined)?.name ?? '',
      })),
    };
  });

  route('POST', '/api/lanterns', ({ user, body }) => {
    const count = (db.prepare('SELECT COUNT(*) AS n FROM lanterns WHERE user_id = ?').get(user.id) as { n: number }).n;
    if (count >= MAX_LANTERNS) throw new HttpError(400, `You can have up to ${MAX_LANTERNS} lanterns. Remove one first.`);
    const name = cleanName(body.name) || 'Lantern';
    const r = db.prepare('INSERT INTO lanterns (user_id, name, created_at) VALUES (?, ?, ?)').run(user.id, name, now());
    const id = Number(r.lastInsertRowid);
    const code = newCode(id);
    return { lantern: json(rowById(id)!), code };
  });

  route('POST', '/api/lanterns/:id/code', ({ user, params }) => {
    const row = mine(user.id, Number(params[0]));
    const code = newCode(row.id);
    return { lantern: json(rowById(row.id)!), code };
  });

  route('PATCH', '/api/lanterns/:id', ({ user, params, body }) => {
    const row = mine(user.id, Number(params[0]));
    const set: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = cleanName(body.name);
      if (!name) throw new HttpError(400, 'Give the lantern a name.');
      set.name = name;
    }
    if (body.enabled !== undefined) set.enabled = body.enabled === true ? 1 : 0;
    if (body.lightWhen !== undefined) {
      if (!LIGHT_WHEN.includes(body.lightWhen as LightWhen)) throw new HttpError(400, 'Pick when the lantern lights up.');
      set.light_when = body.lightWhen;
    }
    if (body.allFires !== undefined) set.all_fires = body.allFires === true ? 1 : 0;
    if (body.fireIds !== undefined) {
      if (!Array.isArray(body.fireIds)) throw new HttpError(400, 'Pick the fires as a list.');
      // Only fires they can see now; the rest are dropped rather than kept for later.
      const seen = new Set(firesFor(user.id).map((c) => c.id));
      set.fire_ids = JSON.stringify([...new Set(body.fireIds.map(Number))].filter((id) => seen.has(id)));
    }
    if (body.brightness !== undefined) {
      const b = Number(body.brightness);
      if (!Number.isFinite(b)) throw new HttpError(400, 'Brightness is a number from 5 to 100.');
      set.brightness = Math.round(Math.min(100, Math.max(5, b)));
    }
    const cols = Object.keys(set);
    if (cols.length) db.prepare(`UPDATE lanterns SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...(Object.values(set) as (string | number)[]), row.id);
    const lamp = lamps.get(row.id);
    if (lamp) refresh(lamp);
    return { lantern: json(rowById(row.id)!) };
  });

  route('DELETE', '/api/lanterns/:id', ({ user, params }) => {
    const row = mine(user.id, Number(params[0]));
    db.prepare('DELETE FROM lanterns WHERE id = ?').run(row.id);
    drop(row.id, 'Removed');
    return { ok: true };
  });

  // Blinks the lamp a few times, to find which one on the shelf this is.
  route('POST', '/api/lanterns/:id/blink', ({ user, params }) => {
    const row = mine(user.id, Number(params[0]));
    const lamp = lamps.get(row.id);
    if (!lamp || lamp.ws.readyState !== WebSocket.OPEN) throw new HttpError(409, "That lantern isn't online. Check it's plugged in and on Wi-Fi.");
    lamp.ws.send(JSON.stringify({ type: 'blink' }));
    return { ok: true };
  });

  // The lamp itself, during setup: it trades the code typed into it for a key of its own.
  route(
    'POST',
    '/api/lanterns/pair',
    ({ body, ip }) => {
      checkTries([`lantern-ip:${ip}`], 10);
      const code = cleanCode(body.code);
      const row = code.length === 8
        ? (db.prepare('SELECT * FROM lanterns WHERE pair_code = ? AND token IS NULL').get(tokenHash(code)) as Row | undefined)
        : undefined;
      if (!row || (row.pair_until ?? 0) <= now()) {
        failedTry([`lantern-ip:${ip}`]);
        throw new HttpError(403, 'That code is wrong or has run out. Make a new one in Peiskos.');
      }
      const key = randomBytes(32).toString('base64url');
      db.prepare('UPDATE lanterns SET token = ?, pair_code = NULL, pair_until = NULL WHERE id = ?').run(tokenHash(key), row.id);
      return { key, id: row.id, name: row.name };
    },
    false,
  );

  // ---- the lamp's own connection: /lantern, with its key as a bearer token ----

  // A lamp only says hello; anything bigger than this is not a lamp.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  // The key only in a header, never the address, so it stays out of proxy and access logs.
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const key = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
    const row = key ? (db.prepare('SELECT * FROM lanterns WHERE token = ?').get(tokenHash(key)) as Row | undefined) : undefined;
    if (!row) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      // The same lamp coming back (it rebooted, or the Wi-Fi blinked): the old connection goes.
      lamps.get(row.id)?.ws.terminate();
      const lamp: Lamp = { ws, id: row.id, userId: row.user_id, fires: watched(row), sent: '' };
      lamps.set(row.id, lamp);
      db.prepare('UPDATE lanterns SET last_seen_at = ? WHERE id = ?').run(now(), row.id);
      ws.send(JSON.stringify({ type: 'hello', name: row.name }));
      show(lamp, row);
      let alive = true;
      ws.on('pong', () => (alive = true));
      const ping = setInterval(() => {
        if (!alive) return ws.terminate();
        alive = false;
        ws.ping();
      }, 30_000);
      ws.on('error', () => ws.terminate());
      ws.on('message', () => {}); // nothing a lamp says changes anything
      ws.on('close', () => {
        clearInterval(ping);
        if (lamps.get(row.id) !== lamp) return;
        lamps.delete(row.id);
        db.prepare('UPDATE lanterns SET last_seen_at = ? WHERE id = ?').run(now(), row.id);
      });
    });
  };

  const stop = () => {
    clearInterval(refreshTimer);
    for (const lamp of lamps.values()) lamp.ws.terminate();
    wss.close();
  };

  return { fireChanged, upgrade, stop };
}
