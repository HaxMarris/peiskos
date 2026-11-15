// Search: messages you can see, by words, person, room, date and what they carry.
import type { Channel, Handler, User } from './app.ts';
import type { Db } from './db.ts';
import { HttpError, type Json } from './http.ts';

export interface SearchContext {
  canSee: (channel: Channel, userId: number) => boolean;
  db: Db;
  messagesByIds: (ids: number[]) => Json[];
  placeOf: (channelId: number, viewerId: number) => { serverId: unknown; channelId: number; kind: string; serverName: unknown; channelName: unknown; threadName: unknown; } | null;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => number;
}

export function search(ctx: SearchContext) {
  const {
    canSee, db, messagesByIds, placeOf, route,
  } = ctx;

  // ---- search ----

  /** The rooms a search looks through: a burrow's (with its threads), your DMs, or everything you can see. */
  const searchRooms = (user: User, scope: string | null) => {
    const sql = `SELECT c.id, c.server_id AS serverId, c.name, c.kind, c.private, c.parent_id AS parentId FROM channels c
                 JOIN members m ON m.server_id = c.server_id AND m.user_id = ? JOIN servers s ON s.id = c.server_id
                 WHERE c.kind != 'voice' ${scope === 'dms' ? "AND s.kind = 'dm'" : scope ? 'AND s.id = ?' : ''}`;
    const args = scope && scope !== 'dms' ? [user.id, Number(scope)] : [user.id];
    return (db.prepare(sql).all(...args) as Channel[]).filter((c) => canSee(c, user.id)).map((c) => c.id);
  };

  // ?q= words (matching the start of words), and optionally in= a burrow id or "dms", room=, from= a user id,
  // has=image|video|audio|file|link, before= and after= (times in ms), and offset= for more.
  route('GET', '/api/search', ({ user, url }) => {
    const p = url.searchParams;
    const words = (p.get('q') ?? '').match(/[\p{L}\p{N}_]+/gu) ?? [];
    const conditions: string[] = [];
    const args: (string | number)[] = [];
    let rooms = searchRooms(user, p.get('in'));
    if (p.get('room')) rooms = rooms.filter((id) => id === Number(p.get('room')));
    if (words.length) {
      conditions.push('m.id IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)');
      args.push(words.slice(0, 12).map((w) => `"${w}"*`).join(' '));
    }
    if (p.get('from')) {
      conditions.push('m.author_id = ?');
      args.push(Number(p.get('from')));
    }
    const has = p.get('has');
    const attachment = (type: string) => `EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id ${type})`;
    if (has === 'image') conditions.push(`(${attachment("AND a.type LIKE 'image/%'")} OR m.sticker_id IS NOT NULL)`);
    else if (has === 'video') conditions.push(attachment("AND a.type LIKE 'video/%'"));
    else if (has === 'audio') conditions.push(attachment("AND a.type LIKE 'audio/%'"));
    else if (has === 'file') conditions.push(attachment(''));
    else if (has === 'link') conditions.push("(m.content LIKE '%http://%' OR m.content LIKE '%https://%')");
    else if (has === 'poll') conditions.push('EXISTS (SELECT 1 FROM polls WHERE message_id = m.id)');
    if (!conditions.length) throw new HttpError(400, 'Type something to search for');
    if (Number(p.get('before'))) {
      conditions.push('m.created_at < ?');
      args.push(Number(p.get('before')));
    }
    if (Number(p.get('after'))) {
      conditions.push('m.created_at >= ?');
      args.push(Number(p.get('after')));
    }
    if (!rooms.length) return { results: [], more: false };
    const PAGE = 25;
    const offset = Math.max(0, Math.min(Number(p.get('offset')) || 0, 1000));
    const ids = (
      db
        .prepare(`SELECT m.id FROM messages m WHERE m.channel_id IN (${rooms.join(',')}) AND ${conditions.join(' AND ')} ORDER BY m.id DESC LIMIT ? OFFSET ?`)
        .all(...args, PAGE + 1, offset) as { id: number }[]
    ).map((r) => r.id);
    const results = messagesByIds(ids.slice(0, PAGE)).map((message) => ({ message, place: placeOf(message.channelId as number, user.id) }));
    return { results, more: ids.length > PAGE };
  });

  return { searchRooms };
}
