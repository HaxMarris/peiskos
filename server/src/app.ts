import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { addModeratorRole, inTransaction, tokenHash, withStatementCache, type Db } from './db.ts';
import { APP_CSP, HttpError, MIME, allowance, bearer, clientIp, readBody, sameText, send, type Json } from './http.ts';
import { hashPassword, verifyPassword, newToken, newInviteCode } from './auth.ts';
import { setCanSpeak, type VoiceOptions } from './voice.ts';
import { jointFires, type JointFireOptions } from './joint-fires.ts';
import { staticFiles } from './static.ts';
import type { GifOptions } from './gifs.ts';
import { fetchEmbed, linksIn, type EmbedOptions } from './embeds.ts';
import type { ApnsConfig } from './apns.ts';
import { appLinkFile, type AppLinksConfig } from './app-links.ts';
import type { FcmConfig } from './fcm.ts';
import { looksLikeEmail, type MailConfig } from './mail.ts';
import { hosting, type HostingOptions } from './hosting.ts';
import { extras, voiceTimeTracker } from './extras.ts';
import { recap } from './recap.ts';
import { trivia } from './trivia.ts';
import { fileURLToPath } from 'node:url';
import { looksBlank, withoutBidi } from './text.ts';
import { CHANNEL_COLS, PERMS, avatarUrl, parsePerms, type Perm } from './common.ts';
import { EMOJI, MAX_ALT_LENGTH, MAX_ATTACHMENTS, MAX_FOLDERS, MAX_MESSAGE_LENGTH, MAX_REACTIONS, SESSION_IDLE_MS } from './limits.ts';
import { firesInLiveKit } from './fires.ts';
import { moderation } from './moderation.ts';
import { botsAndWebhooks } from './bots.ts';
import { readState } from './reading.ts';
import { roomsAndHearths } from './rooms.ts';
import { customRoles } from './roles.ts';
import { emailAddress } from './email.ts';
import { soundboard } from './soundboard.ts';
import { theater } from './theater.ts';
import { customEmoji } from './emoji.ts';
import { linkPreviews } from './link-previews.ts';
import { search } from './search.ts';
import { highlights } from './highlights.ts';
import { invites } from './invites.ts';
import { calendarFeed } from './calendar.ts';
import { profiles } from './profiles.ts';
import { directMessages } from './dms.ts';
import { uploads } from './uploads.ts';
import { alerts } from './alerts.ts';
import { savedMessages } from './saved-messages.ts';
import { lanterns } from './lanterns.ts';
import { planning } from './planning.ts';
import { threads } from './threads.ts';
import { login } from './login.ts';
import { capsules } from './capsules.ts';
import { EVENT_REMIND_MS, hearthEvents } from './events.ts';
import { meetup } from './meetup.ts';
import { friendships } from './friends.ts';
import { listenTogether } from './listen.ts';
import { fireGames } from './games.ts';
import { casino, type CasinoContext } from './casino.ts';
import { fireTapes, type TapeOptions } from './tapes.ts';
import { fishing, fishingDock } from './fishing.ts';
import { league } from './league.ts';
import { hearthland, readLook } from './hearthland.ts';
import { camp } from './camp.ts';
import { childSafetyPage, fallbackContact, privacyPage, termsPage, type LegalOptions } from './legal.ts';
export type { Perm } from './common.ts';

export interface AppOptions {
  db: Db;
  publicDir: string;
  /** When set, new accounts must supply this code to register. */
  registrationCode?: string;
  /** LiveKit settings; voice rooms are turned off without them. */
  voice?: VoiceOptions;
  /** Where uploaded files are stored; uploads are turned off without it. */
  uploadDir?: string;
  /** Largest upload in bytes (default 25 MB). */
  maxUploadBytes?: number;
  /** How much one person may upload in a day, all files together (default 2 GB). */
  dailyUploadBytes?: number;
  /** Uploads stop while the disk has less than this free, so the database always has room (default 2 GB). */
  minFreeDiskBytes?: number;
  /** The movie theater at the fire: the largest movie (default 4 GB), all movies together (default 20 GB), and days an unwatched one is kept (default 14). */
  movies?: { maxBytes?: number; storageBytes?: number; keepDays?: number };
  /** KLIPY settings; the GIF picker is turned off without them (or without uploads). */
  gifs?: GifOptions;
  /** Link previews are on unless this is false. */
  linkPreviews?: EmbedOptions | false;
  /** Where to send email (confirming an address, resetting a forgotten password); email is off without it. */
  mail?: MailConfig;
  /** The address people open Peiskos at, for links in emails. */
  publicUrl?: string;
  /** Where Fireside Trivia's question packs are (server/trivia). */
  triviaDir?: string;
  /** Who push services can contact about this server's pushes (a mailto: or https: address). */
  pushContact?: string;
  /** Push services Peiskos will send to. Tests add their own. */
  pushHosts?: string[];
  /** Alerts for the iPhone app, through Apple (see apns.ts); off without it. */
  apns?: ApnsConfig;
  /** Lets the phone apps open this server's invite links (see app-links.ts). */
  appLinks?: AppLinksConfig;
  /** Alerts for the Android app, through Google's Firebase (see fcm.ts); off without it. */
  fcm?: FcmConfig;
  /** Backups, the admin page, updates and uptime (see hosting.ts). */
  hosting?: HostingOptions;
  /** Who runs this server and how to reach them, for the privacy policy and terms (see legal.ts). */
  legal?: { name?: string; contact?: string };
  /** Clips at the fire (see tapes.ts): on with voice and uploads, unless this is false. */
  tapes?: TapeOptions | false;
  /** Fires shared with other Peiskos servers (see joint-fires.ts); off without it. */
  jointFires?: JointFireOptions;
  /** Tests make the casino's poker table quicker, and stack its decks. */
  casino?: Pick<CasinoContext, 'timing' | 'deck'>;
  /** Tests move the league's clock (seasons are calendar months). */
  league?: { now?: () => number };
}

// What a route is handed. `session` is the hash of the login's token, as it's kept in the sessions table.
export type Handler = (ctx: { user: User; params: string[]; body: Json; url: URL; session: string | undefined; ip: string; ua: string; host: string; secure: boolean }) => unknown;
export type User = { id: number; username: string; displayName: string | null; avatar: string | null };
export type Standing = { host: boolean; rank: number; perms: Set<Perm>; roleIds: number[] };
export type Channel = {
  id: number;
  serverId: number;
  name: string;
  kind: 'text' | 'voice' | 'thread';
  private: number;
  parentId: number | null;
  slow: number; // slow mode: seconds between someone's messages
  announce: number; // only some roles can post
  archivedAt: number | null;
  userLimit: number; // seats at a fire; 0 is no limit
  keepChat: number; // the fireside chat stays after everyone leaves
  spatialSound: number; // voices at the fire pan and fade by seat (mixed by each listener's app)
};

export type PollInput = { question: string; options: string[]; multi: boolean; closesAt: number | null; times?: number[] };
/** What a posted message can carry besides its text. */
export type PostExtras = {
  forwarded?: Json; poll?: PollInput; list?: { title: string; items: string[] }; scheduled?: boolean; live?: Json; webhook?: boolean;
  /** A time capsule being opened: posted as its author, with the files sealed in it (capsules.ts). */
  capsule?: { id: number; sealedAt: number; opensAt: number; openedBy: number };
};

export type StatusRow = { status: string; status_text: string | null; status_emoji: string | null; status_until: number | null };

export function createApp(opts: AppOptions): Server {
  const db = withStatementCache(opts.db);
  const now = () => Date.now();

  // ---- data helpers -------------------------------------------------------

  // A login lasts until it goes unused for SESSION_IDLE_MS. Using it keeps it going.
  // Logins are kept as the hash of their token (see tokenHash), never the token itself.
  const userByToken = (raw: string | undefined): User | undefined => {
    if (!raw) return undefined;
    const token = tokenHash(raw);
    const row = db
      .prepare(
        `SELECT u.id, u.username, u.display_name AS displayName, ${avatarUrl('u.avatar')} AS avatar, COALESCE(s.last_used_at, s.created_at) AS lastUsed, u.bot
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND u.deleted_at IS NULL`,
      )
      .get(token) as (User & { lastUsed: number; bot: number }) | undefined;
    if (!row) return undefined;
    const t = now();
    // A bot's token lasts until it's replaced; people's logins run out when unused.
    if (!row.bot && t - row.lastUsed > SESSION_IDLE_MS) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return undefined;
    }
    if (t - row.lastUsed > 60 * 60 * 1000) db.prepare('UPDATE sessions SET last_used_at = ? WHERE token = ?').run(t, token);
    const { lastUsed: _, bot: __, ...user } = row;
    return user;
  };

  const escHtml = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  // ---- guessing limits ----------------------------------------------------
  // Wrong passwords and registration codes are counted per person and per address;
  // too many in a row and that door closes for a while.
  const failures = new Map<string, { count: number; until: number }>();
  const checkTries = (keys: string[], limit: number) => {
    const t = now();
    for (const key of keys) {
      const f = failures.get(key);
      if (f && f.until > t && f.count >= limit) {
        const minutes = Math.ceil((f.until - t) / 60000);
        throw new HttpError(429, `Too many tries. Wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`);
      }
    }
  };
  const failedTry = (keys: string[], windowMs = 15 * 60 * 1000) => {
    const t = now();
    for (const key of keys) {
      const f = failures.get(key);
      if (!f || f.until <= t) failures.set(key, { count: 1, until: t + windowMs });
      else f.count++;
    }
    if (failures.size > 10000) for (const [k, f] of failures) if (f.until <= t) failures.delete(k);
  };
  const clearTries = (key: string) => failures.delete(key);

  const USER_COLS = `id, username, display_name AS displayName, ${avatarUrl('avatar')} AS avatar`;
  const userById = (id: number) => db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id) as User | undefined;
  /** Bots stay in the one burrow they were made for: no joining others, no DMs, no friends. */
  const isBotUser = (id: number) => !!(db.prepare('SELECT bot FROM users WHERE id = ?').get(id) as { bot: number } | undefined)?.bot;
  const notBot = (user: User) => {
    if (isBotUser(user.id)) throw new HttpError(403, "Bots can't do that");
  };
  /** The name someone goes by in a burrow: their nickname there, else their display name, else their username. */
  const nameSql = (userAlias: string, serverIdSql: string) =>
    `COALESCE((SELECT nn.nickname FROM members nn WHERE nn.server_id = ${serverIdSql} AND nn.user_id = ${userAlias}.id), ${userAlias}.display_name, ${userAlias}.username)`;
  const nameIn = (serverId: number, userId: number) =>
    (db.prepare(`SELECT ${nameSql('u', '?')} AS name FROM users u WHERE u.id = ?`).get(serverId, userId) as { name: string } | undefined)?.name ?? 'Someone';

  const isMember = (serverId: number, userId: number) =>
    !!db.prepare('SELECT 1 FROM members WHERE server_id = ? AND user_id = ?').get(serverId, userId);

  const channelById = (id: number) =>
    db.prepare(`SELECT ${CHANNEL_COLS} FROM channels WHERE id = ?`).get(id) as
      | Channel
      | undefined;

  // ---- roles: the host (whoever created the burrow) and the burrow's own custom roles ----

  /**
   * Where someone stands in a burrow: their roles, what those let them do, and their rank
   * (the position of their highest role; lower is higher, the host is above everyone).
   * Null if they aren't in it. DMs have no roles.
   */
  const standing = (serverId: number, userId: number): Standing | null => {
    const row = db
      .prepare('SELECT s.owner_id, s.kind FROM members m JOIN servers s ON s.id = m.server_id WHERE m.server_id = ? AND m.user_id = ?')
      .get(serverId, userId) as { owner_id: number; kind: string } | undefined;
    if (!row) return null;
    if (row.kind !== 'burrow') return { host: false, rank: Infinity, perms: new Set(), roleIds: [] };
    const roles = db
      .prepare('SELECT r.id, r.position, r.perms FROM member_roles mr JOIN roles r ON r.id = mr.role_id WHERE mr.server_id = ? AND mr.user_id = ?')
      .all(serverId, userId) as { id: number; position: number; perms: string }[];
    const host = row.owner_id === userId;
    return {
      host,
      rank: host ? 0 : Math.min(Infinity, ...roles.map((r) => r.position)),
      perms: new Set(host ? PERMS : roles.flatMap((r) => parsePerms(r.perms))),
      roleIds: roles.map((r) => r.id),
    };
  };
  const can = (serverId: number, userId: number, perm: Perm) => !!standing(serverId, userId)?.perms.has(perm);
  /** Private rooms are seen by people who manage rooms, the people let in, and anyone with a role let in. */
  const canSee = (channel: Channel, userId: number): boolean => {
    // A thread is seen by whoever sees the room it hangs off.
    if (channel.kind === 'thread') {
      const parent = channel.parentId === null ? undefined : channelById(channel.parentId);
      return !!parent && canSee(parent, userId);
    }
    if (!isMember(channel.serverId, userId)) return false;
    if (!channel.private || can(channel.serverId, userId, 'rooms')) return true;
    return !!db
      .prepare(
        `SELECT 1 FROM channel_access WHERE channel_id = ? AND user_id = ?
         UNION SELECT 1 FROM channel_role_access cra JOIN member_roles mr ON mr.role_id = cra.role_id WHERE cra.channel_id = ? AND mr.user_id = ?`,
      )
      .get(channel.id, userId, channel.id, userId);
  };
  /** A room someone can see, by its id. Anything else is "not found", whether it exists or not. */
  const visibleRoom = (id: number, userId: number) => {
    const channel = channelById(id);
    if (!channel || !canSee(channel, userId)) throw new HttpError(404, "That room is gone, or you can't see it.");
    return channel;
  };
  /** A room someone can see that holds messages (not a voice room). */
  const textRoom = (id: number, userId: number) => {
    const channel = visibleRoom(id, userId);
    if (channel.kind === 'voice') throw new HttpError(400, 'Fires have no messages');
    return channel;
  };
  const channelAudience = (channel: Channel) => serverMemberIds(channel.serverId).filter((id) => canSee(channel, id));

  const serverMemberIds = (serverId: number) =>
    (db.prepare('SELECT user_id FROM members WHERE server_id = ?').all(serverId) as { user_id: number }[]).map(
      (r) => r.user_id,
    );

  const attachmentJson = (a: Json) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    size: a.size,
    url: `/api/attachments/${a.id}/${encodeURIComponent(a.name as string)}`,
    ...(a.spoiler ? { spoiler: true } : {}),
    ...(a.alt ? { alt: a.alt } : {}),
    ...(a.voice_seconds != null ? { voiceSeconds: a.voice_seconds } : {}),
    ...(a.width && a.height ? { width: a.width, height: a.height } : {}),
    ...(a.thumb ? { thumb: `/api/attachments/${a.id}/thumb` } : {}),
  });

  const reactionsFor = (messageId: number) => {
    const rows = db
      .prepare('SELECT emoji, user_id FROM reactions WHERE message_id = ? ORDER BY created_at, rowid')
      .all(messageId) as { emoji: string; user_id: number }[];
    const byEmoji = new Map<string, number[]>();
    for (const r of rows) byEmoji.set(r.emoji, [...(byEmoji.get(r.emoji) ?? []), r.user_id]);
    return [...byEmoji].map(([emoji, userIds]) => ({ emoji, userIds }));
  };

  /** A short preview of the message being replied to, or { deleted: true } if it's gone. */
  const replyPreview = (id: unknown) => {
    if (id == null) return null;
    const m = db
      .prepare(
        `SELECT m.id, m.content, u.id AS authorId, ${nameSql('u', '(SELECT c.server_id FROM channels c WHERE c.id = m.channel_id)')} AS author,
                EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id) AS hasAttachments
         FROM messages m JOIN users u ON u.id = m.author_id WHERE m.id = ?`,
      )
      .get(id as number) as Json | undefined;
    if (!m) return { deleted: true };
    return { ...m, content: (m.content as string).slice(0, 160), hasAttachments: !!m.hasAttachments };
  };

  /** Adds attachments, reactions, reply previews, polls, link previews and threads to a list of message rows. */
  const withAttachments = (rows: Json[]): Json[] => {
    if (!rows.length) return rows;
    rows = rows.map(({ replyToId, stickerId, embedsOff, forwarded, pings, live, capsule, authorBot, ...r }) => ({
      ...r,
      ...(authorBot ? { authorBot: true } : {}),
      ...(live ? { live: JSON.parse(live as string) } : {}),
      ...(capsule ? { capsule: JSON.parse(capsule as string) } : {}),
      pings: pings ? JSON.parse(pings as string) : null,
      pinnedAt: r.pinnedAt ?? null,
      replyTo: replyPreview(replyToId),
      reactions: reactionsFor(r.id as number),
      forwarded: forwarded ? JSON.parse(forwarded as string) : null,
      sticker: stickerId == null ? null : stickerJson(stickerId as number),
      poll: pollFor(r.id as number),
      list: listFor(r.id as number),
      embeds: embedsOff ? [] : embedsFor(r.id as number),
      thread: threadOf(r.id as number),
    }));
    const ids = rows.map((r) => r.id as number);
    const atts = db
      .prepare(
        `SELECT id, message_id, name, type, size, spoiler, alt, voice_seconds, width, height, thumb FROM attachments
         WHERE message_id IN (${ids.map(() => '?').join(',')}) ORDER BY position`,
      )
      .all(...ids) as Json[];
    return rows.map((r) => ({ ...r, attachments: atts.filter((a) => a.message_id === r.id).map(attachmentJson) }));
  };

  // Every message is read with these columns, then filled in by withAttachments.
  const MESSAGE_SELECT = `SELECT m.id, m.channel_id AS channelId, m.content, m.created_at AS createdAt, m.edited_at AS editedAt,
      m.reply_to AS replyToId, m.pinned_at AS pinnedAt, m.forwarded, m.sticker_id AS stickerId, m.embeds_off AS embedsOff, m.pings, m.live, m.capsule,
      u.id AS authorId, ${nameSql('u', '(SELECT c.server_id FROM channels c WHERE c.id = m.channel_id)')} AS author, u.username AS authorUsername,
      ${avatarUrl('u.avatar')} AS authorAvatar, u.bot AS authorBot
    FROM messages m JOIN users u ON u.id = m.author_id`;

  const messageById = (id: number) => {
    const row = db.prepare(`${MESSAGE_SELECT} WHERE m.id = ?`).get(id) as Json | undefined;
    return row && withAttachments([row])[0];
  };
  /** Messages by id, in the order given, leaving out any that are gone. */
  const messagesByIds = (ids: number[]) => {
    if (!ids.length) return [];
    const rows = db.prepare(`${MESSAGE_SELECT} WHERE m.id IN (${ids.map(() => '?').join(',')})`).all(...ids) as Json[];
    const byId = new Map(withAttachments(rows).map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter((r): r is Json => !!r);
  };

  /** A burrow as one person sees it: private rooms they can't enter are left out. */
  const serverSummary = (serverId: number, viewerId: number) => {
    const server = db
      .prepare(
        `SELECT id, name, kind, owner_id AS ownerId, invite_code AS inviteCode, dm_key AS dmKey, description, rules,
                welcome_channel_id AS welcomeChannelId, afk_channel_id AS afkChannelId, afk_minutes AS afkMinutes, live_channel_id AS liveChannelId,
                COALESCE(fire_look, 'classic') AS fireLook, COALESCE(sky_look, 'evening') AS skyLook, backdrop,
                hearthland,
                (SELECT cw.backdrop FROM casino_wallets cw WHERE cw.user_id = ? AND cw.server_id = servers.id) AS myBackdrop,
                CASE WHEN icon IS NULL THEN NULL ELSE '/api/burrow-pictures/' || icon END AS icon,
                CASE WHEN banner IS NULL THEN NULL ELSE '/api/burrow-pictures/' || banner END AS banner
         FROM servers WHERE id = ?`,
      )
      .get(viewerId, serverId) as Json;
    // A conversation with no pair key is a group DM, which can have a name.
    if (server.kind === 'dm') {
      delete server.inviteCode;
      server.group = server.dmKey === null;
    }
    delete server.dmKey;
    if (server.kind === 'burrow') server.hearthland = !!server.hearthland;
    else delete server.hearthland;
    const manager = can(serverId, viewerId, 'rooms');
    const ids = (sql: string, id: number) => (db.prepare(sql).all(id) as { id: number }[]).map((r) => r.id);
    const prefs = notifyPrefsOf(viewerId, serverId);
    const channels = (
      db
        .prepare(`SELECT ${CHANNEL_COLS}, topic, group_id AS groupId FROM channels WHERE server_id = ? AND kind != 'thread' ORDER BY COALESCE(position, id), id`)
        .all(serverId) as (Channel & { topic: string; groupId: number | null })[]
    )
      .filter((c) => canSee(c, viewerId))
      .map(({ serverId: _, private: priv, parentId: __, announce, archivedAt, ...c }) => ({
        ...c,
        keepChat: !!c.keepChat,
        spatialSound: !!c.spatialSound,
        private: !!priv,
        announce: !!announce,
        archived: archivedAt !== null,
        canPost: postProblem({ ...c, serverId, private: priv, parentId: null, announce, archivedAt }, viewerId) === null,
        notify: prefs.get(c.id) ?? null,
        ...(c.kind === 'voice' ? voiceSummary(c.id) : readInfo(c.id, serverId, viewerId)),
        // Everyone who can get into a private room, so its member list shows just them.
        ...(priv ? { audienceIds: channelAudience({ ...c, serverId, private: priv, parentId: null, announce, archivedAt }) } : {}),
        // Who has been let in (and who may post in an announcement room), for the people who can change it.
        ...(priv && manager
          ? {
              memberIds: ids('SELECT user_id AS id FROM channel_access WHERE channel_id = ?', c.id),
              roleIds: ids('SELECT role_id AS id FROM channel_role_access WHERE channel_id = ?', c.id),
            }
          : {}),
        ...(announce && manager ? { postRoleIds: ids('SELECT role_id AS id FROM channel_post_roles WHERE channel_id = ?', c.id) } : {}),
        ...(manager ? { readOnlyRoleIds: ids('SELECT role_id AS id FROM channel_read_only WHERE channel_id = ?', c.id) } : {}),
      }));
    const roles = (
      db.prepare('SELECT id, name, color, perms, position, upload_mb AS uploadMb FROM roles WHERE server_id = ? ORDER BY position').all(serverId) as Json[]
    ).map((r) => ({ ...r, id: r.id as number, perms: parsePerms(r.perms as string) }));
    const memberRoles = db
      .prepare('SELECT mr.user_id, mr.role_id FROM member_roles mr JOIN roles r ON r.id = mr.role_id WHERE mr.server_id = ? ORDER BY r.position')
      .all(serverId) as { user_id: number; role_id: number }[];
    const members = db
      .prepare(
        `SELECT u.id, u.username, u.display_name AS displayName, m.nickname, m.shown_role_id AS shownRoleId, u.accent, ${avatarUrl('u.avatar')} AS avatar,
                u.deleted_at IS NOT NULL AS deleted, m.voice_muted AS voiceMuted, m.timeout_until AS timeoutUntil, u.bot,
                u.birthday, u.fire_item AS fireItem, u.look,
                (SELECT pet FROM casino_wallets cw WHERE cw.user_id = u.id AND cw.server_id = m.server_id) AS pet,
                (SELECT seat FROM casino_wallets cw WHERE cw.user_id = u.id AND cw.server_id = m.server_id) AS seat
         FROM members m JOIN users u ON u.id = m.user_id
         WHERE m.server_id = ? ORDER BY u.username`,
      )
      .all(serverId) as (User & { voiceMuted: number; timeoutUntil: number | null; deleted: number; bot: number; look: string | null })[];
    const mine = db.prepare('SELECT rules_accepted_at, pinned_fire_id FROM members WHERE server_id = ? AND user_id = ?').get(serverId, viewerId) as
      | { rules_accepted_at: number | null; pinned_fire_id: number | null }
      | undefined;
    const accepted = mine?.rules_accepted_at;
    return {
      ...server,
      rulesAccepted: !server.rules || !!accepted,
      // The fire this person keeps at the top. One they can no longer see falls back to the first they can.
      pinnedFireId: channels.some((c) => c.id === mine?.pinned_fire_id && c.kind === 'voice') ? mine!.pinned_fire_id : null,
      notify: prefs.get(0) ?? null,
      channels,
      groups: db.prepare('SELECT id, name FROM room_groups WHERE server_id = ? ORDER BY position, id').all(serverId),
      events: server.kind === 'burrow' ? eventsIn(serverId, viewerId) : [],
      capsules: server.kind === 'burrow' ? capsulesIn(serverId, viewerId) : [],
      threads: threadsIn(serverId, viewerId),
      emoji: emojiOf(serverId),
      sounds: soundsOf(serverId),
      serverMuted: serverMuted(serverId, viewerId),
      ...(server.kind === 'burrow' ? moderationSummary(serverId, viewerId) : {}),
      ...(server.kind === 'burrow' ? { motd: fun.motdOf(serverId), league: hearthLeague.summary(serverId) } : {}),
      ...(server.kind === 'dm' ? { seen: dmSeen(serverId, viewerId) } : {}),
      roles,
      members: members.map((m) => {
        // Highest role first. 'role' is kept for apps from before custom roles.
        const roleIds = memberRoles.filter((r) => r.user_id === m.id).map((r) => r.role_id);
        const host = server.kind === 'burrow' && m.id === server.ownerId;
        const powers = roleIds.some((id) => (roles.find((r) => r.id === id)?.perms.length ?? 0) > 0);
        return { ...m, look: readLook(m.look), deleted: !!m.deleted, bot: !!m.bot, voiceMuted: !!m.voiceMuted, timeoutUntil: (m.timeoutUntil ?? 0) > now() ? m.timeoutUntil : null, roleIds, role: host ? 'host' : powers ? 'mod' : 'member', online: online.has(m.id), ...presenceOf(m.id) };
      }),
    };
  };

  /** Logs someone in on this device. `from` is the request, so "your devices" can say which one it is. */
  const startSession = (user: User, from?: { ip: string; ua: string }) => {
    const token = newToken();
    db.prepare('INSERT INTO sessions (token, user_id, created_at, last_used_at, device, ip) VALUES (?, ?, ?, ?, ?, ?)').run(
      tokenHash(token), user.id, now(), now(), from?.ua.slice(0, 300) ?? null, from?.ip ?? null,
    );
    return { token, user: userById(user.id) ?? user };
  };

  const cleanName = (value: unknown, field: string, max = 64) => {
    const v = typeof value === 'string' ? withoutBidi(value).trim() : '';
    if (!v || looksBlank(v)) throw new HttpError(400, `${field} is required`);
    if (v.length > max) throw new HttpError(400, `${field} must be at most ${max} characters`);
    return v;
  };
  const cleanUsername = (value: unknown) => {
    const username = cleanName(value, 'Username', 32);
    if (!/^[\w.-]+$/.test(username)) throw new HttpError(400, 'Usernames can only use letters, numbers and _ . -');
    return username;
  };
  /** The new password someone picked, when changing or resetting it. */
  const newPassword = (body: Json) => {
    if (typeof body.newPassword !== 'string' || body.newPassword.length < 8) throw new HttpError(400, 'New password must be at least 8 characters');
    return body.newPassword;
  };
  /** A code to type in from an email, 000000 to 999999. */
  const sixDigitCode = () => String(randomBytes(4).readUInt32BE() % 1_000_000).padStart(6, '0');

  // ---- realtime -----------------------------------------------------------

  const sockets = new Map<number, Set<WebSocket>>(); // userId -> open sockets
  const socketTokens = new WeakMap<WebSocket, string>(); // which login (its token's hash) each socket belongs to
  const online = new Set<number>();
  const inVoice = new Map<number, number>(); // userId -> voice channel they are in
  // The connection (so the device) someone sat down at the fire with. Their other devices can't
  // change how they sit there, and that device going offline takes them out of the fire.
  const voiceSockets = new Map<number, WebSocket>();

  const voiceFlags = new Map<number, { muted: boolean; deafened: boolean }>(); // userId -> mic off / not listening
  const speaking = new Set<number>(); // people talking right now, as their apps report it
  const lastActive = new Map<number, number>(); // userId -> when they last talked or touched the app, for the AFK fire
  const usersInVoice = (channelId: number) => [...inVoice].filter(([, c]) => c === channelId).map(([u]) => u);
  /** Muted for everyone in this burrow by a moderator, or timed out. */
  const serverMuted = (serverId: number, userId: number) => {
    const r = db.prepare('SELECT voice_muted, timeout_until FROM members WHERE server_id = ? AND user_id = ?').get(serverId, userId) as
      | { voice_muted: number; timeout_until: number | null }
      | undefined;
    return !!r && (!!r.voice_muted || (r.timeout_until ?? 0) > now()); // muted by a moderator, or timed out
  };
  /** Who's in a voice room, and which of them are muted, deafened or talking, so everyone in the burrow can see. */
  const voiceSummary = (channelId: number) => {
    const userIds = usersInVoice(channelId);
    const flagged = (flag: 'muted' | 'deafened') => userIds.filter((u) => voiceFlags.get(u)?.[flag]);
    const serverId = channelById(channelId)?.serverId;
    // Guests from other servers at a joint fire sit there too (joint-fires.ts).
    const joint = joint_.voiceExtra(channelId);
    return {
      voiceUsers: joint ? [...userIds, ...joint.ids] : userIds,
      ...(joint ? { voiceJoint: joint.info } : {}),
      voiceMuted: flagged('muted'),
      voiceDeafened: flagged('deafened'),
      voiceServerMuted: serverId === undefined ? [] : userIds.filter((u) => serverMuted(serverId, u)),
      voiceSpeaking: userIds.filter((u) => speaking.has(u)),
    };
  };
  // Fireside chat: text for the people in a voice room, while they're there. It's kept in memory
  // only, sent to whoever is in the room, and gone once the last person leaves.
  const fireside = new Map<number, Json[]>(); // voice channel id -> recent messages, oldest first
  let firesideId = 0;
  const FIRESIDE_KEEP = 100;
  const voiceStateEvent = (channelId: number) => {
    const { voiceUsers, voiceMuted, voiceDeafened, voiceServerMuted, voiceSpeaking, voiceJoint } = voiceSummary(channelId);
    return { type: 'voice_state', channelId, userIds: voiceUsers, muted: voiceMuted, deafened: voiceDeafened, serverMuted: voiceServerMuted, speaking: voiceSpeaking, ...(voiceJoint ? { joint: voiceJoint } : {}) };
  };
  const sendTo = (userIds: Iterable<number>, event: Json) => {
    const data = JSON.stringify(event);
    for (const id of userIds) for (const ws of sockets.get(id) ?? []) if (ws.readyState === WebSocket.OPEN) ws.send(data);
  };

  const broadcastToServer = (serverId: number, event: Json) => sendTo(serverMemberIds(serverId), event);
  const broadcastToChannel = (channel: Channel, event: Json) => sendTo(channelAudience(channel), event);
  /** Everyone in a burrow gets their own view of it, since private rooms differ person to person. */
  const sendServerUpdate = (serverId: number) => {
    for (const id of serverMemberIds(serverId)) sendTo([id], { type: 'server_updated', server: serverSummary(serverId, id) });
    // Someone left, or the map was turned off: off the map they go.
    hearthMap.clear(serverId);
  };

  // Who is in which voice room. The app reports joining and leaving; LiveKit carries the audio.
  const voiceTime = voiceTimeTracker(db);
  const setVoice = (userId: number, channelId: number | null, flags?: { muted: boolean; deafened: boolean }) => {
    const prev = inVoice.get(userId);
    voiceTokens.delete(userId); // what they say from here on is what counts
    if (channelId === null) {
      voiceFlags.delete(userId);
      voiceSockets.delete(userId);
    }
    else if (flags) voiceFlags.set(userId, flags);
    if (prev === channelId) {
      // Same room: only muting or deafening changed.
      if (flags && prev !== undefined) broadcastToChannel(channelById(prev)!, voiceStateEvent(prev));
      return;
    }
    if (prev === undefined && channelId === null) return;
    speaking.delete(userId);
    if (prev !== undefined) {
      endLive(userId);
      inVoice.delete(userId);
      voiceTime.stop(userId);
      // The last one out puts the fire out: its chat (unless it's kept) and whatever was playing.
      if (!usersInVoice(prev).length) fireside.delete(prev);
      const old = channelById(prev);
      if (old) broadcastToChannel(old, voiceStateEvent(old.id));
      lamps.fireChanged(prev);
      listen.left(prev);
      movies.left(prev);
      games.left(prev, userId);
      tapes?.left(prev, userId);
      dock.left(userId);
      casinoTables.left(prev, userId);
    }
    if (channelId === null) lastActive.delete(userId);
    else {
      const channel = channelById(channelId)!;
      inVoice.set(userId, channelId);
      voiceTime.start(userId, channel.serverId, channelId);
      lastActive.set(userId, Date.now());
      sendTo([userId], { type: 'fireside_history', channelId, messages: firesideHistory(channel) });
      listen.joined(channelId);
      movies.joined(channelId, userId);
      games.joined(channelId, userId);
      tapes?.joined(channelId, userId);
      joint_.clipsJoined(channelId, userId);
      broadcastToChannel(channel, voiceStateEvent(channelId));
      lamps.fireChanged(channelId);
      if (usersInVoice(channelId).length === 2) nudgeGathered(channel);
    }
  };
  // Going live: sharing your screen posts "is live" in the burrow's go-live room, with a way to
  // join, and it's marked as over when the share stops or they leave the fire.
  const liveNow = new Map<number, number>(); // userId -> their go-live message
  const RELIVE_MS = 5 * 60_000; // sharing again this soon picks the same post back up
  function setLiveEnded(messageId: number, endedAt: number | null) {
    db.prepare("UPDATE messages SET live = json_set(live, '$.endedAt', ?) WHERE id = ? AND live IS NOT NULL").run(endedAt, messageId);
    const message = messageById(messageId);
    const channel = message && channelById(message.channelId as number);
    if (message && channel) broadcastToChannel(channel, { type: 'message_updated', message });
  }
  function endLive(userId: number) {
    const messageId = liveNow.get(userId);
    if (messageId === undefined) return;
    liveNow.delete(userId);
    setLiveEnded(messageId, now());
  }
  function goLive(user: User) {
    const voiceId = inVoice.get(user.id);
    if (voiceId === undefined || liveNow.has(user.id)) return;
    const voice = channelById(voiceId);
    if (!voice || !isBurrow(voice.serverId)) return;
    const liveId = (db.prepare('SELECT live_channel_id FROM servers WHERE id = ?').get(voice.serverId) as { live_channel_id: number | null }).live_channel_id;
    const target = liveId === null ? undefined : channelById(liveId);
    if (!target || !canSee(target, user.id) || postProblem(target, user.id)) return;
    // A fire only some can see isn't announced to people who can't: the post would tell them it's going on.
    if (!channelAudience(target).every((id) => canSee(voice, id))) return;
    const last = db
      .prepare('SELECT id, live FROM messages WHERE channel_id = ? AND author_id = ? AND live IS NOT NULL ORDER BY id DESC LIMIT 1')
      .get(target.id, user.id) as { id: number; live: string } | undefined;
    const was = last && JSON.parse(last.live);
    if (last && was.voiceChannelId === voiceId && was.endedAt && was.endedAt > now() - RELIVE_MS) {
      liveNow.set(user.id, last.id);
      return setLiveEnded(last.id, null);
    }
    try {
      const message = postMessage(user, target.id, { content: '' }, { live: { voiceChannelId: voiceId, endedAt: null } });
      liveNow.set(user.id, message.id as number);
    } catch {
      // Slow mode or the like: no announcement this time.
    }
  }
  const firesideHistory = (channel: Channel) =>
    channel.keepChat
      ? (db.prepare('SELECT id, user_id AS userId, author, content, created_at AS createdAt FROM fireside_messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?')
          .all(channel.id, FIRESIDE_KEEP) as Json[]).reverse()
      : fireside.get(channel.id) ?? [];
  const flagsFrom = (msg: Json) => ({ muted: msg.muted === true, deafened: msg.deafened === true });

  const {
    voiceTokens, voiceRoomIds, kickFromVoice, closeVoiceRoom, liveFire, tellLiveKit, handleLiveKitWebhook,
    matchFireSoon, sweepFires, checkFire, fireSweepTimer, fireTimers,
  } = firesInLiveKit({
    opts, canSee, channelById, checkSeat: (...a) => checkSeat(...a), db, inVoice, setVoice, userById, usersInVoice,
    voiceSockets,
    guestsHere: (...a) => joint_.guestsHere(...a),
    jointKick: (...a) => joint_.jointKick(...a),
  });

  const usersSharingServerWith = (userId: number) =>
    (
      db
        .prepare(
          'SELECT DISTINCT b.user_id FROM members a JOIN members b ON a.server_id = b.server_id WHERE a.user_id = ?',
        )
        .all(userId) as { user_id: number }[]
    ).map((r) => r.user_id);

  // Anyone can send a burst of messages, then about one a second: enough for any conversation, not for a flood.
  const postAllowance = allowance(60, 1);
  // Reactions, edits and poll votes get their own, roomier allowances: a quick burst of reacting
  // never runs into them, but nobody can flood everyone's app (or grow the edit history) with a script.
  const reactAllowance = allowance(60, 3);
  const editAllowance = allowance(30, 0.5);
  const voteAllowance = allowance(30, 1);
  // Changes that refresh the whole hearth for everyone in it (nickname, shown role, RSVPs).
  const refreshAllowance = allowance(20, 0.2);
  const notTooFast = (userId: number) => {
    if (!refreshAllowance.take(userId)) throw new HttpError(429, "You're changing things very fast. Wait a moment.");
  };

  // ---- slash commands, worked out by the server so nobody can fake a dice roll

  /**
   * A message starting with one of these is changed before it's sent: /roll 2d6, /flip, /shrug,
   * /me, /spoiler and /poll Question | answer | answer. Anything else starting with / is sent as
   * it is, so a bot in the room can answer its own commands.
   */
  const slashCommand = (content: string): { content: string; poll?: PollInput } | null => {
    const m = /^\/(\w+)(?:\s+([\s\S]*))?$/.exec(content.trim());
    if (!m) return null;
    const rest = (m[2] ?? '').trim();
    switch (m[1].toLowerCase()) {
      case 'roll': {
        const d = /^(\d{0,2})d(\d{1,4})\s*([+-]\s*\d{1,4})?$/i.exec(rest || 'd6');
        if (!d) throw new HttpError(400, 'Roll dice like /roll 2d6, /roll d20 or /roll 3d8+2');
        const count = Math.max(1, Number(d[1] || 1)), sides = Number(d[2]), bonus = Number((d[3] ?? '0').replace(/\s/g, ''));
        if (count > 20 || sides < 2) throw new HttpError(400, 'Up to 20 dice, with at least 2 sides');
        const rolls = Array.from({ length: count }, () => randomInt(1, sides + 1));
        const total = rolls.reduce((a, b) => a + b, 0) + bonus;
        const shown = `${count}d${sides}${bonus ? (bonus > 0 ? `+${bonus}` : bonus) : ''}`;
        const working = count > 1 || bonus ? `${rolls.join(' + ')}${bonus ? ` ${bonus > 0 ? '+' : '-'} ${Math.abs(bonus)}` : ''} = ` : '';
        return { content: `🎲 rolled ${shown}: ${working}**${total}**` };
      }
      case 'flip':
        return { content: `🪙 flipped a coin: **${randomInt(2) ? 'heads' : 'tails'}**` };
      case 'shrug':
        return { content: `${rest ? rest + ' ' : ''}¯\\_(ツ)_/¯` };
      case 'me':
        return rest ? { content: `*${rest}*` } : null;
      case 'spoiler':
        return rest ? { content: `||${rest}||` } : null;
      case 'poll': {
        const parts = rest.split('|').map((p) => p.trim()).filter(Boolean);
        if (parts.length < 3) throw new HttpError(400, 'Make a poll like /poll Pizza or tacos? | Pizza | Tacos');
        return { content: '', poll: makePoll({ question: parts[0], options: parts.slice(1) }) };
      }
      default:
        return null;
    }
  };

  /**
   * Posts a message: text, files (some hidden as spoilers), a sticker, a reply, and for polls
   * and forwards, the extras those bring. Everyone who can see the room gets it.
   */
  const postMessage = (user: User, channelId: number, input: Json, extras: PostExtras = {}) => {
    const channel = channelById(channelId);
    // A webhook writes in the one room it was made for, whoever can see it. A time capsule was
    // sealed by someone who could post here, and opens even if they've left since.
    const sealed = extras.capsule;
    if (!channel || (!extras.webhook && !sealed && !canSee(channel, user.id))) throw new HttpError(404, "That room is gone, or you can't see it.");
    if (channel.kind === 'voice') throw new HttpError(400, 'Fires have no messages');
    const problem = extras.webhook || sealed ? null : postProblem(channel, user.id);
    if (problem) throw new HttpError(403, problem);
    dmBlockCheck(channel.serverId, user.id);
    if (!extras.scheduled && !extras.webhook && !sealed && !postAllowance.take(user.id))
      throw new HttpError(429, "You're sending messages very fast. Wait a moment.");
    const flagged = filterCheck(channel, user.id, typeof input.content === 'string' ? withoutBidi(input.content) : '');
    // Slow mode: people who manage rooms or messages aren't held back, and nor are scheduled messages.
    // A thread goes at its room's pace, counting the room and all its threads together.
    const paced = channel.kind === 'thread' && channel.parentId !== null ? channelById(channel.parentId) ?? channel : channel;
    if (paced.slow && !extras.scheduled && !sealed && !can(channel.serverId, user.id, 'rooms') && !can(channel.serverId, user.id, 'messages')) {
      const last = (db.prepare('SELECT MAX(created_at) AS t FROM messages WHERE channel_id IN (SELECT id FROM channels WHERE id = ? OR parent_id = ?) AND author_id = ?')
        .get(paced.id, paced.id, user.id) as { t: number | null }).t;
      const wait = last === null ? 0 : Math.ceil((last + paced.slow * 1000 - now()) / 1000);
      if (wait > 0) throw new HttpError(429, `Slow mode is on. You can send another message in ${wait} second${wait === 1 ? '' : 's'}.`);
    }
    const raw = input.content ?? '';
    if (typeof raw !== 'string') throw new HttpError(400, 'Write something first');
    let content = withoutBidi(raw);
    if (content.length > MAX_MESSAGE_LENGTH) throw new HttpError(400, `Messages can be at most ${MAX_MESSAGE_LENGTH} characters. Shorten it, or send it in two parts.`);
    if (content.startsWith('/') && !extras.forwarded && !extras.webhook && !sealed) {
      const command = slashCommand(content);
      if (command) {
        content = command.content;
        if (command.poll) extras = { ...extras, poll: command.poll };
      }
    }
    const attachmentIds = input.attachmentIds;
    const ids = Array.isArray(attachmentIds) ? [...new Set(attachmentIds.map(String))] : [];
    if (ids.length > MAX_ATTACHMENTS) throw new HttpError(400, `You can add up to ${MAX_ATTACHMENTS} files to a message`);
    // Only your own uploads to this room that aren't on a message yet (or, opening a time capsule, its own files).
    const usable = ids.filter(
      (id) =>
        !!db
          .prepare('SELECT 1 FROM attachments WHERE id = ? AND uploader_id = ? AND channel_id = ? AND message_id IS NULL AND capsule_id IS ?')
          .get(id, user.id, channelId, sealed?.id ?? null),
    );
    if (usable.length !== ids.length) throw new HttpError(400, "One of the files didn't finish uploading. Remove it and add it again.");
    const spoilers = new Set(Array.isArray(input.spoilerIds) ? input.spoilerIds.map(String) : []);
    // Descriptions of pictures, by file id.
    const alts = input.descriptions && typeof input.descriptions === 'object' && !Array.isArray(input.descriptions) ? (input.descriptions as Record<string, unknown>) : {};
    const altFor = (id: string) => (typeof alts[id] === 'string' ? (alts[id] as string).trim().slice(0, MAX_ALT_LENGTH) || null : null);
    let stickerId: number | null = null;
    if (input.stickerId != null) {
      const sticker = db.prepare("SELECT server_id FROM custom_emoji WHERE id = ? AND kind = 'sticker'").get(Number(input.stickerId)) as
        | { server_id: number }
        | undefined;
      if (!sticker || !isMember(sticker.server_id, user.id)) throw new HttpError(400, "That sticker isn't available");
      stickerId = Number(input.stickerId);
    }
    if (looksBlank(content) && !usable.length && !stickerId && !extras.poll && !extras.list && !extras.forwarded && !extras.live && !sealed) throw new HttpError(400, 'Write something first');
    let replyId: number | null = null;
    const replyTo = input.replyTo;
    if (replyTo != null) {
      const target = db.prepare('SELECT channel_id FROM messages WHERE id = ?').get(Number(replyTo)) as
        | { channel_id: number }
        | undefined;
      if (!target || target.channel_id !== channelId) throw new HttpError(400, "Can't reply to that message");
      replyId = Number(replyTo);
    }
    // Before the message goes out, so the conversation is back in their list when it arrives.
    if (serverKind(channel.serverId) === 'dm') reopenDm(channel.serverId);
    const r = db
      // Numbered above any message ever deleted, so an id is never used twice (see addIdFloor in db.ts).
      .prepare(
        `INSERT INTO messages (id, channel_id, author_id, content, created_at, reply_to, sticker_id, forwarded, live, capsule)
         VALUES (MAX(COALESCE((SELECT MAX(id) FROM messages), 0), COALESCE((SELECT value FROM id_floor WHERE name = 'messages'), 0)) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        channelId, user.id, content, now(), replyId, stickerId, extras.forwarded ? JSON.stringify(extras.forwarded) : null, extras.live ? JSON.stringify(extras.live) : null,
        sealed ? JSON.stringify({ sealedAt: sealed.sealedAt, opensAt: sealed.opensAt, openedBy: sealed.openedBy }) : null,
      );
    const messageId = Number(r.lastInsertRowid);
    // Sent: the draft for this room is done with, on every device. (Not when someone else opened their capsule.)
    if (!sealed && db.prepare('DELETE FROM drafts WHERE user_id = ? AND channel_id = ?').run(user.id, channelId).changes)
      sendTo([user.id], { type: 'draft', channelId, content: '', updatedAt: now() });
    const forWhom = recordMentions(channel, messageId, user.id, content, replyId);
    usable.forEach((id, position) =>
      db.prepare('UPDATE attachments SET message_id = ?, position = ?, spoiler = ?, alt = ? WHERE id = ?').run(messageId, position, spoilers.has(id) ? 1 : 0, altFor(id), id),
    );
    if (extras.poll) {
      const p = extras.poll;
      db.prepare('INSERT INTO polls (message_id, question, options, multi, closes_at, times) VALUES (?, ?, ?, ?, ?, ?)').run(
        messageId, p.question, JSON.stringify(p.options), p.multi ? 1 : 0, p.closesAt, p.times ? JSON.stringify(p.times) : null,
      );
      if (p.closesAt) wakeAt(p.closesAt);
    }
    if (extras.list) {
      db.prepare('INSERT INTO lists (message_id, title) VALUES (?, ?)').run(messageId, extras.list.title);
      for (const text of extras.list.items) db.prepare('INSERT INTO list_items (message_id, text, added_by) VALUES (?, ?, ?)').run(messageId, text, user.id);
    }
    const message = messageById(messageId)!;
    broadcastToChannel(channel, { type: 'message', message });
    if (flagged) fileReport(channel.serverId, message, null, `Word filter: ${flagged}`);
    alertAway(channel, message, forWhom);
    // Writing in a room means you've read it.
    if (!sealed) markRead(user.id, channel, messageId);
    if (channel.kind === 'thread') threadChanged(channel);
    previewLinks(messageId, channel, content);
    return message;
  };

  // ---- HTTP routes --------------------------------------------------------

  type Route = { method: string; pattern: RegExp; auth: boolean; handler: Handler };
  const routes: Route[] = [];
  const route = (method: string, path: string, handler: Handler, auth = true) =>
    routes.push({ method, pattern: new RegExp('^' + path.replace(/:code/g, '([\\w-]+)').replace(/:\w+/g, '(\\d+)') + '$'), auth, handler });

  const admin = hosting({
    db, rawDb: opts.db, route, fail: (status, message) => new HttpError(status, message),
    hosting: opts.hosting, registrationCode: opts.registrationCode, uploadDir: opts.uploadDir, publicUrl: opts.publicUrl,
    online, inVoice,
    signOut: (userId) => signOutOthers(userId, null, 'Signed out'),
    deleteAccount: (userId, deleteMessages) => deleteAccount(userById(userId)!, deleteMessages),
  });
  const fun = extras({
    db, route, fail: (status, message) => new HttpError(status, message),
    isMember, can, canSee, channelById, inVoice, sendServerUpdate, broadcastToChannel,
    allowed: (serverId, user, perm) => allowed(serverId, user as User, perm),
    userChanged: (userId) => userChanged(userId),
  });
  recap({
    db, route, fail: (status, message) => new HttpError(status, message),
    isMember, canSee, channelById, inVoice, usersInVoice, broadcastToChannel,
  });
  trivia({
    db, route, fail: (status, message) => new HttpError(status, message), isMember, can,
    isBurrow: (serverId) => isBurrow(serverId),
    packDir: opts.triviaDir ?? fileURLToPath(new URL('../trivia/', import.meta.url)),
  });

  route(
    'GET',
    '/api/config',
    () => ({
      registrationCodeRequired: admin.signupMode() === 'code',
      signupLinksOnly: admin.signupMode() === 'links',
      voice: !!opts.voice,
      maxUploadBytes: opts.uploadDir ? maxUpload : 0,
      gifs: !!gifs,
      email: !!opts.mail,
      tapes: !!tapes,
      jointFires: joint_.config,
    }),
    false,
  );

  // ---- usernames nobody new can take
  // Names that read like the server itself, or like a removed account, unless ADMIN_USERS names one.
  const RESERVED_NAMES = new Set(['admin', 'administrator', 'peiskos', 'support', 'system', 'deleted', 'moderator', 'staff', 'everyone', 'here']);
  // A name someone gave up (by deleting the account or renaming) waits this long before anyone else can take it.
  const NAME_HOLD_MS = 30 * 24 * 60 * 60 * 1000;
  const heldNameKey = (name: string) => `held_name:${name.toLowerCase()}`;
  /** Holds someone's old name for them. Only the latest one: renaming again lets the one before go, so nobody can collect names. */
  const holdName = (name: string, userId: number) => {
    db.prepare("DELETE FROM app_settings WHERE key LIKE 'held_name:%' AND json_extract(value, '$.userId') = ?").run(userId);
    db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(heldNameKey(name), JSON.stringify({ until: now() + NAME_HOLD_MS, userId }));
  };
  /** Throws unless `username` is free for this person (or a new one) to take. */
  const checkNameFree = (username: string, userId?: number) => {
    const lower = username.toLowerCase();
    if (RESERVED_NAMES.has(lower) && !(opts.hosting?.admins ?? []).some((n) => n.toLowerCase() === lower))
      throw new HttpError(409, 'That username is reserved');
    const taken = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
    if (taken && taken.id !== userId) throw new HttpError(409, 'That username is taken');
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(heldNameKey(username)) as { value: string } | undefined;
    if (!row) return;
    let held: { until?: number; userId?: number } = {};
    try { held = JSON.parse(row.value); } catch {}
    if ((held.until ?? 0) <= now()) db.prepare('DELETE FROM app_settings WHERE key = ?').run(heldNameKey(username));
    else if (held.userId !== userId) throw new HttpError(409, 'That username is taken');
  };

  /** Somewhere this person has a login from now: their own home or phone, not a stranger's. */
  const knownAddress = (userId: number | undefined, ip: string) =>
    userId !== undefined && !!db.prepare('SELECT 1 FROM sessions WHERE user_id = ? AND ip = ?').get(userId, ip);
  /** The tries counted for a login: from this address, and (unless it's one they use) from everywhere. */
  const loginKeys = (name: string, ip: string, userId?: number) => ({
    here: `login-user:${name}|${ip}`,
    anywhere: knownAddress(userId, ip) ? null : `login-user:${name}`,
  });

  route(
    'POST',
    '/api/register',
    ({ body, ip, ua }) => {
      checkTries([`register-ip:${ip}`], 10);
      // New accounts from one address: 20 an hour, so nobody can script thousands (each costs a
      // password hash). Not from this machine itself (tests, or a server nobody proxies).
      const local = /^(127\.|::1$|::ffff:127\.)/.test(ip);
      if (!local) checkTries([`signup-ip:${ip}`], 20);
      const username = cleanUsername(body.username);
      if (typeof body.password !== 'string' || body.password.length < 8)
        throw new HttpError(400, 'Password must be at least 8 characters');
      // A signup link, the registration code, or nothing at all, as the host chose on the admin page.
      const link = admin.checkSignup(body);
      if (link === 'code' && opts.registrationCode && !sameText(body.registrationCode, opts.registrationCode)) {
        failedTry([`register-ip:${ip}`], 60 * 60 * 1000);
        throw new HttpError(403, "That registration code is wrong. Ask whoever runs this Peiskos for it.");
      }
      // Where the server can send email, an address is required, and it counts right away, so a
      // forgotten password can be reset from day one without confirming it first.
      const email = opts.mail && typeof body.email === 'string' ? body.email.trim() : '';
      if (opts.mail && !looksLikeEmail(email)) throw new HttpError(400, "Enter your email, so you can reset a forgotten password");
      checkNameFree(username);
      const r = db
        .prepare('INSERT INTO users (username, password_hash, created_at, email, email_verified) VALUES (?, ?, ?, ?, ?)')
        .run(username, hashPassword(body.password), now(), email || null, email ? 1 : 0);
      if (link && link !== 'code') admin.useSignupLink(link);
      if (!local) failedTry([`signup-ip:${ip}`], 60 * 60 * 1000);
      return startSession(userById(Number(r.lastInsertRowid))!, { ip, ua });
    },
    false,
  );

  route(
    'POST',
    '/api/login',
    ({ body, ip, ua }) => {
      const name = String(body.username ?? '').toLowerCase();
      checkTries([`login-ip:${ip}`], 30);
      const row = db
        .prepare(`SELECT id, password_hash FROM users WHERE username = ? AND deleted_at IS NULL`)
        .get(String(body.username ?? '')) as { id: number; password_hash: string } | undefined;
      // Wrong passwords lock a name out only from the address they came from, so a stranger
      // can't keep someone out of their own account. Many addresses guessing one name together
      // also stop, but not where that person has logged in before.
      const keys = loginKeys(name, ip, row?.id);
      checkTries([keys.here], 10);
      if (keys.anywhere) checkTries([keys.anywhere], 100);
      if (!row || !verifyPassword(String(body.password ?? ''), row.password_hash)) {
        failedTry([keys.here, `login-ip:${ip}`]);
        if (keys.anywhere) failedTry([keys.anywhere], 60 * 60 * 1000);
        throw new HttpError(401, 'Wrong username or password');
      }
      clearTries(keys.here);
      return loginOrAskCode(row.id, { ip, ua });
    },
    false,
  );

  route('POST', '/api/logout', ({ session }) => {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(session ?? '');
    return { ok: true };
  });

  route('GET', '/api/me', ({ user }) => ({ ...meJson(user), folders: foldersOf(user.id) }));

  // Changing your password signs you out everywhere else.
  route('POST', '/api/me/password', ({ user, body, session }) => {
    const key = `password-user:${user.id}`;
    checkTries([key], 10);
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string };
    if (!verifyPassword(String(body.currentPassword ?? ''), row.password_hash)) {
      failedTry([key]);
      throw new HttpError(403, 'Your current password is wrong');
    }
    clearTries(key);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword(body)), user.id);
    signOutOthers(user.id, session ?? null, 'Password changed');
    return { ok: true };
  });

  route('DELETE', '/api/me/avatar', ({ user }) => setAvatarFile(user, null));

  // ---- favorite burrows: the ones shown in your top bar --------------------

  const MAX_FAVORITES = 5;
  const favoritesOf = (userId: number) =>
    (
      db
        .prepare('SELECT server_id AS id FROM members WHERE user_id = ? AND favorite IS NOT NULL ORDER BY favorite')
        .all(userId) as { id: number }[]
    ).map((r) => r.id);

  route('GET', '/api/me/favorites', ({ user }) => ({ serverIds: favoritesOf(user.id) }));

  /** Replaces your favorites with these burrows, in this order. */
  route('POST', '/api/me/favorites', ({ user, body }) => {
    if (!Array.isArray(body.serverIds)) throw new HttpError(400, 'serverIds must be a list');
    const ids = [...new Set(body.serverIds.map(Number))];
    if (ids.length > MAX_FAVORITES) throw new HttpError(400, `You can favorite up to ${MAX_FAVORITES} hearths`);
    const isBurrow = db.prepare("SELECT 1 FROM members m JOIN servers s ON s.id = m.server_id WHERE m.user_id = ? AND m.server_id = ? AND s.kind = 'burrow'");
    for (const id of ids) if (!isBurrow.get(user.id, id)) throw new HttpError(404, "That hearth is gone, or you're not in it.");
    inTransaction(db, () => {
      db.prepare('UPDATE members SET favorite = NULL WHERE user_id = ?').run(user.id);
      const set = db.prepare('UPDATE members SET favorite = ? WHERE user_id = ? AND server_id = ?');
      ids.forEach((id, i) => set.run(i + 1, user.id, id));
    });
    const serverIds = favoritesOf(user.id);
    sendTo([user.id], { type: 'favorites', serverIds }); // your other devices
    return { serverIds };
  });

  route('GET', '/api/servers', ({ user }) => {
    const ids = db
      .prepare(
        "SELECT m.server_id FROM members m JOIN servers s ON s.id = m.server_id WHERE m.user_id = ? AND s.kind = 'burrow' ORDER BY m.joined_at",
      )
      .all(user.id) as { server_id: number }[];
    return ids.map((r) => serverSummary(r.server_id, user.id));
  });

  // ---- direct messages and calls in them (dms.ts)
  const { isGroupDm, leaveGroup, reopenDm } = directMessages({
    channelById, db, isBotUser, isMember, kickFromVoice, notBot, now, opts, route, sendServerUpdate, sendTo,
    serverMemberIds, serverSummary, usersInVoice, voiceRoomIds,
    areFriends: (...a) => areFriends(...a),
    blocked: (...a) => blocked(...a),
    blockedEitherWay: (...a) => blockedEitherWay(...a),
    dmBlockCheck: (...a) => dmBlockCheck(...a),
    markRead: (...a) => markRead(...a),
    removeBurrowPicture: (...a) => removeBurrowPicture(...a),
    removeFiles: (...a) => removeFiles(...a),
    serverKind: (...a) => serverKind(...a),
  });

  // ---- hearths: making, joining and leaving one, and who's in it ----

  route('POST', '/api/servers', ({ user, body }) => {
    notBot(user);
    const name = cleanName(body.name, 'Hearth name');
    const t = now();
    const r = db
      .prepare('INSERT INTO servers (name, owner_id, invite_code, created_at) VALUES (?, ?, ?, ?)')
      .run(name, user.id, newInviteCode(), t);
    const serverId = Number(r.lastInsertRowid);
    db.prepare('INSERT INTO members (server_id, user_id, joined_at) VALUES (?, ?, ?)').run(serverId, user.id, t);
    db.prepare('INSERT INTO channels (server_id, name, created_at) VALUES (?, ?, ?)').run(serverId, 'general', t);
    // Every hearth starts with its fire, when this server has voice.
    if (opts.voice) db.prepare("INSERT INTO channels (server_id, name, kind, created_at) VALUES (?, 'Campfire', 'voice', ?)").run(serverId, t);
    addModeratorRole(db, serverId);
    return serverSummary(serverId, user.id);
  });

  // The code can be pasted on its own or as a whole invite link.
  route('POST', '/api/join', ({ user, body }) => {
    notBot(user);
    const { serverId, invite } = inviteTarget(body.inviteCode);
    if (db.prepare('SELECT 1 FROM bans WHERE server_id = ? AND user_id = ?').get(serverId, user.id))
      throw new HttpError(403, "You've been banned from this hearth");
    if (!isMember(serverId, user.id)) {
      db.prepare('INSERT INTO members (server_id, user_id, joined_at) VALUES (?, ?, ?)').run(serverId, user.id, now());
      const kept = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(standingKey(serverId, user.id)) as { value: string } | undefined;
      if (kept) {
        const { timeoutUntil, voiceMuted } = JSON.parse(kept.value);
        db.prepare('UPDATE members SET timeout_until = ?, voice_muted = ? WHERE server_id = ? AND user_id = ?')
          .run((timeoutUntil ?? 0) > now() ? timeoutUntil : null, voiceMuted ? 1 : 0, serverId, user.id);
        db.prepare('DELETE FROM app_settings WHERE key = ?').run(standingKey(serverId, user.id));
      }
      if (invite) db.prepare('UPDATE invites SET uses = uses + 1 WHERE code = ?').run(invite);
      sendServerUpdate(serverId);
    }
    return serverSummary(serverId, user.id);
  });

  route('POST', '/api/servers/:id/leave', ({ user, params }) => {
    const serverId = Number(params[0]);
    if (isGroupDm(serverId) && isMember(serverId, user.id)) return leaveGroup(serverId, user);
    const owner = db.prepare("SELECT owner_id FROM servers WHERE id = ? AND kind = 'burrow'").get(serverId) as
      | { owner_id: number }
      | undefined;
    if (!owner || !isMember(serverId, user.id)) throw new HttpError(404, "That hearth is gone, or you're not in it.");
    if (owner.owner_id === user.id) deleteBurrow(serverId);
    else removeMember(serverId, user.id);
    return { ok: true };
  });

  /** A host leaving deletes the burrow, with its files, pictures and emoji. */
  const deleteBurrow = (serverId: number) => {
    broadcastToServer(serverId, { type: 'server_deleted', serverId, reason: 'deleted' });
    // Its bots belong to it alone, so their tokens stop working with it.
    for (const { id } of db.prepare('SELECT id FROM users WHERE bot = 1 AND bot_server_id = ? AND deleted_at IS NULL').all(serverId) as { id: number }[]) {
      signOutOthers(id, null, 'Signed out');
      db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(now(), id);
    }
    for (const id of voiceRoomIds(serverId)) closeVoiceRoom(id);
    removeFiles(
      db
        .prepare('SELECT a.id FROM attachments a JOIN channels c ON c.id = a.channel_id WHERE c.server_id = ?')
        .all(serverId) as Json[],
    );
    removeBurrowPicture(serverId);
    removeBurrowPicture(serverId, 'banner');
    for (const e of db.prepare('SELECT file FROM custom_emoji WHERE server_id = ?').all(serverId) as { file: string }[]) removeEmojiFile(e.file);
    db.prepare("DELETE FROM app_settings WHERE key LIKE ?").run(`standing:${serverId}:%`);
    db.prepare('DELETE FROM servers WHERE id = ?').run(serverId);
  };

  const standingKey = (serverId: number, userId: number) => `standing:${serverId}:${userId}`;
  /** Takes someone out of a burrow: out of its voice rooms, its private rooms and its member list. */
  const removeMember = (serverId: number, userId: number) => {
    // A timeout or a moderator's mute outlasts leaving: it's kept and comes back if they rejoin.
    const standing = db.prepare('SELECT timeout_until AS timeoutUntil, voice_muted AS voiceMuted FROM members WHERE server_id = ? AND user_id = ?').get(serverId, userId) as
      { timeoutUntil: number | null; voiceMuted: number } | undefined;
    if (standing && ((standing.timeoutUntil ?? 0) > now() || standing.voiceMuted))
      db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(standingKey(serverId, userId), JSON.stringify(standing));
    // Every voice room in the burrow, not just the one we think they're in: the app may not have said.
    for (const id of voiceRoomIds(serverId)) kickFromVoice(userId, id);
    db.prepare('DELETE FROM channel_access WHERE user_id = ? AND channel_id IN (SELECT id FROM channels WHERE server_id = ?)').run(userId, serverId);
    db.prepare('DELETE FROM members WHERE server_id = ? AND user_id = ?').run(serverId, userId);
    sendServerUpdate(serverId);
  };

  /** Your standing in a burrow, if it lets you do this. */
  const allowed = (serverId: number, user: User, perm: Perm) => {
    const kind = serverKind(serverId);
    const me = kind === 'burrow' ? standing(serverId, user.id) : null;
    if (!me) throw new HttpError(404, "That hearth is gone, or you're not in it.");
    if (!me.perms.has(perm)) throw new HttpError(403, "Your roles don't allow that");
    return me;
  };

  /** Checks a private room's guest list: people in the burrow, without duplicates. */
  const accessList = (serverId: number, ids: unknown) => {
    const members = new Set(serverMemberIds(serverId));
    return [...new Set(Array.isArray(ids) ? ids.map(Number) : [])].filter((id) => members.has(id));
  };
  /** The same for roles: this burrow's roles, without duplicates. */
  const roleList = (serverId: number, ids: unknown) => {
    const roles = new Set((db.prepare('SELECT id FROM roles WHERE server_id = ?').all(serverId) as { id: number }[]).map((r) => r.id));
    return [...new Set(Array.isArray(ids) ? ids.map(Number) : [])].filter((id) => roles.has(id));
  };
  const setAccess = (channelId: number, ids: number[], roleIds: number[]) => {
    db.prepare('DELETE FROM channel_access WHERE channel_id = ?').run(channelId);
    for (const id of ids) db.prepare('INSERT INTO channel_access (channel_id, user_id) VALUES (?, ?)').run(channelId, id);
    db.prepare('DELETE FROM channel_role_access WHERE channel_id = ?').run(channelId);
    for (const id of roleIds) db.prepare('INSERT INTO channel_role_access (channel_id, role_id) VALUES (?, ?)').run(channelId, id);
  };

  /** After rooms or roles change: anyone in a voice room they can no longer see is taken out, and everyone gets the new view. */
  const accessChanged = (serverId: number) => {
    for (const u of new Set([...inVoice.keys(), ...voiceTokens.keys()])) {
      const c = liveFire(u);
      const channel = c === undefined ? null : channelById(c);
      if (channel?.serverId === serverId && !canSee(channel, u)) kickFromVoice(u, c);
    }
    sendServerUpdate(serverId);
  };

  // ---- custom roles (roles.ts)
  const { cleanColor } = customRoles({
    accessChanged, accessList, allowed, can, channelById, cleanName, closeVoiceRoom, db, fireside, isBotUser,
    isMember, now, opts, removeMember, roleList, route, sendServerUpdate, sendTo, serverMuted, serverSummary,
    setAccess, standing, visibleRoom, voiceTokens,
    audit: (...a) => audit(...a),
    checkSeat: (...a) => checkSeat(...a),
    cleanUploadMb: (...a) => cleanUploadMb(...a),
    dmBlockCheck: (...a) => dmBlockCheck(...a),
    groupIn: (...a) => groupIn(...a),
    jointPass: (...a) => joint_.jointPass(...a),
    manageableThread: (...a) => manageableThread(...a),
    removeBot: (...a) => removeBot(...a),
    removeFiles: (...a) => removeFiles(...a),
    renameThread: (...a) => renameThread(...a),
    roleName: (...a) => roleName(...a),
    threadDeleted: (...a) => threadDeleted(...a),
  });

  // ---- fires shared with other Peiskos servers (joint-fires.ts)
  const joint_ = jointFires({
    db, opts, route, can, channelById, visibleRoom, usersInVoice, nameIn, sendServerUpdate, serverSummary, matchFireSoon,
    allowed: (...a) => allowed(...a),
    audit: (...a) => audit(...a),
    serverKind: (...a) => serverKind(...a),
    hearthOnline: (serverId) => serverMemberIds(serverId).some((id) => online.has(id)),
    voiceChanged: (channelId) => {
      const channel = channelById(channelId);
      if (channel) broadcastToChannel(channel, voiceStateEvent(channelId));
    },
    sendTo,
    clipsAt: (channelId) => tapes?.stateFor(channelId) ?? null,
    clipsAnswer: (...a) => tapes?.guestAnswer(...a),
    guestsMoved: (...a) => tapes?.guestsMoved(...a),
  });

  // ---- voice and the Campfire -----------------------------------------------

  // Someone moved by a moderator (or to the AFK fire) gets a seat even at a full fire, for a little while.
  const pendingMoves = new Map<number, { channelId: number; until: number }>();
  /** A fire with a seat limit is full for everyone but people who manage voice, and people being moved there. */
  const checkSeat = (channel: Channel, userId: number) => {
    if (!channel.userLimit || inVoice.get(userId) === channel.id) return;
    const move = pendingMoves.get(userId);
    if (move && move.channelId === channel.id && move.until > Date.now()) return;
    if (usersInVoice(channel.id).length + joint_.guestCount(channel.id) >= channel.userLimit && !can(channel.serverId, userId, 'voice'))
      throw new HttpError(403, `This fire is full (${channel.userLimit} seats)`);
  };

  /** Someone in a voice room of this burrow that you may move, mute or disconnect. */
  const voiceTarget = (serverId: number, user: User, targetId: number) => {
    const me = allowed(serverId, user, 'voice');
    const target = standing(serverId, targetId);
    if (!target) throw new HttpError(404, "They aren't in this hearth");
    if (targetId !== user.id && (target.host || target.rank <= me.rank)) throw new HttpError(403, "You can't do that to them");
    return target;
  };
  const moveTo = (userId: number, channelId: number, extra: Json = {}) => {
    pendingMoves.set(userId, { channelId, until: Date.now() + 30_000 });
    sendTo([userId], { type: 'voice_move', channelId, ...extra });
  };

  // Moving someone to another fire in the same burrow. Their app takes them there.
  route('POST', '/api/voice/move', ({ user, body }) => {
    const to = channelById(Number(body.channelId));
    const targetId = Number(body.userId);
    const from = channelById(inVoice.get(targetId) ?? -1);
    if (!to || to.kind !== 'voice' || !canSee(to, user.id)) throw new HttpError(404, "That room is gone, or you can't see it.");
    voiceTarget(to.serverId, user, targetId);
    if (!from || from.serverId !== to.serverId) throw new HttpError(400, "They aren't at a fire in this hearth");
    if (!canSee(to, targetId)) throw new HttpError(403, "They can't see that room");
    if (from.id !== to.id) {
      audit(to.serverId, user.id, 'voice_move', targetId, `#${from.name} › #${to.name}`);
      moveTo(targetId, to.id, { by: nameIn(to.serverId, user.id) });
    }
    return { ok: true };
  });

  route('POST', '/api/voice/disconnect', ({ user, body }) => {
    const targetId = Number(body.userId);
    const from = channelById(liveFire(targetId) ?? -1);
    // The same answer whether or not they're at a fire somewhere else, so nobody can use this to find out.
    if (!from || !isMember(from.serverId, user.id)) throw new HttpError(400, "They aren't at a fire");
    voiceTarget(from.serverId, user, targetId);
    sendTo([targetId], { type: 'voice_kicked', by: user.displayName || user.username });
    audit(from.serverId, user.id, 'voice_disconnect', targetId, `#${from.name}`);
    kickFromVoice(targetId, from.id);
    return { ok: true };
  });

  // Muted for everyone, in every voice room of the burrow, until a moderator lets them speak again.
  // LiveKit stops taking their microphone too, so it doesn't rely on their app playing along.
  route('POST', '/api/servers/:id/members/:id/voice-mute', ({ user, params, body }) => {
    const [serverId, targetId] = params.map(Number);
    if (targetId === user.id) throw new HttpError(400, "You can't mute yourself for everyone");
    voiceTarget(serverId, user, targetId);
    const muted = body.muted === true;
    db.prepare('UPDATE members SET voice_muted = ? WHERE server_id = ? AND user_id = ?').run(muted ? 1 : 0, serverId, targetId);
    audit(serverId, user.id, muted ? 'voice_mute' : 'voice_unmute', targetId);
    sendTo([targetId], { type: 'server_muted', serverId, muted });
    sendServerUpdate(serverId);
    const channel = channelById(liveFire(targetId) ?? -1);
    if (channel?.serverId === serverId) {
      tellLiveKit(`change whether user ${targetId} can speak`, (v) => setCanSpeak(v, `room-${channel.id}`, String(targetId), !muted));
      broadcastToChannel(channel, voiceStateEvent(channel.id));
    }
    return { ok: true };
  });

  // The AFK fire: people who haven't talked or touched the app for a while are moved there.
  const checkAfk = (t = Date.now()) => {
    for (const [userId, channelId] of inVoice) {
      const channel = channelById(channelId);
      if (!channel) continue;
      const afk = db.prepare("SELECT afk_channel_id AS id, afk_minutes AS minutes FROM servers WHERE id = ? AND kind = 'burrow'").get(channel.serverId) as
        | { id: number | null; minutes: number }
        | undefined;
      if (!afk?.id || afk.id === channelId) continue;
      if (t - (lastActive.get(userId) ?? t) < afk.minutes * 60_000) continue;
      const to = channelById(afk.id);
      if (to?.kind !== 'voice' || to.serverId !== channel.serverId || !canSee(to, userId)) continue;
      lastActive.set(userId, t);
      moveTo(userId, to.id, { afk: true });
    }
  };
  const afkTimer = setInterval(() => checkAfk(), 30_000);
  afkTimer.unref();

  // ---- the soundboard (soundboard.ts)
  const { handleSoundUpload, playSound, serveSound, soundsOf } = soundboard({
    allowed, channelById, db, inVoice, isMember, lastActive, now, opts, route, sendServerUpdate, sendTo,
    serverMuted, serverSummary, usersInVoice,
    picturePath: (...a) => picturePath(...a),
    uploader: (...a) => uploader(...a),
  });

  // ---- listen together

  // ---- clips at the fire: only with everyone's yes, recorded by each person's own app
  const tapes = opts.voice && opts.uploadDir && opts.tapes !== false
    ? fireTapes({
        db, dir: join(opts.uploadDir, 'tapes'), options: opts.tapes ?? {}, minFreeDisk: opts.minFreeDiskBytes ?? 2 * 1024 ** 3,
        route, canSee, channelById, usersInVoice, inVoice, sendTo, nameIn, userByToken: (t) => userByToken(t),
        isBoss: (channelId, userId) => {
          const channel = channelById(channelId);
          return !!channel && serverKind(channel.serverId) === 'burrow' && !!standing(channel.serverId, userId)?.perms.has('voice');
        },
        isHearth: (serverId) => serverKind(serverId) === 'burrow',
        guestsAt: (channelId) => joint_.guestIds(channelId),
        guestName: (channelId, id) => joint_.guestName(channelId, id),
      })
    : null;

  const listen = listenTogether({
    inVoice, usersInVoice, sendTo,
    isBoss: (channelId, userId) => {
      const channel = channelById(channelId);
      return !!channel && serverKind(channel.serverId) === 'burrow' && !!standing(channel.serverId, userId)?.perms.has('voice');
    },
    // Named the way link previews are, so not at all when those are off.
    videoTitle: async (videoId) => (previewOpts ? (await fetchEmbed(`https://www.youtube.com/watch?v=${videoId}`, previewOpts))?.title : undefined),
    active: (userId, t) => lastActive.set(userId, t),
    fail: (status, message) => new HttpError(status, message),
  });

  // ---- the movie theater at the fire (theater.ts)

  const movies = theater({
    db, opts, now, route, channelById, inVoice, usersInVoice, sendTo, isMember,
    canShareFiles: (serverId, userId) => uploadLimitFor(serverId, userId) > 0,
    isBoss: (serverId, userId) => serverKind(serverId) === 'burrow' && !!standing(serverId, userId)?.perms.has('voice'),
    uploader: (...a) => uploader(...a),
    roomOnDisk: (...a) => roomOnDisk(...a),
    active: (userId, t) => lastActive.set(userId, t),
  });

  // ---- the hearth league (league.ts): a season of points a month from the games, fishing and the casino

  const hearthLeague = league({
    db, route, fail: (status, message) => new HttpError(status, message), isMember, can, channelById, sendServerUpdate,
    isBurrow: (serverId) => isBurrow(serverId),
    now: opts.league?.now,
  });

  // ---- games at the fire

  // ---- lanterns: lamps that glow while friends are at a fire (lanterns.ts)
  const lamps = lanterns({ canSee, channelById, checkTries, db, failedTry, now, route, speaking, usersInVoice });

  const games = fireGames({
    inVoice, usersInVoice, sendTo, fail: (status, message) => new HttpError(status, message),
    result: (channelId, game, players, standings) => {
      const got = hearthLeague.gameResult(channelId, game, players, standings);
      // Everyone who scored hears how many points it was.
      if (got) for (const [id, points] of Object.entries(got)) if (points) sendTo([Number(id)], { type: 'league_points', channelId, game, points });
    },
    ended: (channelId, players, ms) => {
      const serverId = channelById(channelId)?.serverId;
      if (serverId !== undefined) camping.gameEnded(serverId, players, ms);
    },
  });
  const dock = fishingDock({ inVoice, usersInVoice, sendTo });

  // ---- the casino (casino.ts): chips, blackjack, slots, cases, and a hold 'em table at each fire

  const casinoTables = casino({
    db, route, fail: (status, message) => new HttpError(status, message),
    channelById, inVoice, usersInVoice, isMember, serverMemberIds, sendTo, can, sendServerUpdate,
    isOnline: (userId) => sockets.has(userId),
    won: (serverId, userId, what) => hearthLeague.casinoWin(serverId, userId, what),
    ...opts.casino,
  });

  // ---- Fireside Angler (fishing.ts): the fishing game's save, per person per hearth

  fishing({
    db, route, fail: (status, message) => new HttpError(status, message), isMember,
    placed: (serverId, places) => hearthLeague.derbyPlaced(serverId, places),
    saved: (...a) => camping.fishSaved(...a),
  });

  // ---- Hearthland (hearthland.ts): the hearth as a map, with everyone's look and where they stand

  const hearthMap = hearthland({ db, route, isMember, sendTo, userChanged: (...a) => userChanged(...a) });

  // ---- The camp grows (camp.ts): builds on the hearth map from time at the fires, games and fish

  const camping = camp({
    db, route, isMember, serverMemberIds, sendTo,
    busyHearths: () => [...new Set(inVoice.values())].map((c) => channelById(c)?.serverId).filter((id): id is number => id !== undefined),
  });

  // ---- messages: reading, sending, editing, reacting and deleting ----

  // The newest messages, or with ?before= older ones, ?after= newer ones (oldest first),
  // or ?around= the messages either side of one (to jump to it).
  route('GET', '/api/channels/:id/messages', ({ user, params, url }) => {
    const channel = visibleRoom(Number(params[0]), user.id);
    if (channel.kind === 'voice') return [];
    // At least 1: SQLite reads a negative LIMIT as no limit at all.
    const limit = Math.max(1, Math.min(Math.floor(Number(url.searchParams.get('limit'))) || 50, 100));
    const older = (before: number, n: number) =>
      (db.prepare(`${MESSAGE_SELECT} WHERE m.channel_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`).all(channel.id, before, n) as Json[]).reverse();
    const newer = (after: number, n: number) =>
      db.prepare(`${MESSAGE_SELECT} WHERE m.channel_id = ? AND m.id > ? ORDER BY m.id LIMIT ?`).all(channel.id, after, n) as Json[];
    const around = Number(url.searchParams.get('around'));
    if (around) return withAttachments([...older(around + 1, Math.ceil(limit / 2)), ...newer(around, Math.floor(limit / 2))]);
    const after = url.searchParams.get('after');
    if (after !== null) return withAttachments(newer(Number(after) || 0, limit));
    return withAttachments(older(Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER, limit));
  });

  route('POST', '/api/channels/:id/messages', ({ user, params, body }) => postMessage(user, Number(params[0]), body));

  /** A message you wrote, in a room you can still see (someone removed from a burrow can't edit what they left behind). */
  const ownMessage = (user: User, id: number) => {
    const { channel, authorId } = visibleMessage(user, id);
    if (authorId !== user.id) throw new HttpError(403, 'You can only change your own messages');
    return channel;
  };

  route('PATCH', '/api/messages/:id', ({ user, params, body }) => {
    const id = Number(params[0]);
    const channel = ownMessage(user, id);
    // Archived rooms stay as they were, and a timeout stops editing as well as writing.
    const room = channel.kind === 'thread' && channel.parentId !== null ? channelById(channel.parentId) ?? channel : channel;
    if (room.archivedAt !== null) throw new HttpError(403, "This room is archived, so nothing new can go in it");
    const left = timeoutLeft(channel.serverId, user.id);
    if (left) throw new HttpError(403, `You're timed out for ${left}`);
    // A role that can only read the room can't change what's there either.
    const me = standing(channel.serverId, user.id);
    if (me && !me.perms.has('rooms') && me.roleIds.length) {
      const readOnly = db.prepare('SELECT role_id FROM channel_read_only WHERE channel_id = ?').all(room.id) as { role_id: number }[];
      if (readOnly.some((r) => me.roleIds.includes(r.role_id))) throw new HttpError(403, 'Your role can only read this room');
    }
    if (!editAllowance.take(user.id)) throw new HttpError(429, "You're editing very fast. Wait a moment.");
    const hasFiles = !!db.prepare('SELECT 1 FROM attachments WHERE message_id = ?').get(id);
    if (typeof body.content === 'string') body.content = withoutBidi(body.content);
    if (typeof body.content !== 'string' || (looksBlank(body.content) && !hasFiles)) throw new HttpError(400, 'Write something first');
    if (body.content.length > MAX_MESSAGE_LENGTH) throw new HttpError(400, `Messages can be at most ${MAX_MESSAGE_LENGTH} characters. Shorten it, or send it in two parts.`);
    const before = db.prepare('SELECT content, COALESCE(edited_at, created_at) AS at FROM messages WHERE id = ?').get(id) as { content: string; at: number };
    if (before.content === body.content) return messageById(id);
    const flagged = filterCheck(channel, user.id, body.content);
    // The old wording is kept, so anyone can see what an edited message used to say.
    db.prepare('INSERT INTO message_edits (message_id, content, edited_at) VALUES (?, ?, ?)').run(id, before.content, before.at);
    db.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?').run(body.content, now(), id);
    // New @names count for the inbox, without alerting anyone again.
    const replyTo = (db.prepare('SELECT reply_to FROM messages WHERE id = ?').get(id) as { reply_to: number | null }).reply_to;
    recordMentions(channel, id, user.id, body.content, replyTo);
    const linksChanged = linksIn(before.content).join() !== linksIn(body.content).join();
    if (linksChanged) db.prepare('DELETE FROM message_embeds WHERE message_id = ?').run(id);
    const message = messageById(id)!;
    broadcastToChannel(channel, { type: 'message_updated', message });
    if (flagged) fileReport(channel.serverId, message, null, `Word filter: ${flagged}`);
    if (linksChanged) previewLinks(id, channel, body.content);
    return message;
  });

  // Adds your reaction, or takes it away if you'd already reacted with that emoji.
  route('POST', '/api/messages/:id/reactions', ({ user, params, body }) => {
    const id = Number(params[0]);
    const msg = db.prepare('SELECT channel_id FROM messages WHERE id = ?').get(id) as { channel_id: number } | undefined;
    const channel = msg && channelById(msg.channel_id);
    if (!channel || !canSee(channel, user.id)) throw new HttpError(404, 'That message is gone. It may have been deleted.');
    const emoji = typeof body.emoji === 'string' ? body.emoji.trim() : '';
    if (!emoji || !(isCustomEmoji(emoji, user.id) || (emoji.length <= 16 && EMOJI.test(emoji)))) throw new HttpError(400, "That's not an emoji");
    const mine = db.prepare('SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').get(id, user.id, emoji);
    if (!reactAllowance.take(user.id)) throw new HttpError(429, "You're reacting very fast. Wait a moment.");
    if (mine) {
      db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(id, user.id, emoji);
    } else {
      // Timed out: taking a reaction off is fine, adding one is writing in the room.
      const left = timeoutLeft(channel.serverId, user.id);
      if (left) throw new HttpError(403, `You're timed out for ${left}`);
      const kinds = reactionsFor(id);
      if (!kinds.some((k) => k.emoji === emoji) && kinds.length >= MAX_REACTIONS)
        throw new HttpError(400, 'That message has all the reactions it can hold');
      db.prepare('INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)').run(id, user.id, emoji, now());
    }
    const reactions = reactionsFor(id);
    broadcastToChannel(channel, { type: 'reactions', messageId: id, channelId: channel.id, reactions });
    return { reactions };
  });

  // Your own messages, or anyone's if you look after the burrow.
  route('DELETE', '/api/messages/:id', ({ user, params }) => {
    const id = Number(params[0]);
    const msg = db.prepare('SELECT author_id, channel_id FROM messages WHERE id = ?').get(id) as
      | { author_id: number; channel_id: number }
      | undefined;
    const channel = msg && channelById(msg.channel_id);
    if (!msg || !channel || !canSee(channel, user.id)) throw new HttpError(404, 'That message is gone. It may have been deleted.');
    if (msg.author_id !== user.id && !can(channel.serverId, user.id, 'messages'))
      throw new HttpError(403, 'You can only delete your own messages');
    if (msg.author_id !== user.id) {
      const text = (db.prepare('SELECT content FROM messages WHERE id = ?').get(id) as { content: string }).content;
      audit(channel.serverId, user.id, 'message_delete', msg.author_id, `in #${channel.name}: ${text.slice(0, 120)}`);
    }
    removeFiles(db.prepare('SELECT id FROM attachments WHERE message_id = ?').all(id) as Json[]);
    db.prepare('DELETE FROM messages WHERE id = ?').run(id);
    broadcastToChannel(channel, { type: 'message_deleted', id, channelId: channel.id });
    if (channel.kind === 'thread') threadChanged(channel); // its reply count
    return { ok: true };
  });

  const maxUpload = opts.maxUploadBytes ?? 25 * 1024 * 1024;

  // ---- moderation: timeouts, the audit log, bulk delete, the word filter, reports, upload limits ----
  const {
    moderationSummary, isBurrow, filterCheck, fileReport, audit, cleanUploadMb, roleName, timeoutLeft,
    uploadLimitFor, openAdminReports, BURROW_FIELDS, cleanWordFilter,
  } = moderation({
    opts, isAdmin: admin.isAdmin, avatarUrl, allowed, broadcastToChannel, can, channelById, db, isMember, liveFire,
    maxUpload, messageById, now, online, removeFiles: (...a) => removeFiles(...a), route,
    sendServerUpdate, sendTo, serverMemberIds, serverMuted, standing, tellLiveKit,
    threadChanged: (...a) => threadChanged(...a), visibleMessage: (...a) => visibleMessage(...a), visibleRoom,
    voiceStateEvent,
  });

  // ---- uploads, pictures and GIFs (uploads.ts)
  const { DAILY_UPLOAD, avatarPath, filePath, gifs, handleAvatarUpload, handleBurrowPictureUpload, handleMotdPicture, handleThumbUpload, handleUpload, overDay, picturePath, removeBurrowPicture, removeFiles, roomOnDisk, savePicture, serveAttachment, serveGifPreview, servePicture, serveThumb, setAvatarFile, thumbPath, uploadedToday, uploader } = uploads({
    allowed, attachmentJson, checkTries, db, failedTry, fun, isGroupDm, isMember, maxUpload, now, opts, route, sendServerUpdate,
    serverSummary, textRoom, uploadLimitFor, userByToken, visibleRoom,
    userChanged: (...a) => userChanged(...a),
  });

  // ---- where a message is, for lists that mix rooms (saved, search, reminders) ----

  /** The burrow (or DM) and room a message is in, as someone sees it. */
  const placeOf = (channelId: number, viewerId: number) => {
    const c = db
      .prepare(
        `SELECT c.name, c.kind, p.name AS parentName, s.id AS serverId, s.name AS serverName, s.kind AS serverKind
         FROM channels c JOIN servers s ON s.id = c.server_id LEFT JOIN channels p ON p.id = c.parent_id WHERE c.id = ?`,
      )
      .get(channelId) as Json | undefined;
    if (!c) return null;
    const dm = c.serverKind === 'dm';
    const partnerName = dm
      ? (db.prepare('SELECT COALESCE(u.display_name, u.username) AS name FROM members m JOIN users u ON u.id = m.user_id WHERE m.server_id = ? AND m.user_id != ?').get(c.serverId as number, viewerId) as { name: string } | undefined)?.name
      : null;
    return {
      serverId: c.serverId,
      channelId,
      kind: dm ? 'dm' : 'burrow',
      serverName: dm ? partnerName ?? 'Direct message' : c.serverName,
      channelName: c.kind === 'thread' ? c.parentName : c.name,
      threadName: c.kind === 'thread' ? c.name : null,
    };
  };

  /** A message and its room, if this person can see it. */
  const visibleMessage = (user: User, id: number) => {
    const msg = db.prepare('SELECT channel_id, author_id FROM messages WHERE id = ?').get(id) as { channel_id: number; author_id: number } | undefined;
    const channel = msg && channelById(msg.channel_id);
    if (!msg || !channel || !canSee(channel, user.id)) throw new HttpError(404, 'That message is gone. It may have been deleted.');
    return { channel, authorId: msg.author_id };
  };
  const messageChanged = (id: number, channel: Channel) => {
    const message = messageById(id);
    if (message) broadcastToChannel(channel, { type: 'message_updated', message });
    return message;
  };

  // ---- notifications and presence ----
  //
  // Who a message is for (your @name, a reply to you, @everyone, @here or one of your roles) is
  // worked out once, when it's sent, and kept: that's your mentions inbox and your unread
  // mention counts. People who are away get a push on their phone or browser, and if they set
  // up email, an email when a mention is still unread a while later.

  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** @name as a whole username: not the start of a longer one (@max in @max-bot or @max.b), though a full stop after it is fine. */
  const mentionRe = (username: string) => new RegExp(`@${escapeRe(username)}(?![\\w-])(?!\\.[\\w-])`, 'i');
  const serverKind = (serverId: number) => (db.prepare('SELECT kind FROM servers WHERE id = ?').get(serverId) as { kind: string } | undefined)?.kind;

  /** @everyone, @here and @Role, if the author's roles let them ping those. */
  const pingsIn = (channel: Channel, authorId: number, content: string) => {
    if (!content.includes('@') || serverKind(channel.serverId) !== 'burrow' || !can(channel.serverId, authorId, 'everyone')) return null;
    const out: { everyone?: 1; here?: 1; roles?: number[] } = {};
    if (/@everyone\b/i.test(content)) out.everyone = 1;
    if (/@here\b/i.test(content)) out.here = 1;
    const roles = db.prepare('SELECT id, name FROM roles WHERE server_id = ?').all(channel.serverId) as { id: number; name: string }[];
    const named = roles.filter((r) => new RegExp(`@${escapeRe(r.name)}(?![\\w-])`, 'i').test(content)).map((r) => r.id);
    if (named.length) out.roles = named;
    return Object.keys(out).length ? out : null;
  };

  /** Keeps who a message is for (never its author), and returns them. Direct messages are for everyone in them anyway. */
  const recordMentions = (channel: Channel, messageId: number, authorId: number, content: string, replyId: number | null) => {
    const pings = pingsIn(channel, authorId, content);
    db.prepare('UPDATE messages SET pings = ? WHERE id = ?').run(pings ? JSON.stringify(pings) : null, messageId);
    const forWhom = new Set<number>();
    if (serverKind(channel.serverId) !== 'burrow') return forWhom;
    const audience = channelAudience(channel).filter((id) => id !== authorId);
    if (content.includes('@')) {
      const names = db
        .prepare(`SELECT id, username FROM users WHERE id IN (${audience.map(() => '?').join(',') || 'NULL'})`)
        .all(...audience) as { id: number; username: string }[];
      for (const u of names) if (mentionRe(u.username).test(content)) forWhom.add(u.id);
    }
    if (replyId !== null) {
      const to = (db.prepare('SELECT author_id FROM messages WHERE id = ?').get(replyId) as { author_id: number } | undefined)?.author_id;
      if (to !== undefined && audience.includes(to)) forWhom.add(to);
    }
    if (pings?.everyone) audience.forEach((id) => forWhom.add(id));
    if (pings?.here) audience.filter((id) => online.has(id)).forEach((id) => forWhom.add(id));
    if (pings?.roles) {
      const inRoles = db
        .prepare(`SELECT DISTINCT user_id FROM member_roles WHERE server_id = ? AND role_id IN (${pings.roles.map(() => '?').join(',')})`)
        .all(channel.serverId, ...pings.roles) as { user_id: number }[];
      for (const { user_id } of inRoles) if (audience.includes(user_id)) forWhom.add(user_id);
    }
    // Nobody is pinged by someone they've blocked.
    for (const id of forWhom) if (blocked(id, authorId)) forWhom.delete(id);
    const add = db.prepare('INSERT OR IGNORE INTO mentions (message_id, user_id) VALUES (?, ?)');
    for (const id of forWhom) add.run(messageId, id);
    return forWhom;
  };

  // Presence: online, away (chosen, or nobody's touched any of their devices for a while) or
  // do not disturb; a custom status; and the game the desktop app sees them playing.
  const idleSockets = new Map<number, Set<WebSocket>>();
  const activities = new Map<number, { name: string; since: number }>();
  const userIdle = (userId: number) => {
    const all = sockets.get(userId);
    const idleOnes = idleSockets.get(userId);
    return !!all?.size && !!idleOnes && [...all].every((ws) => idleOnes.has(ws));
  };
  const statusRow = (userId: number) =>
    db.prepare('SELECT status, status_text, status_emoji, status_until FROM users WHERE id = ?').get(userId) as StatusRow | undefined;
  const customOf = (r: StatusRow | undefined) =>
    r && (r.status_text || r.status_emoji) && (!r.status_until || r.status_until > now())
      ? { text: r.status_text ?? '', emoji: r.status_emoji ?? '', until: r.status_until }
      : null;
  const presenceOf = (userId: number) => {
    const r = statusRow(userId);
    const on = online.has(userId);
    const status = !on ? 'offline' : r?.status === 'dnd' ? 'dnd' : r?.status === 'away' || userIdle(userId) ? 'away' : 'online';
    const activity = on ? activities.get(userId) ?? null : null;
    return { status, custom: customOf(r), activity };
  };
  const sendPresence = (userId: number) =>
    sendTo(new Set([...usersSharingServerWith(userId), ...friendIds(userId)]), { type: 'presence', userId, online: online.has(userId), ...presenceOf(userId) });
  // A custom status that runs out disappears for everyone at that moment.
  const statusTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const expireStatusAt = (userId: number, until: number | null) => {
    clearTimeout(statusTimers.get(userId));
    statusTimers.delete(userId);
    if (!until) return;
    // Timers top out at about 24 days, so a longer status sets the timer again when it fires early.
    const t = setTimeout(() => {
      statusTimers.delete(userId);
      if (until > now()) expireStatusAt(userId, until);
      else sendPresence(userId);
    }, Math.min(Math.max(0, until - now()) + 50, 2 ** 31 - 1));
    t.unref();
    statusTimers.set(userId, t);
  };

  type MeRow = StatusRow & {
    quiet_start: number | null; quiet_end: number | null; time_zone: string | null; email: string | null; email_verified: number;
    totp_secret: string | null; recovery_codes: string; alert_text: number;
  };
  const meRow = (userId: number) =>
    db
      .prepare('SELECT status, status_text, status_emoji, status_until, quiet_start, quiet_end, time_zone, email, email_verified, totp_secret, recovery_codes, alert_text FROM users WHERE id = ?')
      .get(userId) as MeRow;
  /** You, as your own apps see you: settings included. */
  const meJson = (user: User) => {
    const r = meRow(user.id);
    return {
      ...user,
      readReceipts: readReceiptsOn(user.id),
      status: r.status,
      customStatus: customOf(r),
      quietHours: r.quiet_start === null || r.quiet_end === null ? null : { start: r.quiet_start, end: r.quiet_end, timeZone: r.time_zone },
      alertText: !!r.alert_text,
      email: r.email,
      emailVerified: !!r.email_verified,
      ...profileOf(user.id),
      twoStep: !!r.totp_secret,
      ...(admin.isAdmin(user.id) ? { admin: true, adminReports: openAdminReports() } : {}),
      recoveryCodesLeft: (JSON.parse(r.recovery_codes) as string[]).length,
      blockedIds: blockedBy(user.id),
    };
  };
  const validTimeZone = (tz: unknown) => {
    if (typeof tz !== 'string' || tz.length > 64) return false;
    try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
  };
  /** Status, custom status, quiet hours and the email switch, from PATCH /api/me. Says whether others need telling. */
  const updateMyPresence = (user: User, body: Json) => {
    let changed = false;
    if (body.status !== undefined) {
      if (!['online', 'away', 'dnd'].includes(body.status as string)) throw new HttpError(400, 'Pick online, away or do not disturb');
      db.prepare('UPDATE users SET status = ? WHERE id = ?').run(body.status as string, user.id);
      changed = true;
    }
    if (body.customStatus !== undefined) {
      const c = body.customStatus as Json | null;
      if (c === null) {
        db.prepare('UPDATE users SET status_text = NULL, status_emoji = NULL, status_until = NULL WHERE id = ?').run(user.id);
        expireStatusAt(user.id, null);
      } else {
        const text = typeof c.text === 'string' ? c.text.replace(/\s+/g, ' ').trim() : '';
        const emoji = typeof c.emoji === 'string' ? c.emoji.trim() : '';
        if (text.length > 80) throw new HttpError(400, 'Keep your status under 80 characters');
        if (emoji.length > 40) throw new HttpError(400, "That emoji doesn't work here");
        if (!text && !emoji) throw new HttpError(400, 'Write a status or pick an emoji');
        const until = c.until == null ? null : Math.floor(Number(c.until));
        if (until !== null && !(until > now())) throw new HttpError(400, 'Pick a time in the future');
        db.prepare('UPDATE users SET status_text = ?, status_emoji = ?, status_until = ? WHERE id = ?').run(text || null, emoji || null, until, user.id);
        expireStatusAt(user.id, until);
      }
      changed = true;
    }
    if (body.alertText !== undefined) {
      if (typeof body.alertText !== 'boolean') throw new HttpError(400, 'Say whether alerts show message text');
      db.prepare('UPDATE users SET alert_text = ? WHERE id = ?').run(body.alertText ? 1 : 0, user.id);
    }
    if (body.quietHours !== undefined) {
      const q = body.quietHours as Json | null;
      if (q === null) db.prepare('UPDATE users SET quiet_start = NULL, quiet_end = NULL WHERE id = ?').run(user.id);
      else {
        const start = Math.floor(Number(q.start)), end = Math.floor(Number(q.end));
        const ok = (m: number) => Number.isFinite(m) && m >= 0 && m < 1440;
        if (!ok(start) || !ok(end) || start === end) throw new HttpError(400, 'Pick when quiet hours start and end');
        if (!validTimeZone(q.timeZone)) throw new HttpError(400, "That time zone isn't one Peiskos knows");
        db.prepare('UPDATE users SET quiet_start = ?, quiet_end = ?, time_zone = ? WHERE id = ?').run(start, end, q.timeZone as string, user.id);
      }
    }
    return changed;
  };

  /** Whether it's within someone's quiet hours where they are. */
  const inQuietHours = (userId: number, t = now()) => {
    const r = meRow(userId);
    if (r.quiet_start === null || r.quiet_end === null) return false;
    let minutes: number;
    try {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: r.time_zone ?? 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(t);
      minutes = Number(parts.find((p) => p.type === 'hour')!.value) * 60 + Number(parts.find((p) => p.type === 'minute')!.value);
    } catch {
      return false;
    }
    // Quiet hours usually run past midnight (22:00 to 07:00).
    return r.quiet_start < r.quiet_end ? minutes >= r.quiet_start && minutes < r.quiet_end : minutes >= r.quiet_start || minutes < r.quiet_end;
  };

  // ---- push: alerts while Peiskos is closed (alerts.ts)
  const { alertAway, nudgeGathered, pushTo } = alerts({
    channelAudience, db, inQuietHours, inVoice, isGroupDm, nameIn, now, online, opts, placeOf, route, sendTo,
    serverKind, statusRow, userIdle, usersInVoice,
    blocked: (...a) => blocked(...a),
    notifyPrefsOf: (...a) => notifyPrefsOf(...a),
  });

  // ---- the mentions inbox ----

  route('GET', '/api/mentions', ({ user, url }) => {
    const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
    const seen = new Map<number, Channel | null>();
    const out: { id: number; channelId: number }[] = [];
    let cursor = before;
    // Rooms they can no longer see are skipped, so read in batches until there's one more than a page.
    for (let done = false; out.length <= 30 && !done; ) {
      const rows = db
        .prepare(
          `SELECT x.message_id AS id, m.channel_id AS channelId FROM mentions x JOIN messages m ON m.id = x.message_id
           WHERE x.user_id = ? AND x.message_id < ? ORDER BY x.message_id DESC LIMIT 60`,
        )
        .all(user.id, cursor) as { id: number; channelId: number }[];
      done = rows.length < 60;
      for (const r of rows) {
        cursor = r.id;
        if (!seen.has(r.channelId)) {
          const c = channelById(r.channelId);
          seen.set(r.channelId, c && canSee(c, user.id) ? c : null);
        }
        if (seen.get(r.channelId)) out.push(r);
      }
    }
    const more = out.length > 30;
    out.length = Math.min(out.length, 30);
    const lastRead = new Map<number, number>();
    const messages = messagesByIds(out.map((r) => r.id)).map((m) => {
      const c = seen.get(m.channelId as number)!;
      if (!lastRead.has(c.id)) lastRead.set(c.id, lastReadOf(user.id, c.id, c.serverId));
      return { ...m, place: placeOf(c.id, user.id), unread: (m.id as number) > lastRead.get(c.id)! };
    });
    return { messages, more };
  });
  // Clearing one from your inbox (it stays in the room).
  route('DELETE', '/api/mentions/:id', ({ user, params }) => {
    db.prepare('DELETE FROM mentions WHERE user_id = ? AND message_id = ?').run(user.id, Number(params[0]));
    return { ok: true };
  });

  // ---- email: confirming your address and password resets (email.ts)
  const { hashCode } = emailAddress({
    checkTries, clearTries, db, failedTry, knownAddress, meJson, newPassword, now, opts, route, sixDigitCode,
    confirmIdentity: (...a) => confirmIdentity(...a),
    loginOrAskCode: (...a) => loginOrAskCode(...a),
    signOutOthers: (...a) => signOutOthers(...a),
  });

  // ---- unread messages, pins and edit history (reading.ts)
  const { dmSeen, lastReadOf, markRead, readInfo, readReceiptsOn } = readState({
    can, db, isBurrow, isGroupDm, meJson, messageChanged, messagesByIds, now, route, sendPresence,
    sendServerUpdate, sendTo, serverKind, updateMyPresence, userById, visibleMessage, visibleRoom,
    updateProfile: (...a) => updateProfile(...a),
    userChanged: (...a) => userChanged(...a),
  });

  // ---- saved messages, reminders, scheduled messages and forwarding (saved-messages.ts)
  const { deliverReminders, sendScheduled } = savedMessages({
    DAILY_UPLOAD, canSee, channelById, db, filePath, isMember, messageById, messagesByIds, now, opts,
    overDay, placeOf, postMessage, removeFiles, roomOnDisk, route, sendTo, sockets, textRoom, thumbPath,
    uploadLimitFor, uploadedToday, userById, visibleMessage,
    wakeAt: (...a) => wakeAt(...a),
  });

  // ---- bots and webhooks ----
  const {
    removeBot,
  } = botsAndWebhooks({
    MAX_MESSAGE_LENGTH, opts, allowed, audit, canSee, channelById, cleanName, db, isMember, now, postMessage, removeMember, route,
    sendServerUpdate, signOutOthers: (...a) => signOutOthers(...a), sockets, userById,
  });

  // ---- polls, shared lists and "when works?" (planning.ts)
  const { endPolls, listFor, makePoll, pollFor } = planning({
    can, channelById, cleanName, db, isBurrow, messageChanged, now, postMessage, route,
    sendServerUpdate, textRoom, timeoutLeft, visibleMessage, voteAllowance,
    wakeAt: (...a) => wakeAt(...a),
  });

  // ---- custom emoji and stickers (emoji.ts)
  const { emojiOf, handleEmojiUpload, isCustomEmoji, removeEmojiFile, stickerJson } = customEmoji({
    allowed, db, isMember, now, opts, picturePath, route, savePicture, sendServerUpdate, serverSummary,
    uploader,
  });

  // ---- link previews (link-previews.ts)
  const { embedsFor, previewLinks, previewOpts, serveEmbedImage } = linkPreviews({
    db, messageChanged, now, opts, route, visibleMessage,
  });

  // ---- search (search.ts)
  const { searchRooms } = search({
    canSee, db, messagesByIds, placeOf, route,
  });

  // ---- a hearth's best messages and its pictures (highlights.ts)
  const { bestOfNeeds } = highlights({
    attachmentJson, db, isBurrow, messagesByIds, placeOf, route, searchRooms, serverMemberIds,
  });

  // ---- threads: side conversations off one message (threads.ts)
  const { manageableThread, renameThread, threadChanged, threadDeleted, threadOf, threadsIn } = threads({
    can, canSee, channelById, db, messageChanged, now, readInfo, route, sendServerUpdate, serverSummary,
    visibleMessage,
    postProblem: (...a) => postProblem(...a),
  });

  // ---- rooms and hearth settings (rooms.ts)
  const { groupIn, notifyPrefsOf, postProblem } = roomsAndHearths({
    BURROW_FIELDS, accessChanged, allowed, audit, canSee, channelById, cleanName, cleanUploadMb,
    cleanWordFilter, db, isBotUser, isGroupDm, isMember, now, route, sendServerUpdate, sendTo, serverSummary,
    standing, timeoutLeft,
  });

  // ---- invites (invites.ts)
  const { inviteTarget, sendInvitePage } = invites({
    allowed, audit, can, checkTries, db, escHtml, failedTry, isGroupDm, isMember, now, online, opts, route,
    sendServerUpdate, serverKind, serverMemberIds, serverSummary, standing,
  });

  // ---- drafts: half-written messages follow you between devices. Each save is sent to your other
  // devices straight away; an empty draft is deleted. Only rooms you can still see are listed.
  route('GET', '/api/drafts', ({ user }) => {
    const rows = db.prepare('SELECT channel_id AS channelId, content, updated_at AS updatedAt FROM drafts WHERE user_id = ?').all(user.id) as { channelId: number; content: string; updatedAt: number }[];
    return rows.filter((r) => { try { textRoom(r.channelId, user.id); return true; } catch { return false; } });
  });
  route('POST', '/api/channels/:id/draft', ({ user, params, body }) => {
    const channelId = Number(params[0]);
    textRoom(channelId, user.id);
    const content = typeof body.content === 'string' ? body.content.slice(0, MAX_MESSAGE_LENGTH) : '';
    const updatedAt = now();
    if (content.trim()) {
      db.prepare(
        `INSERT INTO drafts (user_id, channel_id, content, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, channel_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
      ).run(user.id, channelId, content, updatedAt);
    } else db.prepare('DELETE FROM drafts WHERE user_id = ? AND channel_id = ?').run(user.id, channelId);
    sendTo([user.id], { type: 'draft', channelId, content: content.trim() ? content : '', updatedAt });
    return { ok: true, updatedAt };
  });

  // ---- events: game nights and the like, with RSVPs and a reminder ----
  const {
    eventsIn,
  } = hearthEvents({
    allowed, canSee, channelById, cleanName, db, isMember, meetupChanged: (...a) => meetupChanged(...a), notTooFast, now, route,
    sendServerUpdate, serverKind, serverSummary, wakeAt: (...a) => wakeAt(...a),
  });

  // ---- time capsules (capsules.ts)
  const { capsulesIn } = capsules({
    can, canSee, channelById, db, inVoice, notTooFast, now, postMessage, postProblem: (...a) => postProblem(...a), removeFiles, route,
    sendServerUpdate, sendTo, serverKind, userById, usersInVoice,
  });

  // ---- meet-up: where people going to an event are on the way there (meetup.ts)
  const { meetupChanged, sweepMeetups, stopMeetups } = meetup({ db, isMember, now, route, sendTo });

  // ---- the calendar feed (calendar.ts)
  const { remindEvents, sendCalendar } = calendarFeed({
    canSee, channelById, db, isMember, now, opts, route, sendTo,
  });

  // ---- folders of burrows: your own grouping in the burrow list ----

  const foldersOf = (userId: number) => {
    const raw = (db.prepare('SELECT burrow_folders FROM users WHERE id = ?').get(userId) as { burrow_folders: string } | undefined)?.burrow_folders;
    try {
      return JSON.parse(raw ?? '[]') as { id: string; name: string; serverIds: number[] }[];
    } catch {
      return [];
    }
  };

  /** Replaces your folders. Each burrow sits in one folder at most, and only burrows you're in count. */
  route('POST', '/api/me/folders', ({ user, body }) => {
    if (!Array.isArray(body.folders)) throw new HttpError(400, 'folders must be a list');
    if (body.folders.length > MAX_FOLDERS) throw new HttpError(400, `You can have up to ${MAX_FOLDERS} folders`);
    const mine = new Set(
      (db.prepare("SELECT m.server_id AS id FROM members m JOIN servers s ON s.id = m.server_id WHERE m.user_id = ? AND s.kind = 'burrow'").all(user.id) as { id: number }[]).map((r) => r.id),
    );
    const used = new Set<number>();
    const folders = (body.folders as Json[]).map((f, i) => ({
      id: typeof f?.id === 'string' && /^[\w-]{1,24}$/.test(f.id) ? f.id : `f${now().toString(36)}${i}`,
      name: cleanName(f?.name, 'Folder name', 32),
      serverIds: (Array.isArray(f?.serverIds) ? f.serverIds.map(Number) : []).filter((id: number) => mine.has(id) && !used.has(id) && used.add(id)),
    }));
    db.prepare('UPDATE users SET burrow_folders = ? WHERE id = ?').run(JSON.stringify(folders), user.id);
    sendTo([user.id], { type: 'folders', folders }); // your other devices
    return { folders };
  });

  // ---- the clock: scheduled messages, reminders and polls closing ----

  let wakeTimer: ReturnType<typeof setTimeout> | null = null;
  let wakeTime = Infinity;
  /** Makes sure the clock goes off by time t. */
  const wakeAt = (t: number) => {
    if (t >= wakeTime) return;
    if (wakeTimer) clearTimeout(wakeTimer);
    wakeTime = t;
    // Timers can't wait more than about 24 days; an hourly check is plenty for anything further off.
    wakeTimer = setTimeout(tick, Math.max(0, Math.min(t - now(), 3600_000)));
    wakeTimer.unref();
  };
  // `at` is the time the clock last looked, so a reminder that fell due just after that still counts as coming up.
  const nextDue = (at = now()) =>
    (db
      .prepare(
        `SELECT MIN(t) AS t FROM (
           SELECT MIN(send_at) AS t FROM scheduled_messages
           UNION ALL SELECT MIN(remind_at) FROM saved_messages WHERE reminded = 0 AND remind_at > ?
           UNION ALL SELECT MIN(closes_at) FROM polls WHERE ended = 0
           UNION ALL SELECT MIN(starts_at) - ? FROM events WHERE reminded = 0 AND starts_at > ?)`,
      )
      .get(at, EVENT_REMIND_MS, now()) as { t: number | null }).t;
  const tick = () => {
    wakeTimer = null;
    wakeTime = Infinity;
    const at = now();
    try {
      sendScheduled();
      deliverReminders(undefined, at);
      endPolls();
      remindEvents();
    } catch (err) {
      console.error(err);
    } finally {
      const next = nextDue(at);
      if (next !== null) wakeAt(next);
    }
  };
  {
    const next = nextDue();
    if (next !== null) wakeAt(next);
  }

  // ---- profiles, nicknames and achievements (profiles.ts)
  const { handleBannerUpload, profileOf, updateProfile, userChanged } = profiles({
    avatarPath, bestOfNeeds, canSee, channelById, cleanColor, db, isBurrow, isMember, meJson, notTooFast,
    now, opts, route, savePicture, sendServerUpdate, sendTo, serverSummary, uploader, userById,
    usersSharingServerWith,
    blocked: (...a) => blocked(...a),
    friendIds: (...a) => friendIds(...a),
    friendState: (...a) => friendState(...a),
    pendingIds: (...a) => pendingIds(...a),
    trophies: (userId, viewerId) => hearthLeague.trophies(userId, viewerId),
  });

  // ---- friends and blocking -----------------------------------------------
  const {
    dmBlockCheck, areFriends, blockedEitherWay, blocked, friendIds, blockedBy, pendingIds, friendState, friendsOf,
  } = friendships({
    checkTries, db, failedTry, meJson, notBot, now, online, presenceOf, pushTo, route, sendPresence, sendTo,
    userById,
  });

  // ---- your login, devices, two-step login, passkeys, and leaving for good (login.ts)
  const { confirmIdentity, deleteAccount, handleExport, loginOrAskCode, signOutOthers } = login({
    accessChanged, avatarPath, broadcastToChannel, channelById, checkNameFree, checkTries, cleanUsername,
    clearTries, db, deleteBurrow, failedTry, filePath, friendsOf, hashCode, holdName, isBotUser, leaveGroup,
    meJson, newPassword, now, opts, placeOf, removeFiles, removeMember, route, sendServerUpdate, sendTo,
    serverMemberIds, socketTokens, sockets, startSession, userById, userByToken, userChanged,
  });

  // ---- HTTP plumbing ------------------------------------------------------

  const sendFile = staticFiles();
  const serveStatic = async (req: IncomingMessage, res: ServerResponse, pathname: string, version: string | null) => {
    const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
    const file = join(opts.publicDir, rel);
    if (!file.startsWith(opts.publicDir)) return send(res, 404, { error: 'Not found' });
    if (await sendFile(req, res, file, MIME[extname(file)] ?? 'application/octet-stream', version)) return;
    // Single-page app: unknown non-API paths get the shell.
    if (!(await sendFile(req, res, join(opts.publicDir, 'index.html'), MIME['.html']))) send(res, 404, { error: 'Not found' });
  };

  const server = createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    // Behind HTTPS (Caddy says so), tell browsers never to use plain HTTP for this site.
    if (req.headers['x-forwarded-proto'] === 'https') res.setHeader('strict-transport-security', 'max-age=31536000');
    // The desktop and phone apps load their UI locally and talk to this server cross-origin, so every
    // header the client sends has to be listed here, or the apps' browsers refuse the request.
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'authorization, content-type, x-filename, x-voice-seconds, x-width, x-height');
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();

    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      // The web app may only run its own scripts, and can't be framed by other sites. Games at the
      // fire are framed by Peiskos itself, and only by it.
      const game = url.pathname.startsWith('/games/');
      res.setHeader('content-security-policy', game ? APP_CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'") : APP_CSP);
      res.setHeader('x-frame-options', game ? 'SAMEORIGIN' : 'DENY');
      res.setHeader('permissions-policy', 'camera=(self), display-capture=(self), geolocation=(self), microphone=(self)');
      // Invite links open the app, which shows the burrow before joining.
      const invite = url.pathname.match(/^\/invite\/([\w-]{1,32})\/?$/);
      if (invite) return sendInvitePage(req, res, invite[1]);
      const appLink = req.method === 'GET' || req.method === 'HEAD' ? appLinkFile(url.pathname, opts.appLinks) : null;
      if (appLink) return res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' }).end(req.method === 'HEAD' ? undefined : appLink);
      // Not the app's page: a phone asking about links that aren't set up should hear "none".
      if (url.pathname.startsWith('/.well-known/')) return send(res, 404, { error: 'Not found' });
      const calendar = url.pathname.match(/^\/calendar\/([\w-]{20,64})\.ics$/);
      if (calendar && req.method === 'GET') return sendCalendar(req, res, calendar[1]);
      // Something shared from another app on a phone, before Peiskos's service worker was there to
      // catch it: open the app (the shared things are lost, but it doesn't error).
      if (req.method === 'POST' && url.pathname === '/share') return res.writeHead(303, { location: '/' }).end();
      const legal = url.pathname.match(/^\/(privacy|terms|child-safety)\/?$/);
      if (legal) {
        const o: LegalOptions = {
          name: opts.legal?.name,
          contact: opts.legal?.contact ?? fallbackContact(opts.mail?.from),
          publicUrl: opts.publicUrl,
          backupDays: opts.hosting?.backupKeep ?? 0,
          offsite: !!opts.hosting?.offsite,
        };
        const html = legal[1] === 'privacy' ? privacyPage(o) : legal[1] === 'terms' ? termsPage(o) : childSafetyPage(o);
        return res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' }).end(req.method === 'HEAD' ? undefined : html);
      }
      return serveStatic(req, res, url.pathname, url.searchParams.get('v'));
    }

    try {
      const upload = req.method === 'POST' && url.pathname.match(/^\/api\/channels\/(\d+)\/attachments$/);
      if (upload) return await handleUpload(req, res, Number(upload[1]));
      const thumb = url.pathname.match(/^\/api\/attachments\/([\w-]+)\/thumb$/);
      if (thumb && req.method === 'POST') return await handleThumbUpload(req, res, thumb[1]);
      if (thumb && (req.method === 'GET' || req.method === 'HEAD')) return await serveThumb(req, res, thumb[1]);
      const file = (req.method === 'GET' || req.method === 'HEAD') && url.pathname.match(/^\/api\/attachments\/([\w-]+)(\/|$)/);
      if (file) return await serveAttachment(req, res, file[1]);
      if (req.method === 'POST' && url.pathname === '/api/livekit/webhook') return await handleLiveKitWebhook(req, res);
      if (tapes && url.pathname.startsWith('/api/tape') && (await tapes.handleRaw(req, res, url))) return;
      if (req.method === 'POST' && url.pathname === '/api/me/avatar') return await handleAvatarUpload(req, res);
      if (req.method === 'POST' && url.pathname === '/api/me/banner') return await handleBannerUpload(req, res);
      if (req.method === 'GET' && url.pathname === '/api/me/export') return await handleExport(req, res);
      const burrowUpload = req.method === 'POST' && url.pathname.match(/^\/api\/servers\/(\d+)\/(picture|banner)$/);
      if (burrowUpload) return await handleBurrowPictureUpload(req, res, Number(burrowUpload[1]), burrowUpload[2] === 'banner' ? 'banner' : 'icon');
      const motdUpload = req.method === 'POST' && url.pathname.match(/^\/api\/servers\/(\d+)\/motd\/picture$/);
      if (motdUpload) return await handleMotdPicture(req, res, Number(motdUpload[1]), url);
      const emojiUpload = req.method === 'POST' && url.pathname.match(/^\/api\/servers\/(\d+)\/emoji$/);
      if (emojiUpload) return await handleEmojiUpload(req, res, Number(emojiUpload[1]), url);
      const soundUpload = req.method === 'POST' && url.pathname.match(/^\/api\/servers\/(\d+)\/sounds$/);
      if (soundUpload) return await handleSoundUpload(req, res, Number(soundUpload[1]), url);
      const moviePiece = req.method === 'PUT' && url.pathname.match(/^\/api\/movie-uploads\/([\w-]+)$/);
      if (moviePiece) return await movies.handleMoviePiece(req, res, moviePiece[1], url);
      const reading = req.method === 'GET' || req.method === 'HEAD';
      const movie = reading && url.pathname.match(/^\/api\/movies\/([\w-]+)\.mp4$/);
      if (movie) return await movies.serveMovie(req, res, movie[1]);
      const picture = reading && url.pathname.match(/^\/api\/(avatars|burrow-pictures|emoji)\/([\w-]+\.(?:png|jpg|gif|webp))$/);
      if (picture) return await servePicture(req, res, picture[1], picture[2]);
      const sound = reading && url.pathname.match(/^\/api\/sounds\/([\w-]+\.(?:mp3|ogg|wav|webm|m4a))$/);
      if (sound) return await serveSound(req, res, sound[1]);
      const embedImage = reading && url.pathname.match(/^\/api\/embeds\/(\d+)\/(\d+)\/([\w-]+)$/);
      if (embedImage) return await serveEmbedImage(req, res, Number(embedImage[1]), Number(embedImage[2]), embedImage[3]);
      const gifPreview = reading && url.pathname.match(/^\/api\/gifs\/preview\/([\w-]+)$/);
      if (gifPreview) return await serveGifPreview(req, res, gifPreview[1]);
      for (const r of routes) {
        const m = r.method === req.method && url.pathname.match(r.pattern);
        if (!m) continue;
        const token = bearer(req);
        const user = userByToken(token);
        if (r.auth && !user) throw new HttpError(401, "You're logged out. Log in again.");
        const body = req.method === 'GET' ? {} : await readBody(req);
        const ua = String(req.headers['user-agent'] ?? '');
        const secure = req.headers['x-forwarded-proto'] === 'https' || !!(req.socket as { encrypted?: boolean }).encrypted;
        return send(res, 200, await r.handler({ user: user!, params: m.slice(1), body, url, session: token ? tokenHash(token) : undefined, ip: clientIp(req), ua, host: String(req.headers.host ?? ''), secure }));
      }
      throw new HttpError(404, 'Not found');
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error(err);
      send(res, 500, { error: 'Internal server error' });
    }
  });

  // ---- WebSocket ----------------------------------------------------------

  // The app only sends small messages (the biggest is a 4000-character chat message), so a
  // connection that sends more than this is cut off rather than kept in memory.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/lantern') return lamps.upgrade(req, socket, head);
    const user = url.pathname === '/ws' ? userByToken(url.searchParams.get('token') ?? undefined) : undefined;
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      socketTokens.set(ws, tokenHash(url.searchParams.get('token')!));
      onConnection(ws, user);
    });
  });

  const onConnection = (ws: WebSocket, user: User) => {
    let set = sockets.get(user.id);
    if (!set) sockets.set(user.id, (set = new Set()));
    set.add(ws);
    if (!online.has(user.id)) {
      online.add(user.id);
      sendPresence(user.id);
    } else if (idleSockets.has(user.id)) {
      // A new device is in use, so they're back.
      const wasIdle = userIdle(user.id);
      if (wasIdle) sendPresence(user.id);
    }
    ws.send(JSON.stringify({ type: 'ready', user }));
    deliverReminders(user.id);

    // A broken or oversized frame closes the connection. Without a listener the error would stop the whole server.
    ws.on('error', () => ws.terminate());
    // Apps send a few messages a second at most (speaking, typing); far more than that is ignored.
    const frames = allowance(200, 50);
    // A game's host sends the board many times a second, so games get their own allowance.
    const gameFrames = allowance(120, 45);

    let alive = true;
    ws.on('pong', () => (alive = true));
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 30_000);

    /** Whether this connection is the one they sit at the fire with (or they aren't at one). */
    const voiceDevice = () => (voiceSockets.get(user.id) ?? ws) === ws;
    ws.on('message', (raw) => {
      const text = String(raw);
      const game = text.startsWith('{"type":"game"');
      if (!(game ? gameFrames : frames).take(0)) return;
      let msg: Json;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      // A second "type" later in the text would win, so only game messages get the games' allowance.
      if (game && msg.type !== 'game') return;
      try {
        if (msg.type === 'ping') {
          // The app checks now and then that the connection still works (a dropped Wi-Fi often doesn't close it).
          ws.send(JSON.stringify({ type: 'pong' }));
        } else if (msg.type === 'send') {
          postMessage(user, Number(msg.channelId), msg);
        } else if (msg.type === 'voice_join') {
          const channel = channelById(Number(msg.channelId));
          if (!channel || channel.kind !== 'voice' || !canSee(channel, user.id))
            throw new HttpError(404, "That room is gone, or you can't see it.");
          checkSeat(channel, user.id);
          pendingMoves.delete(user.id);
          // Sitting down on another device: the one they were at the fire on gets up.
          const was = voiceSockets.get(user.id);
          voiceSockets.set(user.id, ws);
          if (was && was !== ws && was.readyState === WebSocket.OPEN) was.send(JSON.stringify({ type: 'voice_elsewhere', channelId: channel.id }));
          setVoice(user.id, channel.id, flagsFrom(msg));
        } else if (!voiceDevice() && ['voice_status', 'voice_leave', 'voice_live', 'voice_speaking'].includes(msg.type as string)) {
          // From a device that isn't the one at the fire (or one that just lost it to another).
        } else if (msg.type === 'voice_status') {
          // Muted or deafened, in the room they're already in.
          const channelId = inVoice.get(user.id);
          if (channelId !== undefined) setVoice(user.id, channelId, flagsFrom(msg));
        } else if (msg.type === 'voice_leave') {
          setVoice(user.id, null);
        } else if (msg.type === 'voice_live') {
          // Started or stopped sharing their screen.
          if (msg.live === true) goLive(user);
          else endLive(user.id);
        } else if (msg.type === 'fireside_send') {
          const channelId = inVoice.get(user.id);
          if (channelId === undefined) throw new HttpError(400, 'Join the fire to talk there');
          const left = timeoutLeft(channelById(channelId)!.serverId, user.id);
          if (left) throw new HttpError(403, `You're timed out for ${left}`);
          const content = typeof msg.content === 'string' ? withoutBidi(msg.content).trim() : '';
          if (looksBlank(content)) throw new HttpError(400, 'Write something first');
          if (content.length > 1000) throw new HttpError(400, 'Messages here can be at most 1000 characters');
          if (!postAllowance.take(user.id)) throw new HttpError(429, "You're sending messages very fast. Wait a moment.");
          const author = nameIn(channelById(channelId)!.serverId, user.id);
          const message = { id: ++firesideId, userId: user.id, author, content, createdAt: Date.now() };
          if (channelById(channelId)?.keepChat) {
            const r = db
              .prepare('INSERT INTO fireside_messages (channel_id, user_id, author, content, created_at) VALUES (?, ?, ?, ?, ?)')
              .run(channelId, user.id, author, content, message.createdAt);
            message.id = Number(r.lastInsertRowid);
            db.prepare('DELETE FROM fireside_messages WHERE channel_id = ? AND id NOT IN (SELECT id FROM fireside_messages WHERE channel_id = ? ORDER BY id DESC LIMIT ?)')
              .run(channelId, channelId, FIRESIDE_KEEP);
          } else {
            const list = fireside.get(channelId) ?? [];
            list.push(message);
            if (list.length > FIRESIDE_KEEP) list.shift();
            fireside.set(channelId, list);
          }
          sendTo(usersInVoice(channelId), { type: 'fireside', channelId, message });
        } else if (msg.type === 'voice_speaking') {
          // Talking or not. Only lanterns hear about it as it happens (people at the fire see it in
          // the call itself); the server's list of rooms carries it for anyone loading one.
          const channelId = inVoice.get(user.id);
          const on = msg.speaking === true;
          if (channelId === undefined || speaking.has(user.id) === on) return;
          if (on) {
            speaking.add(user.id);
            lastActive.set(user.id, Date.now());
          } else speaking.delete(user.id);
          lamps.fireChanged(channelId);
        } else if (msg.type === 'idle') {
          // Nobody has touched this device for a while (or they're back).
          const before = userIdle(user.id);
          let idleHere = idleSockets.get(user.id);
          if (!idleHere) idleSockets.set(user.id, (idleHere = new Set()));
          if (msg.idle) idleHere.add(ws);
          else idleHere.delete(ws);
          if (before !== userIdle(user.id)) sendPresence(user.id);
        } else if (msg.type === 'activity') {
          // The game the desktop app sees running, or nothing.
          const name = typeof msg.name === 'string' ? msg.name.replace(/\s+/g, ' ').trim().slice(0, 64) : '';
          const was = activities.get(user.id);
          if ((was?.name ?? '') === name) return;
          if (name) activities.set(user.id, { name, since: now() });
          else activities.delete(user.id);
          sendPresence(user.id);
        } else if (msg.type === 'voice_active') {
          // Touched the app, so they aren't away.
          if (inVoice.has(user.id)) lastActive.set(user.id, Date.now());
        } else if (msg.type === 'soundboard') {
          playSound(user, Number(msg.soundId));
        } else if (msg.type === 'tape') {
          const fail = (err: unknown) => ws.send(JSON.stringify({ type: 'error', error: err instanceof Error ? err.message : 'Error' }));
          const at = inVoice.get(user.id);
          // At another server's fire, answers go to that server; clips there are its to turn on.
          const there = at === undefined ? Promise.resolve(false) : joint_.clipsHere(user, at, msg);
          there.then((done) => {
            if (done) return;
            if (!tapes) throw new HttpError(404, "This server doesn't tape fires.");
            return tapes.handle(user, msg);
          }).catch(fail);
        } else if (msg.type === 'listen') {
          listen.handle(user, msg);
        } else if (msg.type === 'theater') {
          movies.handle(user, msg);
        } else if (msg.type === 'game') {
          games.handle(user, ws, msg);
        } else if (msg.type === 'fishing') {
          dock.handle(user, ws, msg);
        } else if (msg.type === 'map') {
          hearthMap.handle(user, ws, msg);
        } else if (msg.type === 'casino') {
          casinoTables.watch(ws, user.id, msg.channelId == null ? null : Number(msg.channelId));
        } else if (msg.type === 'typing') {
          const channel = channelById(Number(msg.channelId));
          if (channel && canSee(channel, user.id))
            sendTo(
              channelAudience(channel).filter((id) => id !== user.id),
              { type: 'typing', channelId: channel.id, userId: user.id, username: nameIn(channel.serverId, user.id) },
            );
        }
      } catch (err) {
        // The app's own tag for what it sent, so it can put an unsent message back in the box.
        const nonce = typeof msg?.nonce === 'string' ? msg.nonce.slice(0, 64) : undefined;
        ws.send(JSON.stringify({ type: 'error', error: err instanceof Error ? err.message : 'Error', nonce }));
      }
    });

    ws.on('close', () => {
      clearInterval(ping);
      set!.delete(ws);
      const wasIdle = userIdle(user.id);
      idleSockets.get(user.id)?.delete(ws);
      games.closed(user.id, ws);
      dock.closed(user.id, ws);
      hearthMap.closed(user.id, ws);
      casinoTables.closed(ws);
      // The device they were at the fire on is gone, even if another one is still connected.
      const fire = inVoice.get(user.id);
      if (voiceSockets.get(user.id) === ws) setVoice(user.id, null);
      // Gone from here, but maybe not from LiveKit (a phone between networks, say). Still there in
      // a little while without their app having come back to say so, they're shown at the fire again.
      if (fire !== undefined && !inVoice.has(user.id)) matchFireSoon(fire, 20_000);
      if (set!.size === 0) {
        sockets.delete(user.id);
        online.delete(user.id);
        idleSockets.delete(user.id);
        activities.delete(user.id);
        setVoice(user.id, null);
        sendPresence(user.id);
      } else if (wasIdle !== userIdle(user.id)) sendPresence(user.id);
    });
  };

  // Tests set a due time in the past and then check the clock, rather than waiting for it.
  Object.assign(server, { checkClock: tick, checkAfk, sweepFires, checkFire, tapes, sweepMeetups, checkCamp: camping.check });
  server.on('close', () => {
    wss.close();
    clearInterval(afkTimer);
    clearInterval(fireSweepTimer);
    for (const t of fireTimers) clearTimeout(t);
    casinoTables.stop();
    tapes?.stop();
    lamps.stop();
    stopMeetups();
    camping.stop();
    for (const t of statusTimers.values()) clearTimeout(t);
    if (wakeTimer) clearTimeout(wakeTimer);
  });
  return server;
}
