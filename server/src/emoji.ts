// Each hearth's own custom emoji and stickers.
import { unlink } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SQLOutputValue } from 'node:sqlite';
import type { AppOptions, Handler, Standing, User } from './app.ts';
import type { Db } from './db.ts';
import { HttpError, type Json, send } from './http.ts';

export interface EmojiContext {
  allowed: (serverId: number, user: User, perm: 'emoji' | 'voice' | 'rooms' | 'messages' | 'remove' | 'ban' | 'roles' | 'burrow' | 'everyone' | 'pin' | 'invites' | 'timeout' | 'audit') => Standing;
  db: Db;
  isMember: (serverId: number, userId: number) => boolean;
  now: () => number;
  opts: AppOptions;
  picturePath: (folder: string, file: string) => string;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => number;
  savePicture: (req: IncomingMessage, folder: string, what: string) => Promise<string>;
  sendServerUpdate: (serverId: number) => void;
  serverSummary: (serverId: number, viewerId: number) => unknown;
  uploader: (req: IncomingMessage) => User;
}

export function customEmoji(ctx: EmojiContext) {
  const {
    allowed, db, isMember, now, opts, picturePath, route, savePicture, sendServerUpdate, serverSummary,
    uploader,
  } = ctx;

  // ---- custom emoji and stickers, each burrow's own ----

  const MAX_EMOJI = { emoji: 50, sticker: 20 } as const;
  const emojiOf = (serverId: number) =>
    db.prepare("SELECT id, name, kind, '/api/emoji/' || file AS url FROM custom_emoji WHERE server_id = ? ORDER BY kind, name").all(serverId);
  const stickerJson = (id: number) =>
    (db.prepare("SELECT id, name, '/api/emoji/' || file AS url FROM custom_emoji WHERE id = ? AND kind = 'sticker'").get(id) as Json | undefined) ?? { id, deleted: true };
  /** A custom emoji written <:name:id>, from a burrow this person is in. */
  const isCustomEmoji = (text: string, userId: number) => {
    const m = /^<:(\w{2,32}):(\d+)>$/.exec(text);
    if (!m) return false;
    const row = db.prepare("SELECT server_id, name FROM custom_emoji WHERE id = ? AND kind = 'emoji'").get(Number(m[2])) as { server_id: number; name: string } | undefined;
    return !!row && row.name === m[1] && isMember(row.server_id, userId);
  };
  const emojiName = (value: unknown) => {
    const name = typeof value === 'string' ? value.trim().replace(/^:|:$/g, '') : '';
    if (!/^\w{2,32}$/.test(name)) throw new HttpError(400, 'Names use 2 to 32 letters, numbers or underscores');
    return name;
  };
  const removeEmojiFile = (file: string) => {
    if (opts.uploadDir) unlink(picturePath('emoji', file)).catch(() => {});
  };

  // The picture is the raw request body; ?name= and ?kind=emoji|sticker say what it is.
  const handleEmojiUpload = async (req: IncomingMessage, res: ServerResponse, serverId: number, url: URL) => {
    const user = uploader(req);
    allowed(serverId, user, 'emoji');
    const kind = url.searchParams.get('kind') === 'sticker' ? 'sticker' : 'emoji';
    const name = emojiName(url.searchParams.get('name'));
    const check = () => {
      const count = (db.prepare('SELECT COUNT(*) AS n FROM custom_emoji WHERE server_id = ? AND kind = ?').get(serverId, kind) as { n: number }).n;
      if (count >= MAX_EMOJI[kind]) throw new HttpError(400, `A hearth can have up to ${MAX_EMOJI[kind]} ${kind === 'sticker' ? 'stickers' : 'emoji'}`);
      if (db.prepare('SELECT 1 FROM custom_emoji WHERE server_id = ? AND kind = ? AND name = ?').get(serverId, kind, name))
        throw new HttpError(409, `There's already ${kind === 'sticker' ? 'a sticker' : 'an emoji'} called ${name}`);
    };
    check();
    const file = await savePicture(req, 'emoji', kind === 'sticker' ? 'Stickers' : 'Emoji');
    try {
      allowed(serverId, user, 'emoji');
      check();
    } catch (err) {
      removeEmojiFile(file);
      throw err;
    }
    db.prepare('INSERT INTO custom_emoji (server_id, name, kind, file, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(serverId, name, kind, file, user.id, now());
    sendServerUpdate(serverId);
    send(res, 200, serverSummary(serverId, user.id));
  };

  const managedEmoji = (id: number, user: User) => {
    const row = db.prepare('SELECT id, server_id, kind, file FROM custom_emoji WHERE id = ?').get(id) as { id: number; server_id: number; kind: string; file: string } | undefined;
    if (!row || !isMember(row.server_id, user.id)) throw new HttpError(404, 'That emoji is gone');
    allowed(row.server_id, user, 'emoji');
    return row;
  };
  route('PATCH', '/api/emoji/:id', ({ user, params, body }) => {
    const row = managedEmoji(Number(params[0]), user);
    const name = emojiName(body.name);
    if (db.prepare('SELECT 1 FROM custom_emoji WHERE server_id = ? AND kind = ? AND name = ? AND id != ?').get(row.server_id, row.kind, name, row.id))
      throw new HttpError(409, `That name is taken`);
    db.prepare('UPDATE custom_emoji SET name = ? WHERE id = ?').run(name, row.id);
    sendServerUpdate(row.server_id);
    return serverSummary(row.server_id, user.id);
  });
  route('DELETE', '/api/emoji/:id', ({ user, params }) => {
    const row = managedEmoji(Number(params[0]), user);
    db.prepare('DELETE FROM custom_emoji WHERE id = ?').run(row.id);
    removeEmojiFile(row.file);
    sendServerUpdate(row.server_id);
    return serverSummary(row.server_id, user.id);
  });

  return { emojiOf, handleEmojiUpload, isCustomEmoji, removeEmojiFile, stickerJson };
}
