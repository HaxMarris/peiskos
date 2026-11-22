// Time capsules: a message, photos and voice notes sealed in a room until a day, then opened
// together at a fire. Until it's opened nobody gets what's inside, its author included: the hearth
// only learns who sealed it, when, how many files are in it, and the day it opens. Its files sit in
// attachments with no message (and are never served) until it's opened and posted in the room.
import type { Channel, Handler, Perm, PostExtras, User } from './app.ts';
import type { Db } from './db.ts';
import { HttpError, type Json } from './http.ts';
import { MAX_ATTACHMENTS, MAX_ALT_LENGTH, MAX_MESSAGE_LENGTH } from './limits.ts';
import { withoutBidi } from './text.ts';

/** The furthest ahead a capsule can open. */
export const CAPSULE_MAX_YEARS = 10;
/** Sealed and not yet opened, per person in a hearth. */
export const MAX_SEALED = 20;

export interface CapsulesContext {
  can: (serverId: number, userId: number, perm: Perm) => boolean;
  canSee: (channel: Channel, userId: number) => boolean;
  channelById: (id: number) => Channel | undefined;
  db: Db;
  inVoice: Map<number, number>;
  notTooFast: (userId: number) => void;
  now: () => number;
  postMessage: (user: User, channelId: number, input: Json, extras?: PostExtras) => Json;
  postProblem: (channel: Channel, userId: number) => string | null;
  removeFiles: (rows: Json[]) => void;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => unknown;
  sendServerUpdate: (serverId: number) => void;
  sendTo: (userIds: number[], event: Json) => void;
  serverKind: (serverId: number) => string | undefined;
  userById: (id: number) => User | undefined;
  usersInVoice: (channelId: number) => number[];
}

type CapsuleRow = {
  id: number; serverId: number; channelId: number; fireId: number | null; authorId: number; content: string;
  createdAt: number; opensAt: number; openedAt: number | null;
};

export function capsules(ctx: CapsulesContext) {
  const {
    can, canSee, channelById, db, inVoice, notTooFast, now, postMessage, postProblem, removeFiles, route, sendServerUpdate,
    sendTo, serverKind, userById, usersInVoice,
  } = ctx;

  const COLS = `id, server_id AS serverId, channel_id AS channelId, fire_id AS fireId, author_id AS authorId, content,
    created_at AS createdAt, opens_at AS opensAt, opened_at AS openedAt`;
  const capsuleById = (id: number) => db.prepare(`SELECT ${COLS} FROM capsules WHERE id = ?`).get(id) as CapsuleRow | undefined;
  const firesOf = (serverId: number) =>
    (db.prepare("SELECT id FROM channels WHERE server_id = ? AND kind = 'voice' ORDER BY COALESCE(position, id), id").all(serverId) as { id: number }[])
      .map((r) => channelById(r.id)!).filter(Boolean);
  /** The fire a capsule opens at, as this person sees it: the one it was sealed for, else the hearth's first. */
  const fireFor = (c: Pick<CapsuleRow, 'serverId' | 'fireId'>, userId: number) => {
    const fire = c.fireId === null ? undefined : channelById(c.fireId);
    if (fire && canSee(fire, userId)) return fire;
    return firesOf(c.serverId).find((f) => canSee(f, userId)) ?? null;
  };
  /** What's in it, counted: shown on the outside so people know what they're waiting for. */
  const contentsOf = (id: number) => {
    const rows = db.prepare('SELECT type, voice_seconds FROM attachments WHERE capsule_id = ?').all(id) as { type: string; voice_seconds: number | null }[];
    return {
      photos: rows.filter((a) => /^(image|video)\//.test(a.type)).length,
      voiceNotes: rows.filter((a) => a.voice_seconds != null).length,
      files: rows.filter((a) => !/^(image|video)\//.test(a.type) && a.voice_seconds == null).length,
    };
  };

  /** Sealed capsules in a hearth, in rooms this person can see, soonest first. Never what's inside. */
  const capsulesIn = (serverId: number, viewerId: number) =>
    (db.prepare(`SELECT ${COLS} FROM capsules WHERE server_id = ? AND opened_at IS NULL ORDER BY opens_at, id`).all(serverId) as CapsuleRow[])
      .filter((c) => {
        const room = channelById(c.channelId);
        return room && canSee(room, viewerId);
      })
      .map((c) => ({
        id: c.id, channelId: c.channelId, fireId: fireFor(c, viewerId)?.id ?? null, authorId: c.authorId,
        createdAt: c.createdAt, opensAt: c.opensAt, ...contentsOf(c.id),
      }));

  route('POST', '/api/channels/:id/capsules', ({ user, params, body }) => {
    const room = channelById(Number(params[0]));
    if (!room || !canSee(room, user.id)) throw new HttpError(404, "That room is gone, or you can't see it.");
    if (room.kind !== 'text' || serverKind(room.serverId) !== 'burrow') throw new HttpError(400, 'Time capsules are sealed in a hearth\'s rooms');
    const problem = postProblem(room, user.id);
    if (problem) throw new HttpError(403, problem);
    notTooFast(user.id);
    const sealed = (db.prepare('SELECT COUNT(*) AS n FROM capsules WHERE server_id = ? AND author_id = ? AND opened_at IS NULL').get(room.serverId, user.id) as { n: number }).n;
    if (sealed >= MAX_SEALED) throw new HttpError(400, `You have ${MAX_SEALED} sealed time capsules in this hearth, the most at once. Wait for one to open first.`);

    const content = typeof body.content === 'string' ? withoutBidi(body.content).trim() : '';
    if (content.length > MAX_MESSAGE_LENGTH) throw new HttpError(400, `A time capsule's message can be at most ${MAX_MESSAGE_LENGTH} characters`);
    const ids = Array.isArray(body.attachmentIds) ? [...new Set(body.attachmentIds.map(String))] : [];
    if (ids.length > MAX_ATTACHMENTS) throw new HttpError(400, `You can put up to ${MAX_ATTACHMENTS} files in a time capsule`);
    const usable = ids.filter((id) => !!db
      .prepare('SELECT 1 FROM attachments WHERE id = ? AND uploader_id = ? AND channel_id = ? AND message_id IS NULL AND capsule_id IS NULL')
      .get(id, user.id, room.id));
    if (usable.length !== ids.length) throw new HttpError(400, "One of the files didn't finish uploading. Remove it and add it again.");
    if (!content && !usable.length) throw new HttpError(400, 'Put something in it first: a message, photos or a voice note');

    const opensAt = Math.floor(Number(body.opensAt));
    if (!(opensAt > now() + 60_000)) throw new HttpError(400, 'Pick a day after today');
    if (!(opensAt < now() + CAPSULE_MAX_YEARS * 366 * 86400_000)) throw new HttpError(400, `Pick a day in the next ${CAPSULE_MAX_YEARS} years`);

    let fireId: number | null = null;
    if (body.fireId != null) {
      const fire = channelById(Number(body.fireId));
      if (!fire || fire.kind !== 'voice' || fire.serverId !== room.serverId || !canSee(fire, user.id)) throw new HttpError(400, "That fire isn't in this hearth");
      fireId = fire.id;
    } else fireId = firesOf(room.serverId).find((f) => canSee(f, user.id))?.id ?? null;

    const spoilers = new Set(Array.isArray(body.spoilerIds) ? body.spoilerIds.map(String) : []);
    const alts = body.descriptions && typeof body.descriptions === 'object' && !Array.isArray(body.descriptions) ? (body.descriptions as Record<string, unknown>) : {};
    const altFor = (id: string) => (typeof alts[id] === 'string' ? (alts[id] as string).trim().slice(0, MAX_ALT_LENGTH) || null : null);
    const r = db
      .prepare('INSERT INTO capsules (server_id, channel_id, fire_id, author_id, content, created_at, opens_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(room.serverId, room.id, fireId, user.id, content, now(), opensAt);
    const id = Number(r.lastInsertRowid);
    usable.forEach((a, position) =>
      db.prepare('UPDATE attachments SET capsule_id = ?, position = ?, spoiler = ?, alt = ? WHERE id = ?').run(id, position, spoilers.has(a) ? 1 : 0, altFor(a), a));
    sendServerUpdate(room.serverId);
    return { id, opensAt, fireId };
  });

  // Taking one back before it opens: whoever sealed it, or someone who manages messages here.
  route('DELETE', '/api/capsules/:id', ({ user, params }) => {
    const c = capsuleById(Number(params[0]));
    const room = c && channelById(c.channelId);
    if (!c || c.openedAt !== null || !room || !canSee(room, user.id)) throw new HttpError(404, 'That time capsule is gone. It may have been opened.');
    if (c.authorId !== user.id && !can(c.serverId, user.id, 'messages')) throw new HttpError(403, 'Only whoever sealed it can throw it away');
    removeFiles(db.prepare('SELECT id FROM attachments WHERE capsule_id = ?').all(c.id) as Json[]);
    db.prepare('DELETE FROM attachments WHERE capsule_id = ?').run(c.id);
    db.prepare('DELETE FROM capsules WHERE id = ?').run(c.id);
    sendServerUpdate(c.serverId);
    return { ok: true };
  });

  // Opening it: once its day has come, by someone sitting at its fire, for everyone there. A hearth
  // with no fire it can open at lets anyone in the room open it.
  route('POST', '/api/capsules/:id/open', ({ user, params }) => {
    const c = capsuleById(Number(params[0]));
    const room = c && channelById(c.channelId);
    if (!c || c.openedAt !== null || !room || !canSee(room, user.id)) throw new HttpError(404, 'That time capsule is gone. It may have been opened already.');
    if (c.opensAt > now()) throw new HttpError(403, `It's sealed until ${new Date(c.opensAt).toDateString()}`);
    const fire = fireFor(c, user.id);
    if (fire && inVoice.get(user.id) !== fire.id) throw new HttpError(403, `Join ${fire.name} to open it with everyone there`);
    const author = userById(c.authorId);
    if (!author) throw new HttpError(404, 'That time capsule is gone');
    // Marked opened first, so two people pressing at once open it once.
    if (!db.prepare('UPDATE capsules SET opened_at = ?, opened_by = ? WHERE id = ? AND opened_at IS NULL').run(now(), user.id, c.id).changes)
      throw new HttpError(404, 'That time capsule was just opened');
    const files = db.prepare('SELECT id, spoiler, alt FROM attachments WHERE capsule_id = ? ORDER BY position').all(c.id) as { id: string; spoiler: number; alt: string | null }[];
    let message: Json;
    try {
      message = postMessage(author, room.id, {
        content: c.content,
        attachmentIds: files.map((a) => a.id),
        spoilerIds: files.filter((a) => a.spoiler).map((a) => a.id),
        descriptions: Object.fromEntries(files.filter((a) => a.alt).map((a) => [a.id, a.alt])),
      }, { capsule: { id: c.id, sealedAt: c.createdAt, opensAt: c.opensAt, openedBy: user.id } });
    } catch (err) {
      db.prepare('UPDATE capsules SET opened_at = NULL, opened_by = NULL WHERE id = ?').run(c.id);
      throw err;
    }
    db.prepare('UPDATE capsules SET message_id = ? WHERE id = ?').run(message.id as number, c.id);
    // Everyone at the fire sees it open at once; the room gets the message like any other.
    const here = fire ? usersInVoice(fire.id).filter((id) => canSee(room, id)) : [user.id];
    sendTo(here, { type: 'capsule_opened', capsuleId: c.id, fireId: fire?.id ?? null, openedBy: user.id, message });
    sendServerUpdate(c.serverId);
    return { message };
  });

  return { capsulesIn };
}
