// Direct messages: one-to-one and group conversations, each a tiny private hearth of kind 'dm'
// with one room, plus calls in them (the conversation's own voice room, and ringing the others).
import type { SQLOutputValue } from 'node:sqlite';
import type { AppOptions, Channel, Handler, User } from './app.ts';
import { newInviteCode } from './auth.ts';
import type { Db } from './db.ts';
import { HttpError, type Json } from './http.ts';
import { MAX_GROUP_DM } from './limits.ts';

export interface DmsContext {
  areFriends: (a: number, b: number) => boolean;
  blocked: (viewer: number, other: number) => boolean;
  blockedEitherWay: (a: number, b: number) => boolean;
  channelById: (id: number) => Channel | undefined;
  db: Db;
  dmBlockCheck: (serverId: number, userId: number) => void;
  isBotUser: (id: number) => boolean;
  isMember: (serverId: number, userId: number) => boolean;
  kickFromVoice: (userId: number, channelId?: number | undefined) => void;
  markRead: (userId: number, channel: Channel, messageId: number, { force, quiet }?: { force?: boolean | undefined; quiet?: boolean | undefined; }) => void;
  notBot: (user: User) => void;
  now: () => number;
  opts: AppOptions;
  removeFiles: (rows: Json[]) => void;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => number;
  sendServerUpdate: (serverId: number) => void;
  sendTo: (userIds: Iterable<number>, event: Json) => void;
  serverKind: (serverId: number) => string | undefined;
  serverMemberIds: (serverId: number) => number[];
  serverSummary: (serverId: number, viewerId: number) => { roles: { id: number; perms: ('voice' | 'rooms' | 'messages' | 'remove' | 'ban' | 'roles' | 'burrow' | 'emoji' | 'everyone' | 'pin' | 'invites' | 'timeout' | 'audit')[]; }[]; members: { status: string; custom: { text: string; emoji: string; until: number | null; } | null; activity: { name: string; since: number; } | null; deleted: boolean; bot: boolean; voiceMuted: boolean; timeoutUntil: number | null; roleIds: number[]; role: string; online: boolean; id: number; username: string; displayName: string | null; avatar: string | null; }[]; seen?: { userId: number; lastReadId: number; } | null | undefined; motd?: { id: number; text: string; picture: string | null; }[] | undefined; openReports?: number | undefined; wordFilter?: any; uploadMb?: number | null | undefined; myUploadLimit?: number | undefined; timeoutUntil?: number | null | undefined; rulesAccepted: boolean; pinnedFireId: number | null; notify: { level: string | null; mutedUntil: number | null; } | null; channels: ({ readOnlyRoleIds?: number[] | undefined; postRoleIds?: number[] | undefined; memberIds?: number[] | undefined; roleIds?: number[] | undefined; audienceIds?: number[] | undefined; voiceUsers: number[]; voiceMuted: number[]; voiceDeafened: number[]; voiceServerMuted: number[]; voiceSpeaking: number[]; keepChat: boolean; private: boolean; announce: boolean; archived: boolean; canPost: boolean; notify: { level: string | null; mutedUntil: number | null; } | null; id: number; name: string; kind: 'text' | 'voice' | 'thread'; slow: number; userLimit: number; topic: string; groupId: number | null; } | { readOnlyRoleIds?: number[] | undefined; postRoleIds?: number[] | undefined; memberIds?: number[] | undefined; roleIds?: number[] | undefined; audienceIds?: number[] | undefined; lastReadId: number; unread: number; mentions: number; keepChat: boolean; private: boolean; announce: boolean; archived: boolean; canPost: boolean; notify: { level: string | null; mutedUntil: number | null; } | null; id: number; name: string; kind: 'text' | 'voice' | 'thread'; slow: number; userLimit: number; topic: string; groupId: number | null; })[]; groups: Record<string, SQLOutputValue>[]; events: { rsvps: Record<string, SQLOutputValue>[]; }[]; threads: { lastReadId: number; unread: number; mentions: number; }[]; emoji: Record<string, SQLOutputValue>[]; sounds: Record<string, SQLOutputValue>[]; serverMuted: boolean; };
  usersInVoice: (channelId: number) => number[];
  voiceRoomIds: (serverId: number) => number[];
}

export function directMessages(ctx: DmsContext) {
  const {
    areFriends, blocked, blockedEitherWay, channelById, db, dmBlockCheck, isBotUser, isMember, kickFromVoice,
    markRead, notBot, now, opts, removeFiles, route, sendServerUpdate, sendTo, serverKind, serverMemberIds,
    serverSummary, usersInVoice, voiceRoomIds,
  } = ctx;

  // ---- direct messages ----------------------------------------------------

  /** Your conversations, most recently active first. */
  route('GET', '/api/dms', ({ user }) => {
    const rows = db
      .prepare(
        `SELECT s.id, COALESCE((SELECT MAX(msg.created_at) FROM channels c JOIN messages msg ON msg.channel_id = c.id
                                WHERE c.server_id = s.id), s.created_at) AS lastActive
         FROM members m JOIN servers s ON s.id = m.server_id
         WHERE m.user_id = ? AND s.kind = 'dm' AND m.hidden_at IS NULL ORDER BY lastActive DESC`,
      )
      .all(user.id) as { id: number; lastActive: number }[];
    return rows.map((r) => ({ ...serverSummary(r.id, user.id), lastActive: r.lastActive, last: lastDmMessage(r.id) }));
  });

  /** A conversation's newest message, for the preview line in the list of conversations. */
  const lastDmMessage = (serverId: number) =>
    (db
      .prepare(
        `SELECT m.id, m.author_id AS authorId, substr(m.content, 1, 120) AS text, m.created_at AS at,
                EXISTS(SELECT 1 FROM attachments a WHERE a.message_id = m.id) AS files
         FROM messages m JOIN channels c ON c.id = m.channel_id
         WHERE c.server_id = ? AND c.kind != 'thread' ORDER BY m.id DESC LIMIT 1`,
      )
      .get(serverId) as Json | undefined) ?? null;

  const sharesBurrow = (a: number, b: number) =>
    !!db
      .prepare(
        `SELECT 1 FROM members a JOIN members b ON a.server_id = b.server_id JOIN servers s ON s.id = a.server_id
         WHERE a.user_id = ? AND b.user_id = ? AND s.kind = 'burrow'`,
      )
      .get(a, b);
  /** The people you're adding to a conversation: real, not you, friends or sharing a burrow with you, and not blocked either way. */
  const dmPeople = (user: User, ids: unknown) => {
    const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number))].filter((id) => id !== user.id);
    for (const id of list) {
      if (isBotUser(id)) throw new HttpError(403, "Bots can't be messaged directly");
      if (!sharesBurrow(user.id, id) && !areFriends(user.id, id)) throw new HttpError(403, 'You can only message friends and people who share a hearth with you');
      if (blockedEitherWay(user.id, id)) throw new HttpError(403, "You can't message this person");
    }
    return list;
  };
  const isGroupDm = (serverId: number) => !!db.prepare("SELECT 1 FROM servers WHERE id = ? AND kind = 'dm' AND dm_key IS NULL").get(serverId);

  /**
   * Opens your conversation with someone, starting it if needed. With several people (userIds)
   * it starts a group conversation instead. You can only message people you share a burrow with.
   */
  route('POST', '/api/dms', ({ user, body }) => {
    notBot(user);
    // A conversation you already have stays open to you, even if you no longer share a burrow.
    // Without you or repeats, so [them], [them, them] and [you, them] all find the same conversation.
    const ids = [...new Set((Array.isArray(body.userIds) ? body.userIds : [body.userId]).map(Number))].filter((id) => id !== user.id);
    if (ids.length === 1) {
      const existing = db.prepare('SELECT id FROM servers WHERE dm_key = ?').get([user.id, ids[0]].sort((a, b) => a - b).join(':')) as { id: number } | undefined;
      if (existing) {
        db.prepare('UPDATE members SET hidden_at = NULL WHERE server_id = ? AND user_id = ?').run(existing.id, user.id);
        return { ...serverSummary(existing.id, user.id), last: lastDmMessage(existing.id) };
      }
    }
    const others = dmPeople(user, ids);
    if (!others.length) throw new HttpError(400, "You can't message yourself");
    if (others.length + 1 > MAX_GROUP_DM) throw new HttpError(400, `A group conversation can have up to ${MAX_GROUP_DM} people`);
    const key = others.length === 1 ? [user.id, others[0]].sort((a, b) => a - b).join(':') : null;
    const name = key ? '' : typeof body.name === 'string' ? body.name.trim().slice(0, 64) : '';
    const t = now();
    const r = db
      .prepare("INSERT INTO servers (name, owner_id, invite_code, created_at, kind, dm_key) VALUES (?, ?, ?, ?, 'dm', ?)")
      .run(name, user.id, newInviteCode(), t, key);
    const serverId = Number(r.lastInsertRowid);
    for (const id of [user.id, ...others])
      db.prepare('INSERT INTO members (server_id, user_id, joined_at) VALUES (?, ?, ?)').run(serverId, id, t);
    db.prepare('INSERT INTO channels (server_id, name, created_at) VALUES (?, ?, ?)').run(serverId, 'dm', t);
    sendServerUpdate(serverId);
    return serverSummary(serverId, user.id);
  });

  // Anyone in a group conversation can add people (that they share a burrow with).
  route('POST', '/api/dms/:id/members', ({ user, params, body }) => {
    const serverId = Number(params[0]);
    if (!isGroupDm(serverId) || !isMember(serverId, user.id)) throw new HttpError(404, 'That conversation is gone');
    const adding = dmPeople(user, body.userIds).filter((id) => !isMember(serverId, id));
    if (serverMemberIds(serverId).length + adding.length > MAX_GROUP_DM)
      throw new HttpError(400, `A group conversation can have up to ${MAX_GROUP_DM} people`);
    // Not someone who has blocked (or been blocked by) a person already in it.
    const there = serverMemberIds(serverId);
    if (adding.some((a) => there.some((b) => blocked(a, b) || blocked(b, a)))) throw new HttpError(403, "Someone you picked can't be added to this conversation");
    for (const id of adding) db.prepare('INSERT INTO members (server_id, user_id, joined_at) VALUES (?, ?, ?)').run(serverId, id, now());
    sendServerUpdate(serverId);
    return serverSummary(serverId, user.id);
  });

  /**
   * Closes a conversation: it leaves your list (on all your devices) but nothing is deleted, and
   * it comes back when someone writes in it or you message them again. What's in it counts as read.
   */
  route('POST', '/api/dms/:id/close', ({ user, params }) => {
    const serverId = Number(params[0]);
    if (serverKind(serverId) !== 'dm' || !isMember(serverId, user.id)) throw new HttpError(404, 'That conversation is gone');
    db.prepare('UPDATE members SET hidden_at = ? WHERE server_id = ? AND user_id = ?').run(now(), serverId, user.id);
    for (const { id } of db.prepare("SELECT id FROM channels WHERE server_id = ? AND kind = 'text'").all(serverId) as { id: number }[]) {
      const newest = (db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM messages WHERE channel_id = ?').get(id) as { id: number }).id;
      if (newest) markRead(user.id, channelById(id)!, newest, { quiet: true });
    }
    sendTo([user.id], { type: 'server_deleted', serverId });
    return { ok: true };
  });
  /** Someone wrote or called in a conversation: it comes back for whoever had closed it. */
  const reopenDm = (serverId: number) => {
    const closed = db.prepare('SELECT user_id FROM members WHERE server_id = ? AND hidden_at IS NOT NULL').all(serverId) as { user_id: number }[];
    if (!closed.length) return;
    db.prepare('UPDATE members SET hidden_at = NULL WHERE server_id = ?').run(serverId);
    for (const { user_id } of closed) sendTo([user_id], { type: 'server_updated', server: serverSummary(serverId, user_id) });
  };

  /** Leaves a group conversation. The last one out takes it with them. */
  const leaveGroup = (serverId: number, user: User) => {
    // Out of its call too, if they're in it.
    for (const id of voiceRoomIds(serverId)) kickFromVoice(user.id, id);
    db.prepare('DELETE FROM members WHERE server_id = ? AND user_id = ?').run(serverId, user.id);
    sendTo([user.id], { type: 'server_deleted', serverId });
    if (serverMemberIds(serverId).length) {
      sendServerUpdate(serverId);
    } else {
      removeFiles(db.prepare('SELECT a.id FROM attachments a JOIN channels c ON c.id = a.channel_id WHERE c.server_id = ?').all(serverId) as Json[]);
      db.prepare('DELETE FROM servers WHERE id = ?').run(serverId);
    }
    return { ok: true };
  };

  // ---- calls in direct messages: a conversation's own voice room, and ringing the others

  const callRoom = (serverId: number) =>
    (db.prepare("SELECT id FROM channels WHERE server_id = ? AND kind = 'voice'").get(serverId) as { id: number } | undefined)?.id;
  route('POST', '/api/dms/:id/call', ({ user, params }) => {
    const serverId = Number(params[0]);
    const kind = serverKind(serverId);
    if (kind !== 'dm' || !isMember(serverId, user.id)) throw new HttpError(404, 'That conversation is gone');
    if (!opts.voice) throw new HttpError(503, "Fires aren't set up on this server yet. Tell whoever runs it.");
    // Nobody can ring someone who blocked them (or whom they blocked), or an account that's gone.
    dmBlockCheck(serverId, user.id);
    let channelId = callRoom(serverId);
    if (channelId === undefined) {
      channelId = Number(db.prepare("INSERT INTO channels (server_id, name, kind, created_at) VALUES (?, 'Call', 'voice', ?)").run(serverId, now()).lastInsertRowid);
      sendServerUpdate(serverId);
    }
    reopenDm(serverId);
    const inCall = new Set(usersInVoice(channelId));
    const others = serverMemberIds(serverId).filter((id) => id !== user.id && !inCall.has(id));
    sendTo(others, { type: 'ring', serverId, channelId, from: { id: user.id, username: user.displayName || user.username } });
    return { channelId };
  });
  // Not picking up: the people in the call hear about it, and your other devices stop ringing.
  route('POST', '/api/dms/:id/call/decline', ({ user, params }) => {
    const serverId = Number(params[0]);
    if (serverKind(serverId) !== 'dm' || !isMember(serverId, user.id)) throw new HttpError(404, 'That conversation is gone');
    const channelId = callRoom(serverId);
    if (channelId !== undefined) sendTo(usersInVoice(channelId), { type: 'ring_declined', serverId, userId: user.id, username: user.displayName || user.username });
    sendTo([user.id], { type: 'ring_stop', serverId });
    return { ok: true };
  });

  return { isGroupDm, leaveGroup, reopenDm };
}
