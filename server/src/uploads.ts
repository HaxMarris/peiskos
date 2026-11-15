// Files people put in: uploads in messages (with their thumbnails), profile and hearth pictures,
// and GIFs found through KLIPY and kept on this server.
import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, statfs, unlink, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { AppOptions, Channel, Handler, Standing, User } from './app.ts';
import type { Db } from './db.ts';
import { download, gifSearch } from './gifs.ts';
import { bearer, HttpError, type Json, readLimited, send } from './http.ts';
import { MAX_ATTACHMENTS } from './limits.ts';
import { AVATAR_TYPES, INLINE_TYPES, MAX_AVATAR_BYTES } from './media.ts';
import { withoutBidi } from './text.ts';

export interface UploadsContext {
  allowed: (serverId: number, user: User, perm: 'voice' | 'rooms' | 'messages' | 'remove' | 'ban' | 'roles' | 'burrow' | 'emoji' | 'everyone' | 'pin' | 'invites' | 'timeout' | 'audit') => Standing;
  attachmentJson: (a: Json) => unknown;
  checkTries: (keys: string[], limit: number) => void;
  db: Db;
  failedTry: (keys: string[], windowMs?: number) => void;
  fun: { motdOf: (serverId: number) => { id: number; text: string; picture: string | null; }[]; addMotd: (serverId: number, user: User, text: unknown, picture?: string | null) => { motd: { id: number; text: string; picture: string | null; }[]; }; canAddMotd: (serverId: number, user: User) => void; };
  maxUpload: number;
  now: () => number;
  opts: AppOptions;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => number;
  sendServerUpdate: (serverId: number) => void;
  serverSummary: (serverId: number, viewerId: number) => unknown;
  textRoom: (id: number, userId: number) => Channel;
  uploadLimitFor: (serverId: number, userId: number) => number;
  userByToken: (raw: string | undefined) => User | undefined;
  userChanged: (userId: number) => unknown;
  visibleRoom: (id: number, userId: number) => Channel;
}

export function uploads(ctx: UploadsContext) {
  const {
    allowed, attachmentJson, checkTries, db, failedTry, fun, maxUpload, now, opts, route, sendServerUpdate,
    serverSummary, textRoom, uploadLimitFor, userByToken, userChanged, visibleRoom,
  } = ctx;

  // ---- uploads ------------------------------------------------------------

  // Files uploaded but not sent yet wait a day before they're cleared out; this many at most per person, so nobody can fill the disk.
  const MAX_UNSENT = 3 * MAX_ATTACHMENTS;
  // Uploads still coming in count as waiting too, so many started at once can't get past the limit.
  const uploading = new Map<number, number>();
  const checkUnsent = (userId: number) => {
    const n = (db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE uploader_id = ? AND message_id IS NULL').get(userId) as { n: number }).n;
    if (n + (uploading.get(userId) ?? 0) >= MAX_UNSENT) throw new HttpError(429, 'You have a lot of files waiting to be sent. Send or remove some first.');
  };
  // Sent files have no limit of their own, so a day's uploads are capped, and nothing is taken in
  // while the disk is nearly full: a full disk would stop the database, and Peiskos with it.
  const DAILY_UPLOAD = opts.dailyUploadBytes ?? 2 * 1024 ** 3;
  const MIN_FREE_DISK = opts.minFreeDiskBytes ?? 2 * 1024 ** 3;
  const uploadedToday = (userId: number) =>
    (db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM attachments WHERE uploader_id = ? AND created_at > ?').get(userId, now() - 24 * 60 * 60 * 1000) as { n: number }).n;
  const roomOnDisk = async (bytes: number) => {
    await mkdir(opts.uploadDir!, { recursive: true });
    const disk = await statfs(opts.uploadDir!).catch(() => null);
    if (disk && disk.bavail * disk.bsize - bytes < MIN_FREE_DISK) throw new HttpError(507, 'This server is nearly out of space, so it can\'t take files right now. Tell whoever runs it.');
  };
  const overDay = () => new HttpError(429, `You've shared ${Math.round(DAILY_UPLOAD / 1048576)} MB of files today, the most for a day. Try again tomorrow.`);
  const filePath = (id: string) => join(opts.uploadDir!, id);
  const removeFiles = (rows: Json[]) => {
    if (!opts.uploadDir) return;
    for (const r of rows) {
      unlink(filePath(r.id as string)).catch(() => {});
      unlink(thumbPath(r.id as string)).catch(() => {});
    }
  };
  const thumbPath = (id: string) => join(opts.uploadDir!, `${id}.thumb`);
  /** A picture or video's size in pixels, from the uploader, when it's believable. */
  const mediaSize = (type: string, w: unknown, h: unknown) => {
    const width = Math.round(Number(w)), height = Math.round(Number(h));
    if (!/^(image|video)\//.test(type) || !(width >= 1 && width <= 20000 && height >= 1 && height <= 20000)) return { width: null, height: null };
    return { width, height };
  };

  /** The logged-in person sending a file, which is the raw request body. */
  const uploader = (req: IncomingMessage) => {
    const user = userByToken(bearer(req));
    if (!user) throw new HttpError(401, "You're logged out. Log in again.");
    if (!opts.uploadDir) throw new HttpError(503, "Sharing files isn't set up on this server. Tell whoever runs it.");
    return user;
  };

  // The file is the raw request body; its name comes in the x-filename header.
  const handleUpload = async (req: IncomingMessage, res: ServerResponse, channelId: number) => {
    const user = uploader(req);
    const channel = textRoom(channelId, user.id);
    const limit = uploadLimitFor(channel.serverId, user.id);
    if (!limit) throw new HttpError(403, "Your roles can't share files in this hearth");
    checkUnsent(user.id);
    const tooBig = () => new HttpError(413, `You can share files up to ${Math.round(limit / 1048576)} MB here`);
    const declared = Number(req.headers['content-length']);
    if (declared > limit) throw tooBig();
    const today = uploadedToday(user.id);
    if (today + (declared > 0 ? declared : 1) > DAILY_UPLOAD) throw overDay();
    uploading.set(user.id, (uploading.get(user.id) ?? 0) + 1);
    try {
      await roomOnDisk(declared > 0 ? declared : limit);
      return await receiveUpload(req, res, user, channel, limit, today, tooBig, overDay);
    } finally {
      const left = (uploading.get(user.id) ?? 1) - 1;
      if (left > 0) uploading.set(user.id, left);
      else uploading.delete(user.id);
    }
  };
  const receiveUpload = async (
    req: IncomingMessage, res: ServerResponse, user: User, channel: Channel, limit: number, today: number,
    tooBig: () => HttpError, overDay: () => HttpError,
  ) => {
    let name = 'file';
    try {
      name = decodeURIComponent(String(req.headers['x-filename'] ?? 'file'));
    } catch {}
    // Without right-to-left marks too, which can make "invoice‮fdp.exe" look like "invoiceexe.pdf".
    name = withoutBidi(name).replace(/[\\/\x00-\x1f]/g, '_').trim().slice(-200) || 'file';
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() || 'application/octet-stream';

    const id = randomBytes(16).toString('base64url');
    const out = createWriteStream(filePath(id));
    let size = 0;
    await new Promise<void>((resolve, reject) => {
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit || today + size > DAILY_UPLOAD) {
          req.pause();
          reject(size > limit ? tooBig() : overDay());
        } else out.write(chunk);
      });
      req.on('end', () => out.end(resolve));
      req.on('error', reject);
      out.on('error', reject);
    }).catch((err) => {
      out.destroy();
      unlink(filePath(id)).catch(() => {});
      throw err;
    });
    if (!size) {
      unlink(filePath(id)).catch(() => {});
      throw new HttpError(400, 'That file is empty');
    }
    // The room may have been deleted (or they lost access) while it uploaded.
    try {
      visibleRoom(channel.id, user.id);
    } catch (err) {
      unlink(filePath(id)).catch(() => {});
      throw err;
    }
    // Voice messages say how long they are, so the player can show it before loading.
    const voiceSeconds = Number(req.headers['x-voice-seconds']);
    const voice = type.startsWith('audio/') && voiceSeconds > 0 && voiceSeconds <= 3600 ? Math.round(voiceSeconds * 10) / 10 : null;
    const { width, height } = mediaSize(type, req.headers['x-width'], req.headers['x-height']);
    db.prepare(
      'INSERT INTO attachments (id, channel_id, uploader_id, name, type, size, created_at, voice_seconds, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, channel.id, user.id, name, type, size, now(), voice, width, height);
    send(res, 200, attachmentJson({ id, name, type, size, voice_seconds: voice, width, height }));
  };

  const MAX_THUMB_BYTES = 300 * 1024;
  // A video's thumbnail: a small still the uploader's app took from it, sent before the message.
  const THUMB_TYPES: Record<string, (b: Buffer) => boolean> = {
    'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
    'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  };
  const handleThumbUpload = async (req: IncomingMessage, res: ServerResponse, id: string) => {
    const user = uploader(req);
    const a = db.prepare('SELECT type FROM attachments WHERE id = ? AND uploader_id = ? AND message_id IS NULL').get(id, user.id) as { type: string } | undefined;
    if (!a) throw new HttpError(404, 'That file is gone. It may have been deleted.');
    // Videos get a still to show before they play; photos a small copy for the chat and the album (the full one opens when tapped).
    if (!a.type.startsWith('video/') && !/^image\/(png|jpeg|webp)$/.test(a.type)) throw new HttpError(400, 'Only videos and photos have previews');
    const data = await readLimited(req, MAX_THUMB_BYTES, new HttpError(413, 'That thumbnail is too big'));
    const kind = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!THUMB_TYPES[kind]?.(data)) throw new HttpError(400, 'Send the thumbnail as a WebP or JPEG picture');
    await writeFile(thumbPath(id), data);
    db.prepare('UPDATE attachments SET thumb = 1 WHERE id = ?').run(id);
    send(res, 200, { thumb: `/api/attachments/${id}/thumb` });
  };
  const serveThumb = async (req: IncomingMessage, res: ServerResponse, id: string) => {
    const a = db.prepare('SELECT 1 FROM attachments WHERE id = ? AND thumb = 1 AND message_id IS NOT NULL').get(id);
    const data = a && opts.uploadDir ? await readFile(thumbPath(id)).catch(() => null) : null;
    if (!data) throw new HttpError(404, 'No thumbnail');
    res.writeHead(200, {
      'content-type': THUMB_TYPES['image/webp'](data) ? 'image/webp' : 'image/jpeg',
      'content-length': data.length,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, max-age=31536000, immutable',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  };

  // Attachment links are unguessable (128 random bits), so images work in <img> tags without a login.
  const serveAttachment = async (req: IncomingMessage, res: ServerResponse, id: string) => {
    const a = db.prepare('SELECT name, type, size FROM attachments WHERE id = ? AND message_id IS NOT NULL').get(id) as
      | { name: string; type: string; size: number }
      | undefined;
    if (!a || !opts.uploadDir || !(await stat(filePath(id)).catch(() => null))) throw new HttpError(404, 'That file is gone. It may have been deleted.');
    const inline = INLINE_TYPES.has(a.type);
    const headers: Record<string, string | number> = {
      'content-type': inline ? a.type : 'application/octet-stream',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, max-age=31536000, immutable',
      'accept-ranges': 'bytes',
    };
    // Videos and long voice messages are fetched a piece at a time, so they start (and skip ahead) without downloading it all.
    const range = String(req.headers.range ?? '').match(/^bytes=(\d*)-(\d*)$/);
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : Math.max(0, a.size - Number(range[2]));
      let end = range[1] && range[2] ? Math.min(Number(range[2]), a.size - 1) : a.size - 1;
      if (start >= a.size || start > end) {
        res.writeHead(416, { 'content-range': `bytes */${a.size}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${a.size}` });
      if (req.method === 'HEAD') return res.end();
      return void createReadStream(filePath(id), { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'content-length': a.size });
    if (req.method === 'HEAD') return res.end();
    createReadStream(filePath(id)).pipe(res);
  };

  // ---- profile and burrow pictures ----------------------------------------

  // Profile pictures live in uploads/avatars, burrow pictures in uploads/burrow-pictures.
  const picturePath = (folder: string, file: string) => join(opts.uploadDir!, folder, file);
  const avatarPath = (file: string) => picturePath('avatars', file);

  /** Swaps in a new picture file (or none), removes the old one and tells everyone who can see this user. */
  const setAvatarFile = (user: User, file: string | null) => {
    const old = db.prepare('SELECT avatar FROM users WHERE id = ?').get(user.id) as { avatar: string | null };
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(file, user.id);
    if (old.avatar && opts.uploadDir) unlink(avatarPath(old.avatar)).catch(() => {});
    return userChanged(user.id);
  };

  /** Reads a picture from the request body and saves it in `folder`, returning its new file name. */
  const savePicture = async (req: IncomingMessage, folder: string, what: string) => {
    const data = await readLimited(req, MAX_AVATAR_BYTES, new HttpError(413, `${what} can be at most ${MAX_AVATAR_BYTES / 1048576} MB`));
    const kind = AVATAR_TYPES.find((t) => t.magic(data));
    if (!kind) throw new HttpError(400, `${what} must be PNG, JPEG, GIF or WebP images`);
    const file = `${randomBytes(16).toString('base64url')}.${kind.ext}`;
    await mkdir(join(opts.uploadDir!, folder), { recursive: true });
    await writeFile(picturePath(folder, file), data);
    return file;
  };

  // The app shrinks the picture to a small square before sending.
  const handleAvatarUpload = async (req: IncomingMessage, res: ServerResponse) => {
    const user = uploader(req);
    send(res, 200, setAvatarFile(user, await savePicture(req, 'avatars', 'Profile pictures')));
  };

  /** Swaps in a burrow's new picture (or none) and shows it to everyone in the burrow. */
  // The banner is a wide picture kept next to the burrow's picture.
  type PictureColumn = 'icon' | 'banner';
  const setBurrowPicture = (serverId: number, file: string | null, column: PictureColumn = 'icon') => {
    removeBurrowPicture(serverId, column);
    db.prepare(`UPDATE servers SET ${column} = ? WHERE id = ?`).run(file, serverId);
    sendServerUpdate(serverId);
  };
  const removeBurrowPicture = (serverId: number, column: PictureColumn = 'icon') => {
    const old = db.prepare(`SELECT ${column} AS file FROM servers WHERE id = ?`).get(serverId) as { file: string | null } | undefined;
    if (old?.file && opts.uploadDir) unlink(picturePath('burrow-pictures', old.file)).catch(() => {});
  };

  // The host, and roles allowed to edit the burrow, can change its picture and banner.
  const handleBurrowPictureUpload = async (req: IncomingMessage, res: ServerResponse, serverId: number, column: PictureColumn = 'icon') => {
    const user = uploader(req);
    allowed(serverId, user, 'burrow');
    const file = await savePicture(req, 'burrow-pictures', column === 'icon' ? 'Hearth pictures' : 'Banners');
    // They may have lost the right (or the burrow may be gone) while it uploaded.
    try {
      allowed(serverId, user, 'burrow');
    } catch (err) {
      unlink(picturePath('burrow-pictures', file)).catch(() => {});
      throw err;
    }
    setBurrowPicture(serverId, file, column);
    send(res, 200, serverSummary(serverId, user.id));
  };
  // A message of the day with a photo: the picture is the request body, its words are ?text=.
  const handleMotdPicture = async (req: IncomingMessage, res: ServerResponse, serverId: number, url: URL) => {
    const user = uploader(req);
    fun.canAddMotd(serverId, user);
    const file = await savePicture(req, 'burrow-pictures', 'Photos');
    try {
      send(res, 200, fun.addMotd(serverId, user, url.searchParams.get('text') ?? '', file));
    } catch (err) {
      unlink(picturePath('burrow-pictures', file)).catch(() => {});
      throw err;
    }
  };
  route('DELETE', '/api/servers/:id/picture', ({ user, params }) => {
    const serverId = Number(params[0]);
    allowed(serverId, user, 'burrow');
    setBurrowPicture(serverId, null);
    return serverSummary(serverId, user.id);
  });
  route('DELETE', '/api/servers/:id/banner', ({ user, params }) => {
    const serverId = Number(params[0]);
    allowed(serverId, user, 'burrow');
    setBurrowPicture(serverId, null, 'banner');
    return serverSummary(serverId, user.id);
  });

  // Picture links are unguessable and never reused, so they can be cached forever.
  const servePicture = async (req: IncomingMessage, res: ServerResponse, folder: string, file: string) => {
    const kind = AVATAR_TYPES.find((t) => file.endsWith('.' + t.ext))!;
    const info = opts.uploadDir ? await stat(picturePath(folder, file)).catch(() => null) : null;
    if (!info) throw new HttpError(404, 'That picture is gone');
    res.writeHead(200, {
      'content-type': kind.type,
      'content-length': info.size,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'public, max-age=31536000, immutable',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(picturePath(folder, file)).pipe(res);
  };

  // ---- GIFs ---------------------------------------------------------------
  // Searching and previews go through Peiskos (see gifs.ts). A GIF that's sent is saved like an
  // uploaded file, so it keeps working even if KLIPY drops it.

  const gifs = opts.gifs && opts.uploadDir ? gifSearch(opts.gifs) : null;
  const gifsOn = () => {
    if (!gifs) throw new HttpError(503, "GIFs aren't set up on this server");
    return gifs;
  };
  const gifTries = (user: User) => {
    const key = `gif:${user.id}`;
    checkTries([key], 120); // searches a minute, per person; plenty for typing as you go
    failedTry([key], 60_000);
  };
  const GIF_TYPES = AVATAR_TYPES.filter((t) => t.ext === 'gif' || t.ext === 'webp');

  route('GET', '/api/gifs', async ({ user, url }) => {
    gifTries(user);
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
    const page = Math.max(1, Math.min(50, Number(url.searchParams.get('page')) || 1));
    try {
      return await (q ? gifsOn().search(q, page, user.id) : gifsOn().trending(page, user.id));
    } catch (err) {
      if (err instanceof HttpError) throw err;
      console.warn(`GIF search failed: ${err instanceof Error ? err.message : err}`);
      throw new HttpError(502, "Couldn't reach the GIF search. Try again in a moment.");
    }
  });

  // Previews load in <img> tags, which can't log in; the ids are random and only last a while.
  const serveGifPreview = async (req: IncomingMessage, res: ServerResponse, id: string) => {
    const gif = gifs?.get(id);
    if (!gif) throw new HttpError(404, 'GIF not found');
    let data: Buffer;
    try {
      data = await download(gif.preview, 5 * 1024 * 1024);
    } catch {
      throw new HttpError(502, "Couldn't load that GIF");
    }
    const kind = GIF_TYPES.find((t) => t.magic(data));
    if (!kind) throw new HttpError(502, "Couldn't load that GIF");
    res.writeHead(200, {
      'content-type': kind.type,
      'content-length': data.length,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, max-age=86400',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  };

  /** Saves a GIF from a search into a room, ready to send like an uploaded file. */
  route('POST', '/api/channels/:id/gifs', async ({ user, params, body }) => {
    const channel = textRoom(Number(params[0]), user.id);
    const gif = gifsOn().get(String(body.id ?? ''));
    if (!gif) throw new HttpError(404, 'That GIF is no longer available. Search again.');
    checkUnsent(user.id);
    let data: Buffer;
    try {
      data = await download(gif.full, maxUpload);
    } catch (err) {
      throw new HttpError(502, err instanceof Error && err.message.includes('too big') ? 'That GIF is too big to send' : "Couldn't fetch that GIF");
    }
    const kind = GIF_TYPES.find((t) => t.magic(data));
    if (!kind) throw new HttpError(502, "Couldn't fetch that GIF");
    // Saved GIFs are files like any other: they count toward the day's uploads and need room on disk.
    if (uploadedToday(user.id) + data.length > DAILY_UPLOAD) throw overDay();
    await roomOnDisk(data.length);
    const id = randomBytes(16).toString('base64url');
    const name = `${gif.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 60) || 'gif'}.${kind.ext}`;
    await mkdir(opts.uploadDir!, { recursive: true });
    await writeFile(filePath(id), data);
    // The room may have been deleted (or they lost access) while it downloaded.
    try {
      visibleRoom(channel.id, user.id);
    } catch (err) {
      unlink(filePath(id)).catch(() => {});
      throw err;
    }
    db.prepare(
      'INSERT INTO attachments (id, channel_id, uploader_id, name, type, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, channel.id, user.id, name, kind.type, data.length, now());
    return attachmentJson({ id, name, type: kind.type, size: data.length });
  });

  // Uploads that never made it into a message are cleared out after a day.
  if (opts.uploadDir) {
    const sweep = () => {
      const stale = db
        .prepare('SELECT id FROM attachments WHERE message_id IS NULL AND created_at < ?')
        .all(now() - 24 * 3600_000) as Json[];
      removeFiles(stale);
      db.prepare('DELETE FROM attachments WHERE message_id IS NULL AND created_at < ?').run(now() - 24 * 3600_000);
    };
    setInterval(sweep, 3600_000).unref();
  }

  return { DAILY_UPLOAD, avatarPath, filePath, gifs, handleAvatarUpload, handleBurrowPictureUpload, handleMotdPicture, handleThumbUpload, handleUpload, overDay, picturePath, removeBurrowPicture, removeFiles, roomOnDisk, savePicture, serveAttachment, serveGifPreview, servePicture, serveThumb, setAvatarFile, thumbPath, uploadedToday, uploader };
}
