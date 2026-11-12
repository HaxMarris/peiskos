// Friends and blocking: who's asked whom, who's accepted, and who doesn't want to hear from whom.
// Blocking reaches further than the list itself (direct messages, calls, mentions), so the checks
// the rest of the app asks are handed back.
import type { Db } from './db.ts';
import { HttpError, type Json } from './http.ts';
import type { Handler, User } from './app.ts';

export interface FriendsContext {
  checkTries: (keys: string[], limit: number) => void;
  db: Db;
  failedTry: (keys: string[], windowMs?: number) => void;
  meJson: (user: User) => unknown;
  notBot: (user: User) => void;
  now: () => number;
  online: Set<number>;
  presenceOf: (userId: number) => { status: string; custom: { text: string; emoji: string; until: number | null; } | null; activity: { name: string; since: number; } | null; };
  pushTo: (userId: number, message: Json) => void;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => unknown;
  sendPresence: (userId: number) => void;
  sendTo: (userIds: Iterable<number>, event: Json) => void;
  userById: (id: number) => User | undefined;
}

export function friendships(ctx: FriendsContext) {
  const {
    checkTries, db, failedTry, meJson, notBot, now, online, presenceOf, pushTo, route, sendPresence, sendTo,
    userById,
  } = ctx;

  const pair = (a: number, b: number) => (a < b ? [a, b] : [b, a]);
  type FriendRow = { requested_by: number; accepted_at: number | null };
  const friendRow = (a: number, b: number) =>
    db.prepare('SELECT requested_by, accepted_at FROM friends WHERE user_a = ? AND user_b = ?').get(...pair(a, b)) as FriendRow | undefined;
  /** 'friends', 'incoming' (they asked you), 'outgoing' (you asked them) or null. */
  const friendState = (me: number, other: number) => {
    const r = friendRow(me, other);
    return !r ? null : r.accepted_at ? 'friends' : r.requested_by === me ? 'outgoing' : 'incoming';
  };
  const areFriends = (a: number, b: number) => !!friendRow(a, b)?.accepted_at;
  const friendIds = (userId: number) =>
    (
      db
        .prepare('SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS id FROM friends WHERE (user_a = ? OR user_b = ?) AND accepted_at IS NOT NULL')
        .all(userId, userId, userId) as { id: number }[]
    ).map((r) => r.id);
  const pendingIds = (userId: number) =>
    (
      db
        .prepare('SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS id FROM friends WHERE (user_a = ? OR user_b = ?) AND accepted_at IS NULL')
        .all(userId, userId, userId) as { id: number }[]
    ).map((r) => r.id);
  /** Whether `viewer` has blocked `other`. */
  const blocked = (viewer: number, other: number) => !!db.prepare('SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?').get(viewer, other);
  const blockedEitherWay = (a: number, b: number) => blocked(a, b) || blocked(b, a);
  const blockedBy = (userId: number) =>
    (db.prepare('SELECT blocked_id AS id FROM blocks WHERE user_id = ? ORDER BY created_at').all(userId) as { id: number }[]).map((r) => r.id);
  /** A one-to-one conversation stops when either person blocks the other, or the other deleted their account. */
  const dmBlockCheck = (serverId: number, userId: number) => {
    const s = db.prepare("SELECT dm_key FROM servers WHERE id = ? AND kind = 'dm'").get(serverId) as { dm_key: string | null } | undefined;
    if (!s?.dm_key) return;
    const other = s.dm_key.split(':').map(Number).find((id) => id !== userId);
    if (other === undefined) return;
    if (blockedEitherWay(userId, other)) throw new HttpError(403, "You can't message this person");
    if ((db.prepare('SELECT deleted_at FROM users WHERE id = ?').get(other) as { deleted_at: number | null } | undefined)?.deleted_at)
      throw new HttpError(403, 'This account was deleted');
  };

  const personJson = (id: number) => {
    const u = userById(id)!;
    return { ...u, online: online.has(id), ...presenceOf(id) };
  };
  /** Your friends (with who's online), requests both ways, and the people you've blocked. */
  const friendsOf = (userId: number) => {
    const rows = db
      .prepare('SELECT user_a, user_b, requested_by, accepted_at FROM friends WHERE user_a = ? OR user_b = ? ORDER BY COALESCE(accepted_at, created_at) DESC')
      .all(userId, userId) as (FriendRow & { user_a: number; user_b: number })[];
    const other = (r: { user_a: number; user_b: number }) => (r.user_a === userId ? r.user_b : r.user_a);
    return {
      friends: rows.filter((r) => r.accepted_at).map((r) => personJson(other(r))),
      incoming: rows.filter((r) => !r.accepted_at && r.requested_by !== userId).map((r) => personJson(other(r))),
      outgoing: rows.filter((r) => !r.accepted_at && r.requested_by === userId).map((r) => personJson(other(r))),
      blocked: blockedBy(userId).map((id) => userById(id)!).filter(Boolean),
    };
  };
  const friendsChanged = (...ids: number[]) => {
    for (const id of ids) sendTo([id], { type: 'friends', ...friendsOf(id) });
  };

  route('GET', '/api/friends', ({ user }) => friendsOf(user.id));

  // Asks someone to be friends, by username or id. If they already asked you, you're friends.
  route('POST', '/api/friends', ({ user, body }) => {
    notBot(user);
    checkTries([`friend:${user.id}`], 30);
    failedTry([`friend:${user.id}`], 60 * 60 * 1000); // every request counts, so nobody is flooded
    const target = (
      body.userId != null
        ? db.prepare('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL AND bot = 0').get(Number(body.userId))
        : db.prepare('SELECT id FROM users WHERE username = ? AND deleted_at IS NULL AND bot = 0').get(String(body.username ?? '').trim().replace(/^@/, ''))
    ) as { id: number } | undefined;
    if (target?.id === user.id) throw new HttpError(400, "You can't add yourself");
    // The same answer for nobody and for someone who blocked you.
    if (!target || blocked(target.id, user.id)) throw new HttpError(404, "Couldn't find anyone with that username");
    if (blocked(user.id, target.id)) throw new HttpError(400, 'Unblock them first, from their profile');
    const r = friendRow(user.id, target.id);
    if (r?.accepted_at) return friendsOf(user.id);
    if (r && r.requested_by !== user.id) {
      db.prepare('UPDATE friends SET accepted_at = ? WHERE user_a = ? AND user_b = ?').run(now(), ...pair(user.id, target.id));
    } else if (!r) {
      const [a, b] = pair(user.id, target.id);
      db.prepare('INSERT INTO friends (user_a, user_b, requested_by, created_at) VALUES (?, ?, ?, ?)').run(a, b, user.id, now());
      pushTo(target.id, { title: 'Friend request', body: `${user.displayName || user.username} wants to be friends`, tag: `friend-${user.id}` });
    }
    friendsChanged(user.id, target.id);
    return friendsOf(user.id);
  });

  route('POST', '/api/friends/:id/accept', ({ user, params }) => {
    const other = Number(params[0]);
    const r = friendRow(user.id, other);
    if (!r || r.requested_by === user.id) throw new HttpError(404, 'No friend request from them');
    if (!r.accepted_at) db.prepare('UPDATE friends SET accepted_at = ? WHERE user_a = ? AND user_b = ?').run(now(), ...pair(user.id, other));
    friendsChanged(user.id, other);
    sendPresence(user.id);
    sendPresence(other);
    return friendsOf(user.id);
  });

  // Unfriends, declines a request, or takes back one you sent.
  route('DELETE', '/api/friends/:id', ({ user, params }) => {
    const other = Number(params[0]);
    db.prepare('DELETE FROM friends WHERE user_a = ? AND user_b = ?').run(...pair(user.id, other));
    friendsChanged(user.id, other);
    return friendsOf(user.id);
  });

  route('POST', '/api/blocks', ({ user, body }) => {
    const other = Number(body.userId);
    if (other === user.id) throw new HttpError(400, "You can't block yourself");
    if (!userById(other)) throw new HttpError(404, "Couldn't find that person");
    db.prepare('INSERT OR IGNORE INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)').run(user.id, other, now());
    db.prepare('DELETE FROM friends WHERE user_a = ? AND user_b = ?').run(...pair(user.id, other));
    friendsChanged(user.id, other);
    sendTo([user.id], { type: 'me_updated', me: meJson(user) });
    return meJson(user);
  });

  route('DELETE', '/api/blocks/:id', ({ user, params }) => {
    db.prepare('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?').run(user.id, Number(params[0]));
    friendsChanged(user.id);
    sendTo([user.id], { type: 'me_updated', me: meJson(user) });
    return meJson(user);
  });

  return {
    dmBlockCheck, areFriends, blockedEitherWay, blocked, friendIds, blockedBy, pendingIds, friendState, friendsOf,
  };
}
