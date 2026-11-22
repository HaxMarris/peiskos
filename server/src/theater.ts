// The movie theater at the fire: a hearth keeps a few movies (MP4 files people upload), and one
// plays at a fire in step for everyone there. Peiskos doesn't convert videos, so a file is checked
// to be one browsers play (mp4.ts) and turned away otherwise. What's playing is only kept in memory,
// like listening together; the movies themselves stay on disk until nobody has watched them for a while.
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { AppOptions, Channel, Handler, User } from './app.ts';
import type { Db } from './db.ts';
import { HttpError, type Json, send } from './http.ts';
import { CONVERT, inspectMp4, Mp4Problem } from './mp4.ts';
import { withoutBidi } from './text.ts';

export const MAX_MOVIES = 10; // per hearth
const DAY = 24 * 3600_000;

type Showing = { movieId: string; playing: boolean; position: number; since: number; by: number; ended: boolean; startedAt: number };
type MovieRow = { id: string; server_id: number; uploader_id: number | null; name: string; size: number; duration: number; width: number; height: number; created_at: number; last_used_at: number };

export interface TheaterContext {
  db: Db;
  opts: AppOptions;
  now: () => number;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => number;
  channelById: (id: number) => Channel | undefined;
  inVoice: Map<number, number>;
  usersInVoice: (channelId: number) => number[];
  sendTo: (userIds: Iterable<number>, event: Json) => void;
  isMember: (serverId: number, userId: number) => boolean;
  /** Whether their roles let them share files in the hearth at all (movies have their own size limit). */
  canShareFiles: (serverId: number, userId: number) => boolean;
  /** Hosts and mods (they manage voice) can stop a movie or take one off the shelf. */
  isBoss: (serverId: number, userId: number) => boolean;
  uploader: (req: IncomingMessage) => User;
  /** Throws while the disk is too full to take this many more bytes. */
  roomOnDisk: (bytes: number) => Promise<void>;
  active: (userId: number, t: number) => void;
}

export function theater(ctx: TheaterContext) {
  const { db, opts, now, route, channelById, usersInVoice, sendTo, isMember } = ctx;
  const MAX_BYTES = opts.movies?.maxBytes ?? 4 * 1024 ** 3;
  const SHELF_BYTES = opts.movies?.storageBytes ?? 20 * 1024 ** 3;
  const KEEP_MS = (opts.movies?.keepDays ?? 14) * DAY;
  const showings = new Map<number, Showing>(); // fire (voice channel id) -> what's on

  const dir = () => join(opts.uploadDir!, 'movies');
  const moviePath = (id: string) => join(dir(), `${id}.mp4`);
  const movieById = (id: unknown) => (typeof id === 'string' ? (db.prepare('SELECT * FROM movies WHERE id = ?').get(id) as MovieRow | undefined) : undefined);
  const movieJson = (m: MovieRow) => ({
    id: m.id, name: m.name, size: m.size, duration: m.duration, width: m.width, height: m.height,
    by: m.uploader_id, createdAt: m.created_at, url: `/api/movies/${m.id}.mp4`,
  });
  const shelfBytes = () => (db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM movies').get() as { n: number }).n;
  const playingAnywhere = (movieId: string) => [...showings.values()].some((s) => s.movieId === movieId);

  // ---- what's playing at each fire

  /** Where the movie is now, in seconds, and the clock it was read at, so apps can line up. */
  const theaterEvent = (channelId: number) => {
    const s = showings.get(channelId);
    const m = s && movieById(s.movieId);
    const at = Date.now();
    return {
      type: 'theater_state',
      channelId,
      at,
      state: s && m
        ? { movie: movieJson(m), playing: s.playing, by: s.by, ended: s.ended, position: Math.min(m.duration, s.position + (s.playing ? (at - s.since) / 1000 : 0)) }
        : null,
    };
  };
  const tellFire = (channelId: number) => sendTo(usersInVoice(channelId), theaterEvent(channelId));

  /** What someone at a fire asks for: start a movie, play, pause, seek, ended or stop. */
  const handle = (user: { id: number }, msg: Json) => {
    const channelId = ctx.inVoice.get(user.id);
    if (channelId === undefined) throw new HttpError(400, 'Join a fire to watch a movie');
    const channel = channelById(channelId);
    if (!channel) return;
    const t = Date.now();
    const s = showings.get(channelId);
    const here = (s: Showing) => s.position + (s.playing ? (t - s.since) / 1000 : 0);
    if (msg.action === 'start') {
      const m = movieById(msg.movieId);
      if (!m || m.server_id !== channel.serverId) throw new HttpError(404, 'That movie is gone. It may have been taken off the shelf.');
      // Putting on another movie cuts off the one that's on, so it's for the same people who can stop it.
      if (s && !s.ended && s.by !== user.id && !ctx.isBoss(channel.serverId, user.id)) throw new HttpError(403, 'A movie is already on. Whoever put it on can stop it first.');
      showings.set(channelId, { movieId: m.id, playing: true, position: 0, since: t, by: user.id, ended: false, startedAt: t });
      db.prepare('UPDATE movies SET last_used_at = ? WHERE id = ?').run(now(), m.id);
    } else if (!s) {
      return;
    } else if (msg.action === 'pause' || msg.action === 'play') {
      const m = movieById(s.movieId);
      // Play at the end starts it over.
      const from = msg.action === 'play' && m && (s.ended || here(s) >= m.duration - 0.5) ? 0 : here(s);
      Object.assign(s, { position: from, since: t, playing: msg.action === 'play', ended: false });
    } else if (msg.action === 'seek') {
      const m = movieById(s.movieId);
      const position = Math.max(0, Math.min(Number(msg.position) || 0, m?.duration ?? 0));
      Object.assign(s, { position, since: t, ended: false });
    } else if (msg.action === 'ended') {
      // Every app says so when its player reaches the end; the first one stops it for everyone.
      if (msg.movieId !== s.movieId || !s.playing || t - s.startedAt < 5000) return;
      const m = movieById(s.movieId);
      Object.assign(s, { position: m?.duration ?? here(s), since: t, playing: false, ended: true });
    } else if (msg.action === 'stop') {
      if (s.by !== user.id && !ctx.isBoss(channel.serverId, user.id)) throw new HttpError(403, 'Only whoever put it on, or a host or mod, can stop it');
      showings.delete(channelId);
    } else return;
    ctx.active(user.id, t);
    tellFire(channelId);
  };

  /** A movie left the shelf: it stops wherever it was on. */
  const stopEverywhere = (movieId: string) => {
    for (const [channelId, s] of showings) if (s.movieId === movieId) {
      showings.delete(channelId);
      tellFire(channelId);
    }
  };
  const removeMovie = (m: MovieRow) => {
    db.prepare('DELETE FROM movies WHERE id = ?').run(m.id);
    unlink(moviePath(m.id)).catch(() => {});
    stopEverywhere(m.id);
  };

  // ---- the shelf

  route('GET', '/api/servers/:id/movies', ({ user, params }) => {
    const serverId = Number(params[0]);
    if (!isMember(serverId, user.id)) throw new HttpError(404, 'That hearth is gone');
    const movies = db.prepare('SELECT * FROM movies WHERE server_id = ? ORDER BY last_used_at DESC').all(serverId) as MovieRow[];
    return {
      movies: movies.map(movieJson),
      maxBytes: opts.uploadDir ? MAX_BYTES : 0,
      maxMovies: MAX_MOVIES,
      canAdd: !!opts.uploadDir && ctx.canShareFiles(serverId, user.id),
      canRemoveAny: ctx.isBoss(serverId, user.id),
      keepDays: Math.round(KEEP_MS / DAY),
    };
  });

  route('DELETE', '/api/movies/:code', ({ user, params }) => {
    const m = movieById(params[0]);
    if (!m || !isMember(m.server_id, user.id)) throw new HttpError(404, 'That movie is already gone');
    if (m.uploader_id !== user.id && !ctx.isBoss(m.server_id, user.id)) throw new HttpError(403, 'Only whoever added it, or a host or mod, can remove it');
    removeMovie(m);
    return { ok: true };
  });

  // A movie is sent in pieces, each its own request: a big file over a home connection takes longer
  // than one request may last, and a dropped connection picks up where it got to instead of
  // starting over. Each person has one movie on the way at a time.
  type Incoming = { id: string; userId: number; serverId: number; name: string; size: number; received: number; part: string; lastAt: number };
  const incoming = new Map<string, Incoming>(); // upload id -> the movie on its way
  const PIECE = 16 * 1024 * 1024; // the largest piece; the app sends this much at a time
  const IDLE_MS = 3600_000; // an upload nobody adds to for this long is dropped
  const dropIncoming = (u: Incoming) => {
    incoming.delete(u.id);
    unlink(u.part).catch(() => {});
  };
  const gbs = (bytes: number) => (bytes / 1024 ** 3).toFixed(1).replace(/\.0$/, '');
  const mayAdd = (serverId: number, user: { id: number }) => {
    if (!opts.uploadDir) throw new HttpError(503, "Sharing files isn't set up on this server. Tell whoever runs it.");
    if (!isMember(serverId, user.id)) throw new HttpError(404, 'That hearth is gone');
    if (!ctx.canShareFiles(serverId, user.id)) throw new HttpError(403, "Your roles can't share files in this hearth");
  };
  /** Bytes the shelf has promised: movies on it and movies on the way (except `but`). */
  const promised = () => shelfBytes() + [...incoming.values()].reduce((n, u) => n + u.size, 0);
  const roomOnShelf = (serverId: number, size: number) => {
    const count = (db.prepare('SELECT COUNT(*) AS n FROM movies WHERE server_id = ?').get(serverId) as { n: number }).n;
    if (count >= MAX_MOVIES) throw new HttpError(409, `This hearth has ${MAX_MOVIES} movies, the most it can keep. Remove one first.`);
    if (promised() + size > SHELF_BYTES) throw new HttpError(507, 'The movie shelf on this server is full. Remove a movie first, or ask whoever runs it for more room.');
  };

  route('POST', '/api/servers/:id/movies', async ({ user, params, body }) => {
    const serverId = Number(params[0]);
    mayAdd(serverId, user);
    const size = Math.floor(Number(body.size));
    if (!(size > 0)) throw new HttpError(400, 'That file is empty');
    if (size > MAX_BYTES) throw new HttpError(413, `Movies can be up to ${gbs(MAX_BYTES)} GB`);
    for (const u of incoming.values()) if (u.userId === user.id) dropIncoming(u);
    roomOnShelf(serverId, size);
    await ctx.roomOnDisk(size);
    let name = typeof body.name === 'string' ? body.name : '';
    name = withoutBidi(name).replace(/[\\/\x00-\x1f]/g, '_').replace(/\.(mp4|m4v|mov)$/i, '').trim().slice(0, 120) || 'Movie';
    await mkdir(dir(), { recursive: true });
    const id = randomBytes(16).toString('base64url');
    const u: Incoming = { id, userId: user.id, serverId, name, size, received: 0, part: join(dir(), `${id}.part`), lastAt: Date.now() };
    await writeFile(u.part, '');
    incoming.set(id, u);
    return { uploadId: id, received: 0, piece: PIECE };
  });

  // One piece: the raw request body, which must start where the last one ended (?at=).
  const handleMoviePiece = async (req: IncomingMessage, res: ServerResponse, uploadId: string, url: URL) => {
    const user = ctx.uploader(req);
    const u = incoming.get(uploadId);
    if (!u || u.userId !== user.id) throw new HttpError(404, 'That upload stopped. Start it again.');
    if (u.lastAt < 0) throw new HttpError(409, 'Another piece of this movie is on its way. Wait for it.');
    const at = Number(url.searchParams.get('at'));
    if (at !== u.received) return send(res, 409, { error: 'That piece is out of order.', received: u.received });
    const lastAt = u.lastAt;
    u.lastAt = -1; // one piece at a time
    let data: Buffer;
    try {
      // A connection that drops partway keeps the upload: the app sends this piece again.
      data = await readPiece(req, Math.min(PIECE, u.size - u.received));
    } finally {
      u.lastAt = Math.max(lastAt, Date.now());
    }
    try {
      if (!data.length) throw new HttpError(400, 'That piece is empty');
      // The first piece shows whether it's an MP4 at all, before the rest is sent.
      if (!u.received && data.toString('latin1', 4, 8) !== 'ftyp') throw new HttpError(415, `That isn't an MP4 file. ${CONVERT}`);
      await appendFile(u.part, data);
      u.received += data.length;
      if (u.received < u.size) return send(res, 200, { received: u.received });
      incoming.delete(u.id);
      let info;
      try {
        info = await inspectMp4(u.part);
      } catch (err) {
        if (err instanceof Mp4Problem) throw new HttpError(415, err.message);
        throw err;
      }
      // They may have lost the right (or left) while it uploaded, and others may have filled the shelf.
      mayAdd(u.serverId, user);
      roomOnShelf(u.serverId, u.size);
      await rename(u.part, moviePath(u.id));
      const t = now();
      db.prepare('INSERT INTO movies (id, server_id, uploader_id, name, size, duration, width, height, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(u.id, u.serverId, user.id, u.name, u.size, info.duration, info.width, info.height, t, t);
      send(res, 200, { received: u.received, movie: movieJson(movieById(u.id)!) });
    } catch (err) {
      dropIncoming(u);
      throw err;
    }
  };
  /** A piece's bytes, failing past `max` or when the connection closes before it's all there. */
  const readPiece = (req: IncomingMessage, max: number) => new Promise<Buffer>((resolve, reject) => {
    const tooBig = new HttpError(413, 'That piece is bigger than the movie said it would be.');
    if (Number(req.headers['content-length']) > max) return reject(tooBig);
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        req.pause();
        reject(tooBig);
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
    req.on('close', () => reject(new HttpError(400, 'The connection dropped. Send that piece again.')));
  });

  route('DELETE', '/api/movie-uploads/:code', ({ user, params }) => {
    const u = incoming.get(params[0]);
    if (u && u.userId === user.id) dropIncoming(u);
    return { ok: true };
  });
  setInterval(() => {
    for (const u of incoming.values()) if (u.lastAt > 0 && Date.now() - u.lastAt > IDLE_MS) dropIncoming(u);
  }, 5 * 60_000).unref();

  // Movie links are unguessable (128 random bits), so the player can load them without a login,
  // a piece at a time (so it starts at once, and skipping ahead doesn't download the rest).
  const serveMovie = async (req: IncomingMessage, res: ServerResponse, id: string) => {
    const m = movieById(id);
    if (!m || !opts.uploadDir || !(await stat(moviePath(id)).catch(() => null))) throw new HttpError(404, 'That movie is gone. It may have been taken off the shelf.');
    const headers: Record<string, string | number> = {
      'content-type': 'video/mp4',
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(m.name)}.mp4`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, max-age=31536000, immutable',
      'accept-ranges': 'bytes',
    };
    const range = String(req.headers.range ?? '').match(/^bytes=(\d*)-(\d*)$/);
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, m.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), m.size - 1) : m.size - 1;
      if (start >= m.size || start > end) {
        res.writeHead(416, { 'content-range': `bytes */${m.size}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${m.size}` });
      if (req.method === 'HEAD') return res.end();
      return void createReadStream(moviePath(id), { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'content-length': m.size });
    if (req.method === 'HEAD') return res.end();
    createReadStream(moviePath(id)).pipe(res);
  };

  // Movies nobody has put on for a while leave the shelf, so the disk doesn't fill with old ones.
  // Files left behind (a hearth deleted, an upload cut off) go too.
  const sweep = async () => {
    if (!opts.uploadDir) return;
    const stale = db.prepare('SELECT * FROM movies WHERE last_used_at < ?').all(now() - KEEP_MS) as MovieRow[];
    for (const m of stale) if (!playingAnywhere(m.id)) removeMovie(m);
    const kept = new Set((db.prepare('SELECT id FROM movies').all() as { id: string }[]).map((r) => r.id));
    const files = await readdir(dir()).catch(() => [] as string[]);
    for (const f of files) {
      const [id, ext] = f.split('.');
      if (ext === 'mp4' && !kept.has(id)) await unlink(join(dir(), f)).catch(() => {});
      if (ext === 'part' && !incoming.has(id)) {
        const info = await stat(join(dir(), f)).catch(() => null);
        if (info && Date.now() - info.mtimeMs > DAY) await unlink(join(dir(), f)).catch(() => {});
      }
    }
  };
  if (opts.uploadDir) setInterval(() => void sweep(), 3600_000).unref();

  return {
    handle,
    handleMoviePiece,
    serveMovie,
    sweep,
    /** Someone sat down at a fire: they see what's on. */
    joined: (channelId: number, userId: number) => {
      if (showings.has(channelId)) sendTo([userId], theaterEvent(channelId));
    },
    /** Someone left a fire; the last one out ends the movie. */
    left: (channelId: number) => {
      if (!usersInVoice(channelId).length) showings.delete(channelId);
    },
  };
}
