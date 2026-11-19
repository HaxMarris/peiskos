// Push alerts while Peiskos is closed: web push, Apple (APNs) and Android (FCM) devices,
// who gets an alert for what, and the server's own push keys.
import { createApns } from './apns.ts';
import type { AppOptions, Channel, Handler, StatusRow } from './app.ts';
import type { Db } from './db.ts';
import { createFcm } from './fcm.ts';
import { HttpError, type Json } from './http.ts';
import { newVapidKeys, sendPush, type VapidKeys, vapidKeysWork } from './push.ts';

export interface AlertsContext {
  blocked: (viewer: number, other: number) => boolean;
  channelAudience: (channel: Channel) => number[];
  db: Db;
  inQuietHours: (userId: number, t?: number) => boolean;
  inVoice: Map<number, number>;
  isGroupDm: (serverId: number) => boolean;
  nameIn: (serverId: number, userId: number) => string;
  notifyPrefsOf: (userId: number, serverId: number) => Map<number, { level: string | null; mutedUntil: number | null; }>;
  now: () => number;
  online: Set<number>;
  opts: AppOptions;
  placeOf: (channelId: number, viewerId: number) => { serverId: unknown; channelId: number; kind: string; serverName: unknown; channelName: unknown; threadName: unknown; } | null;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => number;
  sendTo: (userIds: Iterable<number>, event: Json) => void;
  serverKind: (serverId: number) => string | undefined;
  statusRow: (userId: number) => StatusRow | undefined;
  userIdle: (userId: number) => boolean;
  usersInVoice: (channelId: number) => number[];
}

export function alerts(ctx: AlertsContext) {
  const {
    blocked, channelAudience, db, inQuietHours, inVoice, isGroupDm, nameIn, notifyPrefsOf, now, online, opts,
    placeOf, route, sendTo, serverKind, statusRow, userIdle, usersInVoice,
  } = ctx;

  // ---- push: alerts while Peiskos is closed ----

  const vapid: VapidKeys = (() => {
    const saved = db.prepare("SELECT value FROM app_secrets WHERE name = 'vapid'").get() as { value: string } | undefined;
    if (saved) {
      try {
        const keys = JSON.parse(saved.value) as VapidKeys;
        if (vapidKeysWork(keys)) return keys;
      } catch {}
    }
    const keys = newVapidKeys();
    db.prepare("INSERT OR REPLACE INTO app_secrets (name, value) VALUES ('vapid', ?)").run(JSON.stringify(keys));
    return keys;
  })();
  const pushContact = opts.pushContact || 'https://github.com/HaxMarris/peiskos';
  // Only the big browsers' push services, so nobody can make the server post to anywhere else.
  const PUSH_HOSTS = ['.googleapis.com', '.mozilla.com', '.push.apple.com', '.notify.windows.com', ...(opts.pushHosts ?? [])];
  const pushHostAllowed = (endpoint: string) => {
    try {
      const u = new URL(endpoint);
      const testHost = opts.pushHosts?.includes(u.host);
      return (u.protocol === 'https:' || (testHost && u.protocol === 'http:')) && (testHost || PUSH_HOSTS.some((h) => h.startsWith('.') && u.hostname.endsWith(h)));
    } catch {
      return false;
    }
  };
  const MAX_PUSH_DEVICES = 10;

  route('GET', '/api/push/key', () => ({ key: vapid.publicKey }));
  route('POST', '/api/push', ({ user, body, session }) => {
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
    const keys = (body.keys ?? {}) as Json;
    const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh : '';
    const auth = typeof keys.auth === 'string' ? keys.auth : '';
    if (endpoint.length > 2000 || !pushHostAllowed(endpoint)) throw new HttpError(400, "That browser's alerts aren't supported");
    if (Buffer.from(p256dh, 'base64url').length !== 65 || Buffer.from(auth, 'base64url').length !== 16) throw new HttpError(400, "Turning on alerts didn't work. Try again.");
    db.prepare(
      `INSERT INTO push_subs (user_id, endpoint, p256dh, auth, created_at, session) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = excluded.created_at, session = excluded.session`,
    ).run(user.id, endpoint, p256dh, auth, now(), session ?? null);
    db.prepare(
      `DELETE FROM push_subs WHERE user_id = ? AND id NOT IN (SELECT id FROM push_subs WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ${MAX_PUSH_DEVICES})`,
    ).run(user.id, user.id);
    return { ok: true };
  });
  // The phone apps' tokens, kept alongside browsers' subscriptions as "apns:<token>" (iPhone,
  // through Apple) or "fcm:<token>" (Android, through Google's Firebase).
  const apns = opts.apns ? createApns(opts.apns) : null;
  if (opts.apns && !apns?.ready) console.warn("APNS_KEY isn't a key from Apple, so the iPhone app won't get alerts.");
  const fcm = opts.fcm ? createFcm(opts.fcm) : null;
  if (opts.fcm && !fcm?.ready) console.warn("FCM_SERVICE_ACCOUNT isn't a Firebase service account file, so the Android app won't get alerts.");
  const saveAppToken = (userId: number, endpoint: string, session: string | undefined) => {
    db.prepare(
      `INSERT INTO push_subs (user_id, endpoint, p256dh, auth, created_at, session) VALUES (?, ?, '', '', ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, created_at = excluded.created_at, session = excluded.session`,
    ).run(userId, endpoint, now(), session ?? null);
    db.prepare(
      `DELETE FROM push_subs WHERE user_id = ? AND id NOT IN (SELECT id FROM push_subs WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ${MAX_PUSH_DEVICES})`,
    ).run(userId, userId);
  };
  route('POST', '/api/push/apns', ({ user, body, session }) => {
    const token = typeof body.token === 'string' ? body.token.toLowerCase() : '';
    if (!/^[0-9a-f]{64,200}$/.test(token)) throw new HttpError(400, "That doesn't look like an iPhone's alert token");
    saveAppToken(user.id, `apns:${token}`, session);
    return { ok: true, sending: !!apns?.ready };
  });
  route('POST', '/api/push/fcm', ({ user, body, session }) => {
    const token = typeof body.token === 'string' ? body.token : '';
    if (!/^[\w:-]{32,1000}$/.test(token)) throw new HttpError(400, "That doesn't look like an Android alert token");
    saveAppToken(user.id, `fcm:${token}`, session);
    return { ok: true, sending: !!fcm?.ready };
  });
  route('DELETE', '/api/push', ({ user, body }) => {
    db.prepare('DELETE FROM push_subs WHERE user_id = ? AND endpoint = ?').run(user.id, String(body.endpoint ?? ''));
    return { ok: true };
  });

  /** Unread @mentions plus unread direct messages, for the number on the app icon. */
  const badgeCount = (userId: number) => {
    const mentions = (db
      .prepare(
        `SELECT COUNT(*) AS n FROM (SELECT 1 FROM mentions x JOIN messages m ON m.id = x.message_id
         LEFT JOIN read_state r ON r.user_id = x.user_id AND r.channel_id = m.channel_id
         WHERE x.user_id = ? AND m.id > COALESCE(r.last_read_id, 0) LIMIT 100)`,
      )
      .get(userId) as { n: number }).n;
    const dms = (db
      .prepare(
        `SELECT COUNT(*) AS n FROM (SELECT 1 FROM members mb JOIN servers s ON s.id = mb.server_id AND s.kind = 'dm'
         JOIN channels c ON c.server_id = s.id JOIN messages m ON m.channel_id = c.id
         LEFT JOIN read_state r ON r.user_id = mb.user_id AND r.channel_id = c.id
         WHERE mb.user_id = ? AND m.author_id != mb.user_id AND m.id > COALESCE(r.last_read_id, 0) AND m.created_at >= mb.joined_at LIMIT 100)`,
      )
      .get(userId) as { n: number }).n;
    return Math.min(99, mentions + dms);
  };

  /** message.private is what the alert says instead for people who turned off message text in alerts. */
  const pushTo = (userId: number, full: Json) => {
    const { private: instead, ...rest } = full;
    // Without message text: no names or words, which Apple and Google would otherwise carry.
    const text = (db.prepare('SELECT alert_text FROM users WHERE id = ?').get(userId) as { alert_text: number } | undefined)?.alert_text !== 0;
    const message: Json = text ? rest : { ...rest, title: 'Peiskos', body: String(instead ?? 'New message') };
    const subs = db.prepare('SELECT endpoint, p256dh, auth FROM push_subs WHERE user_id = ?').all(userId) as { endpoint: string; p256dh: string; auth: string }[];
    for (const sub of subs) {
      const app = {
        title: String(message.title ?? ''),
        body: String(message.body ?? ''),
        badge: message.badge as number | undefined,
        silent: !!message.silent,
        data: { channelId: message.channelId, messageId: message.messageId },
      };
      const sent = sub.endpoint.startsWith('apns:')
        ? apns?.send(sub.endpoint.slice(5), { ...app, thread: message.tag as string | undefined }) ?? Promise.resolve('failed' as const)
        : sub.endpoint.startsWith('fcm:')
          ? fcm?.send(sub.endpoint.slice(4), { ...app, tag: message.tag as string | undefined }) ?? Promise.resolve('failed' as const)
          : sendPush(sub, message, vapid, pushContact);
      void sent.then((result) => {
        if (result === 'gone') db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(sub.endpoint);
      });
    }
  };

  /** A message's text without formatting marks, for an alert or an email. */
  const plainPreview = (m: Json) => {
    const text = String(m.content ?? '')
      .replace(/```[\s\S]*?```/g, '[code]')
      .replace(/\|\|[\s\S]*?\|\|/g, '[spoiler]')
      .replace(/[*_~`>#]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) return text.length > 200 ? text.slice(0, 199) + '…' : text;
    const files = m.attachments as Json[] | undefined;
    return m.poll ? `Poll: ${(m.poll as Json).question}` : m.sticker ? 'Sent a sticker' : files?.length ? `Sent ${files.length === 1 ? 'a file' : `${files.length} files`}` : '';
  };

  /**
   * After a message is sent: pushes to the phones and browsers of people it's for who aren't
   * looking at Peiskos right now, and remembers mentions for email. Muted rooms, "nothing" and
   * do not disturb stay silent; quiet hours make the alert silent.
   */
  const alertAway = (channel: Channel, message: Json, forWhom: Set<number>) => {
    const dm = serverKind(channel.serverId) === 'dm';
    const room = channel.kind === 'thread' && channel.parentId !== null ? channel.parentId : channel.id;
    const place = placeOf(channel.id, message.authorId as number);
    for (const id of channelAudience(channel)) {
      if (id === message.authorId || blocked(id, message.authorId as number)) continue;
      const forThem = dm || forWhom.has(id);
      const prefs = notifyPrefsOf(id, channel.serverId);
      const roomPref = prefs.get(room), burrowPref = prefs.get(0);
      if (roomPref?.mutedUntil || burrowPref?.mutedUntil) continue;
      const level = roomPref?.level ?? burrowPref?.level ?? null;
      if (level === 'none') continue;
      // Every message, like the app's own sounds, unless they set the room to only @mentions.
      if (!forThem && level === 'mentions') continue;
      if (statusRow(id)?.status === 'dnd') continue;
      if (online.has(id) && !userIdle(id)) continue; // they'll see it in the app
      const where = dm
        ? isGroupDm(channel.serverId) ? `${message.author} in ${(db.prepare('SELECT name FROM servers WHERE id = ?').get(channel.serverId) as { name: string }).name || 'your group'}` : String(message.author)
        : `${message.author} in #${place?.channelName ?? channel.name}${place?.threadName ? ` › ${place.threadName}` : ''} (${place?.serverName ?? ''})`;
      pushTo(id, {
        title: where,
        body: plainPreview(message),
        tag: `room-${channel.id}`,
        channelId: channel.id,
        messageId: message.id,
        silent: inQuietHours(id),
        badge: badgeCount(id),
      });
    }
  };

  /**
   * A second person sat down at a hearth's fire: the rest of the hearth hears that friends are
   * gathering, once every two hours per fire. In the app it's a note with a Join button; away from
   * it, a push. Muted hearths, ones set to only @mentions or nothing, and do not disturb stay quiet.
   */
  const lastNudge = new Map<number, number>();
  const nudgeGathered = (channel: Channel) => {
    if (serverKind(channel.serverId) === 'dm') return;
    if ((lastNudge.get(channel.id) ?? 0) > now() - 2 * 3600e3) return;
    lastNudge.set(channel.id, now());
    const there = usersInVoice(channel.id);
    const names = there.map((id) => nameIn(channel.serverId, id));
    const hearth = (db.prepare('SELECT name FROM servers WHERE id = ?').get(channel.serverId) as { name: string } | undefined)?.name ?? '';
    const text = `${names.join(' and ')} are at the fire in ${hearth}`;
    for (const id of channelAudience(channel)) {
      if (there.includes(id) || inVoice.has(id)) continue;
      if (there.some((u) => blocked(id, u))) continue;
      const prefs = notifyPrefsOf(id, channel.serverId);
      const burrowPref = prefs.get(0), roomPref = prefs.get(channel.id);
      if (burrowPref?.mutedUntil || roomPref?.mutedUntil) continue;
      const level = roomPref?.level ?? burrowPref?.level ?? null;
      if (level === 'none' || level === 'mentions') continue;
      if (statusRow(id)?.status === 'dnd') continue;
      if (online.has(id) && !userIdle(id)) sendTo([id], { type: 'fire_gathered', serverId: channel.serverId, channelId: channel.id, text });
      else pushTo(id, { title: hearth, body: text, private: 'Friends are at the fire', tag: `fire-${channel.id}`, silent: inQuietHours(id) });
    }
  };

  return { alertAway, nudgeGathered, pushTo };
}
