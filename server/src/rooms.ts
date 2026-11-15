// Rooms and hearths: making, editing, ordering, archiving and deleting rooms and categories,
// and editing the hearth itself (name, picture, rules, welcome).
import type { Channel, Handler, Perm, Standing, User } from './app.ts';
import { type Db, inTransaction } from './db.ts';
import { HttpError, type Json } from './http.ts';
import { MAX_DESCRIPTION, MAX_RULES } from './limits.ts';

export interface RoomsContext {
  BURROW_FIELDS: Record<string, string>;
  accessChanged: (serverId: number) => void;
  allowed: (serverId: number, user: User, perm: Perm) => Standing;
  audit: (serverId: number, actorId: number | null, action: string, targetId: number | null, detail?: string) => void;
  canSee: (channel: Channel, userId: number) => boolean;
  channelById: (id: number) => Channel | undefined;
  cleanName: (value: unknown, field: string, max?: number) => string;
  cleanUploadMb: (value: unknown) => number | null;
  cleanWordFilter: (value: unknown) => string | null;
  db: Db;
  isBotUser: (id: number) => boolean;
  isGroupDm: (serverId: number) => boolean;
  isMember: (serverId: number, userId: number) => boolean;
  now: () => number;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => number;
  sendServerUpdate: (serverId: number) => void;
  sendTo: (userIds: Iterable<number>, event: Json) => void;
  serverSummary: (serverId: number, viewerId: number) => unknown;
  standing: (serverId: number, userId: number) => Standing | null;
  timeoutLeft: (serverId: number, userId: number) => string | null;
}

export function roomsAndHearths(ctx: RoomsContext) {
  const {
    BURROW_FIELDS, accessChanged, allowed, audit, canSee, channelById, cleanName, cleanUploadMb,
    cleanWordFilter, db, isBotUser, isGroupDm, isMember, now, route, sendServerUpdate, sendTo, serverSummary,
    standing, timeoutLeft,
  } = ctx;

  // ---- rooms, burrows and organization -------------------------------------

  /** Whether someone has accepted the burrow's rules, or there are none. The host wrote them. */
  const rulesOk = (serverId: number, userId: number) => {
    const row = db
      .prepare('SELECT s.rules, s.owner_id, m.rules_accepted_at FROM servers s JOIN members m ON m.server_id = s.id WHERE s.id = ? AND m.user_id = ?')
      .get(serverId, userId) as { rules: string; owner_id: number; rules_accepted_at: number | null } | undefined;
    return !row?.rules || row.owner_id === userId || row.rules_accepted_at !== null;
  };

  /** Why someone can't write in a room right now (archived, announcements only, rules not accepted), or null if they can. */
  const postProblem = (channel: Channel, userId: number): string | null => {
    const room = channel.kind === 'thread' && channel.parentId !== null ? channelById(channel.parentId) ?? channel : channel;
    if (room.archivedAt !== null) return 'This room is archived, so nothing new can go in it';
    const me = standing(channel.serverId, userId);
    if (!me) return "That room is gone, or you can't see it.";
    if (channel.kind !== 'thread' && channel.announce && !me.perms.has('rooms')) {
      const allowedRoles = db.prepare('SELECT role_id FROM channel_post_roles WHERE channel_id = ?').all(channel.id) as { role_id: number }[];
      if (!allowedRoles.some((r) => me.roleIds.includes(r.role_id))) return 'Only some roles can post in this room';
    }
    if (!me.perms.has('rooms') && me.roleIds.length) {
      const readOnly = db.prepare('SELECT role_id FROM channel_read_only WHERE channel_id = ?').all(room.id) as { role_id: number }[];
      if (readOnly.some((r) => me.roleIds.includes(r.role_id))) return 'Your role can only read this room';
    }
    const left = timeoutLeft(channel.serverId, userId);
    if (left) return `You're timed out for ${left}`;
    if (!rulesOk(channel.serverId, userId)) return "Accept the hearth's rules first";
    return null;
  };

  /** Your notification settings in a burrow: channel id (0 for the whole burrow) -> { level, mutedUntil }. Ended mutes are left out. */
  const notifyPrefsOf = (userId: number, serverId: number) => {
    const rows = db
      .prepare('SELECT channel_id, level, muted_until FROM notify_prefs WHERE user_id = ? AND server_id = ?')
      .all(userId, serverId) as { channel_id: number; level: string | null; muted_until: number | null }[];
    const out = new Map<number, { level: string | null; mutedUntil: number | null }>();
    for (const r of rows) {
      const mutedUntil = r.muted_until !== null && (r.muted_until === -1 || r.muted_until > now()) ? r.muted_until : null;
      if (r.level || mutedUntil) out.set(r.channel_id, { level: r.level, mutedUntil });
    }
    return out;
  };

  // All messages, only @mentions, or nothing; and muting for a while (or until turned back on).
  route('POST', '/api/notify', ({ user, body }) => {
    const serverId = Number(body.serverId);
    if (!isMember(serverId, user.id)) throw new HttpError(404, "That hearth is gone, or you're not in it.");
    const channelId = body.channelId == null ? 0 : Number(body.channelId);
    if (channelId) {
      const channel = channelById(channelId);
      if (!channel || channel.serverId !== serverId || !canSee(channel, user.id)) throw new HttpError(404, "That room is gone, or you can't see it.");
    }
    const level = ['all', 'mentions', 'none'].includes(body.level as string) ? (body.level as string) : null;
    const until = body.mutedUntil == null ? null : Math.floor(Number(body.mutedUntil));
    if (until !== null && until !== -1 && !(until > now())) throw new HttpError(400, 'Pick a time in the future');
    db.prepare(
      `INSERT INTO notify_prefs (user_id, server_id, channel_id, level, muted_until) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, server_id, channel_id) DO UPDATE SET level = excluded.level, muted_until = excluded.muted_until`,
    ).run(user.id, serverId, channelId, level, until);
    const server = serverSummary(serverId, user.id);
    sendTo([user.id], { type: 'server_updated', server }); // your other devices
    return server;
  });

  /** A room heading in this burrow, or a 400. */
  const groupIn = (serverId: number, id: unknown) => {
    const row = db.prepare('SELECT id FROM room_groups WHERE id = ? AND server_id = ?').get(Number(id), serverId) as { id: number } | undefined;
    if (!row) throw new HttpError(400, 'That heading is gone');
    return row.id;
  };
  const groupById = (id: number) =>
    db.prepare('SELECT id, server_id AS serverId FROM room_groups WHERE id = ?').get(id) as { id: number; serverId: number } | undefined;

  route('POST', '/api/servers/:id/groups', ({ user, params, body }) => {
    const serverId = Number(params[0]);
    allowed(serverId, user, 'rooms');
    const count = db.prepare('SELECT COUNT(*) AS n, MAX(position) AS last FROM room_groups WHERE server_id = ?').get(serverId) as { n: number; last: number | null };
    if (count.n >= 30) throw new HttpError(400, 'A hearth can have at most 30 headings');
    db.prepare('INSERT INTO room_groups (server_id, name, position) VALUES (?, ?, ?)').run(serverId, cleanName(body.name, 'Heading', 32), (count.last ?? 0) + 1);
    sendServerUpdate(serverId);
    return serverSummary(serverId, user.id);
  });

  route('PATCH', '/api/groups/:id', ({ user, params, body }) => {
    const group = groupById(Number(params[0]));
    if (!group || !isMember(group.serverId, user.id)) throw new HttpError(404, 'That heading is gone');
    allowed(group.serverId, user, 'rooms');
    db.prepare('UPDATE room_groups SET name = ? WHERE id = ?').run(cleanName(body.name, 'Heading', 32), group.id);
    sendServerUpdate(group.serverId);
    return serverSummary(group.serverId, user.id);
  });

  // Deleting a heading keeps its rooms; they move out from under it.
  route('DELETE', '/api/groups/:id', ({ user, params }) => {
    const group = groupById(Number(params[0]));
    if (!group || !isMember(group.serverId, user.id)) throw new HttpError(404, 'That heading is gone');
    allowed(group.serverId, user, 'rooms');
    db.prepare('UPDATE channels SET group_id = NULL WHERE group_id = ?').run(group.id);
    db.prepare('DELETE FROM room_groups WHERE id = ?').run(group.id);
    sendServerUpdate(group.serverId);
    return serverSummary(group.serverId, user.id);
  });

  /**
   * Puts the rooms in this order, each under its heading (or none), and the headings in their order.
   * Rooms left out keep their place after the ones given. Voice rooms never sit under a heading.
   */
  route('POST', '/api/servers/:id/layout', ({ user, params, body }) => {
    const serverId = Number(params[0]);
    allowed(serverId, user, 'rooms');
    const rooms = new Map(
      (db.prepare("SELECT id, kind FROM channels WHERE server_id = ? AND kind != 'thread' ORDER BY COALESCE(position, id), id").all(serverId) as { id: number; kind: string }[]).map((r) => [r.id, r.kind]),
    );
    const groups = new Set((db.prepare('SELECT id FROM room_groups WHERE server_id = ?').all(serverId) as { id: number }[]).map((g) => g.id));
    const given = (Array.isArray(body.rooms) ? body.rooms : []) as Json[];
    const order: { id: number; groupId: number | null }[] = [];
    for (const r of given) {
      const id = Number(r?.id);
      if (!rooms.has(id) || order.some((o) => o.id === id)) continue;
      const groupId = r.groupId == null || rooms.get(id) !== 'text' ? null : Number(r.groupId);
      if (groupId !== null && !groups.has(groupId)) throw new HttpError(400, 'That heading is gone');
      order.push({ id, groupId });
    }
    inTransaction(db, () => {
      let position = 1;
      const place = db.prepare('UPDATE channels SET position = ?, group_id = ? WHERE id = ?');
      for (const o of order) place.run(position++, o.groupId, o.id);
      for (const id of rooms.keys()) if (!order.some((o) => o.id === id)) db.prepare('UPDATE channels SET position = ? WHERE id = ?').run(position++, id);
      if (Array.isArray(body.groups)) {
        const seen = new Set<number>();
        let gp = 1;
        for (const g of body.groups.map(Number)) if (groups.has(g) && !seen.has(g)) { seen.add(g); db.prepare('UPDATE room_groups SET position = ? WHERE id = ?').run(gp++, g); }
      }
    });
    sendServerUpdate(serverId);
    return serverSummary(serverId, user.id);
  });

  // The burrow's name, blurb, welcome room and rules. In a group conversation anyone can rename it.
  route('PATCH', '/api/servers/:id', ({ user, params, body }) => {
    const serverId = Number(params[0]);
    if (isGroupDm(serverId)) {
      if (!isMember(serverId, user.id)) throw new HttpError(404, 'That conversation is gone');
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (name.length > 64) throw new HttpError(400, 'The name can be at most 64 characters');
      db.prepare('UPDATE servers SET name = ? WHERE id = ?').run(name, serverId);
      sendServerUpdate(serverId);
      return serverSummary(serverId, user.id);
    }
    allowed(serverId, user, 'burrow');
    const changes = Object.keys(body).filter((k) => ['name', 'description', 'welcomeChannelId', 'afkChannelId', 'afkMinutes', 'rules', 'uploadMb', 'wordFilter', 'liveChannelId'].includes(k));
    // All of it or none: one field that doesn't check out leaves the others as they were.
    inTransaction(db, () => {
      if (changes.length) audit(serverId, user.id, 'burrow_edit', null, changes.map((k) => BURROW_FIELDS[k]).join(', '));
      if (body.uploadMb !== undefined) db.prepare('UPDATE servers SET upload_mb = ? WHERE id = ?').run(cleanUploadMb(body.uploadMb), serverId);
      if (body.wordFilter !== undefined) db.prepare('UPDATE servers SET word_filter = ? WHERE id = ?').run(cleanWordFilter(body.wordFilter), serverId);
      if (body.liveChannelId !== undefined) {
        const channel = body.liveChannelId === null ? null : channelById(Number(body.liveChannelId));
        if (channel && (channel.serverId !== serverId || channel.kind !== 'text'))
          throw new HttpError(400, 'Pick a text room in this hearth for go-live posts');
        db.prepare('UPDATE servers SET live_channel_id = ? WHERE id = ?').run(channel?.id ?? null, serverId);
      }
      if (body.name !== undefined) db.prepare('UPDATE servers SET name = ? WHERE id = ?').run(cleanName(body.name, 'Hearth name'), serverId);
      if (body.description !== undefined) {
        const text = typeof body.description === 'string' ? body.description.trim() : '';
        if (text.length > MAX_DESCRIPTION) throw new HttpError(400, `The description can be at most ${MAX_DESCRIPTION} characters`);
        db.prepare('UPDATE servers SET description = ? WHERE id = ?').run(text, serverId);
      }
      if (body.welcomeChannelId !== undefined) {
        const channel = body.welcomeChannelId === null ? null : channelById(Number(body.welcomeChannelId));
        if (channel && (channel.serverId !== serverId || channel.kind !== 'text' || channel.private))
          throw new HttpError(400, 'The welcome room must be a text room everyone can see');
        db.prepare('UPDATE servers SET welcome_channel_id = ? WHERE id = ?').run(channel?.id ?? null, serverId);
      }
      if (body.afkChannelId !== undefined) {
        const channel = body.afkChannelId === null ? null : channelById(Number(body.afkChannelId));
        if (channel && (channel.serverId !== serverId || channel.kind !== 'voice')) throw new HttpError(400, 'The AFK fire must be one of this hearth\'s voice rooms');
        db.prepare('UPDATE servers SET afk_channel_id = ? WHERE id = ?').run(channel?.id ?? null, serverId);
      }
      if (body.afkMinutes !== undefined) {
        const minutes = Math.floor(Number(body.afkMinutes));
        if (!(minutes >= 1 && minutes <= 240)) throw new HttpError(400, 'Pick between 1 minute and 4 hours');
        db.prepare('UPDATE servers SET afk_minutes = ? WHERE id = ?').run(minutes, serverId);
      }
      if (body.rules !== undefined) {
        const rules = typeof body.rules === 'string' ? body.rules.trim() : '';
        if (rules.length > MAX_RULES) throw new HttpError(400, `The rules can be at most ${MAX_RULES} characters`);
        const old = (db.prepare('SELECT rules FROM servers WHERE id = ?').get(serverId) as { rules: string }).rules;
        db.prepare('UPDATE servers SET rules = ? WHERE id = ?').run(rules, serverId);
        // Changed rules need accepting again, by everyone but whoever changed them.
        if (rules !== old) {
          db.prepare('UPDATE members SET rules_accepted_at = NULL WHERE server_id = ?').run(serverId);
          db.prepare('UPDATE members SET rules_accepted_at = ? WHERE server_id = ? AND user_id = ?').run(now(), serverId, user.id);
        }
      }
    });
    sendServerUpdate(serverId);
    return serverSummary(serverId, user.id);
  });

  route('POST', '/api/servers/:id/rules/accept', ({ user, params }) => {
    const serverId = Number(params[0]);
    if (!isMember(serverId, user.id)) throw new HttpError(404, "That hearth is gone, or you're not in it.");
    db.prepare('UPDATE members SET rules_accepted_at = ? WHERE server_id = ? AND user_id = ?').run(now(), serverId, user.id);
    const server = serverSummary(serverId, user.id);
    sendTo([user.id], { type: 'server_updated', server });
    return server;
  });

  // The host hands the burrow to someone else in it, and becomes an ordinary member.
  route('POST', '/api/servers/:id/transfer', ({ user, params, body }) => {
    const serverId = Number(params[0]);
    const me = standing(serverId, user.id);
    if (!me?.host) throw new HttpError(403, 'Only the host can hand the hearth over');
    const to = Number(body.userId);
    if (to === user.id || !isMember(serverId, to)) throw new HttpError(400, "They aren't in this hearth");
    if (isBotUser(to)) throw new HttpError(400, "A bot can't be the host");
    db.prepare('UPDATE servers SET owner_id = ? WHERE id = ?').run(to, serverId);
    accessChanged(serverId);
    return serverSummary(serverId, user.id);
  });

  return { groupIn, notifyPrefsOf, postProblem };
}
