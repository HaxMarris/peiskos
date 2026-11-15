// A hearth's best messages (the most reacted) and the pictures shared in it.
import type { Handler, User } from './app.ts';
import type { Db } from './db.ts';
import { HttpError, type Json } from './http.ts';

export interface HighlightsContext {
  attachmentJson: (a: Json) => Json;
  db: Db;
  isBurrow: (serverId: number) => boolean;
  messagesByIds: (ids: number[]) => Json[];
  placeOf: (channelId: number, viewerId: number) => unknown;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => number;
  searchRooms: (user: User, scope: string | null) => number[];
  serverMemberIds: (serverId: number) => number[];
}

export function highlights(ctx: HighlightsContext) {
  const {
    attachmentJson, db, isBurrow, messagesByIds, placeOf, route, searchRooms, serverMemberIds,
  } = ctx;

  // ---- a hearth's best messages and its pictures ----

  /** How many people (not counting the author) have to 🔥 a message for it to make Best of. */
  const bestOfNeeds = (serverId: number) => (serverMemberIds(serverId).length <= 5 ? 2 : 3);
  route('GET', '/api/servers/:id/best-of', ({ user, params, url }) => {
    const serverId = Number(params[0]);
    if (!isBurrow(serverId)) throw new HttpError(404, "That hearth is gone, or you're not in it.");
    const rooms = searchRooms(user, String(serverId));
    const needs = bestOfNeeds(serverId);
    if (!rooms.length) return { results: [], more: false, needs };
    const PAGE = 20;
    const offset = Math.max(0, Math.min(Number(url.searchParams.get('offset')) || 0, 2000));
    const ids = (db.prepare(
      `SELECT m.id FROM messages m JOIN reactions r ON r.message_id = m.id AND r.emoji = '🔥' AND r.user_id != m.author_id
       WHERE m.channel_id IN (${rooms.join(',')}) GROUP BY m.id HAVING COUNT(*) >= ? ORDER BY m.id DESC LIMIT ? OFFSET ?`,
    ).all(needs, PAGE + 1, offset) as { id: number }[]).map((r) => r.id);
    const results = messagesByIds(ids.slice(0, PAGE)).map((message) => ({ message, place: placeOf(message.channelId as number, user.id) }));
    return { results, more: ids.length > PAGE, needs };
  });

  // Every picture and video shared in a hearth's rooms you can see, newest first. Spoilers stay out.
  route('GET', '/api/servers/:id/album', ({ user, params, url }) => {
    const serverId = Number(params[0]);
    if (!isBurrow(serverId)) throw new HttpError(404, "That hearth is gone, or you're not in it.");
    const rooms = searchRooms(user, String(serverId));
    if (!rooms.length) return { items: [], more: false };
    const PAGE = 60;
    const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
    const rows = db.prepare(
      `SELECT a.*, m.id AS messageId, m.channel_id AS channelId, m.created_at AS createdAt, m.author_id AS authorId
       FROM attachments a JOIN messages m ON m.id = a.message_id
       WHERE m.channel_id IN (${rooms.join(',')}) AND (a.type LIKE 'image/%' OR a.type LIKE 'video/%') AND COALESCE(a.spoiler, 0) = 0 AND m.id < ?
       ORDER BY m.id DESC, a.rowid LIMIT ?`,
    ).all(before, PAGE + 1) as Json[];
    const items = rows.slice(0, PAGE).map((r) => ({
      ...attachmentJson(r), messageId: r.messageId, channelId: r.channelId, createdAt: r.createdAt, authorId: r.authorId,
    }));
    // A page ends between messages, so "more" picks up at the last message shown.
    const more = rows.length > PAGE;
    if (more) while (items.length > 1 && items[items.length - 1].messageId === rows[PAGE].messageId) items.pop();
    return { items, more };
  });

  return { bestOfNeeds };
}
