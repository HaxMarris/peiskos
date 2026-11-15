// Planning together: polls, shared lists (who's bringing what), and "when works?", a poll of
// times that the one who asked turns into an event.
import type { Channel, Handler, PollInput, PostExtras, User } from './app.ts';
import type { Db } from './db.ts';
import { EVENT_REMIND_MS } from './events.ts';
import { HttpError, type Json } from './http.ts';
import { withoutBidi } from './text.ts';

export interface PlanningContext {
  can: (serverId: number, userId: number, perm: 'rooms' | 'messages' | 'remove' | 'ban' | 'roles' | 'burrow' | 'emoji' | 'voice' | 'everyone' | 'pin' | 'invites' | 'timeout' | 'audit') => boolean;
  channelById: (id: number) => Channel | undefined;
  cleanName: (value: unknown, field: string, max?: number) => string;
  db: Db;
  isBurrow: (serverId: number) => boolean;
  messageChanged: (id: number, channel: Channel) => Json | undefined;
  now: () => number;
  postMessage: (user: User, channelId: number, input: Json, extras?: PostExtras) => Json;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => number;
  sendServerUpdate: (serverId: number) => void;
  textRoom: (id: number, userId: number) => Channel;
  timeoutLeft: (serverId: number, userId: number) => string | null;
  visibleMessage: (user: User, id: number) => { channel: Channel; authorId: number; };
  voteAllowance: { take(key: number): boolean; };
  wakeAt: (t: number) => void;
}

export function planning(ctx: PlanningContext) {
  const {
    can, channelById, cleanName, db, isBurrow, messageChanged, now, postMessage, route,
    sendServerUpdate, textRoom, timeoutLeft, visibleMessage, voteAllowance, wakeAt,
  } = ctx;

  // ---- polls ----

  const MAX_POLL_OPTIONS = 10;
  const pollFor = (messageId: number) => {
    const p = db.prepare('SELECT question, options, multi, closes_at, times, event_id FROM polls WHERE message_id = ?').get(messageId) as Json | undefined;
    if (!p) return null;
    const votes = db.prepare('SELECT user_id, option FROM poll_votes WHERE message_id = ? ORDER BY rowid').all(messageId) as { user_id: number; option: number }[];
    const times = p.times ? (JSON.parse(p.times as string) as number[]) : null;
    const options = (JSON.parse(p.options as string) as string[]).map((text, i) => ({
      text, ...(times ? { at: times[i] } : {}), userIds: votes.filter((v) => v.option === i).map((v) => v.user_id),
    }));
    const closesAt = (p.closes_at as number | null) ?? null;
    // A "when works?" poll that became an event says which, while that event is still there.
    const eventId = p.event_id != null && db.prepare('SELECT 1 FROM events WHERE id = ?').get(p.event_id as number) ? p.event_id : null;
    return {
      question: p.question, options, multi: !!p.multi, closesAt, closed: closesAt !== null && closesAt <= now(),
      ...(times ? { kind: 'when', eventId } : {}),
    };
  };

  const makePoll = (body: Json): PollInput => {
    const question = cleanName(body.question, 'Question', 300);
    const options = (Array.isArray(body.options) ? body.options : []).map((o) => (typeof o === 'string' ? o.trim() : '')).filter(Boolean);
    if (options.length < 2) throw new HttpError(400, 'A poll needs at least two answers');
    if (options.length > MAX_POLL_OPTIONS) throw new HttpError(400, `A poll can have at most ${MAX_POLL_OPTIONS} answers`);
    if (options.some((o) => o.length > 80)) throw new HttpError(400, 'Answers can be at most 80 characters');
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw new HttpError(400, 'Each answer must be different');
    const hours = Number(body.hours) || 0;
    if (hours < 0 || hours > 24 * 30) throw new HttpError(400, 'A poll can run for up to 30 days');
    return { question, options, multi: body.multi === true, closesAt: hours ? now() + hours * 3600_000 : null };
  };

  route('POST', '/api/channels/:id/polls', ({ user, params, body }) =>
    postMessage(user, Number(params[0]), { content: '', replyTo: body.replyTo }, { poll: makePoll(body) }));

  // ---- shared lists: who's bringing what ----

  const MAX_LIST_ITEMS = 50;
  const listFor = (messageId: number) => {
    const l = db.prepare('SELECT title FROM lists WHERE message_id = ?').get(messageId) as { title: string } | undefined;
    if (!l) return null;
    const items = db.prepare('SELECT id, text, added_by AS addedBy, done_by AS doneBy, done_at AS doneAt FROM list_items WHERE message_id = ? ORDER BY id').all(messageId);
    return { title: l.title, items };
  };
  const listText = (value: unknown) => {
    const text = typeof value === 'string' ? withoutBidi(value).trim() : '';
    if (!text) throw new HttpError(400, 'Write what the item is');
    if (text.length > 120) throw new HttpError(400, 'Keep each item to 120 characters');
    return text;
  };
  route('POST', '/api/channels/:id/lists', ({ user, params, body }) => {
    const title = cleanName(body.title, 'The list name', 100);
    const items = (Array.isArray(body.items) ? body.items : []).filter((x) => typeof x === 'string' && x.trim()).map(listText);
    if (items.length > MAX_LIST_ITEMS) throw new HttpError(400, `A list can have up to ${MAX_LIST_ITEMS} items`);
    return postMessage(user, Number(params[0]), { content: '', replyTo: body.replyTo }, { list: { title, items } });
  });
  /** Timeouts stop votes and list changes too, not only messages. */
  const notTimedOut = (channel: Channel, userId: number) => {
    const left = timeoutLeft(channel.serverId, userId);
    if (left) throw new HttpError(403, `You're timed out for ${left}`);
  };
  /** A list someone can see and change: it's in a room they can see that isn't archived. */
  const listMessage = (user: User, id: number) => {
    const { channel, authorId } = visibleMessage(user, id);
    if (!listFor(id)) throw new HttpError(404, "That message isn't a list");
    if (channel.archivedAt !== null) throw new HttpError(403, 'This room is archived, so nothing new can go in it');
    notTimedOut(channel, user.id);
    if (!voteAllowance.take(user.id)) throw new HttpError(429, "You're changing things very fast. Wait a moment.");
    return { channel, authorId };
  };
  route('POST', '/api/messages/:id/list', ({ user, params, body }) => {
    const id = Number(params[0]);
    const { channel } = listMessage(user, id);
    if ((db.prepare('SELECT COUNT(*) AS n FROM list_items WHERE message_id = ?').get(id) as { n: number }).n >= MAX_LIST_ITEMS)
      throw new HttpError(400, `A list can have up to ${MAX_LIST_ITEMS} items. Remove some first.`);
    db.prepare('INSERT INTO list_items (message_id, text, added_by) VALUES (?, ?, ?)').run(id, listText(body.text), user.id);
    return messageChanged(id, channel);
  });
  // Ticking an item says you've got it; anyone can untick it again.
  route('POST', '/api/messages/:id/list/:item', ({ user, params, body }) => {
    const id = Number(params[0]);
    const { channel } = listMessage(user, id);
    const item = db.prepare('SELECT id FROM list_items WHERE id = ? AND message_id = ?').get(Number(params[1]), id);
    if (!item) throw new HttpError(404, "That item isn't on the list any more");
    if (body.done) db.prepare('UPDATE list_items SET done_by = ?, done_at = ? WHERE id = ?').run(user.id, now(), Number(params[1]));
    else db.prepare('UPDATE list_items SET done_by = NULL, done_at = NULL WHERE id = ?').run(Number(params[1]));
    return messageChanged(id, channel);
  });
  // Whoever added an item, started the list, or can manage messages can take it off.
  route('DELETE', '/api/messages/:id/list/:item', ({ user, params }) => {
    const id = Number(params[0]);
    const { channel, authorId } = listMessage(user, id);
    const item = db.prepare('SELECT added_by FROM list_items WHERE id = ? AND message_id = ?').get(Number(params[1]), id) as { added_by: number | null } | undefined;
    if (!item) throw new HttpError(404, "That item isn't on the list any more");
    if (item.added_by !== user.id && authorId !== user.id && !can(channel.serverId, user.id, 'messages'))
      throw new HttpError(403, 'Only whoever added it, or started the list, can take it off');
    db.prepare('DELETE FROM list_items WHERE id = ?').run(Number(params[1]));
    return messageChanged(id, channel);
  });

  // ---- "when works?": a poll of times that the one who asked turns into an event ----

  const MAX_PLAN_TIMES = 12;
  route('POST', '/api/channels/:id/plans', ({ user, params, body }) => {
    const channel = textRoom(Number(params[0]), user.id);
    if (!isBurrow(channel.serverId)) throw new HttpError(400, 'Planning works in hearths, where events live');
    const question = cleanName(body.title, 'What it is', 100);
    const times = [...new Set((Array.isArray(body.times) ? body.times : []).map((t: unknown) => Math.floor(Number(t))))].sort((a, b) => a - b);
    if (times.length < 2) throw new HttpError(400, 'Pick at least two times people can choose from');
    if (times.length > MAX_PLAN_TIMES) throw new HttpError(400, `Pick at most ${MAX_PLAN_TIMES} times`);
    if (times.some((t) => !(t > now() && t < now() + 366 * 86400_000))) throw new HttpError(400, 'Pick times in the next year, not ones that have passed');
    // Open until the first of the times, unless it says to close sooner.
    const hours = Number(body.hours ?? 0) || 0;
    if (hours < 0 || hours > 24 * 30) throw new HttpError(400, 'A plan can stay open for up to 30 days');
    const closesAt = hours ? Math.min(now() + hours * 3600_000, times[0]) : times[0];
    return postMessage(user, channel.id, { content: '', replyTo: body.replyTo }, {
      poll: { question, options: times.map(String), multi: true, closesAt, times },
    });
  });

  // Picks one of the times: it becomes an event, with everyone who said that time works down as going.
  route('POST', '/api/messages/:id/plan/event', ({ user, params, body }) => {
    const id = Number(params[0]);
    const { channel, authorId } = visibleMessage(user, id);
    const poll = pollFor(id);
    if (!poll || poll.kind !== 'when') throw new HttpError(404, "That message isn't a plan");
    if (authorId !== user.id && !can(channel.serverId, user.id, 'messages')) throw new HttpError(403, 'Only whoever started the plan can pick the time');
    if (poll.eventId) throw new HttpError(409, "It's an event already");
    const pick = poll.options[Number(body.option)];
    if (!pick?.at) throw new HttpError(400, "That isn't one of the times");
    if (pick.at <= now()) throw new HttpError(400, 'That time has passed. Start a new plan.');
    const room = channel.kind === 'thread' && channel.parentId !== null ? channel.parentId : channel.id;
    const r = db
      .prepare('INSERT INTO events (server_id, channel_id, title, details, starts_at, created_by, created_at, reminded) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(channel.serverId, room, poll.question as string, '', pick.at, user.id, now(), pick.at - EVENT_REMIND_MS <= now() ? 1 : 0);
    const eventId = Number(r.lastInsertRowid);
    for (const uid of new Set([user.id, ...pick.userIds]))
      db.prepare("INSERT OR IGNORE INTO event_rsvps (event_id, user_id, status) VALUES (?, ?, 'going')").run(eventId, uid);
    db.prepare('UPDATE polls SET event_id = ?, closes_at = MIN(COALESCE(closes_at, ?), ?), ended = 1 WHERE message_id = ?').run(eventId, now(), now(), id);
    wakeAt(pick.at - EVENT_REMIND_MS);
    sendServerUpdate(channel.serverId);
    return messageChanged(id, channel);
  });

  // Your answer (or answers) to a poll; an empty list takes your vote back.
  route('POST', '/api/messages/:id/vote', ({ user, params, body }) => {
    const id = Number(params[0]);
    const { channel } = visibleMessage(user, id);
    const poll = pollFor(id);
    if (!poll) throw new HttpError(404, "That message isn't a poll");
    if (poll.closed) throw new HttpError(400, 'This poll has closed');
    const picks = [...new Set((Array.isArray(body.options) ? body.options : []).map(Number))];
    if (picks.some((i) => !Number.isInteger(i) || i < 0 || i >= poll.options.length)) throw new HttpError(400, "That isn't one of the answers");
    if (!poll.multi && picks.length > 1) throw new HttpError(400, 'This poll takes one answer');
    notTimedOut(channel, user.id);
    if (!voteAllowance.take(user.id)) throw new HttpError(429, "You're voting very fast. Wait a moment.");
    db.prepare('DELETE FROM poll_votes WHERE message_id = ? AND user_id = ?').run(id, user.id);
    for (const i of picks) db.prepare('INSERT INTO poll_votes (message_id, user_id, option) VALUES (?, ?, ?)').run(id, user.id, i);
    return messageChanged(id, channel);
  });

  // Whoever asked (or anyone who can delete messages) can close a poll early.
  route('POST', '/api/messages/:id/poll/end', ({ user, params }) => {
    const id = Number(params[0]);
    const { channel, authorId } = visibleMessage(user, id);
    if (!pollFor(id)) throw new HttpError(404, "That message isn't a poll");
    if (authorId !== user.id && !can(channel.serverId, user.id, 'messages')) throw new HttpError(403, 'Only whoever asked can end this poll');
    db.prepare('UPDATE polls SET closes_at = MIN(COALESCE(closes_at, ?), ?), ended = 1 WHERE message_id = ?').run(now(), now(), id);
    return messageChanged(id, channel);
  });

  /** Tells everyone about polls that have just closed, so their results show as final. */
  const endPolls = () => {
    const due = db.prepare('SELECT p.message_id, m.channel_id FROM polls p JOIN messages m ON m.id = p.message_id WHERE p.ended = 0 AND p.closes_at <= ?').all(now()) as { message_id: number; channel_id: number }[];
    for (const p of due) {
      db.prepare('UPDATE polls SET ended = 1 WHERE message_id = ?').run(p.message_id);
      const channel = channelById(p.channel_id);
      if (channel) messageChanged(p.message_id, channel);
    }
  };

  return { endPolls, listFor, makePoll, pollFor };
}
