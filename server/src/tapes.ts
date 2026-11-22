// Fire tapes: a fire recorded, only once everyone at it says yes, with "Clip that" for the last
// 30 seconds, and transcripts made overnight on this server.
//
// Voice is end-to-end encrypted, so LiveKit only ever has scrambled audio and can't record it.
// Instead each person's own app records their own microphone, only while they're on the tape,
// and sends it here a few seconds at a time. Peiskos keeps each person's audio apart (which is
// also how the transcript knows who said what) and mixes it with ffmpeg for listening.
import { randomBytes } from 'node:crypto';
import { createReadStream, openAsBlob } from 'node:fs';
import { appendFile, mkdir, readdir, rename, stat, statfs, unlink } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { setPriority } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { Channel, Handler, User } from './app.ts';
import type { Db } from './db.ts';
import { bearer, HttpError, type Json, readLimited, send } from './http.ts';

export interface TapeOptions {
  /** Longest a tape runs before it stops by itself (default 3 hours). */
  maxMinutes?: number;
  /** Whole tapes are cleared this long after they end; their clips stay (default 30). */
  keepDays?: number;
  /** All tapes and clips together stop new tapes past this (default 10 GB). */
  storageBytes?: number;
  /** whisper.cpp's server (see transcriber/); no transcripts without it. */
  whisperUrl?: string;
  /** The language people speak, for whisper ("auto" works it out). */
  language?: string;
  /** Transcripts are made between these hours, server time (default 1 to 7 at night). */
  nightHours?: [number, number];
  ffmpeg?: string;
  /** Tests make it all quicker. */
  timing?: { askMs?: number; clipDelayMs?: number; endGraceMs?: number; askAgainMs?: number };
}

export interface TapesContext {
  db: Db;
  /** Where tapes are kept (uploads/tapes). */
  dir: string;
  options: TapeOptions;
  minFreeDisk: number;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => number;
  canSee: (channel: Channel, userId: number) => boolean;
  channelById: (id: number) => Channel | undefined;
  usersInVoice: (channelId: number) => number[];
  inVoice: Map<number, number>;
  sendTo: (userIds: Iterable<number>, event: Json) => void;
  nameIn: (serverId: number, userId: number) => string;
  /** Hosts and mods (who manage voice) can delete any tape at their fires. */
  isBoss: (channelId: number, userId: number) => boolean;
  /** Tapes are for hearths' fires, not calls in direct messages. */
  isHearth: (serverId: number) => boolean;
  userByToken: (raw: string | undefined) => User | undefined;
}

type Keep = 'all' | 'clips';
/** A fire being asked, or being taped, right now. */
type Live = {
  channelId: number;
  phase: 'asking' | 'taping';
  by: number;
  keep: Keep;
  answers: Map<number, boolean>; // yes or no, from everyone asked
  tapeId: number | null;
  startedAt: number;
  timer: NodeJS.Timeout | null; // the ask running out, or the tape's longest
};
type Part = { rowId: number; file: string; next: number; chain: Promise<unknown>; bytes: number };
type AudioRow = { id: number; tape_id: number; clip_id: number | null; user_id: number | null; file: string; start_ms: number; bytes: number; transcript: string | null };

export const CLIP_MS = 30_000;
const CHUNK_MAX = 1024 * 1024;
const PERSON_MAX = 200 * 1024 * 1024; // what one person's app can send for one tape (3 hours is about 45 MB)
const CLIPS_MAX = 200;
const TYPES: Record<string, string> = { 'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/ogg': 'ogg' };
// What people's apps send is read only as the audio it says it is: ffmpeg left to guess could take a
// file for a playlist and go reading other files or addresses.
const DEMUXERS: Record<string, string> = { webm: 'matroska', mp4: 'mov', m4a: 'mov', ogg: 'ogg' };
const input = (file: string, path: string) => ['-protocol_whitelist', 'file', '-f', DEMUXERS[file.split('.').pop()!] ?? 'matroska', '-i', path];

export function fireTapes(ctx: TapesContext) {
  const { db, dir, options, route, canSee, channelById, usersInVoice, sendTo, nameIn, isBoss, isHearth } = ctx;
  const ffmpeg = options.ffmpeg ?? 'ffmpeg';
  const maxMs = (options.maxMinutes ?? 180) * 60_000;
  const keepMs = (options.keepDays ?? 30) * 86_400_000;
  const storage = options.storageBytes ?? 10 * 1024 ** 3;
  const [nightFrom, nightTo] = options.nightHours ?? [1, 7];
  const ASK_MS = options.timing?.askMs ?? 60_000;
  const CLIP_DELAY_MS = options.timing?.clipDelayMs ?? 6_000; // the app sends every 3 seconds
  const END_GRACE_MS = options.timing?.endGraceMs ?? 8_000;
  const ASK_AGAIN_MS = options.timing?.askAgainMs ?? 30_000;

  const live = new Map<number, Live>(); // voice channel id -> what's going on there
  const parts = new Map<string, Part>(); // `${tapeId}:${userId}:${part}` -> where that recording goes
  const lastNo = new Map<number, number>(); // fire -> when an ask there last came to nothing
  const lastClip = new Map<number, number>(); // user -> their last clip
  const timers = new Set<NodeJS.Timeout>();
  const later = (ms: number, run: () => void) => {
    const t = setTimeout(() => { timers.delete(t); run(); }, ms);
    t.unref();
    timers.add(t);
    return t;
  };
  const fileOf = (name: string) => join(dir, name);
  const newName = (ext: string) => `${randomBytes(16).toString('base64url')}.${ext}`;
  const remove = (name: string | null | undefined) => { if (name) unlink(fileOf(name)).catch(() => {}); };

  // ---- ffmpeg, one job at a time and at low priority, so a long mix never slows the fire down
  let jobs: Promise<unknown> = Promise.resolve();
  const runFfmpeg = (args: string[]) => {
    const job = jobs.then(() => new Promise<void>((resolve, reject) => {
      const p = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
      try { if (p.pid) setPriority(p.pid, 15); } catch { /* not allowed here: it runs at normal priority */ }
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `ffmpeg stopped with ${code}`))));
    }));
    jobs = job.catch(() => {});
    return job;
  };

  /**
   * Mixes people's audio between two moments of a tape (ms from its start) into one file.
   * Each input starts at its own moment, so they line up. False when there was nothing to mix.
   */
  const mixWindow = async (inputs: { file: string; start_ms: number }[], from: number, to: number, out: string) => {
    const used = inputs.filter((p) => p.start_ms < to);
    if (!used.length || to <= from) return false;
    const args: string[] = [];
    const chains: string[] = [];
    used.forEach((p, k) => {
      args.push(...input(p.file, fileOf(p.file)));
      const start = Math.max(0, from - p.start_ms) / 1000;
      const end = (to - p.start_ms) / 1000;
      const delay = Math.max(0, p.start_ms - from);
      chains.push(`[${k}:a]aresample=48000,aformat=channel_layouts=mono,atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,adelay=${delay}:all=1[a${k}]`);
    });
    const inputsList = used.map((_, k) => `[a${k}]`).join('');
    const together = used.length > 1 ? `${inputsList}amix=inputs=${used.length}:normalize=0:duration=longest:dropout_transition=0` : `${inputsList}anull`;
    chains.push(`${together},alimiter=limit=0.95,atrim=end=${(to - from) / 1000}[out]`);
    const tmp = `${out}.part`;
    try {
      await runFfmpeg([...args, '-filter_complex', chains.join(';'), '-map', '[out]', '-ac', '1', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-f', 'mp4', fileOf(tmp)]);
      const size = (await stat(fileOf(tmp)).catch(() => null))?.size ?? 0;
      // An mp4 with no sound in it is about a kilobyte of headers.
      if (size < 2048) { remove(tmp); return false; }
      await rename(fileOf(tmp), fileOf(out));
      return true;
    } catch (err) {
      remove(tmp);
      throw err;
    }
  };

  // ---- what the fire is told
  const tapeOf = (id: number) =>
    db.prepare('SELECT id, server_id, channel_id, started_by, keep, state, started_at, ended_at, file, duration_ms FROM tapes WHERE id = ?').get(id) as
      | { id: number; server_id: number; channel_id: number; started_by: number | null; keep: Keep; state: string; started_at: number; ended_at: number | null; file: string | null; duration_ms: number | null }
      | undefined;
  const peopleOn = (tapeId: number) =>
    (db.prepare('SELECT user_id FROM tape_people WHERE tape_id = ?').all(tapeId) as { user_id: number }[]).map((r) => r.user_id);
  const isOn = (tapeId: number, userId: number) => !!db.prepare('SELECT 1 FROM tape_people WHERE tape_id = ? AND user_id = ?').get(tapeId, userId);
  const clipCount = (tapeId: number) => (db.prepare('SELECT COUNT(*) AS n FROM tape_clips WHERE tape_id = ?').get(tapeId) as { n: number }).n;

  const stateEvent = (channelId: number) => {
    const l = live.get(channelId);
    if (!l) return { type: 'tape_state', channelId, tape: null };
    const yes = [...l.answers].filter(([, v]) => v).map(([id]) => id);
    const no = [...l.answers].filter(([, v]) => !v).map(([id]) => id);
    return {
      type: 'tape_state',
      channelId,
      tape: {
        phase: l.phase,
        id: l.tapeId,
        by: l.by,
        keep: l.keep,
        startedAt: l.startedAt,
        now: Date.now(),
        // While asking: who said yes. While taping: who is on it (said yes), and who said no.
        yes: l.phase === 'taping' && l.tapeId ? peopleOn(l.tapeId) : yes,
        no,
        clips: l.tapeId ? clipCount(l.tapeId) : 0,
        endsAt: l.phase === 'asking' ? l.startedAt + ASK_MS : l.startedAt + maxMs,
      },
    };
  };
  const tellFire = (channelId: number) => sendTo(usersInVoice(channelId), stateEvent(channelId));
  const note = (channelId: number, text: string) => sendTo(usersInVoice(channelId), { type: 'tape_note', channelId, text });

  // ---- asking, and starting
  const usedBytes = async () => {
    let total = 0;
    for (const name of await readdir(dir).catch(() => [] as string[])) total += (await stat(fileOf(name)).catch(() => null))?.size ?? 0;
    return total;
  };
  const roomForTapes = async () => {
    const disk = await statfs(dir).catch(() => null);
    if (disk && disk.bavail * disk.bsize < ctx.minFreeDisk) return false;
    return (await usedBytes()) < storage;
  };

  const ask = async (user: User, channelId: number, keep: Keep) => {
    const channel = channelById(channelId)!;
    if (!isHearth(channel.serverId)) throw new HttpError(400, 'Tapes are for fires in a hearth.');
    if (live.has(channelId)) throw new HttpError(409, live.get(channelId)!.phase === 'taping' ? 'This fire is already being taped.' : 'Everyone is being asked already.');
    const since = lastNo.get(channelId);
    if (since && Date.now() - since < ASK_AGAIN_MS) throw new HttpError(429, 'Wait a little before asking again.');
    await mkdir(dir, { recursive: true });
    if (!(await roomForTapes())) throw new HttpError(507, "This server has no room for more tapes. Delete some old ones, or tell whoever runs it.");
    if (live.has(channelId) || ctx.inVoice.get(user.id) !== channelId) return;
    const l: Live = { channelId, phase: 'asking', by: user.id, keep, answers: new Map([[user.id, true]]), tapeId: null, startedAt: Date.now(), timer: null };
    live.set(channelId, l);
    l.timer = later(ASK_MS, () => {
      if (live.get(channelId) !== l || l.phase !== 'asking') return;
      endAsk(l, 'Not everyone answered, so nothing is taped.');
    });
    tellFire(channelId);
    settle(l);
  };
  const endAsk = (l: Live, why: string) => {
    if (l.timer) clearTimeout(l.timer);
    live.delete(l.channelId);
    lastNo.set(l.channelId, Date.now());
    note(l.channelId, why);
    tellFire(l.channelId);
  };
  /** Starts the tape once everyone at the fire has said yes. */
  const settle = (l: Live) => {
    if (l.phase !== 'asking') return;
    const here = usersInVoice(l.channelId);
    if (!here.length) return endAsk(l, 'Everyone left, so nothing is taped.');
    if (!here.every((id) => l.answers.get(id) === true)) return;
    if (l.timer) clearTimeout(l.timer);
    const channel = channelById(l.channelId);
    if (!channel) return void live.delete(l.channelId);
    const t = Date.now();
    const tapeId = Number(db.prepare("INSERT INTO tapes (server_id, channel_id, started_by, keep, state, started_at) VALUES (?, ?, ?, ?, 'taping', ?)")
      .run(channel.serverId, channel.id, l.by, l.keep, t).lastInsertRowid);
    const add = db.prepare('INSERT OR IGNORE INTO tape_people (tape_id, user_id) VALUES (?, ?)');
    for (const id of here) add.run(tapeId, id);
    Object.assign(l, { phase: 'taping', tapeId, startedAt: t });
    l.answers = new Map(here.map((id) => [id, true]));
    l.timer = later(maxMs, () => { if (live.get(l.channelId) === l) stop(l, `The tape stopped after ${Math.round(maxMs / 3600_000 * 10) / 10} hours, the longest one can run.`); });
    tellFire(l.channelId);
  };

  const answer = (user: User, l: Live, yes: boolean) => {
    if (l.answers.get(user.id) === yes) return;
    l.answers.set(user.id, yes);
    const channel = channelById(l.channelId)!;
    if (l.phase === 'asking') {
      if (!yes) return endAsk(l, `${nameIn(channel.serverId, user.id)} said no, so nothing is taped.`);
      tellFire(l.channelId);
      return settle(l);
    }
    // Arrived while it was being taped. Yes puts them on it from now; no leaves them off it.
    if (yes) db.prepare('INSERT OR IGNORE INTO tape_people (tape_id, user_id) VALUES (?, ?)').run(l.tapeId, user.id);
    else note(l.channelId, `${nameIn(channel.serverId, user.id)} isn't on the tape.`);
    tellFire(l.channelId);
  };

  // ---- stopping, and mixing it all together
  const stop = (l: Live, why?: string) => {
    if (l.timer) clearTimeout(l.timer);
    live.delete(l.channelId);
    const tapeId = l.tapeId!;
    db.prepare("UPDATE tapes SET state = 'mixing', ended_at = ? WHERE id = ? AND state = 'taping'").run(Date.now(), tapeId);
    if (why) note(l.channelId, why);
    tellFire(l.channelId);
    // The last few seconds are still on their way from people's apps.
    later(END_GRACE_MS, () => void finish(tapeId));
  };
  const clipsCutting = new Map<number, Promise<unknown>>(); // tape -> its clips still being cut
  const finish = async (tapeId: number) => {
    await clipsCutting.get(tapeId);
    const tape = tapeOf(tapeId);
    if (!tape || tape.state !== 'mixing') return;
    for (const key of parts.keys()) if (key.startsWith(`${tapeId}:`)) parts.delete(key);
    const audio = db.prepare('SELECT id, file, start_ms FROM tape_audio WHERE tape_id = ? AND clip_id IS NULL').all(tapeId) as { id: number; file: string; start_ms: number }[];
    const length = (tape.ended_at ?? Date.now()) - tape.started_at;
    let state = 'ready';
    let file: string | null = null;
    try {
      if (tape.keep === 'all') {
        file = newName('m4a');
        if (!(await mixWindow(audio, 0, length, file))) file = null;
      } else {
        // Only the clips are kept: everything else anyone said goes now.
        for (const a of audio) remove(a.file);
        db.prepare('DELETE FROM tape_audio WHERE tape_id = ? AND clip_id IS NULL').run(tapeId);
      }
      const readyClips = (db.prepare("SELECT COUNT(*) AS n FROM tape_clips WHERE tape_id = ? AND state = 'ready'").get(tapeId) as { n: number }).n;
      if (tape.keep === 'all' ? !file : !readyClips) state = 'empty';
    } catch (err) {
      console.warn(`Couldn't mix tape ${tapeId}: ${(err as Error).message}`);
      state = 'failed';
    }
    if (!tapeOf(tapeId)) return remove(file); // deleted while it was mixing
    db.prepare('UPDATE tapes SET state = ?, file = ?, duration_ms = ? WHERE id = ?').run(state, file, length, tapeId);
    const channel = channelById(tape.channel_id);
    if (channel) sendTo(peopleOn(tapeId), { type: 'tape_ready', tapeId, channelId: channel.id, fire: channel.name, state });
  };

  // ---- "Clip that": the last 30 seconds
  const clip = (user: User, l: Live) => {
    if (l.phase !== 'taping' || !l.tapeId || !isOn(l.tapeId, user.id)) throw new HttpError(403, "You're not on this tape.");
    const t = Date.now();
    if (t - (lastClip.get(user.id) ?? 0) < 3000) return;
    if (clipCount(l.tapeId) >= CLIPS_MAX) throw new HttpError(429, `A tape can have ${CLIPS_MAX} clips at most.`);
    lastClip.set(user.id, t);
    const end = t - l.startedAt;
    const start = Math.max(0, end - CLIP_MS);
    const tapeId = l.tapeId;
    const clipId = Number(db.prepare("INSERT INTO tape_clips (tape_id, made_by, start_ms, end_ms, state, created_at) VALUES (?, ?, ?, ?, 'cutting', ?)")
      .run(tapeId, user.id, start, end, t).lastInsertRowid);
    note(l.channelId, `${nameIn(channelById(l.channelId)!.serverId, user.id)} clipped that.`);
    tellFire(l.channelId);
    // Cut once the apps have sent what was said up to now.
    const cutting = new Promise<void>((resolve) => later(CLIP_DELAY_MS, () => void cut(clipId).finally(resolve)));
    clipsCutting.set(tapeId, Promise.all([clipsCutting.get(tapeId), cutting]));
  };
  const clipOf = (id: number) =>
    db.prepare('SELECT id, tape_id, made_by, start_ms, end_ms, state, file, created_at FROM tape_clips WHERE id = ?').get(id) as
      | { id: number; tape_id: number; made_by: number | null; start_ms: number; end_ms: number; state: string; file: string | null; created_at: number }
      | undefined;
  /** Cuts a clip from everyone's audio (again, if someone took themselves off the tape). */
  const cut = async (clipId: number) => {
    const c = clipOf(clipId);
    const tape = c && tapeOf(c.tape_id);
    if (!c || !tape) return;
    const audio = db.prepare('SELECT id, user_id, file, start_ms FROM tape_audio WHERE tape_id = ? AND clip_id IS NULL').all(c.tape_id) as { id: number; user_id: number | null; file: string; start_ms: number }[];
    let state = 'ready';
    const file = newName('m4a');
    const slices: { user_id: number | null; file: string }[] = [];
    // A finished tape that kept only clips has just each person's part of the clip left to cut from.
    if (!audio.length && tape.keep === 'clips') {
      const kept = db.prepare('SELECT file, start_ms FROM tape_audio WHERE clip_id = ?').all(clipId) as { file: string; start_ms: number }[];
      try {
        if (!(await mixWindow(kept, 0, c.end_ms - c.start_ms, file))) state = 'empty';
      } catch (err) {
        console.warn(`Couldn't cut clip ${clipId}: ${(err as Error).message}`);
        state = 'failed';
      }
      if (!clipOf(clipId)) return remove(file);
      remove(c.file);
      db.prepare('UPDATE tape_clips SET state = ?, file = ? WHERE id = ?').run(state, state === 'ready' ? file : null, clipId);
      if (state !== 'ready') remove(file);
      return;
    }
    try {
      if (!(await mixWindow(audio, c.start_ms, c.end_ms, file))) state = 'empty';
      // A tape that keeps only clips loses everyone's own audio when it ends, so each person's
      // part of the clip is kept apart too, for the transcript to say who said what.
      else if (tape.keep === 'clips') {
        for (const userId of new Set(audio.map((a) => a.user_id))) {
          const slice = newName('m4a');
          if (await mixWindow(audio.filter((a) => a.user_id === userId), c.start_ms, c.end_ms, slice)) slices.push({ user_id: userId, file: slice });
        }
      }
    } catch (err) {
      console.warn(`Couldn't cut clip ${clipId}: ${(err as Error).message}`);
      state = 'failed';
    }
    if (!clipOf(clipId)) { remove(file); for (const s of slices) remove(s.file); return; }
    const old = db.prepare('SELECT file FROM tape_audio WHERE clip_id = ?').all(clipId) as { file: string }[];
    db.prepare('DELETE FROM tape_audio WHERE clip_id = ?').run(clipId);
    for (const o of old) remove(o.file);
    const addSlice = db.prepare('INSERT INTO tape_audio (tape_id, clip_id, user_id, file, start_ms) VALUES (?, ?, ?, ?, 0)');
    for (const s of slices) addSlice.run(c.tape_id, clipId, s.user_id, s.file);
    remove(c.file);
    db.prepare('UPDATE tape_clips SET state = ?, file = ? WHERE id = ?').run(state, state === 'ready' ? file : null, clipId);
    if (state !== 'ready') remove(file);
    const channel = channelById(tape.channel_id);
    if (channel) sendTo(new Set([...usersInVoice(channel.id), ...peopleOn(tape.id)]), { type: 'tape_clip', channelId: channel.id, clip: clipJson(clipOf(clipId)!, tape.server_id) });
  };

  // ---- taking yourself off a tape
  /** Everything of theirs on the tape is deleted, and its clips are cut again without them. */
  const leaveTape = async (tapeId: number, userId: number) => {
    db.prepare('DELETE FROM tape_people WHERE tape_id = ? AND user_id = ?').run(tapeId, userId);
    for (const key of parts.keys()) if (key.startsWith(`${tapeId}:${userId}:`)) parts.delete(key);
    const mine = db.prepare('SELECT file FROM tape_audio WHERE tape_id = ? AND user_id = ?').all(tapeId, userId) as { file: string }[];
    db.prepare('DELETE FROM tape_audio WHERE tape_id = ? AND user_id = ?').run(tapeId, userId);
    for (const a of mine) remove(a.file);
    const tape = tapeOf(tapeId);
    if (!tape) return;
    const clipIds = (db.prepare('SELECT id FROM tape_clips WHERE tape_id = ?').all(tapeId) as { id: number }[]).map((r) => r.id);
    const recut = Promise.all(clipIds.map((id) => cut(id)));
    clipsCutting.set(tapeId, Promise.all([clipsCutting.get(tapeId), recut]));
    await recut;
    // A finished tape is mixed again without them.
    if (tape.keep === 'all' && (tape.state === 'ready' || tape.state === 'empty')) {
      db.prepare("UPDATE tapes SET state = 'mixing' WHERE id = ?").run(tapeId);
      remove(tape.file);
      await finish(tapeId);
    }
  };

  // ---- what people's apps send while they're on a tape
  const handleAudio = async (req: IncomingMessage, res: ServerResponse, tapeId: number, url: URL) => {
    const user = ctx.userByToken(bearer(req));
    if (!user) throw new HttpError(401, "You're logged out. Log in again.");
    const tape = tapeOf(tapeId);
    const ext = TYPES[String(req.headers['content-type'] ?? '').split(';')[0].trim()];
    if (!ext) throw new HttpError(415, 'Send WebM, MP4 or Ogg audio.');
    const part = url.searchParams.get('part') ?? '';
    const seq = Number(url.searchParams.get('seq'));
    const elapsed = Number(url.searchParams.get('elapsed'));
    if (!/^[\w-]{4,32}$/.test(part) || !Number.isInteger(seq) || seq < 0 || !(elapsed >= 0 && elapsed < maxMs + 60_000)) throw new HttpError(400, "That isn't a piece of a tape.");
    // Still taping, or just stopped: the last pieces are on their way.
    const open = tape && (tape.state === 'taping' || (tape.state === 'mixing' && Date.now() < (tape.ended_at ?? 0) + END_GRACE_MS));
    if (!tape || !open || !isOn(tapeId, user.id)) throw new HttpError(403, "You're not on a tape that's running.");
    const body = await readLimited(req, CHUNK_MAX, new HttpError(413, 'Send the audio in smaller pieces.'));
    const key = `${tapeId}:${user.id}:${part}`;
    let p = parts.get(key);
    if (!p) {
      // A part starts with its first piece; a later one means Peiskos restarted in between.
      if (seq !== 0) throw new HttpError(409, 'Start a new part.');
      const mine = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS b FROM tape_audio WHERE tape_id = ? AND user_id = ? AND clip_id IS NULL').get(tapeId, user.id) as { n: number; b: number };
      if (mine.n >= 50 || mine.b > PERSON_MAX) throw new HttpError(429, "That's all this tape can take from you.");
      const file = newName(ext);
      // When their app started this part, by this server's clock: now, less how long it's been going.
      const start = Math.max(0, Date.now() - elapsed - tape.started_at);
      const rowId = Number(db.prepare('INSERT INTO tape_audio (tape_id, user_id, file, start_ms) VALUES (?, ?, ?, ?)').run(tapeId, user.id, file, start).lastInsertRowid);
      parts.set(key, (p = { rowId, file, next: 0, chain: Promise.resolve(), bytes: mine.b }));
    }
    const part0 = p;
    // Pieces go on in order. One sent twice (its answer was lost) is taken once.
    const write = part0.chain.then(async () => {
      if (seq < part0.next) return;
      if (part0.bytes + body.length > PERSON_MAX) throw new HttpError(429, "That's all this tape can take from you.");
      await appendFile(fileOf(part0.file), body);
      part0.next = seq + 1;
      part0.bytes += body.length;
      db.prepare('UPDATE tape_audio SET bytes = bytes + ? WHERE id = ?').run(body.length, part0.rowId);
    });
    part0.chain = write.catch(() => {});
    await write;
    send(res, 200, { ok: true });
  };

  /** Tape and clip files, by their long random names, the same way shared files are. */
  const serveFile = async (req: IncomingMessage, res: ServerResponse, name: string) => {
    const known = db.prepare('SELECT 1 FROM tapes WHERE file = ? UNION SELECT 1 FROM tape_clips WHERE file = ?').get(name, name);
    const info = known && (await stat(fileOf(name)).catch(() => null));
    if (!info) throw new HttpError(404, 'That tape is gone. It may have been deleted.');
    const headers: Record<string, string | number> = {
      'content-type': 'audio/mp4',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, max-age=31536000, immutable',
      'accept-ranges': 'bytes',
    };
    const range = String(req.headers.range ?? '').match(/^bytes=(\d*)-(\d*)$/);
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      if (start >= info.size || start > end) return void res.writeHead(416, { 'content-range': `bytes */${info.size}` }).end();
      res.writeHead(206, { ...headers, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${info.size}` });
      if (req.method === 'HEAD') return void res.end();
      return void createReadStream(fileOf(name), { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'content-length': info.size });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(fileOf(name)).pipe(res);
  };

  /** The tapes' own requests that aren't JSON. True when it was one of them. */
  const handleRaw = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    const audio = req.method === 'POST' && url.pathname.match(/^\/api\/tapes\/(\d+)\/audio$/);
    const file = (req.method === 'GET' || req.method === 'HEAD') && url.pathname.match(/^\/api\/tape-files\/([\w-]{22}\.m4a)$/);
    if (audio) await handleAudio(req, res, Number(audio[1]), url);
    else if (file) await serveFile(req, res, file[1]);
    return !!(audio || file);
  };

  // ---- the fire's own messages: { type: 'tape', action }
  const handle = async (user: User, msg: Json) => {
    const channelId = ctx.inVoice.get(user.id);
    if (channelId === undefined) throw new HttpError(400, 'Join the fire first.');
    const l = live.get(channelId);
    switch (msg.action) {
      case 'ask':
        return ask(user, channelId, msg.keep === 'clips' ? 'clips' : 'all');
      case 'answer':
        if (l && (l.phase === 'asking' || !l.answers.has(user.id) || msg.yes === true)) answer(user, l, msg.yes === true);
        return;
      case 'cancel':
        if (l?.phase === 'asking' && l.by === user.id) endAsk(l, 'The tape was called off.');
        return;
      case 'stop':
        if (l?.phase === 'taping' && l.tapeId && isOn(l.tapeId, user.id)) stop(l, `${nameIn(channelById(channelId)!.serverId, user.id)} stopped the tape.`);
        return;
      case 'clip':
        if (l) clip(user, l);
        return;
      case 'leave':
        // Off the tape: nothing of theirs is kept, not even what was taped already.
        if (l?.phase === 'taping' && l.tapeId && isOn(l.tapeId, user.id)) {
          l.answers.set(user.id, false);
          await leaveTape(l.tapeId, user.id);
          note(channelId, `${nameIn(channelById(channelId)!.serverId, user.id)} took themselves off the tape.`);
          if (live.get(channelId) === l && !usersInVoice(channelId).some((id) => isOn(l.tapeId!, id))) stop(l);
          else tellFire(channelId);
        }
        return;
    }
  };

  /** Someone sat down at a fire: they hear what's going on, and are asked if it's being taped. */
  const joined = (channelId: number, userId: number) => {
    sendTo([userId], stateEvent(channelId));
    const l = live.get(channelId);
    // A new arrival while asking has to say yes too; while taping, they're asked and the tape goes on.
    if (l?.phase === 'asking') { l.answers.delete(userId); tellFire(channelId); }
    else if (l?.phase === 'taping' && l.answers.get(userId) === false) l.answers.delete(userId);
  };
  /** Someone got up. A tape with nobody on it left at the fire stops. */
  const left = (channelId: number, userId: number) => {
    sendTo([userId], { type: 'tape_state', channelId, tape: null });
    const l = live.get(channelId);
    if (!l) return;
    if (l.phase === 'asking') {
      if (l.by === userId) return endAsk(l, 'The tape was called off.');
      l.answers.delete(userId);
      tellFire(channelId);
      return settle(l);
    }
    if (!usersInVoice(channelId).some((id) => isOn(l.tapeId!, id))) stop(l, usersInVoice(channelId).length ? 'Nobody on the tape is here, so it stopped.' : undefined);
    else tellFire(channelId);
  };

  // ---- reading tapes back
  const canManage = (tape: { id: number; channel_id: number; started_by: number | null }, userId: number) =>
    tape.started_by === userId || isOn(tape.id, userId) || isBoss(tape.channel_id, userId);
  const fileUrl = (name: string | null) => (name ? `/api/tape-files/${name}` : null);
  const clipJson = (c: NonNullable<ReturnType<typeof clipOf>>, serverId: number) => ({
    id: c.id, tapeId: c.tape_id, by: c.made_by, byName: c.made_by ? nameIn(serverId, c.made_by) : 'Someone', startMs: c.start_ms, endMs: c.end_ms,
    state: c.state, url: fileUrl(c.file), createdAt: c.created_at,
  });
  const visibleTape = (id: number, userId: number) => {
    const tape = tapeOf(id);
    const channel = tape && channelById(tape.channel_id);
    if (!tape || !channel || !canSee(channel, userId)) throw new HttpError(404, "That tape is gone, or you can't see it.");
    return { tape, channel };
  };
  const tapeJson = (tape: NonNullable<ReturnType<typeof tapeOf>>, userId: number) => {
    const people = peopleOn(tape.id);
    const clips = (db.prepare('SELECT id, tape_id, made_by, start_ms, end_ms, state, file, created_at FROM tape_clips WHERE tape_id = ? ORDER BY start_ms').all(tape.id) as NonNullable<ReturnType<typeof clipOf>>[])
      .map((c) => clipJson(c, tape.server_id));
    return {
      id: tape.id, channelId: tape.channel_id, by: tape.started_by, keep: tape.keep, state: tape.state, startedAt: tape.started_at, endedAt: tape.ended_at,
      durationMs: tape.duration_ms, url: fileUrl(tape.file), cleared: tape.keep === 'all' && tape.state === 'ready' && !tape.file,
      people: people.map((id) => ({ id, name: nameIn(tape.server_id, id) })), clips, canDelete: canManage(tape, userId), onIt: people.includes(userId),
    };
  };

  /** Who said what, in order: from each person's own audio, timed from the start of the tape (or clip). */
  const transcriptOf = (tape: NonNullable<ReturnType<typeof tapeOf>>, clip?: NonNullable<ReturnType<typeof clipOf>>) => {
    if (!options.whisperUrl) return { state: 'off', lines: [] };
    const fromSlices = !!clip && tape.keep === 'clips';
    const rows = (fromSlices
      ? db.prepare('SELECT user_id, start_ms, transcript FROM tape_audio WHERE clip_id = ?').all(clip.id)
      : db.prepare('SELECT user_id, start_ms, transcript FROM tape_audio WHERE tape_id = ? AND clip_id IS NULL').all(tape.id)) as Pick<AudioRow, 'user_id' | 'start_ms' | 'transcript'>[];
    if (!rows.length && !fromSlices && tape.file === null && tape.keep === 'all' && tape.state === 'ready') return { state: 'cleared', lines: [] };
    const waiting = rows.some((r) => r.transcript === null) || tape.state === 'taping' || tape.state === 'mixing';
    let lines = rows.flatMap((r) => (JSON.parse(r.transcript ?? '[]') as { s: number; e: number; t: string }[])
      .map((seg) => ({ at: r.start_ms + seg.s, end: r.start_ms + seg.e, userId: r.user_id, name: r.user_id ? nameIn(tape.server_id, r.user_id) : 'Someone', text: seg.t })));
    if (clip && !fromSlices) lines = lines.filter((x) => x.end > clip.start_ms && x.at < clip.end_ms).map((x) => ({ ...x, at: Math.max(0, x.at - clip.start_ms), end: x.end - clip.start_ms }));
    lines.sort((a, b) => a.at - b.at);
    return { state: waiting ? 'waiting' : 'ready', lines };
  };

  route('GET', '/api/channels/:id/tapes', ({ user, params }) => {
    const channel = channelById(Number(params[0]));
    if (!channel || channel.kind !== 'voice' || !canSee(channel, user.id)) throw new HttpError(404, "That fire is gone, or you can't see it.");
    const rows = db.prepare('SELECT id FROM tapes WHERE channel_id = ? ORDER BY started_at DESC LIMIT 50').all(channel.id) as { id: number }[];
    return { tapes: rows.map((r) => tapeJson(tapeOf(r.id)!, user.id)), transcripts: !!options.whisperUrl };
  });
  route('GET', '/api/tapes/:id', ({ user, params }) => {
    const { tape } = visibleTape(Number(params[0]), user.id);
    return { tape: tapeJson(tape, user.id), transcript: transcriptOf(tape) };
  });
  route('GET', '/api/tape-clips/:id', ({ user, params }) => {
    const c = clipOf(Number(params[0]));
    if (!c) throw new HttpError(404, 'That clip is gone.');
    const { tape } = visibleTape(c.tape_id, user.id);
    return { clip: clipJson(c, tape.server_id), transcript: transcriptOf(tape, c) };
  });
  route('DELETE', '/api/tapes/:id', ({ user, params }) => {
    const { tape } = visibleTape(Number(params[0]), user.id);
    if (!canManage(tape, user.id)) throw new HttpError(403, 'Only people on the tape, and whoever manages voice, can delete it.');
    if (tape.state === 'taping') throw new HttpError(409, 'Stop the tape first.');
    deleteTape(tape.id);
    return { ok: true };
  });
  route('DELETE', '/api/tape-clips/:id', ({ user, params }) => {
    const c = clipOf(Number(params[0]));
    if (!c) return { ok: true };
    const { tape } = visibleTape(c.tape_id, user.id);
    if (c.made_by !== user.id && !canManage(tape, user.id)) throw new HttpError(403, 'Only people on the tape, and whoever manages voice, can delete its clips.');
    const files = db.prepare('SELECT file FROM tape_audio WHERE clip_id = ?').all(c.id) as { file: string }[];
    db.prepare('DELETE FROM tape_clips WHERE id = ?').run(c.id);
    remove(c.file);
    for (const f of files) remove(f.file);
    return { ok: true };
  });
  /** Takes yourself off a finished tape: your voice is taken out of it and its clips. */
  route('POST', '/api/tapes/:id/leave', async ({ user, params }) => {
    const { tape } = visibleTape(Number(params[0]), user.id);
    if (!isOn(tape.id, user.id)) return { ok: true };
    if (tape.state === 'taping') throw new HttpError(409, 'Use the button at the fire to come off a tape that is running.');
    await leaveTape(tape.id, user.id);
    return { tape: tapeJson(tapeOf(tape.id)!, user.id) };
  });

  const deleteTape = (tapeId: number) => {
    const tape = tapeOf(tapeId);
    if (!tape) return;
    const files = [
      tape.file,
      ...(db.prepare('SELECT file FROM tape_clips WHERE tape_id = ?').all(tapeId) as { file: string | null }[]).map((r) => r.file),
      ...(db.prepare('SELECT file FROM tape_audio WHERE tape_id = ?').all(tapeId) as { file: string }[]).map((r) => r.file),
    ];
    db.prepare('DELETE FROM tapes WHERE id = ?').run(tapeId);
    for (const key of parts.keys()) if (key.startsWith(`${tapeId}:`)) parts.delete(key);
    for (const f of files) remove(f);
  };

  // ---- overnight transcripts, one person's audio at a time
  const atNight = (d = new Date()) => {
    const h = d.getHours();
    return nightFrom <= nightTo ? h >= nightFrom && h < nightTo : h >= nightFrom || h < nightTo;
  };
  let transcribing = false;
  /** Transcribes the next piece waiting, if any; true when it did one. Runs only at night unless told otherwise. */
  const transcribeNext = async (anyTime = false) => {
    if (!options.whisperUrl || transcribing || (!anyTime && !atNight())) return false;
    const row = db.prepare(`SELECT a.id, a.file, a.transcribe_tries FROM tape_audio a JOIN tapes t ON t.id = a.tape_id
      WHERE a.transcript IS NULL AND t.state = 'ready' AND (a.clip_id IS NULL OR (SELECT state FROM tape_clips WHERE id = a.clip_id) = 'ready')
      ORDER BY a.transcribe_tries, a.id LIMIT 1`).get() as { id: number; file: string; transcribe_tries: number } | undefined;
    if (!row) return false;
    transcribing = true;
    const wav = `${row.file}.wav`;
    try {
      db.prepare('UPDATE tape_audio SET transcribe_tries = transcribe_tries + 1 WHERE id = ?').run(row.id);
      // whisper.cpp takes 16 kHz WAV.
      await runFfmpeg([...input(row.file, fileOf(row.file)), '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', '-f', 'wav', fileOf(wav)]);
      const form = new FormData();
      form.set('file', await openAsBlob(fileOf(wav), { type: 'audio/wav' }), 'audio.wav');
      form.set('response_format', 'verbose_json');
      form.set('temperature', '0');
      form.set('language', options.language || 'auto');
      const res = await fetch(`${options.whisperUrl.replace(/\/$/, '')}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(4 * 3600_000) });
      if (!res.ok) throw new Error(`whisper said ${res.status}`);
      const out = (await res.json()) as { text?: string; segments?: { start?: number; end?: number; text?: string }[] };
      const segments = Array.isArray(out.segments) ? out.segments : out.text ? [{ start: 0, end: 0, text: out.text }] : [];
      const lines = segments
        .map((s) => ({ s: Math.round(Number(s.start ?? 0) * 1000), e: Math.round(Number(s.end ?? 0) * 1000), t: String(s.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000) }))
        // whisper marks quiet stretches like [BLANK_AUDIO] or (wind blowing).
        .filter((s) => s.t && !/^[[(*♪].*[\])*♪]$/.test(s.t));
      if (db.prepare('SELECT 1 FROM tape_audio WHERE id = ?').get(row.id)) db.prepare('UPDATE tape_audio SET transcript = ? WHERE id = ?').run(JSON.stringify(lines), row.id);
      return true;
    } catch (err) {
      console.warn(`Couldn't transcribe tape audio ${row.id}: ${(err as Error).message}`);
      // Tried on three nights: it's left without words rather than tried forever.
      if (row.transcribe_tries + 1 >= 3) db.prepare("UPDATE tape_audio SET transcript = '[]' WHERE id = ?").run(row.id);
      return false;
    } finally {
      remove(wav);
      transcribing = false;
    }
  };
  const transcribeTimer = setInterval(async () => {
    // One after another while it's night and there's more waiting.
    while (await transcribeNext()) { /* next */ }
  }, 5 * 60_000);
  transcribeTimer.unref();

  // ---- clearing out
  /** Whole tapes past their days are cleared (their clips stay), and files nothing points to go. */
  const sweep = async () => {
    const old = db.prepare("SELECT id, file FROM tapes WHERE keep = 'all' AND state = 'ready' AND ended_at < ? AND (file IS NOT NULL OR EXISTS (SELECT 1 FROM tape_audio WHERE tape_id = tapes.id AND clip_id IS NULL))")
      .all(Date.now() - keepMs) as { id: number; file: string | null }[];
    for (const t of old) {
      remove(t.file);
      const audio = db.prepare('SELECT file FROM tape_audio WHERE tape_id = ? AND clip_id IS NULL').all(t.id) as { file: string }[];
      for (const a of audio) remove(a.file);
      db.prepare('DELETE FROM tape_audio WHERE tape_id = ? AND clip_id IS NULL').run(t.id);
      db.prepare('UPDATE tapes SET file = NULL WHERE id = ?').run(t.id);
    }
    // A tape whose fire was deleted takes its rows with it; its files are cleared here.
    const known = new Set([
      ...(db.prepare('SELECT file FROM tapes WHERE file IS NOT NULL UNION SELECT file FROM tape_clips WHERE file IS NOT NULL UNION SELECT file FROM tape_audio').all() as { file: string }[]).map((r) => r.file),
    ]);
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (known.has(name)) continue;
      const info = await stat(fileOf(name)).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 3600_000) remove(name);
    }
  };
  const sweepTimer = setInterval(() => void sweep().catch(() => {}), 3600_000);
  sweepTimer.unref();

  // Peiskos stopped while fires were taped: those tapes end where they got to.
  for (const t of db.prepare("SELECT id FROM tapes WHERE state IN ('taping', 'mixing')").all() as { id: number }[]) {
    db.prepare("UPDATE tapes SET state = 'mixing', ended_at = COALESCE(ended_at, ?) WHERE id = ?").run(Date.now(), t.id);
    for (const c of db.prepare("SELECT id FROM tape_clips WHERE tape_id = ? AND state = 'cutting'").all(t.id) as { id: number }[]) void cut(c.id);
    later(1000, () => void finish(t.id));
  }

  const stopAll = () => {
    clearInterval(transcribeTimer);
    clearInterval(sweepTimer);
    for (const t of timers) clearTimeout(t);
    for (const l of live.values()) if (l.timer) clearTimeout(l.timer);
  };
  /** Waits for clips being cut and tapes being mixed (for tests). */
  const settled = async () => {
    await new Promise((r) => setTimeout(r, 0));
    await Promise.all(clipsCutting.values());
    await jobs;
  };

  return { handle, handleRaw, joined, left, transcribeNext, sweep, stop: stopAll, settled, deleteTape };
}
