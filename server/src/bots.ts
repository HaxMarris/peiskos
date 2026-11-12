// Bots and webhooks: accounts that post in a hearth without a person behind them. A bot signs in
// with its own token; a webhook is a link that anything able to send a web request can post to.
import { newToken } from './auth.ts';
import { type Db, tokenHash } from './db.ts';
import { HttpError, type Json, sameText } from './http.ts';
import { createHash, randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import type { AppOptions, Channel, Handler, Perm, Standing, User } from './app.ts';

export interface BotsContext {
  MAX_MESSAGE_LENGTH: number;
  opts: AppOptions;
  allowed: (serverId: number, user: User, perm: Perm) => Standing;
  audit: (serverId: number, actorId: number | null, action: string, targetId: number | null, detail?: string) => void;
  canSee: (channel: Channel, userId: number) => boolean;
  channelById: (id: number) => Channel | undefined;
  cleanName: (value: unknown, field: string, max?: number) => string;
  db: Db;
  isMember: (serverId: number, userId: number) => boolean;
  now: () => number;
  postMessage: (user: User, channelId: number, input: Json, extras?: { forwarded?: Json; poll?: { question: string; options: string[]; multi: boolean; closesAt: number | null; times?: number[]; }; list?: { title: string; items: string[]; }; scheduled?: boolean; live?: Json; webhook?: boolean; }) => Json;
  removeMember: (serverId: number, userId: number) => void;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => unknown;
  sendServerUpdate: (serverId: number) => void;
  signOutOthers: (userId: number, keepToken: string | null, reason: string) => void;
  sockets: Map<number, Set<WebSocket>>;
  userById: (id: number) => User | undefined;
}

export function botsAndWebhooks(ctx: BotsContext) {
  const {
    MAX_MESSAGE_LENGTH, opts, allowed, audit, canSee, channelById, cleanName, db, isMember, now, postMessage, removeMember, route,
    sendServerUpdate, signOutOthers, sockets, userById,
  } = ctx;

  //
  // A bot is an account for one burrow that logs in with a token instead of a password and uses
  // the same API and live connection as the app. A webhook is a web address that writes in one
  // room as its own bot, for services that only know how to send a message (GitHub, a home
  // server, a script). People who can edit the burrow make both.

  const MAX_BOTS = 20; // bots and webhooks in one burrow
  const botName = (value: unknown) => {
    const name = cleanName(value, 'Name', 32);
    if (/[\x00-\x1f]/.test(name)) throw new HttpError(400, "Names can't have control characters");
    return name;
  };
  /** A bot account: a username from its name (made unique), never able to log in with a password. */
  const makeBot = (serverId: number, name: string) => {
    const base = name.toLowerCase().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'bot';
    let username = `${base}-bot`;
    for (let n = 2; db.prepare('SELECT 1 FROM users WHERE username = ?').get(username); n++) username = `${base}-bot${n}`;
    const r = db
      .prepare('INSERT INTO users (username, display_name, password_hash, created_at, bot, bot_server_id) VALUES (?, ?, ?, ?, 1, ?)')
      .run(username, name, `bot$${randomBytes(16).toString('base64url')}`, now(), serverId);
    const id = Number(r.lastInsertRowid);
    db.prepare('INSERT INTO members (server_id, user_id, joined_at) VALUES (?, ?, ?)').run(serverId, id, now());
    return id;
  };
  const newBotToken = (userId: number) => {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    const token = newToken();
    db.prepare("INSERT INTO sessions (token, user_id, created_at, last_used_at, device) VALUES (?, ?, ?, ?, 'Bot')").run(tokenHash(token), userId, now(), now());
    return token;
  };
  const removeBot = (serverId: number, userId: number) => {
    signOutOthers(userId, null, 'Signed out');
    db.prepare('DELETE FROM webhooks WHERE user_id = ?').run(userId);
    // Its messages stay, under its name.
    db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(now(), userId);
    removeMember(serverId, userId);
  };
  const botsOf = (serverId: number) => ({
    bots: db
      .prepare(`SELECT u.id, u.username, u.display_name AS name, u.created_at AS createdAt,
                  (SELECT MAX(COALESCE(s.last_used_at, s.created_at)) FROM sessions s WHERE s.user_id = u.id) AS lastUsed
                FROM users u WHERE u.bot = 1 AND u.bot_server_id = ? AND u.deleted_at IS NULL
                  AND NOT EXISTS (SELECT 1 FROM webhooks w WHERE w.user_id = u.id) ORDER BY u.id`)
      .all(serverId),
    webhooks: db
      .prepare(`SELECT w.id, w.channel_id AS channelId, u.display_name AS name, u.id AS userId, w.created_at AS createdAt
                FROM webhooks w JOIN users u ON u.id = w.user_id WHERE w.server_id = ? ORDER BY w.id`)
      .all(serverId),
  });
  const botCount = (serverId: number) =>
    (db.prepare('SELECT COUNT(*) AS n FROM users WHERE bot = 1 AND bot_server_id = ? AND deleted_at IS NULL').get(serverId) as { n: number }).n;
  const webhookUrl = (host: string, secure: boolean, id: number, token: string) =>
    `${(opts.publicUrl || `${secure ? 'https' : 'http'}://${host}`).replace(/\/$/, '')}/api/webhooks/${id}/${token}`;

  route('GET', '/api/servers/:id/bots', ({ user, params }) => {
    const serverId = Number(params[0]);
    allowed(serverId, user, 'burrow');
    return botsOf(serverId);
  });
  route('POST', '/api/servers/:id/bots', ({ user, params, body }) => {
    const serverId = Number(params[0]);
    allowed(serverId, user, 'burrow');
    if (botCount(serverId) >= MAX_BOTS) throw new HttpError(400, `A hearth can have up to ${MAX_BOTS} bots and webhooks`);
    const id = makeBot(serverId, botName(body.name));
    audit(serverId, user.id, 'bot_add', id);
    sendServerUpdate(serverId);
    return { ...botsOf(serverId), token: newBotToken(id), botId: id };
  });
  const ownBot = (serverId: number, botId: number) => {
    const bot = db.prepare('SELECT id FROM users WHERE id = ? AND bot = 1 AND bot_server_id = ? AND deleted_at IS NULL').get(botId, serverId);
    if (!bot) throw new HttpError(404, 'No such bot');
  };
  route('POST', '/api/servers/:id/bots/:id/token', ({ user, params }) => {
    const [serverId, botId] = params.map(Number);
    allowed(serverId, user, 'burrow');
    ownBot(serverId, botId);
    for (const ws of sockets.get(botId) ?? []) ws.close(4001, 'Signed out');
    return { token: newBotToken(botId) };
  });
  route('DELETE', '/api/servers/:id/bots/:id', ({ user, params }) => {
    const [serverId, botId] = params.map(Number);
    allowed(serverId, user, 'burrow');
    ownBot(serverId, botId);
    removeBot(serverId, botId);
    audit(serverId, user.id, 'bot_remove', botId);
    return botsOf(serverId);
  });

  route('POST', '/api/channels/:id/webhooks', ({ user, params, body, host, secure }) => {
    const channel = channelById(Number(params[0]));
    if (!channel || channel.kind !== 'text' || !canSee(channel, user.id)) throw new HttpError(404, "That room is gone, or you can't see it.");
    allowed(channel.serverId, user, 'burrow');
    if (botCount(channel.serverId) >= MAX_BOTS) throw new HttpError(400, `A hearth can have up to ${MAX_BOTS} bots and webhooks`);
    const botId = makeBot(channel.serverId, botName(body.name));
    const token = randomBytes(24).toString('base64url');
    const r = db
      .prepare('INSERT INTO webhooks (server_id, channel_id, user_id, token_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(channel.serverId, channel.id, botId, createHash('sha256').update(token).digest('hex'), user.id, now());
    audit(channel.serverId, user.id, 'webhook_add', botId, `#${channel.name}`);
    sendServerUpdate(channel.serverId);
    return { ...botsOf(channel.serverId), url: webhookUrl(host, secure, Number(r.lastInsertRowid), token) };
  });
  route('DELETE', '/api/webhooks/:id', ({ user, params }) => {
    const hook = db.prepare('SELECT server_id AS serverId, user_id AS userId FROM webhooks WHERE id = ?').get(Number(params[0])) as
      | { serverId: number; userId: number }
      | undefined;
    if (!hook) throw new HttpError(404, 'No such webhook');
    allowed(hook.serverId, user, 'burrow');
    removeBot(hook.serverId, hook.userId);
    audit(hook.serverId, user.id, 'webhook_remove', hook.userId);
    return botsOf(hook.serverId);
  });

  // Posting to a webhook: { "content": "…" } (Discord style) or { "text": "…" } (Slack style).
  const hookTries = new Map<number, { count: number; until: number }>();
  route('POST', '/api/webhooks/:id/:code', ({ params, body }) => {
    const id = Number(params[0]);
    const hook = db.prepare('SELECT channel_id AS channelId, user_id AS userId, token_hash AS hash FROM webhooks WHERE id = ?').get(id) as
      | { channelId: number; userId: number; hash: string }
      | undefined;
    if (!hook || !sameText(createHash('sha256').update(params[1]).digest('hex'), hook.hash)) throw new HttpError(404, 'No such webhook');
    const t = now();
    const tries = hookTries.get(id);
    if (tries && tries.until > t && tries.count >= 30) throw new HttpError(429, 'Slow down: at most 30 messages a minute');
    if (!tries || tries.until <= t) hookTries.set(id, { count: 1, until: t + 60_000 });
    else tries.count++;
    const text = typeof body.content === 'string' ? body.content : typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) throw new HttpError(400, 'Send { "content": "your message" }');
    const room = channelById(hook.channelId);
    if (!room || !isMember(room.serverId, hook.userId)) throw new HttpError(404, 'No such webhook');
    if (room.archivedAt !== null) throw new HttpError(403, "This room is archived, so nothing new can go in it");
    const message = postMessage(userById(hook.userId)!, hook.channelId, { content: text.slice(0, MAX_MESSAGE_LENGTH) }, { webhook: true });
    return { id: message.id };
  }, false);

  return {
    removeBot,
  };
}
