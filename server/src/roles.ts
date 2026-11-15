// Custom roles: each hearth's own roles, their permissions and colors, and who has them.
import type { AppOptions, Channel, Handler, Standing, User } from './app.ts';
import { avatarUrl, parsePerms, PERMS } from './common.ts';
import { type Db, inTransaction } from './db.ts';
import { HttpError, type Json } from './http.ts';
import { MAX_ROLES, MAX_TOPIC } from './limits.ts';
import { voiceToken } from './voice.ts';

export interface RolesContext {
  accessChanged: (serverId: number) => void;
  accessList: (serverId: number, ids: unknown) => number[];
  allowed: (serverId: number, user: User, perm: 'rooms' | 'messages' | 'remove' | 'ban' | 'roles' | 'burrow' | 'emoji' | 'voice' | 'everyone' | 'pin' | 'invites' | 'timeout' | 'audit') => Standing;
  audit: (serverId: number, actorId: number | null, action: string, targetId: number | null, detail?: string) => void;
  can: (serverId: number, userId: number, perm: 'rooms' | 'messages' | 'remove' | 'ban' | 'roles' | 'burrow' | 'emoji' | 'voice' | 'everyone' | 'pin' | 'invites' | 'timeout' | 'audit') => boolean;
  channelById: (id: number) => Channel | undefined;
  checkSeat: (channel: Channel, userId: number) => void;
  cleanName: (value: unknown, field: string, max?: number) => string;
  cleanUploadMb: (value: unknown) => number | null;
  closeVoiceRoom: (channelId: number) => void;
  db: Db;
  dmBlockCheck: (serverId: number, userId: number) => void;
  fireside: Map<number, Json[]>;
  groupIn: (serverId: number, id: unknown) => number;
  isBotUser: (id: number) => boolean;
  isMember: (serverId: number, userId: number) => boolean;
  manageableThread: (thread: Channel, user: User) => number | null;
  now: () => number;
  opts: AppOptions;
  removeBot: (serverId: number, userId: number) => void;
  removeFiles: (rows: Json[]) => void;
  removeMember: (serverId: number, userId: number) => void;
  renameThread: (thread: Channel, user: User, name: unknown) => unknown;
  roleList: (serverId: number, ids: unknown) => number[];
  roleName: (id: number) => string;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => number;
  sendServerUpdate: (serverId: number) => void;
  sendTo: (userIds: Iterable<number>, event: Json) => void;
  serverMuted: (serverId: number, userId: number) => boolean;
  serverSummary: (serverId: number, viewerId: number) => unknown;
  setAccess: (channelId: number, ids: number[], roleIds: number[]) => void;
  standing: (serverId: number, userId: number) => Standing | null;
  threadDeleted: (thread: Channel, parentMessageId: number | null) => void;
  visibleRoom: (id: number, userId: number) => Channel;
  voiceTokens: Map<number, { channelId: number; at: number; }>;
}

export function customRoles(ctx: RolesContext) {
  const {
    accessChanged, accessList, allowed, audit, can, channelById, checkSeat, cleanName, cleanUploadMb,
    closeVoiceRoom, db, dmBlockCheck, fireside, groupIn, isBotUser, isMember, manageableThread, now, opts,
    removeBot, removeFiles, removeMember, renameThread, roleList, roleName, route, sendServerUpdate, sendTo,
    serverMuted, serverSummary, setAccess, standing, threadDeleted, visibleRoom, voiceTokens,
  } = ctx;

  // ---- custom roles ----
  // People who manage roles can only touch roles below their own highest role,
  // and can't hand out permissions they don't have themselves. The host can do anything.

  const roleById = (id: number) =>
    db.prepare('SELECT id, server_id AS serverId, position, perms FROM roles WHERE id = ?').get(id) as
      | { id: number; serverId: number; position: number; perms: string }
      | undefined;
  const cleanColor = (value: unknown) => {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new HttpError(400, 'Pick a colour like #4f8a5b');
    return value.toLowerCase();
  };
  // Permissions you don't have yourself stay as they were.
  const cleanPerms = (value: unknown, me: Standing, current = '') => {
    const wanted = new Set(parsePerms(Array.isArray(value) ? value.join(',') : ''));
    const had = new Set(parsePerms(current));
    return PERMS.filter((p) => (me.perms.has(p) ? wanted.has(p) : had.has(p))).join(',');
  };
  /** The role, if you're allowed to change it. */
  const managedRole = (id: number, user: User) => {
    const role = roleById(id);
    if (!role || !isMember(role.serverId, user.id)) throw new HttpError(404, 'That role is gone');
    const me = allowed(role.serverId, user, 'roles');
    if (role.position <= me.rank) throw new HttpError(403, 'You can only change roles below your own');
    return { role, me };
  };

  route('POST', '/api/servers/:id/roles', ({ user, params, body }) => {
    const serverId = Number(params[0]);
    const me = allowed(serverId, user, 'roles');
    const count = (db.prepare('SELECT COUNT(*) AS n, MAX(position) AS last FROM roles WHERE server_id = ?').get(serverId) as { n: number; last: number | null });
    if (count.n >= MAX_ROLES) throw new HttpError(400, `A hearth can have at most ${MAX_ROLES} roles`);
    // New roles start at the bottom, below everyone's.
    const name = cleanName(body.name, 'Role name', 32);
    uploadLimitAllowed(serverId, user.id, body);
    audit(serverId, user.id, 'role_create', null, name);
    db.prepare('INSERT INTO roles (server_id, name, color, perms, position, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      serverId,
      name,
      cleanColor(body.color ?? '#8a8f87'),
      cleanPerms(body.perms, me),
      (count.last ?? 0) + 1,
      now(),
    );
    if (body.uploadMb !== undefined) db.prepare('UPDATE roles SET upload_mb = ? WHERE id = (SELECT MAX(id) FROM roles WHERE server_id = ?)').run(cleanUploadMb(body.uploadMb), serverId);
    sendServerUpdate(serverId);
    return serverSummary(serverId, user.id);
  });

  /** A role's upload limit can go past the hearth's own, so only people who can change the hearth's settings set it. */
  const uploadLimitAllowed = (serverId: number, userId: number, body: Json) => {
    if (body.uploadMb !== undefined && !can(serverId, userId, 'burrow')) throw new HttpError(403, "Only people who can change the hearth's settings can set a role's upload limit");
  };
  // Rename, recolor, change permissions, or move up or down one place.
  route('PATCH', '/api/roles/:id', ({ user, params, body }) => {
    const { role, me } = managedRole(Number(params[0]), user);
    uploadLimitAllowed(role.serverId, user.id, body);
    if (body.name !== undefined) db.prepare('UPDATE roles SET name = ? WHERE id = ?').run(cleanName(body.name, 'Role name', 32), role.id);
    if (body.color !== undefined) db.prepare('UPDATE roles SET color = ? WHERE id = ?').run(cleanColor(body.color), role.id);
    if (body.perms !== undefined) db.prepare('UPDATE roles SET perms = ? WHERE id = ?').run(cleanPerms(body.perms, me, role.perms), role.id);
    if (body.uploadMb !== undefined) db.prepare('UPDATE roles SET upload_mb = ? WHERE id = ?').run(cleanUploadMb(body.uploadMb), role.id);
    if (body.name !== undefined || body.color !== undefined || body.perms !== undefined || body.uploadMb !== undefined)
      audit(role.serverId, user.id, 'role_edit', null, roleName(role.id));
    if (body.move === 'up' || body.move === 'down') {
      const neighbor = db
        .prepare(
          body.move === 'up'
            ? 'SELECT id, position FROM roles WHERE server_id = ? AND position < ? ORDER BY position DESC LIMIT 1'
            : 'SELECT id, position FROM roles WHERE server_id = ? AND position > ? ORDER BY position LIMIT 1',
        )
        .get(role.serverId, role.position) as { id: number; position: number } | undefined;
      if (neighbor && neighbor.position <= me.rank) throw new HttpError(403, "You can't move a role above your own");
      if (neighbor) {
        db.prepare('UPDATE roles SET position = ? WHERE id = ?').run(neighbor.position, role.id);
        db.prepare('UPDATE roles SET position = ? WHERE id = ?').run(role.position, neighbor.id);
      }
    }
    accessChanged(role.serverId);
    return serverSummary(role.serverId, user.id);
  });

  route('DELETE', '/api/roles/:id', ({ user, params }) => {
    const { role } = managedRole(Number(params[0]), user);
    audit(role.serverId, user.id, 'role_delete', null, roleName(role.id));
    db.prepare('DELETE FROM roles WHERE id = ?').run(role.id);
    accessChanged(role.serverId);
    return serverSummary(role.serverId, user.id);
  });

  // Gives someone exactly these roles. Roles at or above your own stay as they are.
  route('POST', '/api/servers/:id/members/:id/roles', ({ user, params, body }) => {
    const [serverId, targetId] = params.map(Number);
    const me = allowed(serverId, user, 'roles');
    const target = standing(serverId, targetId);
    if (!target) throw new HttpError(404, "They aren't in this hearth");
    if (targetId !== user.id && target.rank <= me.rank) throw new HttpError(403, "You can't change their roles");
    const wanted = new Set(roleList(serverId, body.roleIds));
    const changeable = (id: number) => roleById(id)!.position > me.rank;
    // A role that allows something you can't do yourself would hand that out, so only the host can give or take it.
    const withinMine = (id: number) => parsePerms(roleById(id)!.perms).every((p) => me.perms.has(p));
    for (const id of new Set([...wanted, ...target.roleIds])) {
      if (wanted.has(id) === target.roleIds.includes(id)) continue;
      if (!changeable(id)) throw new HttpError(403, 'You can only give or take roles below your own');
      if (!withinMine(id)) throw new HttpError(403, `Only the host can give or take ${roleName(id)}: it allows things your roles don't`);
      if (wanted.has(id)) db.prepare('INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)').run(serverId, targetId, id);
      else db.prepare('DELETE FROM member_roles WHERE role_id = ? AND user_id = ?').run(id, targetId);
      audit(serverId, user.id, wanted.has(id) ? 'role_give' : 'role_take', targetId, roleName(id));
    }
    accessChanged(serverId);
    return { ok: true };
  });

  // Removes someone; with ban: true they can't come back with the invite code.
  // You can only remove people whose highest role is below yours.
  route('POST', '/api/servers/:id/members/:id/remove', ({ user, params, body }) => {
    const [serverId, targetId] = params.map(Number);
    const me = allowed(serverId, user, body.ban ? 'ban' : 'remove');
    const target = standing(serverId, targetId);
    if (!target) throw new HttpError(404, "They aren't in this hearth");
    if (target.host || target.rank <= me.rank || targetId === user.id) throw new HttpError(403, "You can't remove them");
    if (body.ban) db.prepare('INSERT OR IGNORE INTO bans (server_id, user_id, banned_at) VALUES (?, ?, ?)').run(serverId, targetId, now());
    audit(serverId, user.id, body.ban ? 'ban' : 'remove', targetId);
    // A bot can't come back, so removing it is the same as deleting it: its token and webhook stop too.
    if (isBotUser(targetId)) removeBot(serverId, targetId);
    else removeMember(serverId, targetId);
    // Their app says so, rather than the hearth just vanishing.
    sendTo([targetId], { type: 'server_deleted', serverId, reason: body.ban ? 'banned' : 'removed' });
    return { ok: true };
  });

  route('GET', '/api/servers/:id/bans', ({ user, params }) => {
    allowed(Number(params[0]), user, 'ban');
    return db
      .prepare(
        `SELECT u.id, u.username, ${avatarUrl('u.avatar')} AS avatar, b.banned_at AS bannedAt
         FROM bans b JOIN users u ON u.id = b.user_id WHERE b.server_id = ? ORDER BY b.banned_at DESC`,
      )
      .all(Number(params[0]));
  });

  route('DELETE', '/api/servers/:id/bans/:id', ({ user, params }) => {
    const [serverId, targetId] = params.map(Number);
    allowed(serverId, user, 'ban');
    db.prepare('DELETE FROM bans WHERE server_id = ? AND user_id = ?').run(serverId, targetId);
    audit(serverId, user.id, 'unban', targetId);
    return { ok: true };
  });

  route('POST', '/api/servers/:id/channels', ({ user, params, body }) => {
    const serverId = Number(params[0]);
    allowed(serverId, user, 'rooms');
    const kind = body.kind === 'voice' ? 'voice' : 'text';
    const name = roomName(body.name, kind);
    const last = (db.prepare("SELECT MAX(COALESCE(position, id)) AS p FROM channels WHERE server_id = ? AND kind != 'thread'").get(serverId) as { p: number | null }).p;
    const groupId = kind === 'text' && body.groupId != null ? groupIn(serverId, body.groupId) : null;
    const r = db
      .prepare('INSERT INTO channels (server_id, name, kind, private, created_at, position, group_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(serverId, name, kind, body.private ? 1 : 0, now(), (last ?? 0) + 1, groupId);
    if (body.private) setAccess(Number(r.lastInsertRowid), accessList(serverId, body.memberIds), roleList(serverId, body.roleIds));
    sendServerUpdate(serverId);
    return serverSummary(serverId, user.id);
  });

  // Text rooms read like #game-night; voice rooms keep their spaces ("Game Night").
  const roomName = (value: unknown, kind: string) => {
    const name = cleanName(value, 'Room name', 32);
    return kind === 'text' ? name.toLowerCase().replace(/\s+/g, '-') : name;
  };

  // Rename a room, make it private or public, or change who's let in.
  route('PATCH', '/api/channels/:id', ({ user, params, body }) => {
    const channel = visibleRoom(Number(params[0]), user.id);
    if (channel.kind === 'thread') return renameThread(channel, user, body.name);
    allowed(channel.serverId, user, 'rooms');
    // All of it or none: one field that doesn't check out leaves the others as they were.
    inTransaction(db, () => {
      if (body.name !== undefined) db.prepare('UPDATE channels SET name = ? WHERE id = ?').run(roomName(body.name, channel.kind), channel.id);
      if (body.private !== undefined) db.prepare('UPDATE channels SET private = ? WHERE id = ?').run(body.private ? 1 : 0, channel.id);
      if (body.memberIds !== undefined || body.roleIds !== undefined)
        setAccess(channel.id, accessList(channel.serverId, body.memberIds), roleList(channel.serverId, body.roleIds));
      if (body.topic !== undefined) {
        const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
        if (topic.length > MAX_TOPIC) throw new HttpError(400, `The topic can be at most ${MAX_TOPIC} characters`);
        db.prepare('UPDATE channels SET topic = ? WHERE id = ?').run(topic, channel.id);
      }
      if (body.slow !== undefined) {
        const slow = Math.floor(Number(body.slow) || 0);
        if (slow < 0 || slow > 6 * 3600) throw new HttpError(400, 'Slow mode can be at most 6 hours');
        db.prepare('UPDATE channels SET slow_seconds = ? WHERE id = ?').run(slow, channel.id);
      }
      if (body.announce !== undefined) db.prepare('UPDATE channels SET announce = ? WHERE id = ?').run(body.announce ? 1 : 0, channel.id);
      if (body.postRoleIds !== undefined) {
        db.prepare('DELETE FROM channel_post_roles WHERE channel_id = ?').run(channel.id);
        for (const id of roleList(channel.serverId, body.postRoleIds))
          db.prepare('INSERT INTO channel_post_roles (channel_id, role_id) VALUES (?, ?)').run(channel.id, id);
      }
      if (body.readOnlyRoleIds !== undefined) {
        db.prepare('DELETE FROM channel_read_only WHERE channel_id = ?').run(channel.id);
        for (const id of roleList(channel.serverId, body.readOnlyRoleIds))
          db.prepare('INSERT INTO channel_read_only (channel_id, role_id) VALUES (?, ?)').run(channel.id, id);
      }
      if (body.userLimit !== undefined && channel.kind === 'voice') {
        const limit = Math.floor(Number(body.userLimit) || 0);
        if (limit < 0 || limit > 99) throw new HttpError(400, 'A fire can have up to 99 seats');
        db.prepare('UPDATE channels SET user_limit = ? WHERE id = ?').run(limit, channel.id);
      }
      if (body.keepChat !== undefined && channel.kind === 'voice') {
        db.prepare('UPDATE channels SET keep_chat = ? WHERE id = ?').run(body.keepChat ? 1 : 0, channel.id);
        // Turned off: what was kept goes, and the chat now lives only while people are at the fire.
        if (!body.keepChat) db.prepare('DELETE FROM fireside_messages WHERE channel_id = ?').run(channel.id);
        else if (fireside.has(channel.id)) {
          for (const m of fireside.get(channel.id)!)
            db.prepare('INSERT INTO fireside_messages (channel_id, user_id, author, content, created_at) VALUES (?, ?, ?, ?, ?)').run(channel.id, m.userId as number, m.author as string, m.content as string, m.createdAt as number);
        }
      }
      if (body.archived !== undefined && channel.kind === 'text') {
        if (body.archived && !channel.archivedAt) {
          const open = db.prepare("SELECT COUNT(*) AS n FROM channels WHERE server_id = ? AND kind = 'text' AND archived_at IS NULL").get(channel.serverId) as { n: number };
          if (open.n <= 1) throw new HttpError(400, 'A hearth needs at least one text room that isn\'t archived');
        }
        db.prepare('UPDATE channels SET archived_at = ? WHERE id = ?').run(body.archived ? channel.archivedAt ?? now() : null, channel.id);
      }
      audit(channel.serverId, user.id, 'room_edit', null, `#${channelById(channel.id)!.name}`);
    });
    // Now kept in the database, so the copy in memory goes (only once the change is saved).
    if (body.keepChat && channel.kind === 'voice') fireside.delete(channel.id);
    accessChanged(channel.serverId);
    return serverSummary(channel.serverId, user.id);
  });

  route('DELETE', '/api/channels/:id', ({ user, params }) => {
    const channel = visibleRoom(Number(params[0]), user.id);
    const threadMessage = channel.kind === 'thread' ? manageableThread(channel, user) : null;
    if (channel.kind !== 'thread') allowed(channel.serverId, user, 'rooms');
    const textRooms = db.prepare("SELECT COUNT(*) AS n FROM channels WHERE server_id = ? AND kind = 'text'").get(channel.serverId) as { n: number };
    if (channel.kind === 'text' && textRooms.n <= 1) throw new HttpError(400, 'A hearth needs at least one text room');
    // Nor can the last room people can still write in go, leaving only archived ones.
    const openRooms = db.prepare("SELECT COUNT(*) AS n FROM channels WHERE server_id = ? AND kind = 'text' AND archived_at IS NULL").get(channel.serverId) as { n: number };
    if (channel.kind === 'text' && channel.archivedAt === null && openRooms.n <= 1) throw new HttpError(400, "A hearth needs at least one text room that isn't archived");
    if (channel.kind === 'voice') closeVoiceRoom(channel.id);
    if (channel.kind !== 'thread') audit(channel.serverId, user.id, 'room_delete', null, `#${channel.name}`);
    removeFiles(
      db.prepare('SELECT id FROM attachments WHERE channel_id = ? OR channel_id IN (SELECT id FROM channels WHERE parent_id = ?)').all(channel.id, channel.id) as Json[],
    );
    db.prepare('DELETE FROM channels WHERE id = ?').run(channel.id);
    // Not tied to the room by the database, so a later room can't pick up its mute.
    db.prepare('DELETE FROM notify_prefs WHERE channel_id = ?').run(channel.id);
    // Nor the jobs it had: room ids are used again, and the next room made would quietly take them over.
    db.prepare('UPDATE servers SET welcome_channel_id = NULL WHERE welcome_channel_id = ?').run(channel.id);
    db.prepare('UPDATE servers SET afk_channel_id = NULL WHERE afk_channel_id = ?').run(channel.id);
    db.prepare('UPDATE members SET pinned_fire_id = NULL WHERE pinned_fire_id = ?').run(channel.id);
    if (channel.kind === 'thread') threadDeleted(channel, threadMessage);
    sendServerUpdate(channel.serverId);
    return { ok: true };
  });

  route('POST', '/api/channels/:id/voice', ({ user, params }) => {
    const channel = visibleRoom(Number(params[0]), user.id);
    if (channel.kind !== 'voice') throw new HttpError(400, "That's not a fire");
    if (!opts.voice) throw new HttpError(503, "Fires aren't set up on this server yet. Tell whoever runs it.");
    dmBlockCheck(channel.serverId, user.id);
    checkSeat(channel, user.id);
    const canSpeak = !serverMuted(channel.serverId, user.id);
    voiceTokens.set(user.id, { channelId: channel.id, at: Date.now() });
    return { url: opts.voice.url ?? null, token: voiceToken(opts.voice, user, `room-${channel.id}`, undefined, canSpeak), canSpeak };
  });

  return { cleanColor };
}
