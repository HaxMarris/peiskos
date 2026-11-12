// Events: game nights and the like in a hearth, with RSVPs and a reminder shortly before they start.
// The clock in app.ts sends the reminders; the calendar feed there reads the same rows.
import type { Db } from './db.ts';
import { HttpError, type Json } from './http.ts';
import type { Channel, Handler, Perm, Standing, User } from './app.ts';

export interface EventsContext {
  allowed: (serverId: number, user: User, perm: Perm) => Standing;
  canSee: (channel: Channel, userId: number) => boolean;
  channelById: (id: number) => Channel | undefined;
  cleanName: (value: unknown, field: string, max?: number) => string;
  db: Db;
  isMember: (serverId: number, userId: number) => boolean;
  notTooFast: (userId: number) => void;
  now: () => number;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => unknown;
  sendServerUpdate: (serverId: number) => void;
  serverKind: (serverId: number) => string | undefined;
  serverSummary: (serverId: number, viewerId: number) => unknown;
  wakeAt: (t: number) => void;
}

export function hearthEvents(ctx: EventsContext) {
  const {
    allowed, canSee, channelById, cleanName, db, isMember, notTooFast, now, route, sendServerUpdate, serverKind,
    serverSummary, wakeAt,
  } = ctx;

  const EVENT_REMIND_MS = 15 * 60_000;
  /** Upcoming events in a burrow, and ones that started in the last few hours. */
  const eventsIn = (serverId: number, viewerId: number) => {
    const rows = db
      .prepare(
        `SELECT id, title, details, starts_at AS startsAt, channel_id AS channelId, created_by AS createdBy FROM events
         WHERE server_id = ? AND starts_at > ? ORDER BY starts_at LIMIT 50`,
      )
      .all(serverId, now() - 3 * 3600_000) as Json[];
    return rows
      .filter((e) => {
        const c = e.channelId === null ? null : channelById(e.channelId as number);
        if (c && !canSee(c, viewerId)) return false;
        if (!c) e.channelId = null;
        return true;
      })
      .map((e) => ({
        ...e,
        rsvps: db.prepare('SELECT user_id AS userId, status FROM event_rsvps WHERE event_id = ?').all(e.id as number),
      }));
  };
  const eventById = (id: number) =>
    db.prepare('SELECT id, server_id AS serverId, created_by AS createdBy, starts_at AS startsAt, title FROM events WHERE id = ?').get(id) as
      | { id: number; serverId: number; createdBy: number | null; startsAt: number; title: string }
      | undefined;
  const cleanEvent = (serverId: number, user: User, body: Json, partial = false) => {
    const out: Json = {};
    if (!partial || body.title !== undefined) out.title = cleanName(body.title, 'Event name', 100);
    if (!partial || body.details !== undefined) {
      const details = typeof body.details === 'string' ? body.details.trim() : '';
      if (details.length > 1000) throw new HttpError(400, 'The details can be at most 1000 characters');
      out.details = details;
    }
    if (!partial || body.startsAt !== undefined) {
      const t = Math.floor(Number(body.startsAt));
      if (!(t > now() - 60_000 && t < now() + 366 * 86400_000)) throw new HttpError(400, 'Pick a time in the next year');
      out.starts_at = t;
      out.reminded = t - EVENT_REMIND_MS <= now() ? 1 : 0;
    }
    if (!partial || body.channelId !== undefined) {
      const c = body.channelId == null ? null : channelById(Number(body.channelId));
      if (c && (c.serverId !== serverId || !canSee(c, user.id))) throw new HttpError(400, "That room isn't in this hearth");
      out.channel_id = c?.id ?? null;
    }
    return out;
  };
  /** The event, if you made it or can edit the burrow. */
  const ownEvent = (id: number, user: User) => {
    const e = eventById(id);
    if (!e || !isMember(e.serverId, user.id)) throw new HttpError(404, 'That event is gone. It may have been cancelled.');
    if (e.createdBy !== user.id) allowed(e.serverId, user, 'burrow');
    return e;
  };

  route('POST', '/api/servers/:id/events', ({ user, params, body }) => {
    const serverId = Number(params[0]);
    const kind = serverKind(serverId);
    if (kind !== 'burrow' || !isMember(serverId, user.id)) throw new HttpError(404, "That hearth is gone, or you're not in it.");
    const upcoming = (db.prepare('SELECT COUNT(*) AS n FROM events WHERE server_id = ? AND starts_at > ?').get(serverId, now()) as { n: number }).n;
    if (upcoming >= 50) throw new HttpError(400, 'This hearth has 50 events coming up already');
    const e = cleanEvent(serverId, user, body);
    const r = db
      .prepare('INSERT INTO events (server_id, channel_id, title, details, starts_at, created_by, created_at, reminded) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(serverId, e.channel_id as number | null, e.title as string, e.details as string, e.starts_at as number, user.id, now(), e.reminded as number);
    // Whoever plans it is going.
    db.prepare("INSERT INTO event_rsvps (event_id, user_id, status) VALUES (?, ?, 'going')").run(Number(r.lastInsertRowid), user.id);
    wakeAt((e.starts_at as number) - EVENT_REMIND_MS);
    sendServerUpdate(serverId);
    return serverSummary(serverId, user.id);
  });

  route('PATCH', '/api/events/:id', ({ user, params, body }) => {
    const ev = ownEvent(Number(params[0]), user);
    const e = cleanEvent(ev.serverId, user, body, true);
    for (const [col, value] of Object.entries(e)) db.prepare(`UPDATE events SET ${col} = ? WHERE id = ?`).run(value as string | number | null, ev.id);
    if (e.starts_at) wakeAt((e.starts_at as number) - EVENT_REMIND_MS);
    sendServerUpdate(ev.serverId);
    return serverSummary(ev.serverId, user.id);
  });

  route('DELETE', '/api/events/:id', ({ user, params }) => {
    const ev = ownEvent(Number(params[0]), user);
    db.prepare('DELETE FROM events WHERE id = ?').run(ev.id);
    sendServerUpdate(ev.serverId);
    return serverSummary(ev.serverId, user.id);
  });

  // Going, maybe, or not going (null takes your answer back).
  route('POST', '/api/events/:id/rsvp', ({ user, params, body }) => {
    const ev = eventById(Number(params[0]));
    if (!ev || !isMember(ev.serverId, user.id)) throw new HttpError(404, 'That event is gone. It may have been cancelled.');
    notTooFast(user.id);
    if (['going', 'maybe', 'no'].includes(body.status as string))
      db.prepare(
        `INSERT INTO event_rsvps (event_id, user_id, status) VALUES (?, ?, ?)
         ON CONFLICT (event_id, user_id) DO UPDATE SET status = excluded.status`,
      ).run(ev.id, user.id, body.status as string);
    else db.prepare('DELETE FROM event_rsvps WHERE event_id = ? AND user_id = ?').run(ev.id, user.id);
    sendServerUpdate(ev.serverId);
    return serverSummary(ev.serverId, user.id);
  });

  return {
    eventsIn, EVENT_REMIND_MS,
  };
}
