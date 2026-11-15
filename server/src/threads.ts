// Threads: side conversations off one message, each a small room of its own under the room it
// started in.
import type { Channel, Handler, Perm, User } from './app.ts';
import type { Db } from './db.ts';
import { HttpError, type Json } from './http.ts';

export interface ThreadsContext {
  can: (serverId: number, userId: number, perm: Perm) => boolean;
  canSee: (channel: Channel, userId: number) => boolean;
  channelById: (id: number) => Channel | undefined;
  db: Db;
  messageChanged: (id: number, channel: Channel) => Json | undefined;
  now: () => number;
  postProblem: (channel: Channel, userId: number) => string | null;
  readInfo: (channelId: number, serverId: number, userId: number) => { lastReadId: number; unread: number; mentions: number; };
  route: (method: string, path: string, handler: Handler, auth?: boolean) => number;
  sendServerUpdate: (serverId: number) => void;
  serverSummary: (serverId: number, viewerId: number) => Json;
  visibleMessage: (user: User, id: number) => { channel: Channel; authorId: number; };
}

export function threads(ctx: ThreadsContext) {
  const {
    can, canSee, channelById, db, messageChanged, now, postProblem, readInfo, route, sendServerUpdate,
    serverSummary, visibleMessage,
  } = ctx;

  // ---- threads: side conversations off one message ----

  const threadOf = (messageId: number) =>
    (db
      .prepare(
        `SELECT c.id, c.name, (SELECT COUNT(*) FROM messages WHERE channel_id = c.id) AS count,
                (SELECT MAX(created_at) FROM messages WHERE channel_id = c.id) AS lastAt
         FROM channels c WHERE c.parent_message_id = ? AND c.kind = 'thread'`,
      )
      .get(messageId) as Json | undefined) ?? null;

  /** A burrow's threads that someone can see, with how much of each they've read. */
  const threadsIn = (serverId: number, viewerId: number) => {
    const rows = db
      .prepare(
        `SELECT c.id, c.name, c.parent_id AS parentId, c.parent_message_id AS parentMessageId, c.created_by AS createdBy,
                c.created_at AS createdAt, (SELECT COUNT(*) FROM messages WHERE channel_id = c.id) AS count,
                COALESCE((SELECT MAX(created_at) FROM messages WHERE channel_id = c.id), c.created_at) AS lastAt
         FROM channels c WHERE c.server_id = ? AND c.kind = 'thread' ORDER BY lastAt DESC`,
      )
      .all(serverId) as Json[];
    const seen = new Map<number, boolean>();
    const parentVisible = (id: number) => {
      if (!seen.has(id)) {
        const parent = channelById(id);
        seen.set(id, !!parent && canSee(parent, viewerId));
      }
      return seen.get(id)!;
    };
    return rows.filter((t) => parentVisible(t.parentId as number)).map((t) => ({ ...t, ...readInfo(t.id as number, serverId, viewerId) }));
  };

  /** The thread's message in the room it hangs off shows its reply count, so that message updates. */
  const threadChanged = (thread: Channel) => {
    const row = db.prepare('SELECT parent_message_id FROM channels WHERE id = ?').get(thread.id) as { parent_message_id: number | null } | undefined;
    const parent = thread.parentId === null ? undefined : channelById(thread.parentId);
    if (row?.parent_message_id && parent) messageChanged(row.parent_message_id, parent);
  };
  /** After a thread is deleted, its message loses the reply count. */
  const threadDeleted = (thread: Channel, parentMessageId: number | null) => {
    const parent = thread.parentId === null ? undefined : channelById(thread.parentId);
    if (parent && parentMessageId) messageChanged(parentMessageId, parent);
  };

  /** Whoever started a thread can rename or delete it, and so can anyone who manages rooms. */
  const manageableThread = (thread: Channel, user: User) => {
    const row = db.prepare('SELECT created_by, parent_message_id FROM channels WHERE id = ?').get(thread.id) as { created_by: number | null; parent_message_id: number | null };
    if (row.created_by !== user.id && !can(thread.serverId, user.id, 'rooms')) throw new HttpError(403, 'Only whoever started this thread can change it');
    return row.parent_message_id;
  };
  const threadName = (value: unknown) => {
    const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    if (!name) throw new HttpError(400, 'Give the thread a name');
    return name.slice(0, 60);
  };
  const renameThread = (thread: Channel, user: User, name: unknown) => {
    manageableThread(thread, user);
    db.prepare('UPDATE channels SET name = ? WHERE id = ?').run(threadName(name), thread.id);
    sendServerUpdate(thread.serverId);
    threadChanged(thread);
    return serverSummary(thread.serverId, user.id);
  };

  // Starts a thread off a message (or opens the one it already has).
  route('POST', '/api/messages/:id/thread', ({ user, params, body }) => {
    const id = Number(params[0]);
    const { channel } = visibleMessage(user, id);
    if (channel.kind !== 'text') throw new HttpError(400, "Threads can't start inside a thread");
    let thread = db.prepare("SELECT id FROM channels WHERE parent_message_id = ? AND kind = 'thread'").get(id) as { id: number } | undefined;
    if (!thread) {
      // Starting a thread is writing in the room, so the same limits apply (timeouts, read-only, archived).
      const problem = postProblem(channel, user.id);
      if (problem) throw new HttpError(403, problem);
      const m = db.prepare('SELECT content FROM messages WHERE id = ?').get(id) as { content: string };
      const firstLine = m.content.split('\n').find((l) => l.trim()) ?? '';
      // The first line, without its formatting marks (headings, quotes, bold and so on) or custom emoji codes.
      const plain = firstLine.replace(/<:(\w+):\d+>/g, ':$1:').replace(/^\s*(#{1,3}|>|[-*]|\d+[.)])\s+/, '').replace(/[*_~`|]/g, '');
      const name = body.name ? threadName(body.name) : plain.replace(/\s+/g, ' ').trim().slice(0, 40) || 'Thread';
      const r = db
        .prepare("INSERT INTO channels (server_id, name, kind, private, created_at, parent_id, parent_message_id, created_by) VALUES (?, ?, 'thread', 0, ?, ?, ?, ?)")
        .run(channel.serverId, name, now(), channel.id, id, user.id);
      thread = { id: Number(r.lastInsertRowid) };
      messageChanged(id, channel);
      sendServerUpdate(channel.serverId);
    }
    return { threadId: thread.id, server: serverSummary(channel.serverId, user.id) };
  });

  return { manageableThread, renameThread, threadChanged, threadDeleted, threadOf, threadsIn };
}
