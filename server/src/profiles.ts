// Profiles: names, about-me cards, nicknames in each hearth, and the little achievement badges
// worked out from what people have done.
import { unlink } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppOptions, Channel, Handler, User } from './app.ts';
import type { Db } from './db.ts';
import { HttpError, type Json, send } from './http.ts';
import { looksBlank, withoutBidi } from './text.ts';

export interface ProfilesContext {
  avatarPath: (file: string) => string;
  bestOfNeeds: (serverId: number) => 2 | 3;
  blocked: (viewer: number, other: number) => boolean;
  canSee: (channel: Channel, userId: number) => boolean;
  channelById: (id: number) => Channel | undefined;
  cleanColor: (value: unknown) => string;
  db: Db;
  friendIds: (userId: number) => number[];
  friendState: (me: number, other: number) => 'friends' | 'outgoing' | 'incoming' | null;
  isBurrow: (serverId: number) => boolean;
  isMember: (serverId: number, userId: number) => boolean;
  meJson: (user: User) => unknown;
  notTooFast: (userId: number) => void;
  now: () => number;
  opts: AppOptions;
  pendingIds: (userId: number) => number[];
  route: (method: string, path: string, handler: Handler, auth?: boolean) => number;
  savePicture: (req: IncomingMessage, folder: string, what: string) => Promise<string>;
  sendServerUpdate: (serverId: number) => void;
  sendTo: (userIds: Iterable<number>, event: Json) => void;
  serverSummary: (serverId: number, viewerId: number) => unknown;
  uploader: (req: IncomingMessage) => User;
  userById: (id: number) => User | undefined;
  usersSharingServerWith: (userId: number) => number[];
}

export function profiles(ctx: ProfilesContext) {
  const {
    avatarPath, bestOfNeeds, blocked, canSee, channelById, cleanColor, db, friendIds, friendState, isBurrow,
    isMember, meJson, notTooFast, now, opts, pendingIds, route, savePicture, sendServerUpdate, sendTo,
    serverSummary, uploader, userById, usersSharingServerWith,
  } = ctx;

  // ---- profiles: names, about-me cards and nicknames ----------------------

  const MAX_BIO = 190;
  const profileOf = (userId: number) => {
    const r = db.prepare('SELECT display_name, bio, banner, accent, created_at, birthday, fire_item FROM users WHERE id = ?').get(userId) as
      | { display_name: string | null; bio: string; banner: string | null; accent: string | null; created_at: number; birthday: string | null; fire_item: string | null }
      | undefined;
    return {
      displayName: r?.display_name ?? null,
      bio: r?.bio ?? '',
      banner: r?.banner ? `/api/avatars/${r.banner}` : null,
      accent: r?.accent ?? null,
      joinedAt: r?.created_at ?? null,
      birthday: r?.birthday ?? null,
      fireItem: r?.fire_item ?? null,
    };
  };

  /** Tells everyone who can see this person that their name, picture or card changed. */
  const userChanged = (userId: number) => {
    const u = userById(userId)!;
    const p = profileOf(userId);
    const updated = { ...u, accent: p.accent, birthday: p.birthday, fireItem: p.fireItem };
    sendTo(new Set([userId, ...usersSharingServerWith(userId), ...friendIds(userId), ...pendingIds(userId)]), { type: 'user_updated', user: updated });
    sendTo([userId], { type: 'me_updated', me: meJson(u) });
    return updated;
  };

  /** A birthday is a month and day ('03-12'); the year stays private by never being asked. */
  const cleanBirthday = (value: unknown) => {
    const m = typeof value === 'string' ? /^(\d{2})-(\d{2})$/.exec(value) : null;
    const month = Number(m?.[1]), day = Number(m?.[2]);
    // 2024 is a leap year, so 29 February is allowed.
    if (!m || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(2024, month, 0)).getUTCDate()) throw new HttpError(400, 'Pick a month and day');
    return value as string;
  };
  /** Display name, bio, birthday and accent colour, from PATCH /api/me. Says whether others need telling. */
  const updateProfile = (user: User, body: Json) => {
    let changed = false;
    if (body.displayName !== undefined) {
      let name = typeof body.displayName === 'string' ? withoutBidi(body.displayName).replace(/\s+/g, ' ').trim() : '';
      if (looksBlank(name)) name = '';
      if (name.length > 32) throw new HttpError(400, 'Keep your display name to 32 characters');
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name || null, user.id);
      changed = true;
    }
    if (body.bio !== undefined) {
      const bio = typeof body.bio === 'string' ? body.bio.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim() : '';
      if (bio.length > MAX_BIO) throw new HttpError(400, `Keep your about me to ${MAX_BIO} characters`);
      db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio, user.id);
      changed = true;
    }
    if (body.birthday !== undefined) {
      db.prepare('UPDATE users SET birthday = ? WHERE id = ?').run(body.birthday === null || body.birthday === '' ? null : cleanBirthday(body.birthday), user.id);
      changed = true;
    }
    if (body.accent !== undefined) {
      db.prepare('UPDATE users SET accent = ? WHERE id = ?').run(body.accent === null ? null : cleanColor(body.accent), user.id);
      changed = true;
    }
    return changed;
  };

  const setBannerFile = (user: User, file: string | null) => {
    const old = db.prepare('SELECT banner FROM users WHERE id = ?').get(user.id) as { banner: string | null };
    db.prepare('UPDATE users SET banner = ? WHERE id = ?').run(file, user.id);
    if (old.banner && opts.uploadDir) unlink(avatarPath(old.banner)).catch(() => {});
    userChanged(user.id);
    return meJson(user);
  };
  const handleBannerUpload = async (req: IncomingMessage, res: ServerResponse) => {
    const user = uploader(req);
    send(res, 200, setBannerFile(user, await savePicture(req, 'avatars', 'Banners')));
  };
  route('DELETE', '/api/me/banner', ({ user }) => setBannerFile(user, null));

  /** Someone's card: who they are, what you share, and whether you're friends. */
  // ---- achievements: little badges on profiles, worked out from what people have done ----

  const ACHIEVEMENTS: { id: string; icon: string; title: string; how: string; earned: (id: number) => boolean }[] = [
    { id: 'chatter', icon: '💬', title: 'Chatterbox', how: 'Send 1,000 messages',
      earned: (id) => (db.prepare('SELECT COUNT(*) AS n FROM (SELECT 1 FROM messages WHERE author_id = ? LIMIT 1000)').get(id) as { n: number }).n >= 1000 },
    { id: 'storyteller', icon: '📜', title: 'Storyteller', how: 'Send 10,000 messages',
      earned: (id) => (db.prepare('SELECT COUNT(*) AS n FROM (SELECT 1 FROM messages WHERE author_id = ? LIMIT 10000)').get(id) as { n: number }).n >= 10000 },
    { id: 'regular', icon: '🔥', title: 'Regular at the fire', how: 'Spend 10 hours at fires',
      earned: (id) => (db.prepare('SELECT COALESCE(SUM(ended_at - started_at), 0) AS ms FROM voice_time WHERE user_id = ?').get(id) as { ms: number }).ms >= 10 * 3600_000 },
    { id: 'keeper', icon: '🪵', title: 'Fire keeper', how: 'Spend 100 hours at fires',
      earned: (id) => (db.prepare('SELECT COALESCE(SUM(ended_at - started_at), 0) AS ms FROM voice_time WHERE user_id = ?').get(id) as { ms: number }).ms >= 100 * 3600_000 },
    { id: 'favourite', icon: '⭐', title: 'Crowd favourite', how: 'Have a message make Best of',
      // As many 🔥 as that hearth's Best of asks for (more in bigger hearths).
      earned: (id) => (db.prepare(`SELECT c.server_id AS serverId, COUNT(*) AS n FROM messages m JOIN channels c ON c.id = m.channel_id
                                    JOIN reactions r ON r.message_id = m.id AND r.emoji = '🔥' AND r.user_id != m.author_id
                                    WHERE m.author_id = ? GROUP BY m.id HAVING COUNT(*) >= 2`).all(id) as { serverId: number; n: number }[])
        .some((r) => isBurrow(r.serverId) && r.n >= bestOfNeeds(r.serverId)) },
    { id: 'planner', icon: '📅', title: 'Party planner', how: 'Plan 5 events',
      earned: (id) => (db.prepare('SELECT COUNT(*) AS n FROM events WHERE created_by = ?').get(id) as { n: number }).n >= 5 },
    { id: 'host', icon: '🏕️', title: 'Host', how: 'Host a hearth with 5 or more people in it',
      earned: (id) => !!db.prepare(`SELECT 1 FROM servers s WHERE s.owner_id = ? AND s.kind = 'burrow' AND (SELECT COUNT(*) FROM members WHERE server_id = s.id) >= 5`).get(id) },
    { id: 'friendly', icon: '🤝', title: 'Good company', how: 'Have 5 friends',
      earned: (id) => (db.prepare('SELECT COUNT(*) AS n FROM friends WHERE (user_a = ? OR user_b = ?) AND accepted_at IS NOT NULL').get(id, id) as { n: number }).n >= 5 },
    { id: 'perfect', icon: '🐟', title: 'Perfect catch', how: 'Land a 5-star fish',
      earned: (id) => !!db.prepare('SELECT 1 FROM fishing_best WHERE user_id = ? AND stars >= 5 LIMIT 1').get(id) },
    { id: 'derby', icon: '🏆', title: 'Derby champion', how: 'Win a fishing derby',
      earned: (id) => !!db.prepare('SELECT 1 FROM fishing_derby_entries WHERE user_id = ? AND place = 1 LIMIT 1').get(id) },
    { id: 'year', icon: '🎂', title: 'Old flame', how: 'Be on Peiskos for a year',
      earned: (id) => !!db.prepare('SELECT 1 FROM users WHERE id = ? AND created_at <= ?').get(id, now() - 365 * 86400_000) },
  ];
  /** What someone has earned, and for yourself the ones still to go. */
  const achievementsOf = (id: number, self: boolean) =>
    ACHIEVEMENTS.map(({ id: key, icon, title, how, earned }) => ({ id: key, icon, title, how, earned: earned(id) }))
      .filter((a) => self || a.earned);

  route('GET', '/api/users/:id', ({ user, params }) => {
    const id = Number(params[0]);
    const u = userById(id);
    const state = friendState(user.id, id);
    const knows = id === user.id || usersSharingServerWith(user.id).includes(id) || state === 'friends' || state === 'incoming';
    if (!u || (!knows && state !== 'outgoing')) throw new HttpError(404, "Couldn't find that person");
    // Asking a stranger to be friends shows only their name and picture until they say yes.
    if (!knows) return { ...u, deleted: false, friend: state, blocked: blocked(user.id, id), mutualBurrows: [], achievements: [] };
    const mutual = db
      .prepare(
        `SELECT s.id, s.name FROM members a JOIN members b ON a.server_id = b.server_id JOIN servers s ON s.id = a.server_id
         WHERE a.user_id = ? AND b.user_id = ? AND s.kind = 'burrow' ORDER BY s.name`,
      )
      .all(user.id, id);
    const deleted = !!(db.prepare('SELECT deleted_at FROM users WHERE id = ?').get(id) as { deleted_at: number | null }).deleted_at;
    return {
      ...u, ...profileOf(id), deleted, friend: friendState(user.id, id), blocked: blocked(user.id, id), mutualBurrows: id === user.id ? [] : mutual,
      achievements: deleted ? [] : achievementsOf(id, id === user.id),
    };
  });

  // Your name in one burrow. Empty goes back to your display name.
  route('PATCH', '/api/servers/:id/nickname', ({ user, params, body }) => {
    const serverId = Number(params[0]);
    if (!isBurrow(serverId) || !isMember(serverId, user.id)) throw new HttpError(404, "That hearth is gone, or you're not in it.");
    let nick = typeof body.nickname === 'string' ? withoutBidi(body.nickname).replace(/\s+/g, ' ').trim() : '';
    if (looksBlank(nick)) nick = '';
    if (nick.length > 32) throw new HttpError(400, 'Keep your nickname to 32 characters');
    notTooFast(user.id);
    db.prepare('UPDATE members SET nickname = ? WHERE server_id = ? AND user_id = ?').run(nick || null, serverId, user.id);
    sendServerUpdate(serverId);
    return serverSummary(serverId, user.id);
  });

  // The role you show under your name in the member list. Null goes back to your top role.
  route('PATCH', '/api/servers/:id/shown-role', ({ user, params, body }) => {
    const serverId = Number(params[0]);
    if (!isBurrow(serverId) || !isMember(serverId, user.id)) throw new HttpError(404, "That hearth is gone, or you're not in it.");
    notTooFast(user.id);
    const roleId = body.roleId == null ? null : Number(body.roleId);
    if (roleId !== null && !db.prepare('SELECT 1 FROM member_roles WHERE server_id = ? AND user_id = ? AND role_id = ?').get(serverId, user.id, roleId))
      throw new HttpError(400, "You don't have that role");
    db.prepare('UPDATE members SET shown_role_id = ? WHERE server_id = ? AND user_id = ?').run(roleId, serverId, user.id);
    sendServerUpdate(serverId);
    return serverSummary(serverId, user.id);
  });

  // The fire you keep at the top of a hearth's sidebar. Null goes back to the first one you can see.
  route('PATCH', '/api/servers/:id/pinned-fire', ({ user, params, body }) => {
    const serverId = Number(params[0]);
    if (!isBurrow(serverId) || !isMember(serverId, user.id)) throw new HttpError(404, "That hearth is gone, or you're not in it.");
    const channelId = body.channelId == null ? null : Number(body.channelId);
    if (channelId !== null) {
      const channel = channelById(channelId);
      if (!channel || channel.serverId !== serverId || channel.kind !== 'voice' || !canSee(channel, user.id)) throw new HttpError(404, 'That fire is gone');
    }
    db.prepare('UPDATE members SET pinned_fire_id = ? WHERE server_id = ? AND user_id = ?').run(channelId, serverId, user.id);
    const summary = serverSummary(serverId, user.id);
    // Your other devices follow along.
    sendTo([user.id], { type: 'server_updated', server: summary });
    return summary;
  });

  return { handleBannerUpload, profileOf, updateProfile, userChanged };
}
