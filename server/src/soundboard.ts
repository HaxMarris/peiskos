// The soundboard: each hearth's short clips, played for everyone at its fires.
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { SQLOutputValue } from 'node:sqlite';
import type { AppOptions, Channel, Handler, Standing, User } from './app.ts';
import type { Db } from './db.ts';
import { HttpError, type Json, readLimited, send } from './http.ts';
import { MAX_SOUNDS } from './limits.ts';
import { MAX_SOUND_BYTES, SOUND_TYPES } from './media.ts';

export interface SoundboardContext {
  allowed: (serverId: number, user: User, perm: 'voice' | 'rooms' | 'messages' | 'remove' | 'ban' | 'roles' | 'burrow' | 'emoji' | 'everyone' | 'pin' | 'invites' | 'timeout' | 'audit') => Standing;
  channelById: (id: number) => Channel | undefined;
  db: Db;
  inVoice: Map<number, number>;
  isMember: (serverId: number, userId: number) => boolean;
  lastActive: Map<number, number>;
  now: () => number;
  opts: AppOptions;
  picturePath: (folder: string, file: string) => string;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => number;
  sendServerUpdate: (serverId: number) => void;
  sendTo: (userIds: Iterable<number>, event: Json) => void;
  serverMuted: (serverId: number, userId: number) => boolean;
  serverSummary: (serverId: number, viewerId: number) => { roles: { id: number; perms: ('voice' | 'rooms' | 'messages' | 'remove' | 'ban' | 'roles' | 'burrow' | 'emoji' | 'everyone' | 'pin' | 'invites' | 'timeout' | 'audit')[]; }[]; members: { status: string; custom: { text: string; emoji: string; until: number | null; } | null; activity: { name: string; since: number; } | null; deleted: boolean; bot: boolean; voiceMuted: boolean; timeoutUntil: number | null; roleIds: number[]; role: string; online: boolean; id: number; username: string; displayName: string | null; avatar: string | null; }[]; seen?: { userId: number; lastReadId: number; } | null | undefined; motd?: { id: number; text: string; picture: string | null; }[] | undefined; openReports?: number | undefined; wordFilter?: any; uploadMb?: number | null | undefined; myUploadLimit?: number | undefined; timeoutUntil?: number | null | undefined; rulesAccepted: boolean; pinnedFireId: number | null; notify: { level: string | null; mutedUntil: number | null; } | null; channels: ({ readOnlyRoleIds?: number[] | undefined; postRoleIds?: number[] | undefined; memberIds?: number[] | undefined; roleIds?: number[] | undefined; audienceIds?: number[] | undefined; voiceUsers: number[]; voiceMuted: number[]; voiceDeafened: number[]; voiceServerMuted: number[]; voiceSpeaking: number[]; keepChat: boolean; private: boolean; announce: boolean; archived: boolean; canPost: boolean; notify: { level: string | null; mutedUntil: number | null; } | null; id: number; name: string; kind: 'text' | 'voice' | 'thread'; slow: number; userLimit: number; topic: string; groupId: number | null; } | { readOnlyRoleIds?: number[] | undefined; postRoleIds?: number[] | undefined; memberIds?: number[] | undefined; roleIds?: number[] | undefined; audienceIds?: number[] | undefined; lastReadId: number; unread: number; mentions: number; keepChat: boolean; private: boolean; announce: boolean; archived: boolean; canPost: boolean; notify: { level: string | null; mutedUntil: number | null; } | null; id: number; name: string; kind: 'text' | 'voice' | 'thread'; slow: number; userLimit: number; topic: string; groupId: number | null; })[]; groups: Record<string, SQLOutputValue>[]; events: { rsvps: Record<string, SQLOutputValue>[]; }[]; threads: { lastReadId: number; unread: number; mentions: number; }[]; emoji: Record<string, SQLOutputValue>[]; sounds: Record<string, SQLOutputValue>[]; serverMuted: boolean; };
  uploader: (req: IncomingMessage) => User;
  usersInVoice: (channelId: number) => number[];
}

export function soundboard(ctx: SoundboardContext) {
  const {
    allowed, channelById, db, inVoice, isMember, lastActive, now, opts, picturePath, route, sendServerUpdate,
    sendTo, serverMuted, serverSummary, uploader, usersInVoice,
  } = ctx;

  // ---- the soundboard: each burrow's short clips, played for everyone at its fires

  const soundsOf = (serverId: number) =>
    db.prepare("SELECT id, name, emoji, '/api/sounds/' || file AS url FROM sounds WHERE server_id = ? ORDER BY name").all(serverId);
  const soundPath = (file: string) => picturePath('sounds', file);
  const soundName = (value: unknown) => {
    const name = typeof value === 'string' ? value.trim() : '';
    if (!name || name.length > 32) throw new HttpError(400, 'Sound names are 1 to 32 characters');
    return name;
  };
  // An emoji shown on the sound's button: one emoji, or one of the burrow's own.
  const soundEmoji = (value: unknown) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text.length > 64) throw new HttpError(400, 'Pick one emoji');
    return text;
  };

  const handleSoundUpload = async (req: IncomingMessage, res: ServerResponse, serverId: number, url: URL) => {
    const user = uploader(req);
    allowed(serverId, user, 'emoji');
    const name = soundName(url.searchParams.get('name'));
    const emoji = soundEmoji(url.searchParams.get('emoji'));
    const check = () => {
      const count = (db.prepare('SELECT COUNT(*) AS n FROM sounds WHERE server_id = ?').get(serverId) as { n: number }).n;
      if (count >= MAX_SOUNDS) throw new HttpError(400, `A hearth can have up to ${MAX_SOUNDS} sounds`);
    };
    check();
    const data = await readLimited(req, MAX_SOUND_BYTES, new HttpError(413, `Sounds can be at most ${MAX_SOUND_BYTES / 1024} KB`));
    const kind = SOUND_TYPES.find((t) => t.magic(data));
    if (!kind) throw new HttpError(400, 'Sounds must be MP3, OGG, WAV, WebM or M4A audio');
    allowed(serverId, user, 'emoji');
    check();
    const file = `${randomBytes(16).toString('base64url')}.${kind.ext}`;
    await mkdir(join(opts.uploadDir!, 'sounds'), { recursive: true });
    await writeFile(soundPath(file), data);
    db.prepare('INSERT INTO sounds (server_id, name, emoji, file, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(serverId, name, emoji, file, user.id, now());
    sendServerUpdate(serverId);
    send(res, 200, serverSummary(serverId, user.id));
  };

  const serveSound = async (req: IncomingMessage, res: ServerResponse, file: string) => {
    const kind = SOUND_TYPES.find((t) => file.endsWith('.' + t.ext))!;
    const info = opts.uploadDir ? await stat(soundPath(file)).catch(() => null) : null;
    if (!info) throw new HttpError(404, 'That sound is gone');
    res.writeHead(200, {
      'content-type': kind.type,
      'content-length': info.size,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'public, max-age=31536000, immutable',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(soundPath(file)).pipe(res);
  };

  const managedSound = (id: number, user: User) => {
    const row = db.prepare('SELECT id, server_id, file FROM sounds WHERE id = ?').get(id) as { id: number; server_id: number; file: string } | undefined;
    if (!row || !isMember(row.server_id, user.id)) throw new HttpError(404, 'That sound is gone');
    allowed(row.server_id, user, 'emoji');
    return row;
  };
  route('PATCH', '/api/sounds/:id', ({ user, params, body }) => {
    const row = managedSound(Number(params[0]), user);
    if (body.name !== undefined) db.prepare('UPDATE sounds SET name = ? WHERE id = ?').run(soundName(body.name), row.id);
    if (body.emoji !== undefined) db.prepare('UPDATE sounds SET emoji = ? WHERE id = ?').run(soundEmoji(body.emoji), row.id);
    sendServerUpdate(row.server_id);
    return serverSummary(row.server_id, user.id);
  });
  route('DELETE', '/api/sounds/:id', async ({ user, params }) => {
    const row = managedSound(Number(params[0]), user);
    db.prepare('DELETE FROM sounds WHERE id = ?').run(row.id);
    // Gone before the answer, so nobody can still play it a moment later.
    if (opts.uploadDir) await unlink(soundPath(row.file)).catch(() => {});
    sendServerUpdate(row.server_id);
    return serverSummary(row.server_id, user.id);
  });

  const lastSound = new Map<number, number>(); // userId -> when they last played one
  /** Plays a clip for everyone at your fire. Each app fetches and plays it itself. */
  const playSound = (user: User, soundId: number) => {
    const channel = channelById(inVoice.get(user.id) ?? -1);
    if (!channel) throw new HttpError(400, 'Join a fire to play sounds');
    const sound = db.prepare("SELECT id, '/api/sounds/' || file AS url FROM sounds WHERE id = ? AND server_id = ?").get(soundId, channel.serverId) as Json | undefined;
    if (!sound) throw new HttpError(404, 'That sound is gone');
    if (serverMuted(channel.serverId, user.id)) throw new HttpError(403, "You've been muted here");
    const t = Date.now();
    if (t - (lastSound.get(user.id) ?? 0) < 2000) throw new HttpError(429, 'One sound at a time');
    lastSound.set(user.id, t);
    lastActive.set(user.id, t);
    sendTo(usersInVoice(channel.id), { type: 'soundboard', channelId: channel.id, userId: user.id, soundId, url: sound.url });
  };

  return { handleSoundUpload, playSound, serveSound, soundsOf };
}
