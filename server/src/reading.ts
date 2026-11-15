// Reading: the newest message each person has read in each room (unread counts, read receipts),
// pinned messages, and edit history.
import type { Channel, Handler, User } from './app.ts';
import { type Db, inTransaction } from './db.ts';
import { HttpError, type Json } from './http.ts';

export interface ReadingContext {
  can: (serverId: number, userId: number, perm: 'voice' | 'rooms' | 'messages' | 'remove' | 'ban' | 'roles' | 'burrow' | 'emoji' | 'everyone' | 'pin' | 'invites' | 'timeout' | 'audit') => boolean;
  db: Db;
  isBurrow: (serverId: number) => boolean;
  isGroupDm: (serverId: number) => boolean;
  meJson: (user: User) => { recoveryCodesLeft: number; blockedIds: number[]; admin?: boolean | undefined; adminReports?: number | undefined; twoStep: boolean; displayName: string | null; bio: string; banner: string | null; accent: string | null; joinedAt: number | null; birthday: string | null; fireItem: string | null; readReceipts: boolean; status: string; customStatus: { text: string; emoji: string; until: number | null; } | null; quietHours: { start: number; end: number; timeZone: string | null; } | null; email: string | null; emailVerified: boolean; id: number; username: string; avatar: string | null; };
  messageChanged: (id: number, channel: Channel) => Json | undefined;
  messagesByIds: (ids: number[]) => Json[];
  now: () => number;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => number;
  sendPresence: (userId: number) => void;
  sendServerUpdate: (serverId: number) => void;
  sendTo: (userIds: Iterable<number>, event: Json) => void;
  serverKind: (serverId: number) => string | undefined;
  updateMyPresence: (user: User, body: Json) => boolean;
  updateProfile: (user: User, body: Json) => boolean;
  userById: (id: number) => User | undefined;
  userChanged: (userId: number) => { accent: string | null; birthday: string | null; fireItem: string | null; id: number; username: string; displayName: string | null; avatar: string | null; };
  visibleMessage: (user: User, id: number) => { channel: Channel; authorId: number; };
  visibleRoom: (id: number, userId: number) => Channel;
}

export function readState(ctx: ReadingContext) {
  const {
    can, db, isBurrow, isGroupDm, meJson, messageChanged, messagesByIds, now, route, sendPresence,
    sendServerUpdate, sendTo, serverKind, updateMyPresence, updateProfile, userById, userChanged,
    visibleMessage, visibleRoom,
  } = ctx;

  // ---- unread messages: the newest message each person has read in each room ----

  const UNREAD_CAP = 100; // counts stop here; the app shows "99+"

  const lastReadOf = (userId: number, channelId: number, serverId: number) => {
    const row = db.prepare('SELECT last_read_id FROM read_state WHERE user_id = ? AND channel_id = ?').get(userId, channelId) as
      | { last_read_id: number }
      | undefined;
    if (row) return row.last_read_id;
    // A room you've never opened: what was said before you joined counts as read.
    const joined = (db.prepare('SELECT joined_at FROM members WHERE server_id = ? AND user_id = ?').get(serverId, userId) as { joined_at: number } | undefined)?.joined_at ?? 0;
    return (db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM messages WHERE channel_id = ? AND created_at < ?').get(channelId, joined) as { id: number }).id;
  };

  /** Where someone stopped reading a room, how many messages came after, and how many of those are for them. */
  const readInfo = (channelId: number, serverId: number, userId: number) => {
    const lastReadId = lastReadOf(userId, channelId, serverId);
    const count = (sql: string, ...args: (number | string)[]) =>
      (db.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM messages m WHERE m.channel_id = ? AND m.id > ? AND m.author_id != ? ${sql} LIMIT ${UNREAD_CAP})`)
        .get(channelId, lastReadId, userId, ...args) as { n: number }).n;
    const unread = count('');
    if (!unread) return { lastReadId, unread, mentions: 0 };
    const dm = serverKind(serverId) === 'dm';
    // In a DM everything is for you; elsewhere it's @mentions (your name, @everyone, your roles) and replies to you.
    const mentions = dm ? unread : count('AND EXISTS (SELECT 1 FROM mentions x WHERE x.message_id = m.id AND x.user_id = ?)', userId);
    return { lastReadId, unread, mentions };
  };

  const readReceiptsOn = (userId: number) =>
    !!(db.prepare('SELECT read_receipts FROM users WHERE id = ?').get(userId) as { read_receipts: number } | undefined)?.read_receipts;
  // Only two-person conversations have a partner (and "Seen"); group ones don't.
  const dmPartner = (serverId: number, userId: number) =>
    isGroupDm(serverId)
      ? undefined
      : (db.prepare('SELECT user_id FROM members WHERE server_id = ? AND user_id != ?').get(serverId, userId) as { user_id: number } | undefined)?.user_id;
  /** In a DM, how far the other person has read, if you both share that. */
  const dmSeen = (serverId: number, viewerId: number) => {
    const partner = dmPartner(serverId, viewerId);
    const channel = db.prepare("SELECT id FROM channels WHERE server_id = ? AND kind = 'text'").get(serverId) as { id: number } | undefined;
    if (!partner || !channel || !readReceiptsOn(partner) || !readReceiptsOn(viewerId)) return null;
    return { userId: partner, lastReadId: lastReadOf(partner, channel.id, serverId) };
  };

  /**
   * Moves where someone has read up to. It only moves forward, unless `force` (marking a message
   * unread moves it back). Their other devices hear about it, and in a DM so does the other person.
   */
  const markRead = (userId: number, channel: Channel, messageId: number, { force = false, quiet = false } = {}) => {
    if (channel.kind === 'voice') return;
    if (!force && messageId <= lastReadOf(userId, channel.id, channel.serverId)) return;
    db.prepare(
      `INSERT INTO read_state (user_id, channel_id, last_read_id) VALUES (?, ?, ?)
       ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_id = excluded.last_read_id`,
    ).run(userId, channel.id, messageId);
    sendTo([userId], { type: 'read', channelId: channel.id, ...readInfo(channel.id, channel.serverId, userId) });
    if (quiet || force || channel.kind !== 'text') return;
    const kind = serverKind(channel.serverId);
    const partner = kind === 'dm' ? dmPartner(channel.serverId, userId) : undefined;
    if (partner && readReceiptsOn(partner) && readReceiptsOn(userId))
      sendTo([partner], { type: 'dm_seen', serverId: channel.serverId, channelId: channel.id, userId, lastReadId: messageId });
  };

  // You've read a room up to here. With unread: true, it's set back to here ("mark unread").
  route('POST', '/api/channels/:id/read', ({ user, params, body }) => {
    const channel = visibleRoom(Number(params[0]), user.id);
    const newest = (db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM messages WHERE channel_id = ?').get(channel.id) as { id: number }).id;
    const id = Math.max(0, Math.min(Math.floor(Number(body.lastReadId) || 0), newest));
    markRead(user.id, channel, id, { force: body.unread === true });
    return readInfo(channel.id, channel.serverId, user.id);
  });

  // Turning DM read receipts on or off. Your conversations update for both sides.
  route('PATCH', '/api/me', ({ user, body }) => {
    // All of it or none, and nobody hears about it until it's saved.
    const changed = inTransaction(db, () => {
      if (body.readReceipts !== undefined) db.prepare('UPDATE users SET read_receipts = ? WHERE id = ?').run(body.readReceipts ? 1 : 0, user.id);
      return { profile: updateProfile(user, body), presence: updateMyPresence(user, body) };
    });
    if (body.readReceipts !== undefined) {
      const dms = db.prepare("SELECT s.id FROM members m JOIN servers s ON s.id = m.server_id WHERE m.user_id = ? AND s.kind = 'dm'").all(user.id) as { id: number }[];
      for (const { id } of dms) sendServerUpdate(id);
    }
    if (changed.profile) userChanged(user.id);
    if (changed.presence) {
      sendPresence(user.id);
      sendTo([user.id], { type: 'me_updated', me: meJson(user) }); // your other devices
    }
    return meJson(userById(user.id)!);
  });

  // ---- pinned messages ----

  const MAX_PINS = 50;
  route('POST', '/api/messages/:id/pin', ({ user, params, body }) => {
    const id = Number(params[0]);
    const { channel } = visibleMessage(user, id);
    if (isBurrow(channel.serverId) && !can(channel.serverId, user.id, 'pin')) throw new HttpError(403, "Your roles don't allow pinning");
    if (body.pinned === false) db.prepare('UPDATE messages SET pinned_at = NULL, pinned_by = NULL WHERE id = ?').run(id);
    else {
      const pins = (db.prepare('SELECT COUNT(*) AS n FROM messages WHERE channel_id = ? AND pinned_at IS NOT NULL AND id != ?').get(channel.id, id) as { n: number }).n;
      if (pins >= MAX_PINS) throw new HttpError(400, `A room can have at most ${MAX_PINS} pins. Unpin one first.`);
      db.prepare('UPDATE messages SET pinned_at = COALESCE(pinned_at, ?), pinned_by = COALESCE(pinned_by, ?) WHERE id = ?').run(now(), user.id, id);
    }
    return messageChanged(id, channel);
  });

  /** A room's pinned messages, most recently pinned first. */
  route('GET', '/api/channels/:id/pins', ({ user, params }) => {
    const channel = visibleRoom(Number(params[0]), user.id);
    const ids = db.prepare('SELECT id FROM messages WHERE channel_id = ? AND pinned_at IS NOT NULL ORDER BY pinned_at DESC').all(channel.id) as { id: number }[];
    return messagesByIds(ids.map((r) => r.id));
  });

  // ---- edit history ----

  /** What an edited message used to say, oldest first, each with when it was written. */
  route('GET', '/api/messages/:id/edits', ({ user, params }) => {
    const id = Number(params[0]);
    visibleMessage(user, id);
    return db.prepare('SELECT content, edited_at AS writtenAt FROM message_edits WHERE message_id = ? ORDER BY rowid').all(id);
  });

  return { dmSeen, lastReadOf, markRead, readInfo, readReceiptsOn };
}
