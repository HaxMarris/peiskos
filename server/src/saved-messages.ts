// Your own lists of messages: saved messages and reminders to come back to, scheduled messages
// (written now, sent later), and forwarding a copy of a message to another room.
import { randomBytes } from 'node:crypto';
import { copyFile } from 'node:fs/promises';
import type { WebSocket } from 'ws';
import type { AppOptions, Channel, Handler, PostExtras, User } from './app.ts';
import type { Db } from './db.ts';
import { HttpError, type Json } from './http.ts';
import { MAX_MESSAGE_LENGTH } from './limits.ts';
import { looksBlank, withoutBidi } from './text.ts';

export interface SavedContext {
  DAILY_UPLOAD: number;
  canSee: (channel: Channel, userId: number) => boolean;
  channelById: (id: number) => Channel | undefined;
  db: Db;
  filePath: (id: string) => string;
  isMember: (serverId: number, userId: number) => boolean;
  messageById: (id: number) => Json | undefined;
  messagesByIds: (ids: number[]) => Json[];
  now: () => number;
  opts: AppOptions;
  overDay: () => HttpError;
  placeOf: (channelId: number, viewerId: number) => { serverId: unknown; channelId: number; kind: string; serverName: unknown; channelName: unknown; threadName: unknown; } | null;
  postMessage: (user: User, channelId: number, input: Json, extras?: PostExtras) => Json;
  removeFiles: (rows: Json[]) => void;
  roomOnDisk: (bytes: number) => Promise<void>;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => number;
  sendTo: (userIds: Iterable<number>, event: Json) => void;
  sockets: Map<number, Set<WebSocket>>;
  textRoom: (id: number, userId: number) => Channel;
  thumbPath: (id: string) => string;
  uploadLimitFor: (serverId: number, userId: number) => number;
  uploadedToday: (userId: number) => number;
  userById: (id: number) => User | undefined;
  visibleMessage: (user: User, id: number) => { channel: Channel; authorId: number; };
  wakeAt: (t: number) => void;
}

export function savedMessages(ctx: SavedContext) {
  const {
    DAILY_UPLOAD, canSee, channelById, db, filePath, isMember, messageById, messagesByIds, now, opts,
    overDay, placeOf, postMessage, removeFiles, roomOnDisk, route, sendTo, sockets, textRoom, thumbPath,
    uploadLimitFor, uploadedToday, userById, visibleMessage, wakeAt,
  } = ctx;

  // ---- saved messages and reminders: a private list of messages to come back to ----

  const MAX_SAVED = 500;
  const savedJson = (row: Json) => ({
    messageId: row.message_id,
    savedAt: row.saved_at,
    remindAt: row.remind_at,
    reminded: !!row.reminded,
  });

  route('POST', '/api/messages/:id/save', ({ user, params, body }) => {
    const id = Number(params[0]);
    visibleMessage(user, id);
    if (body.saved === false) {
      db.prepare('DELETE FROM saved_messages WHERE user_id = ? AND message_id = ?').run(user.id, id);
      sendTo([user.id], { type: 'saved', messageId: id, saved: null });
      return { saved: null };
    }
    let remindAt: number | null = null;
    if (body.remindAt != null) {
      remindAt = Math.floor(Number(body.remindAt));
      if (!(remindAt > now() && remindAt < now() + 366 * 86400_000)) throw new HttpError(400, 'Pick a time in the next year');
    }
    const count = (db.prepare('SELECT COUNT(*) AS n FROM saved_messages WHERE user_id = ?').get(user.id) as { n: number }).n;
    const already = db.prepare('SELECT 1 FROM saved_messages WHERE user_id = ? AND message_id = ?').get(user.id, id);
    if (!already && count >= MAX_SAVED) throw new HttpError(400, `You can save up to ${MAX_SAVED} messages`);
    db.prepare(
      `INSERT INTO saved_messages (user_id, message_id, saved_at, remind_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, message_id) DO UPDATE SET remind_at = excluded.remind_at, reminded = 0`,
    ).run(user.id, id, now(), remindAt);
    if (remindAt) wakeAt(remindAt);
    const row = db.prepare('SELECT * FROM saved_messages WHERE user_id = ? AND message_id = ?').get(user.id, id) as Json;
    const saved = savedJson(row);
    sendTo([user.id], { type: 'saved', messageId: id, saved });
    return { saved };
  });

  /** Your saved messages, newest first, with where each one is. Messages you can no longer see are left out. */
  route('GET', '/api/me/saved', ({ user }) => {
    const rows = db.prepare('SELECT * FROM saved_messages WHERE user_id = ? ORDER BY saved_at DESC').all(user.id) as Json[];
    const messages = new Map(messagesByIds(rows.map((r) => r.message_id as number)).map((m) => [m.id, m]));
    return rows.flatMap((r) => {
      const message = messages.get(r.message_id);
      const channel = message && channelById(message.channelId as number);
      if (!message || !channel || !canSee(channel, user.id)) return [];
      return [{ ...savedJson(r), message, place: placeOf(channel.id, user.id) }];
    });
  });

  /** Sends reminders that are due to whoever set them, if they're connected. The rest wait until they are. */
  const deliverReminders = (userId?: number, at = now()) => {
    const rows = db
      .prepare(`SELECT * FROM saved_messages WHERE remind_at <= ? AND reminded = 0 ${userId ? 'AND user_id = ?' : ''}`)
      .all(...(userId ? [at, userId] : [at])) as Json[];
    for (const r of rows) {
      const uid = r.user_id as number;
      if (!sockets.has(uid)) continue;
      db.prepare('UPDATE saved_messages SET reminded = 1 WHERE user_id = ? AND message_id = ?').run(uid, r.message_id as number);
      const message = messageById(r.message_id as number);
      const channel = message && channelById(message.channelId as number);
      if (!message || !channel || !canSee(channel, uid)) continue;
      const saved = savedJson({ ...r, reminded: 1 });
      sendTo([uid], { type: 'reminder', saved, message, place: placeOf(channel.id, uid) });
    }
  };

  // ---- scheduled messages: written now, sent later ----

  const MAX_SCHEDULED = 25;
  const scheduledOf = (userId: number) =>
    (db.prepare('SELECT id, channel_id AS channelId, content, reply_to AS replyTo, send_at AS sendAt FROM scheduled_messages WHERE user_id = ? ORDER BY send_at').all(userId) as Json[])
      .map((s) => ({ ...s, place: placeOf(s.channelId as number, userId) }));
  const scheduledChanged = (userId: number) => sendTo([userId], { type: 'scheduled', items: scheduledOf(userId) });

  route('POST', '/api/channels/:id/scheduled', ({ user, params, body }) => {
    const channel = textRoom(Number(params[0]), user.id);
    const content = typeof body.content === 'string' ? withoutBidi(body.content) : '';
    if (looksBlank(content)) throw new HttpError(400, 'Write something first');
    if (content.length > MAX_MESSAGE_LENGTH) throw new HttpError(400, `Messages can be at most ${MAX_MESSAGE_LENGTH} characters. Shorten it, or send it in two parts.`);
    const sendAt = Math.floor(Number(body.sendAt));
    if (!(sendAt > now() + 10_000 && sendAt < now() + 366 * 86400_000)) throw new HttpError(400, 'Pick a time in the next year');
    const count = (db.prepare('SELECT COUNT(*) AS n FROM scheduled_messages WHERE user_id = ?').get(user.id) as { n: number }).n;
    if (count >= MAX_SCHEDULED) throw new HttpError(400, `You can have up to ${MAX_SCHEDULED} messages waiting to send`);
    db.prepare('INSERT INTO scheduled_messages (user_id, channel_id, content, reply_to, send_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      user.id, channel.id, content, body.replyTo == null ? null : Number(body.replyTo), sendAt, now(),
    );
    wakeAt(sendAt);
    scheduledChanged(user.id);
    return scheduledOf(user.id);
  });

  route('GET', '/api/me/scheduled', ({ user }) => scheduledOf(user.id));

  route('DELETE', '/api/scheduled/:id', ({ user, params }) => {
    db.prepare('DELETE FROM scheduled_messages WHERE id = ? AND user_id = ?').run(Number(params[0]), user.id);
    scheduledChanged(user.id);
    return scheduledOf(user.id);
  });

  /** Sends scheduled messages whose time has come, as the person who wrote them. */
  const sendScheduled = () => {
    const due = db.prepare('SELECT * FROM scheduled_messages WHERE send_at <= ? ORDER BY send_at').all(now()) as Json[];
    for (const s of due) {
      db.prepare('DELETE FROM scheduled_messages WHERE id = ?').run(s.id as number);
      const uid = s.user_id as number;
      const user = userById(uid);
      if (!user) continue;
      // The message it answered may be gone by now; it's sent anyway, as a plain message.
      const replyStill = s.reply_to != null && db.prepare('SELECT 1 FROM messages WHERE id = ? AND channel_id = ?').get(s.reply_to as number, s.channel_id as number);
      try {
        postMessage(user, s.channel_id as number, { content: s.content, replyTo: replyStill ? s.reply_to : null }, { scheduled: true });
      } catch (err) {
        sendTo([uid], { type: 'scheduled_failed', content: s.content, error: err instanceof Error ? err.message : 'Error' });
      }
      scheduledChanged(uid);
    }
  };

  // ---- forwarding: a copy of a message in another room, saying where it came from ----

  route('POST', '/api/messages/:id/forward', async ({ user, params, body }) => {
    const id = Number(params[0]);
    const { channel: from } = visibleMessage(user, id);
    const to = textRoom(Number(body.channelId), user.id);
    const m = messageById(id)!;
    const place = placeOf(from.id, user.id)!;
    // Files are copied, so the forward keeps working if the original is deleted.
    const attachmentIds: string[] = [];
    const spoilerIds: string[] = [];
    const descriptions: Record<string, string> = {};
    if ((m.attachments as Json[]).length) {
      if (!opts.uploadDir) throw new HttpError(503, "Sharing files isn't set up on this server. Tell whoever runs it.");
      // The files land in the other room, so its upload limit applies, as if they were uploaded there.
      const limit = uploadLimitFor(to.serverId, user.id);
      if (!limit) throw new HttpError(403, "Your roles can't share files in that hearth");
      if ((m.attachments as Json[]).some((a) => (a.size as number) > limit))
        throw new HttpError(413, `You can share files up to ${Math.round(limit / 1048576)} MB there`);
      // Copies take room on disk like uploads, so they count toward the day's files and the free space.
      const total = (m.attachments as Json[]).reduce((n, a) => n + (a.size as number), 0);
      if (uploadedToday(user.id) + total > DAILY_UPLOAD) throw overDay();
      await roomOnDisk(total);
      for (const a of m.attachments as Json[]) {
        const copy = randomBytes(16).toString('base64url');
        await copyFile(filePath(a.id as string), filePath(copy)).catch(() => {
          throw new HttpError(410, 'One of its files is gone');
        });
        const thumb = a.thumb ? await copyFile(thumbPath(a.id as string), thumbPath(copy)).then(() => 1, () => 0) : 0;
        db.prepare(
          'INSERT INTO attachments (id, channel_id, uploader_id, name, type, size, created_at, voice_seconds, width, height, thumb) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(copy, to.id, user.id, a.name as string, a.type as string, a.size as number, now(), (a.voiceSeconds as number) ?? null, (a.width as number) ?? null, (a.height as number) ?? null, thumb);
        attachmentIds.push(copy);
        if (a.spoiler) spoilerIds.push(copy);
        if (a.alt) descriptions[copy] = a.alt as string;
      }
    }
    let content = m.content as string;
    const poll = m.poll as { question: string; options: { text: string }[] } | null;
    if (poll) content = `📊 ${poll.question}\n${poll.options.map((o) => `• ${o.text}`).join('\n')}`;
    const sticker = m.sticker as { id: number; name: string } | null;
    const stickerServer = sticker?.id && (db.prepare('SELECT server_id FROM custom_emoji WHERE id = ?').get(sticker.id) as { server_id: number } | undefined)?.server_id;
    const keepSticker = !!stickerServer && isMember(stickerServer, user.id);
    if (sticker && !keepSticker) content = `${content}${content ? '\n' : ''}[sticker: ${sticker.name ?? 'removed'}]`;
    const forwarded = {
      messageId: id,
      authorId: m.authorId,
      author: m.author,
      createdAt: m.createdAt,
      from: place.kind === 'dm' ? 'a direct message' : place.threadName ? `${place.serverName} › #${place.channelName} › ${place.threadName}` : `${place.serverName} › #${place.channelName}`,
    };
    try {
      return postMessage(user, to.id, { content: content.slice(0, MAX_MESSAGE_LENGTH), attachmentIds, spoilerIds, descriptions, stickerId: keepSticker ? sticker!.id : null }, { forwarded });
    } catch (err) {
      // Not sent (slow mode, a read-only room…): the copies go now rather than waiting a day for the sweep.
      removeFiles(attachmentIds.map((id) => ({ id })));
      for (const id of attachmentIds) db.prepare('DELETE FROM attachments WHERE id = ? AND message_id IS NULL').run(id);
      throw err;
    }
  });

  return { deliverReminders, sendScheduled };
}
