// Moderation in a hearth: timeouts, muting someone at the fire for everyone, the audit log, bulk
// delete, the word filter, reports, and how big an upload each role may send.
import type { Db } from './db.ts';
import { HttpError, type Json } from './http.ts';
import { fallbackContact } from './legal.ts';
import { looksLikeEmail, sendMail } from './mail.ts';
import { setCanSpeak, type VoiceOptions } from './voice.ts';
import type { AppOptions, Channel, Handler, Perm, Standing, User } from './app.ts';

export interface ModerationContext {
  opts: AppOptions;
  isAdmin: (userId: number) => boolean;
  avatarUrl: (col: string) => string;
  allowed: (serverId: number, user: User, perm: Perm) => Standing;
  broadcastToChannel: (channel: Channel, event: Json) => void;
  can: (serverId: number, userId: number, perm: Perm) => boolean;
  channelById: (id: number) => Channel | undefined;
  db: Db;
  isMember: (serverId: number, userId: number) => boolean;
  liveFire: (userId: number) => number | undefined;
  maxUpload: number;
  messageById: (id: number) => Json | undefined;
  now: () => number;
  online: Set<number>;
  removeFiles: (rows: Json[]) => void;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => unknown;
  sendServerUpdate: (serverId: number) => void;
  sendTo: (userIds: Iterable<number>, event: Json) => void;
  serverMemberIds: (serverId: number) => number[];
  serverMuted: (serverId: number, userId: number) => boolean;
  standing: (serverId: number, userId: number) => Standing | null;
  tellLiveKit: (what: string, call: (voice: VoiceOptions) => Promise<void>) => void;
  threadChanged: (thread: Channel) => void;
  visibleMessage: (user: User, id: number) => { channel: Channel; authorId: number; };
  visibleRoom: (id: number, userId: number) => Channel;
  voiceStateEvent: (channelId: number) => { type: string; channelId: number; userIds: number[]; muted: number[]; deafened: number[]; serverMuted: number[]; speaking: number[]; };
}

export function moderation(ctx: ModerationContext) {
  const {
    opts, isAdmin, avatarUrl, maxUpload, allowed, broadcastToChannel, can, channelById, db, isMember, liveFire, messageById, now, online,
    removeFiles, route, sendServerUpdate, sendTo, serverMemberIds, serverMuted, standing, tellLiveKit, threadChanged,
    visibleMessage, visibleRoom, voiceStateEvent,
  } = ctx;

  const isBurrow = (serverId: number) => !!db.prepare("SELECT 1 FROM servers WHERE id = ? AND kind = 'burrow'").get(serverId);
  const roleName = (id: number) => (db.prepare('SELECT name FROM roles WHERE id = ?').get(id) as { name: string } | undefined)?.name ?? '';
  const BURROW_FIELDS: Record<string, string> = {
    name: 'name', description: 'description', welcomeChannelId: 'welcome room', afkChannelId: 'AFK fire', afkMinutes: 'AFK time',
    rules: 'rules', uploadMb: 'upload limit', wordFilter: 'word filter', liveChannelId: 'go-live room',
  };

  /** Notes who did what, for the audit log. */
  const audit = (serverId: number, actorId: number | null, action: string, targetId: number | null, detail = '') => {
    if (!isBurrow(serverId)) return;
    db.prepare('INSERT INTO audit_log (server_id, actor_id, action, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      serverId, actorId, action, targetId, detail.slice(0, 300), now(),
    );
  };
  route('GET', '/api/servers/:id/audit', ({ user, params, url }) => {
    const serverId = Number(params[0]);
    allowed(serverId, user, 'audit');
    const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
    const rows = db
      .prepare(
        `SELECT a.id, a.action, a.detail, a.created_at AS createdAt, a.actor_id AS actorId, COALESCE(ua.display_name, ua.username) AS actor, a.target_id AS targetId, COALESCE(ut.display_name, ut.username) AS target
         FROM audit_log a LEFT JOIN users ua ON ua.id = a.actor_id LEFT JOIN users ut ON ut.id = a.target_id
         WHERE a.server_id = ? AND a.id < ? ORDER BY a.id DESC LIMIT 51`,
      )
      .all(serverId, before) as Json[];
    return { entries: rows.slice(0, 50), more: rows.length > 50 };
  });

  // Timeouts: someone can't write, react with files, or talk at a fire until it runs out.
  const MAX_TIMEOUT_MINUTES = 7 * 24 * 60;
  const timeoutTimers = new Map<string, NodeJS.Timeout>();
  const timeoutUntil = (serverId: number, userId: number) =>
    (db.prepare('SELECT timeout_until FROM members WHERE server_id = ? AND user_id = ?').get(serverId, userId) as { timeout_until: number | null } | undefined)?.timeout_until ?? 0;
  /** "12 minutes" or "3 hours" left on a timeout, or null if there isn't one. */
  const timeoutLeft = (serverId: number, userId: number) => {
    const ms = timeoutUntil(serverId, userId) - now();
    if (ms <= 0) return null;
    const minutes = Math.ceil(ms / 60000);
    if (minutes < 60) return `${minutes} more minute${minutes === 1 ? '' : 's'}`;
    const hours = Math.round(minutes / 60);
    return hours < 48 ? `${hours} more hour${hours === 1 ? '' : 's'}` : `${Math.round(hours / 24)} more days`;
  };
  /** Tells LiveKit whether someone at a fire can speak, after a timeout starts or ends. */
  const voiceRightsChanged = (serverId: number, userId: number) => {
    const channel = channelById(liveFire(userId) ?? -1);
    if (channel?.serverId !== serverId) return;
    tellLiveKit(`change whether user ${userId} can speak`, (v) => setCanSpeak(v, `room-${channel.id}`, String(userId), !serverMuted(serverId, userId)));
    broadcastToChannel(channel, voiceStateEvent(channel.id));
  };
  const scheduleTimeoutEnd = (serverId: number, userId: number, until: number) => {
    const key = `${serverId}:${userId}`;
    clearTimeout(timeoutTimers.get(key));
    timeoutTimers.delete(key);
    if (until <= now()) return;
    const t = setTimeout(() => {
      timeoutTimers.delete(key);
      if (timeoutUntil(serverId, userId) > now()) return;
      voiceRightsChanged(serverId, userId);
      sendServerUpdate(serverId);
    }, Math.min(until - now() + 500, 2 ** 31 - 1));
    t.unref();
    timeoutTimers.set(key, t);
  };
  for (const r of db.prepare('SELECT server_id, user_id, timeout_until FROM members WHERE timeout_until > ?').all(now()) as { server_id: number; user_id: number; timeout_until: number }[])
    scheduleTimeoutEnd(r.server_id, r.user_id, r.timeout_until);

  route('POST', '/api/servers/:id/members/:id/timeout', ({ user, params, body }) => {
    const [serverId, targetId] = params.map(Number);
    const me = allowed(serverId, user, 'timeout');
    const target = standing(serverId, targetId);
    if (!target) throw new HttpError(404, "They aren't in this hearth");
    if (target.host || target.rank <= me.rank || targetId === user.id) throw new HttpError(403, "You can't time them out");
    const minutes = Math.floor(Number(body.minutes) || 0);
    if (minutes < 0 || minutes > MAX_TIMEOUT_MINUTES) throw new HttpError(400, 'A timeout can last up to a week');
    const until = minutes ? now() + minutes * 60000 : null;
    db.prepare('UPDATE members SET timeout_until = ? WHERE server_id = ? AND user_id = ?').run(until, serverId, targetId);
    audit(serverId, user.id, until ? 'timeout' : 'timeout_end', targetId, until ? `${minutes} minutes` : '');
    scheduleTimeoutEnd(serverId, targetId, until ?? 0);
    voiceRightsChanged(serverId, targetId);
    sendServerUpdate(serverId);
    return { ok: true, timeoutUntil: until };
  });

  // Bulk delete: a message and everything after it in the room, up to 100 at a time.
  const MAX_BULK = 100;
  route('POST', '/api/channels/:id/bulk-delete', ({ user, params, body }) => {
    const channel = visibleRoom(Number(params[0]), user.id);
    allowed(channel.serverId, user, 'messages');
    const fromId = Number(body.fromId);
    const ids = (db.prepare('SELECT id FROM messages WHERE channel_id = ? AND id >= ? ORDER BY id LIMIT ?').all(channel.id, fromId, MAX_BULK + 1) as { id: number }[]).map((r) => r.id);
    if (!ids.length) throw new HttpError(404, 'That message is gone. It may have been deleted.');
    if (ids.length > MAX_BULK) throw new HttpError(400, `That's more than ${MAX_BULK} messages. Pick a newer one to start from.`);
    for (const id of ids) {
      removeFiles(db.prepare('SELECT id FROM attachments WHERE message_id = ?').all(id) as Json[]);
      db.prepare('DELETE FROM messages WHERE id = ?').run(id);
      broadcastToChannel(channel, { type: 'message_deleted', id, channelId: channel.id });
    }
    audit(channel.serverId, user.id, 'bulk_delete', null, `${ids.length} message${ids.length === 1 ? '' : 's'} in #${channel.name}`);
    if (channel.kind === 'thread') threadChanged(channel);
    return { deleted: ids.length };
  });

  // The word filter: chosen words either stop a message, or let it through and report it.
  type WordFilter = { words: string[]; action: 'block' | 'flag' };
  const cleanWordFilter = (value: unknown) => {
    if (value === null) return null;
    const v = (value ?? {}) as Json;
    const words = [...new Set((Array.isArray(v.words) ? v.words : []).map((w) => String(w).trim().toLowerCase()).filter(Boolean))];
    if (words.length > 200) throw new HttpError(400, 'The word filter can hold up to 200 words');
    if (words.some((w) => w.length > 40)) throw new HttpError(400, 'Each filtered word can be at most 40 characters');
    if (!words.length) return null;
    return JSON.stringify({ words, action: v.action === 'flag' ? 'flag' : 'block' });
  };
  const wordFilterOf = (serverId: number): WordFilter | null => {
    const raw = (db.prepare('SELECT word_filter FROM servers WHERE id = ?').get(serverId) as { word_filter: string | null } | undefined)?.word_filter;
    return raw ? JSON.parse(raw) : null;
  };
  const filterRegexes = new Map<string, RegExp>();
  /** The first filtered word in a message, matched as a whole word in any letter case. */
  const filteredWord = (filter: WordFilter, text: string) => {
    for (const word of filter.words) {
      let re = filterRegexes.get(word);
      if (!re) {
        re = new RegExp(`(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu');
        if (filterRegexes.size > 5000) filterRegexes.clear();
        filterRegexes.set(word, re);
      }
      if (re.test(text)) return word;
    }
    return null;
  };
  /** Stops a message the filter blocks; returns the word if it should be reported instead. People who manage messages are exempt. */
  const filterCheck = (channel: Channel, userId: number, text: string) => {
    const filter = text ? wordFilterOf(channel.serverId) : null;
    if (!filter || can(channel.serverId, userId, 'messages')) return null;
    const word = filteredWord(filter, text);
    if (word && filter.action === 'block') throw new HttpError(400, "Your message has a word this hearth doesn't allow");
    return word;
  };

  // Reports: anyone can flag a message for the people who manage messages.
  const openReports = (serverId: number) =>
    (db.prepare('SELECT COUNT(*) AS n FROM reports WHERE server_id = ? AND resolved_at IS NULL').get(serverId) as { n: number }).n;
  const reportsChanged = (serverId: number) => {
    const count = openReports(serverId);
    sendTo(serverMemberIds(serverId).filter((id) => can(serverId, id, 'messages')), { type: 'reports', serverId, open: count });
  };
  const fileReport = (serverId: number, message: Json, reporterId: number | null, reason: string) => {
    db.prepare(
      'INSERT INTO reports (server_id, message_id, channel_id, author_id, content, reporter_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(serverId, message.id as number, message.channelId as number, message.authorId as number, String(message.content ?? '').slice(0, 1000), reporterId, reason.slice(0, 200), now());
    reportsChanged(serverId);
  };
  route('POST', '/api/messages/:id/report', ({ user, params, body }) => {
    const { channel } = visibleMessage(user, Number(params[0]));
    const message = messageById(Number(params[0]))!;
    if (!isBurrow(channel.serverId)) throw new HttpError(400, 'Only messages in hearths can be reported');
    if (db.prepare('SELECT 1 FROM reports WHERE message_id = ? AND reporter_id = ? AND resolved_at IS NULL').get(message.id as number, user.id))
      throw new HttpError(409, "You've already reported this message");
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length > 200) throw new HttpError(400, 'The reason can be at most 200 characters');
    fileReport(channel.serverId, message, user.id, reason);
    return { ok: true };
  });
  route('GET', '/api/servers/:id/reports', ({ user, params }) => {
    const serverId = Number(params[0]);
    allowed(serverId, user, 'messages');
    return db
      .prepare(
        `SELECT r.id, r.message_id AS messageId, r.channel_id AS channelId, c.name AS channelName, r.content, r.reason, r.created_at AS createdAt,
                r.author_id AS authorId, COALESCE(ua.display_name, ua.username) AS author, ${avatarUrl('ua.avatar')} AS authorAvatar, ur.username AS reporter,
                r.resolved_at AS resolvedAt, uv.username AS resolvedBy
         FROM reports r LEFT JOIN users ua ON ua.id = r.author_id LEFT JOIN users ur ON ur.id = r.reporter_id
         LEFT JOIN users uv ON uv.id = r.resolved_by LEFT JOIN channels c ON c.id = r.channel_id
         WHERE r.server_id = ? AND (r.resolved_at IS NULL OR r.resolved_at > ?) ORDER BY r.resolved_at IS NOT NULL, r.id DESC LIMIT 100`,
      )
      .all(serverId, now() - 7 * 86400e3);
  });
  // Dealt with: optionally deleting the message too. Every open report on that message closes.
  route('POST', '/api/reports/:id/resolve', ({ user, params, body }) => {
    const report = db.prepare('SELECT server_id, message_id, author_id FROM reports WHERE id = ?').get(Number(params[0])) as
      | { server_id: number; message_id: number | null; author_id: number | null }
      | undefined;
    if (!report || !isMember(report.server_id, user.id)) throw new HttpError(404, 'That report is gone');
    allowed(report.server_id, user, 'messages');
    const message = report.message_id === null ? undefined : (db.prepare('SELECT id, channel_id, content FROM messages WHERE id = ?').get(report.message_id) as Json | undefined);
    if (body.deleteMessage && message) {
      const channel = channelById(message.channel_id as number)!;
      audit(report.server_id, user.id, 'message_delete', report.author_id, `in #${channel.name}: ${String(message.content).slice(0, 120)}`);
      removeFiles(db.prepare('SELECT id FROM attachments WHERE message_id = ?').all(message.id as number) as Json[]);
      db.prepare('DELETE FROM messages WHERE id = ?').run(message.id as number);
      broadcastToChannel(channel, { type: 'message_deleted', id: message.id, channelId: channel.id });
      if (channel.kind === 'thread') threadChanged(channel);
    }
    db.prepare('UPDATE reports SET resolved_at = ?, resolved_by = ? WHERE resolved_at IS NULL AND (id = ? OR (message_id IS NOT NULL AND message_id = ?))').run(
      now(), user.id, Number(params[0]), report.message_id ?? -1,
    );
    reportsChanged(report.server_id);
    return { ok: true };
  });

  // Report to Peiskos: anyone can send any message they can see (DMs too) to whoever runs the
  // server, past the hearth's own moderators. Child safety reports are listed first.
  const SAFETY_CATEGORIES: Record<string, string> = {
    child: 'Child safety',
    sexual: 'Sexual content',
    harassment: 'Harassment or threats',
    selfharm: 'Self-harm',
    spam: 'Spam or scam',
    other: 'Something else',
  };
  const openAdminReports = () => (db.prepare('SELECT COUNT(*) AS n FROM admin_reports WHERE resolved_at IS NULL').get() as { n: number }).n;
  const adminReportsChanged = () => {
    const open = openAdminReports();
    sendTo(new Set([...online].filter((id) => isAdmin(id))), { type: 'admin_reports', open });
  };
  /** Where a message is, in words, for someone who isn't in that conversation. */
  const placeText = (channelId: number) => {
    const c = db.prepare('SELECT c.name, c.kind, p.name AS parentName, s.id AS serverId, s.name AS serverName, s.kind AS serverKind FROM channels c JOIN servers s ON s.id = c.server_id LEFT JOIN channels p ON p.id = c.parent_id WHERE c.id = ?')
      .get(channelId) as { name: string; kind: string; parentName: string | null; serverId: number; serverName: string; serverKind: string } | undefined;
    if (!c) return '';
    if (c.serverKind === 'dm') {
      const names = (db.prepare('SELECT COALESCE(u.display_name, u.username) AS n FROM members m JOIN users u ON u.id = m.user_id WHERE m.server_id = ? ORDER BY u.id').all(c.serverId) as { n: string }[]).map((r) => r.n);
      return `${names.length > 2 ? `Group${c.serverName ? ` "${c.serverName}"` : ''}` : 'Direct messages'} between ${names.join(', ')}`;
    }
    return c.kind === 'thread' ? `${c.serverName} › #${c.parentName} › ${c.name}` : `${c.serverName} › #${c.name}`;
  };
  route('POST', '/api/messages/:id/report-to-admin', ({ user, params, body }) => {
    const { channel, authorId } = visibleMessage(user, Number(params[0]));
    if (authorId === user.id) throw new HttpError(400, "That's your own message");
    const category = typeof body.category === 'string' && SAFETY_CATEGORIES[body.category] ? body.category : null;
    if (!category) throw new HttpError(400, 'Pick what the report is about');
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length > 500) throw new HttpError(400, 'The details can be at most 500 characters');
    const message = messageById(Number(params[0]))!;
    if (db.prepare('SELECT 1 FROM admin_reports WHERE message_id = ? AND reporter_id = ? AND resolved_at IS NULL').get(message.id as number, user.id))
      throw new HttpError(409, "You've already reported this message");
    if ((db.prepare('SELECT COUNT(*) AS n FROM admin_reports WHERE reporter_id = ? AND resolved_at IS NULL').get(user.id) as { n: number }).n >= 20)
      throw new HttpError(429, "You have 20 reports waiting already. They'll be looked at soon.");
    db.prepare(
      `INSERT INTO admin_reports (message_id, channel_id, place, author_id, content, files, reporter_id, category, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(message.id as number, channel.id, placeText(channel.id), authorId, String(message.content ?? '').slice(0, 4000),
      (message.attachments as Json[] | undefined)?.length ?? 0, user.id, category, reason, now());
    adminReportsChanged();
    // Whoever runs the server hears about it even with Peiskos closed. What was said stays out of the email.
    const contact = opts.legal?.contact ?? fallbackContact(opts.mail?.from);
    if (opts.mail && contact && looksLikeEmail(contact)) {
      const label = SAFETY_CATEGORIES[category];
      const where = (opts.publicUrl ?? '').replace(/\/$/, '');
      sendMail(opts.mail, {
        to: contact,
        subject: `Peiskos report: ${label}`,
        text: `Someone reported a message to you (${label}).\n\nOpen ${where || 'Peiskos'}, then Server admin › Reports to look at it.\n`,
      }).catch((err) => console.error('Sending a report email failed:', err));
    }
    return { ok: true };
  });
  route('GET', '/api/admin/reports', ({ user }) => {
    if (!isAdmin(user.id)) throw new HttpError(403, 'Only whoever runs this Peiskos can do that');
    const rows = db.prepare(
      `SELECT r.id, r.message_id AS messageId, r.channel_id AS channelId, r.place, r.content, r.files, r.category, r.reason, r.created_at AS createdAt,
              r.author_id AS authorId, COALESCE(ua.display_name, ua.username) AS author, ua.username AS authorUsername, ${avatarUrl('ua.avatar')} AS authorAvatar,
              ur.username AS reporter, r.resolved_at AS resolvedAt, uv.username AS resolvedBy, r.outcome
       FROM admin_reports r LEFT JOIN users ua ON ua.id = r.author_id LEFT JOIN users ur ON ur.id = r.reporter_id LEFT JOIN users uv ON uv.id = r.resolved_by
       WHERE r.resolved_at IS NULL OR r.resolved_at > ?
       ORDER BY r.resolved_at IS NOT NULL, r.category = 'child' DESC, r.id DESC LIMIT 200`,
    ).all(now() - 30 * 86400e3) as Json[];
    return rows.map((r) => {
      // Still there: its files too, so they can be looked at (attachment links work without being in the conversation).
      const live = r.messageId == null ? undefined : messageById(r.messageId as number);
      return { ...r, label: SAFETY_CATEGORIES[r.category as string] ?? r.category, attachments: live?.attachments ?? [], gone: !live };
    });
  });
  // Dealt with: optionally deleting the message too. Every open report on that message closes.
  route('POST', '/api/admin/reports/:id/resolve', ({ user, params, body }) => {
    if (!isAdmin(user.id)) throw new HttpError(403, 'Only whoever runs this Peiskos can do that');
    const report = db.prepare('SELECT message_id, author_id FROM admin_reports WHERE id = ?').get(Number(params[0])) as
      | { message_id: number | null; author_id: number | null }
      | undefined;
    if (!report) throw new HttpError(404, 'That report is gone');
    const message = report.message_id === null ? undefined : (db.prepare('SELECT id, channel_id, content FROM messages WHERE id = ?').get(report.message_id) as Json | undefined);
    const deleting = !!body.deleteMessage && !!message;
    if (deleting) {
      const channel = channelById(message!.channel_id as number)!;
      if (isBurrow(channel.serverId)) audit(channel.serverId, user.id, 'message_delete', report.author_id, `in #${channel.name}: ${String(message!.content).slice(0, 120)}`);
      removeFiles(db.prepare('SELECT id FROM attachments WHERE message_id = ?').all(message!.id as number) as Json[]);
      db.prepare('DELETE FROM messages WHERE id = ?').run(message!.id as number);
      broadcastToChannel(channel, { type: 'message_deleted', id: message!.id, channelId: channel.id });
      if (channel.kind === 'thread') threadChanged(channel);
    }
    db.prepare('UPDATE admin_reports SET resolved_at = ?, resolved_by = ?, outcome = ? WHERE resolved_at IS NULL AND (id = ? OR (message_id IS NOT NULL AND message_id = ?))').run(
      now(), user.id, deleting ? 'deleted' : 'dismissed', Number(params[0]), report.message_id ?? -1,
    );
    adminReportsChanged();
    return { ok: true };
  });

  // Upload limits: a size for the burrow, and roles that allow more (or less). 0 means no files.
  const cleanUploadMb = (value: unknown) => {
    if (value === null || value === '') return null;
    const mb = Math.floor(Number(value));
    if (!(mb >= 0 && mb <= 10000)) throw new HttpError(400, 'Pick an upload limit in MB, or leave it empty');
    return mb;
  };
  /** The largest file someone can share in a burrow, in bytes (0: none). The server's own limit is the most. */
  const uploadLimitFor = (serverId: number, userId: number) => {
    if (!isBurrow(serverId)) return maxUpload;
    const me = standing(serverId, userId);
    if (!me || me.host) return maxUpload;
    const base = (db.prepare('SELECT upload_mb FROM servers WHERE id = ?').get(serverId) as { upload_mb: number | null }).upload_mb;
    const roleLimits = me.roleIds.length
      ? (db.prepare(`SELECT upload_mb FROM roles WHERE upload_mb IS NOT NULL AND id IN (${me.roleIds.map(() => '?').join(',')})`).all(...me.roleIds) as { upload_mb: number }[]).map((r) => r.upload_mb)
      : [];
    const mb = Math.max(base ?? Infinity, ...roleLimits);
    return Math.min(maxUpload, mb * 1024 * 1024);
  };

  /** What the burrow's settings screens need, for the people allowed to see each part. */
  const moderationSummary = (serverId: number, viewerId: number) => {
    const r = db.prepare('SELECT upload_mb, word_filter FROM servers WHERE id = ?').get(serverId) as { upload_mb: number | null; word_filter: string | null };
    return {
      uploadMb: r.upload_mb,
      myUploadLimit: opts.uploadDir ? uploadLimitFor(serverId, viewerId) : 0,
      timeoutUntil: timeoutUntil(serverId, viewerId) > now() ? timeoutUntil(serverId, viewerId) : null,
      ...(can(serverId, viewerId, 'burrow') ? { wordFilter: r.word_filter ? JSON.parse(r.word_filter) : null } : {}),
      ...(can(serverId, viewerId, 'messages') ? { openReports: openReports(serverId) } : {}),
    };
  };

  return {
    moderationSummary, isBurrow, filterCheck, fileReport, audit, cleanUploadMb, roleName, timeoutLeft,
    uploadLimitFor, openAdminReports, BURROW_FIELDS, cleanWordFilter,
  };
}
