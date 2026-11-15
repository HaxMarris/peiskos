// The calendar feed: your hearths' events as an iCalendar link for Google, Apple or Outlook.
import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppOptions, Channel, Handler } from './app.ts';
import type { Db } from './db.ts';
import { EVENT_REMIND_MS } from './events.ts';
import { type Json, send } from './http.ts';

export interface CalendarContext {
  canSee: (channel: Channel, userId: number) => boolean;
  channelById: (id: number) => Channel | undefined;
  db: Db;
  isMember: (serverId: number, userId: number) => boolean;
  now: () => number;
  opts: AppOptions;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => number;
  sendTo: (userIds: Iterable<number>, event: Json) => void;
}

export function calendarFeed(ctx: CalendarContext) {
  const {
    canSee, channelById, db, isMember, now, opts, route, sendTo,
  } = ctx;

  // ---- calendar feed: your hearths' events in Google, Apple or Outlook calendar ----

  route('GET', '/api/me/calendar', ({ user }) => ({ on: !!db.prepare('SELECT 1 FROM calendar_feeds WHERE user_id = ?').get(user.id) }));
  // A new address each time, so turning it off and on again cuts off anyone who had the old one.
  route('POST', '/api/me/calendar', ({ user }) => {
    const token = randomBytes(24).toString('base64url');
    db.prepare(`INSERT INTO calendar_feeds (user_id, token_hash, created_at) VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at`)
      .run(user.id, createHash('sha256').update(token).digest('hex'), now());
    return { on: true, path: `/calendar/${token}.ics` };
  });
  route('DELETE', '/api/me/calendar', ({ user }) => {
    db.prepare('DELETE FROM calendar_feeds WHERE user_id = ?').run(user.id);
    return { on: false };
  });

  const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const icsTime = (t: number) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  /** Lines longer than 75 bytes are folded, as calendar files want. */
  const icsFold = (line: string) => {
    const out: string[] = [];
    let rest = line;
    while (Buffer.byteLength(rest) > 75) {
      let cut = 74;
      while (Buffer.byteLength(rest.slice(0, cut)) > 74) cut--;
      out.push(rest.slice(0, cut));
      rest = ' ' + rest.slice(cut);
    }
    out.push(rest);
    return out.join('\r\n');
  };
  const sendCalendar = (req: IncomingMessage, res: ServerResponse, token: string) => {
    const feed = db.prepare('SELECT user_id FROM calendar_feeds WHERE token_hash = ?').get(createHash('sha256').update(token).digest('hex')) as { user_id: number } | undefined;
    if (!feed) return send(res, 404, { error: 'This calendar address was turned off. Get a new one from Peiskos.' });
    const secure = req.headers['x-forwarded-proto'] === 'https' || !!(req.socket as { encrypted?: boolean }).encrypted;
    const base = (opts.publicUrl || `${secure ? 'https' : 'http'}://${String(req.headers.host ?? 'localhost')}`).replace(/\/$/, '');
    const host = new URL(base).hostname;
    const rows = db.prepare(
      `SELECT e.id, e.server_id AS serverId, e.title, e.details, e.starts_at AS startsAt, e.channel_id AS channelId, e.created_at AS createdAt, s.name AS hearth
       FROM events e JOIN servers s ON s.id = e.server_id JOIN members m ON m.server_id = e.server_id AND m.user_id = ?
       WHERE e.starts_at > ? ORDER BY e.starts_at LIMIT 500`,
    ).all(feed.user_id, now() - 60 * 86400_000) as { id: number; serverId: number; title: string; details: string; startsAt: number; channelId: number | null; createdAt: number; hearth: string }[];
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Peiskos//Events//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Peiskos', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H'];
    for (const e of rows) {
      const room = e.channelId === null ? null : channelById(e.channelId);
      if (room && !canSee(room, feed.user_id)) continue;
      const status = (db.prepare('SELECT status FROM event_rsvps WHERE event_id = ? AND user_id = ?').get(e.id, feed.user_id) as { status: string } | undefined)?.status;
      if (status === 'no') continue;
      lines.push('BEGIN:VEVENT', `UID:event-${e.id}@${host}`, `DTSTAMP:${icsTime(e.createdAt)}`, `DTSTART:${icsTime(e.startsAt)}`, 'DURATION:PT2H',
        `SUMMARY:${icsText(e.title)}`, `DESCRIPTION:${icsText([e.details, `${e.hearth}${room ? ` · #${room.name}` : ''} on Peiskos`].filter(Boolean).join('\n\n'))}`,
        `LOCATION:${icsText(`${e.hearth}${room ? ` · #${room.name}` : ''}`)}`, `URL:${base}/`, ...(status === 'maybe' ? ['STATUS:TENTATIVE'] : []), 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    const body = lines.map(icsFold).join('\r\n') + '\r\n';
    res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' });
    res.end(body);
  };

  /** Tells the people going (or maybe going) that an event starts soon. */
  const remindEvents = () => {
    const due = db
      .prepare('SELECT id, server_id, title, starts_at, channel_id FROM events WHERE reminded = 0 AND starts_at - ? <= ? AND starts_at > ?')
      .all(EVENT_REMIND_MS, now(), now() - 3600_000) as { id: number; server_id: number; title: string; starts_at: number; channel_id: number | null }[];
    for (const e of due) {
      db.prepare('UPDATE events SET reminded = 1 WHERE id = ?').run(e.id);
      const people = (db.prepare("SELECT user_id FROM event_rsvps WHERE event_id = ? AND status IN ('going', 'maybe')").all(e.id) as { user_id: number }[])
        .map((r) => r.user_id)
        .filter((id) => isMember(e.server_id, id));
      sendTo(people, { type: 'event_reminder', serverId: e.server_id, event: { id: e.id, title: e.title, startsAt: e.starts_at, channelId: e.channel_id } });
    }
  };

  return { remindEvents, sendCalendar };
}
