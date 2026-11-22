// Joint fires: one fire shared by two Peiskos servers, each run by its own group of friends.
//
// The host is the server the fire lives on. Someone there who can edit the hearth makes a code for
// one fire and gives it to the other group, whose server adds the fire to one of its hearths. When
// someone there sits down, their own server asks the host for a pass to the host's LiveKit room,
// and they talk to the host's people through it directly (still encrypted end to end).
//
// Who trusts whom:
// - The code is the only thing that lets another server in. The host keeps just its hash, can see
//   and close each one, and closing it takes that group's guests out of the fire straight away.
// - The host trusts the other server about who its own people are (that's the point: they don't
//   need accounts here). So a guest's name always shows with the label the host gave the code,
//   and guests get their own range of LiveKit identities, so they can never pass as someone here.
// - Guests get a pass for that one fire's room with a microphone only: no camera, no screen, no
//   chat, games, files or anything else on the host.
// - A server only ever calls the servers its admin listed (JOINT_FIRE_SERVERS), never an address
//   someone typed, so a code can't be used to make it fetch anything else.
// It's all off until a server's admin turns it on.
import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './db.ts';
import { HttpError, type Json } from './http.ts';
import { guestVoiceToken, removeFromRoom, type VoiceOptions } from './voice.ts';
import { withoutBidi, looksBlank } from './text.ts';
import type { Channel, User } from './app.ts';

export interface JointFireOptions {
  /** This server's hearths may open fires to guests from other servers (JOINT_FIRES=on). */
  host?: boolean;
  /** Other Peiskos servers whose fires this server's hearths may join, by address (JOINT_FIRE_SERVERS). */
  servers?: string[];
  /** How often joined fires ask their host who's there (tests make it quicker). */
  pollMs?: number;
}

/** Guests' LiveKit identities start here, far above any account's id, so the two never meet. */
export const GUEST_BASE = 1_000_000_000;
export const isGuestIdentity = (identity: string) => /^\d{10,15}$/.test(identity) && Number(identity) >= GUEST_BASE;

const MAX_LINKS_PER_FIRE = 5;
const MAX_JOINED_PER_HEARTH = 5;
const PASS_SECONDS = 10 * 60;
const hashOf = (secret: string) => createHash('sha256').update(secret).digest('hex');

/** An address from the admin's list, as an origin ("https://host"); plain http only for this machine. */
export function cleanOrigin(value: string) {
  try {
    const u = new URL(value.trim());
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
    if (u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** A name another server sent: plain text, one line, short. */
function cleanRemoteName(value: unknown) {
  const v = typeof value === 'string' ? withoutBidi(value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32) : '';
  return v && !looksBlank(v) ? v : 'Guest';
}

// A small allowance per text key (an address, a code), refilled over time.
function textAllowance(burst: number, perSecond: number) {
  const left = new Map<string, { n: number; at: number }>();
  const bucket = (key: string) => {
    const t = Date.now();
    if (left.size > 5000) left.clear(); // bounded: many addresses only reset everyone's count
    const b = left.get(key) ?? { n: burst, at: t };
    b.n = Math.min(burst, b.n + ((t - b.at) / 1000) * perSecond);
    b.at = t;
    left.set(key, b);
    return b;
  };
  return {
    /** Uses one, and says whether there was one to use. */
    take: (key: string) => {
      const b = bucket(key);
      if (b.n < 1) return false;
      b.n -= 1;
      return true;
    },
    /** Whether there's one left, without using it. */
    left: (key: string) => bucket(key).n >= 1,
  };
}

type Link = { id: number; channelId: number; label: string; closedAt: number | null };
type Guest = { id: number; linkId: number; remoteId: string; name: string; blocked: number };
type Person = { identity: string; name: string; from: string | null; remoteId?: string };
type Joined = { channelId: number; origin: string; secret: string; hostName: string };
type Route = (method: string, path: string, handler: (c: { user: User; params: string[]; body: Json; session?: string; ip: string }) => unknown, auth?: boolean) => void;

export interface JointContext {
  db: Db;
  opts: { voice?: VoiceOptions; publicUrl?: string; jointFires?: JointFireOptions };
  route: Route;
  allowed: (serverId: number, user: User, perm: 'burrow' | 'voice') => void;
  can: (serverId: number, userId: number, perm: 'burrow' | 'voice') => boolean;
  channelById: (id: number) => Channel | undefined;
  visibleRoom: (id: number, userId: number) => Channel;
  serverKind: (serverId: number) => string | undefined;
  usersInVoice: (channelId: number) => number[];
  nameIn: (serverId: number, userId: number) => string;
  hearthOnline: (serverId: number) => boolean;
  voiceChanged: (channelId: number) => void;
  sendServerUpdate: (serverId: number) => void;
  serverSummary: (serverId: number, userId: number) => unknown;
  matchFireSoon: (channelId: number, ms: number) => void;
  audit: (serverId: number, userId: number, action: string, targetId: number | null, detail?: string) => void;
  sendTo: (userIds: Iterable<number>, event: Json) => void;
  /** Clips at the fire (tapes.ts): what's going on at a fire, a guest's answer, and guests coming and going. */
  clipsAt: (channelId: number) => Json | null;
  clipsAnswer: (channelId: number, guestId: number, yes: boolean) => void;
  guestsMoved: (channelId: number, came: number[], went: number[]) => void;
}

export function jointFires(ctx: JointContext) {
  const { db, opts, route, allowed, can, channelById, visibleRoom, usersInVoice, nameIn, voiceChanged } = ctx;
  const servers = new Set((opts.jointFires?.servers ?? []).map(cleanOrigin).filter((o): o is string => !!o));
  const hosting = !!opts.jointFires?.host && !!opts.voice;
  const joining = servers.size > 0 && !!opts.voice;

  /** Where a guest's app reaches this server's LiveKit: LIVEKIT_URL if it's a full address, else this server. */
  const liveKitAddress = () => {
    const url = opts.voice?.url ?? opts.publicUrl;
    if (!url) return null;
    try {
      const u = new URL(url);
      return `${u.protocol === 'http:' || u.protocol === 'ws:' ? 'ws' : 'wss'}://${u.host}${u.pathname.replace(/\/$/, '')}`;
    } catch {
      return null;
    }
  };

  // ---- the host's side ----------------------------------------------------

  const linkCols = 'id, channel_id AS channelId, label, closed_at AS closedAt';
  const openLinkCount = (channelId: number) =>
    (db.prepare('SELECT COUNT(*) AS n FROM joint_links WHERE channel_id = ? AND closed_at IS NULL').get(channelId) as { n: number }).n;

  // Guests LiveKit has at each fire right now, checked against their codes (see guestsHere).
  const guestsAt = new Map<number, Map<string, { linkId: number; name: string; from: string; remoteId: string }>>();
  const guestCount = (channelId: number) => guestsAt.get(channelId)?.size ?? 0;

  const tellLiveKit = (room: string, identity: string) => {
    if (opts.voice) removeFromRoom(opts.voice, room, identity).catch((err) => console.warn(`Couldn't take a guest out of ${room}: ${err.message}`));
  };

  /**
   * LiveKit's list of a fire includes guests: keep the ones whose code is still open for this fire
   * and who weren't removed, and take anyone else with a guest identity out of the room.
   */
  const guestsHere = (channelId: number, identities: string[]) => {
    const before = guestsAt.get(channelId);
    const now = new Map<string, { linkId: number; name: string; from: string; remoteId: string }>();
    for (const identity of identities.filter(isGuestIdentity)) {
      const g = db
        .prepare(`SELECT g.link_id AS linkId, g.name, g.remote_id AS remoteId, g.blocked, l.label, l.channel_id AS channelId, l.closed_at AS closedAt
          FROM joint_guests g JOIN joint_links l ON l.id = g.link_id WHERE g.id = ?`)
        .get(Number(identity) - GUEST_BASE) as { linkId: number; name: string; remoteId: string; blocked: number; label: string; channelId: number; closedAt: number | null } | undefined;
      if (!hosting || !g || g.channelId !== channelId || g.closedAt !== null || g.blocked) {
        tellLiveKit(`room-${channelId}`, identity);
        continue;
      }
      now.set(identity, { linkId: g.linkId, name: g.name, from: g.label, remoteId: g.remoteId });
    }
    if (now.size) guestsAt.set(channelId, now);
    else guestsAt.delete(channelId);
    const came = [...now.keys()].filter((k) => !before?.has(k)).map(Number);
    const went = [...(before?.keys() ?? [])].filter((k) => !now.has(k)).map(Number);
    if (came.length || went.length) {
      voiceChanged(channelId);
      ctx.guestsMoved(channelId, came, went);
    }
  };

  const takeOut = (channelId: number, keep: (g: { linkId: number; remoteId: string }) => boolean) => {
    const here = guestsAt.get(channelId);
    if (!here) return;
    const went = [...here.keys()];
    for (const [identity, g] of here) {
      if (keep(g)) continue;
      here.delete(identity);
      tellLiveKit(`room-${channelId}`, identity);
    }
    if (!here.size) guestsAt.delete(channelId);
    voiceChanged(channelId);
    ctx.guestsMoved(channelId, [], went.filter((k) => !here.has(k)).map(Number));
  };

  /** The fire a code opens, for a request from another server; anything else gets the same answer. */
  const fireFor = (session: string | undefined, ip: string) => {
    if (!hosting) throw new HttpError(404, 'Not found');
    // A code can't be guessed (256 random bits), but wrong ones are still limited per address.
    if (!wrong.left(ip)) throw new HttpError(429, 'Too many tries. Wait a minute.');
    // session is the request's Authorization token, hashed the way logins are; it's the code's secret.
    const link = session ? (db.prepare(`SELECT ${linkCols} FROM joint_links WHERE secret_hash = ?`).get(session) as Link | undefined) : undefined;
    const channel = link && link.closedAt === null ? channelById(link.channelId) : undefined;
    if (!link || !channel || channel.kind !== 'voice') {
      wrong.take(ip);
      throw new HttpError(401, 'That joint fire is closed.');
    }
    if (!calls.take(String(link.id))) throw new HttpError(429, 'Too many requests. Wait a minute.');
    return { link, channel };
  };
  const wrong = textAllowance(20, 0.1);
  const calls = textAllowance(120, 2);
  const passes = textAllowance(10, 0.2);

  const hearthName = (serverId: number) =>
    (db.prepare('SELECT name FROM servers WHERE id = ?').get(serverId) as { name: string } | undefined)?.name ?? 'A hearth';

  /** Who's at a fire, as another server is told: names only, and which of them are its own people. */
  const roster = (channel: Channel, linkId: number | null): Person[] => [
    ...usersInVoice(channel.id).map((id) => ({ identity: String(id), name: nameIn(channel.serverId, id), from: null })),
    ...[...(guestsAt.get(channel.id) ?? [])].map(([identity, g]) => ({
      identity, name: g.name, from: g.from, ...(g.linkId === linkId ? { remoteId: g.remoteId } : {}),
    })),
  ];

  // Another server asks who's at the fire its code opens.
  route('GET', '/api/joint/fire', ({ session, ip }) => {
    const { link, channel } = fireFor(session, ip);
    return { fire: channel.name, hearth: hearthName(channel.serverId), label: link.label, people: roster(channel, link.id), clips: ctx.clipsAt(channel.id) };
  }, false);

  // A guest's server passes on their answer about clips at the fire.
  route('POST', '/api/joint/clips', ({ session, ip, body }) => {
    const { link, channel } = fireFor(session, ip);
    const remoteId = typeof body.id === 'string' ? body.id : '';
    const identity = [...(guestsAt.get(channel.id) ?? [])].find(([, g]) => g.linkId === link.id && g.remoteId === remoteId)?.[0];
    if (!identity) throw new HttpError(403, 'Sit down at the fire first.');
    ctx.clipsAnswer(channel.id, Number(identity), body.yes === true);
    return { clips: ctx.clipsAt(channel.id) };
  }, false);

  // Another server asks for a pass for one of its people.
  route('POST', '/api/joint/pass', ({ session, ip, body }) => {
    const { link, channel } = fireFor(session, ip);
    if (!passes.take(String(link.id))) throw new HttpError(429, 'Too many people sitting down at once. Try again in a minute.');
    const remoteId = typeof body.id === 'string' && /^[\w-]{1,64}$/.test(body.id) ? body.id : null;
    if (!remoteId) throw new HttpError(400, 'Who is sitting down?');
    const address = liveKitAddress();
    if (!address) throw new HttpError(503, "This server can't host joint fires until PUBLIC_URL is set.");
    const name = cleanRemoteName(body.name);
    db.prepare(`INSERT INTO joint_guests (link_id, remote_id, name, last_seen) VALUES (?, ?, ?, ?)
      ON CONFLICT (link_id, remote_id) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen`).run(link.id, remoteId, name, Date.now());
    const guest = db.prepare('SELECT id, blocked FROM joint_guests WHERE link_id = ? AND remote_id = ?').get(link.id, remoteId) as Guest;
    if (guest.blocked) throw new HttpError(403, 'You were removed from this fire.');
    const identity = String(GUEST_BASE + guest.id);
    const seated = usersInVoice(channel.id).length + guestCount(channel.id);
    if (channel.userLimit && seated >= channel.userLimit && !guestsAt.get(channel.id)?.has(identity))
      throw new HttpError(403, `This fire is full (${channel.userLimit} seats).`);
    // LiveKit tells us when they arrive; looking again shortly covers a server without its webhook.
    ctx.matchFireSoon(channel.id, 4000);
    return {
      url: address,
      token: guestVoiceToken(opts.voice!, identity, name, `room-${channel.id}`, PASS_SECONDS, body.muted !== true),
      identity,
      fire: channel.name,
      hearth: hearthName(channel.serverId),
    };
  }, false);

  // The other server took one of its people out (left the hearth, removed by a moderator there).
  route('POST', '/api/joint/leave', ({ session, ip, body }) => {
    const { link, channel } = fireFor(session, ip);
    const remoteId = typeof body.id === 'string' ? body.id : '';
    takeOut(channel.id, (g) => !(g.linkId === link.id && g.remoteId === remoteId));
    return { ok: true };
  }, false);

  // People here who can edit the hearth see and manage a fire's codes.
  const fireToShare = (id: number, user: User) => {
    if (!hosting) throw new HttpError(404, "This server doesn't host joint fires.");
    const channel = visibleRoom(id, user.id);
    if (channel.kind !== 'voice' || joinedFire(channel.id)) throw new HttpError(400, "Only this hearth's own fires can be shared.");
    if (ctx.serverKind(channel.serverId) !== 'burrow') throw new HttpError(400, 'Only fires in a hearth can be shared.');
    allowed(channel.serverId, user, 'burrow');
    return channel;
  };
  const linksOf = (channelId: number) =>
    (db.prepare('SELECT id, label, created_at AS createdAt FROM joint_links WHERE channel_id = ? AND closed_at IS NULL ORDER BY id').all(channelId) as { id: number; label: string; createdAt: number }[])
      .map((l) => ({ ...l, here: [...(guestsAt.get(channelId)?.values() ?? [])].filter((g) => g.linkId === l.id).length }));

  route('GET', '/api/channels/:id/joint', ({ user, params }) => ({ links: linksOf(fireToShare(Number(params[0]), user).id) }));

  route('POST', '/api/channels/:id/joint', ({ user, params, body }) => {
    const channel = fireToShare(Number(params[0]), user);
    if (!liveKitAddress()) throw new HttpError(503, "This server can't host joint fires until PUBLIC_URL is set.");
    const label = typeof body.label === 'string' ? withoutBidi(body.label).trim() : '';
    if (!label || looksBlank(label)) throw new HttpError(400, "Name the group you're inviting");
    if (label.length > 32) throw new HttpError(400, "The group's name must be at most 32 characters");
    if (openLinkCount(channel.id) >= MAX_LINKS_PER_FIRE) throw new HttpError(400, `A fire can be open to ${MAX_LINKS_PER_FIRE} groups at most. Close one first.`);
    const secret = randomBytes(32).toString('base64url');
    // Kept as the hash a login token is kept as, since that's what a request's token is looked up by.
    db.prepare('INSERT INTO joint_links (channel_id, label, secret_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(channel.id, label, hashOf(secret), user.id, Date.now());
    ctx.audit(channel.serverId, user.id, 'joint_open', null, `#${channel.name} › ${label}`);
    voiceChanged(channel.id);
    const base = opts.publicUrl!.replace(/\/$/, '');
    return { code: `${base}/joint#${secret}`, links: linksOf(channel.id) };
  });

  route('DELETE', '/api/joint/links/:id', ({ user, params }) => {
    const link = db.prepare(`SELECT ${linkCols} FROM joint_links WHERE id = ?`).get(Number(params[0])) as Link | undefined;
    if (!link || link.closedAt !== null) throw new HttpError(404, 'That joint fire is already closed.');
    const channel = fireToShare(link.channelId, user);
    db.prepare('UPDATE joint_links SET closed_at = ? WHERE id = ?').run(Date.now(), link.id);
    takeOut(channel.id, (g) => g.linkId !== link.id);
    ctx.audit(channel.serverId, user.id, 'joint_close', null, `#${channel.name} › ${link.label}`);
    return { links: linksOf(channel.id) };
  });

  // Someone who manages voice here takes a guest out, and they can't sit back down with that code.
  route('POST', '/api/channels/:id/guests/:id/remove', ({ user, params }) => {
    const channel = visibleRoom(Number(params[0]), user.id);
    const identity = params[1];
    const g = guestsAt.get(channel.id)?.get(identity);
    if (!g) throw new HttpError(404, "They aren't at this fire.");
    allowed(channel.serverId, user, 'voice');
    db.prepare('UPDATE joint_guests SET blocked = 1 WHERE id = ?').run(Number(identity) - GUEST_BASE);
    takeOut(channel.id, (x) => !(x.linkId === g.linkId && x.remoteId === g.remoteId));
    ctx.audit(channel.serverId, user.id, 'joint_remove', null, `${g.name} (${g.from}) from #${channel.name}`);
    return { ok: true };
  });

  // ---- the guests' side -----------------------------------------------------

  const joinedFire = (channelId: number) =>
    db.prepare('SELECT channel_id AS channelId, origin, secret, host_name AS hostName FROM joint_fires WHERE channel_id = ?').get(channelId) as Joined | undefined;

  /** A call to the host. Only ever to an address on the admin's list, and its answer is read with care. */
  const askHost = async (fire: { origin: string; secret: string }, method: 'GET' | 'POST', path: string, body?: Json) => {
    if (!servers.has(fire.origin)) throw new HttpError(403, "This server isn't set up to join fires there any more.");
    let res: Response;
    try {
      res = await fetch(`${fire.origin}${path}`, {
        method,
        headers: { authorization: `Bearer ${fire.secret}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(6000),
      });
    } catch {
      throw new HttpError(502, `Couldn't reach ${new URL(fire.origin).host}. Try again later.`);
    }
    const text = await readCapped(res, 64 * 1024);
    let data: Json = {};
    try { data = JSON.parse(text ?? '') ?? {}; } catch { /* not JSON: handled below */ }
    if (res.ok && text !== null && data && typeof data === 'object') return data;
    if (res.status === 401) throw new HttpError(410, 'The other group closed this joint fire.');
    // Their own plain answer (full, removed) is worth passing on; it's shown as text, never as markup.
    if (res.status === 403 || res.status === 429) throw new HttpError(403, typeof data.error === 'string' ? data.error.slice(0, 120) : 'The other server said no.');
    throw new HttpError(502, `Couldn't reach ${new URL(fire.origin).host}. Try again later.`);
  };

  // What the host last said about each joined fire, so the sidebar can show who's there.
  const remote = new Map<number, { people: Person[]; ok: boolean; hearth?: string; clips?: Json | null; at: number }>();
  const pollMs = opts.jointFires?.pollMs ?? 15_000;
  const asking = new Set<number>(); // joined fires whose host is being asked right now
  const pollRemote = async (fire: Joined) => {
    if (asking.has(fire.channelId)) return;
    asking.add(fire.channelId);
    try { await askRoster(fire); } finally { asking.delete(fire.channelId); }
  };
  const askRoster = async (fire: Joined) => {
    const { at: _, clips: wasClips, ...was } = remote.get(fire.channelId) ?? { at: 0 };
    const before = JSON.stringify(was);
    try {
      const data = await askHost(fire, 'GET', '/api/joint/fire');
      const people = (Array.isArray(data.people) ? data.people : []).slice(0, 100).flatMap((p: any): Person[] =>
        p && typeof p.identity === 'string' && /^\d{1,15}$/.test(p.identity)
          ? [{ identity: p.identity, name: cleanRemoteName(p.name), from: p.from == null ? null : cleanRemoteName(p.from), ...(typeof p.remoteId === 'string' ? { remoteId: p.remoteId } : {}) }]
          : []);
      remote.set(fire.channelId, { people, ok: true, hearth: cleanRemoteName(data.hearth), clips: hostClips(data.clips, people), at: Date.now() });
    } catch {
      remote.set(fire.channelId, { people: [], ok: false, at: Date.now() });
    }
    const { at: __, clips, ...now } = remote.get(fire.channelId)!;
    if (JSON.stringify(now) !== before) voiceChanged(fire.channelId);
    if (clipsKey(clips) !== clipsKey(wasClips)) tellClips(fire.channelId);
    // While the host is asking everyone, its answer is looked for sooner than the usual poll.
    if ((clips as { phase?: string } | null | undefined)?.phase === 'asking' && usersInVoice(fire.channelId).length)
      setTimeout(() => { pollRemote(fire).catch(() => {}); }, 3000).unref();
  };

  /**
   * Clips at the host's fire, as people here see them: everyone's ids as this server knows them
   * (ours by their own id, the host's people below zero), and marked as another server's, so
   * nobody's app here records anything for it.
   */
  const hostClips = (raw: unknown, people: Person[]): Json | null => {
    if (!raw || typeof raw !== 'object') return null;
    const c = raw as Record<string, unknown>;
    if (c.phase !== 'asking' && c.phase !== 'taping') return null;
    const idOf = (v: unknown) => {
      const identity = String(v);
      if (!/^\d{1,15}$/.test(identity)) return null;
      const p = people.find((x) => x.identity === identity);
      return p?.remoteId !== undefined && /^\d{1,15}$/.test(p.remoteId) ? Number(p.remoteId) : -Number(identity);
    };
    const ids = (v: unknown) => (Array.isArray(v) ? v.slice(0, 100).map(idOf).filter((x): x is number => x !== null) : []);
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const shift = c.now ? Date.now() - num(c.now) : 0;
    return {
      phase: c.phase, id: null, by: idOf(c.by), yes: ids(c.yes), agreed: ids(c.agreed), no: ids(c.no), remote: true,
      // The host's times, moved onto this server's clock (its "now" is filled in when it's sent).
      startedAt: num(c.startedAt) + shift, endsAt: num(c.endsAt) + shift, clips: Math.max(0, Math.min(1000, Math.floor(num(c.clips)))),
    };
  };
  // What changed, leaving out the times (which move a little with each answer from the host).
  const clipsKey = (clips: Json | null | undefined) => {
    if (!clips) return 'null';
    const { startedAt: _, endsAt: __, ...rest } = clips as Record<string, unknown>;
    return JSON.stringify(rest);
  };
  const clipsEvent = (channelId: number) => {
    const clips = remote.get(channelId)?.clips;
    return { type: 'tape_state', channelId, tape: clips ? { ...(clips as object), now: Date.now() } : null };
  };
  const tellClips = (channelId: number) => ctx.sendTo(usersInVoice(channelId), clipsEvent(channelId));
  /** Someone here sat down at a joined fire: they see whether clips are on there. */
  const clipsJoined = (channelId: number, userId: number) => {
    if (remote.get(channelId)?.clips) ctx.sendTo([userId], clipsEvent(channelId));
  };
  /** Someone here answers about clips at the host's fire; only the host can turn them on or off. */
  const clipsHere = async (user: User, channelId: number, msg: Json) => {
    const fire = joinedFire(channelId);
    if (!fire) return false;
    if (msg.action !== 'answer') throw new HttpError(400, "Clips at this fire are turned on by the group it belongs to.");
    const data = await askHost(fire, 'POST', '/api/joint/clips', { id: String(user.id), yes: msg.yes === true });
    const r = remote.get(channelId);
    if (r) {
      r.clips = hostClips(data.clips, r.people);
      tellClips(channelId);
    }
    return true;
  };
  const pollAll = async () => {
    if (!joining) return;
    const fires = db.prepare(`SELECT f.channel_id AS channelId, f.origin, f.secret, f.host_name AS hostName, c.server_id AS serverId
      FROM joint_fires f JOIN channels c ON c.id = f.channel_id`).all() as (Joined & { serverId: number })[];
    // Only while someone in that hearth has Peiskos open: nobody's looking otherwise.
    await Promise.all(fires.filter((f) => ctx.hearthOnline(f.serverId) || usersInVoice(f.channelId).length).map(pollRemote));
  };
  const pollTimer = setInterval(() => { pollAll().catch(() => {}); }, pollMs);
  pollTimer.unref();

  /** Someone here sits down at a joined fire: their pass comes from the host. */
  const jointPass = async (channel: Channel, user: User, canSpeak: boolean) => {
    const fire = joinedFire(channel.id);
    if (!fire) return null;
    if (!joining) throw new HttpError(403, "This server isn't set up to join fires on other servers any more.");
    const data = await askHost(fire, 'POST', '/api/joint/pass', { id: String(user.id), name: nameIn(channel.serverId, user.id), muted: !canSpeak });
    if (typeof data.token !== 'string' || typeof data.url !== 'string' || !/^wss?:\/\//.test(data.url) || typeof data.identity !== 'string' || !isGuestIdentity(data.identity))
      throw new HttpError(502, "The other server's answer didn't make sense.");
    // The host's own name for the fire, kept fresh for the sidebar.
    const hostName = `${cleanRemoteName(data.hearth)} · ${cleanRemoteName(data.fire)}`;
    if (hostName !== fire.hostName) {
      db.prepare('UPDATE joint_fires SET host_name = ? WHERE channel_id = ?').run(hostName, channel.id);
      ctx.sendServerUpdate(channel.serverId);
    }
    setTimeout(() => { pollRemote(fire).catch(() => {}); }, 3000).unref();
    return { url: data.url, token: data.token, canSpeak, joint: { identity: data.identity } };
  };

  /** Someone here was taken out of a joined fire: the host is asked to take them out of its room too. */
  const jointKick = (userId: number, channelId: number) => {
    const fire = joinedFire(channelId);
    if (fire) askHost(fire, 'POST', '/api/joint/leave', { id: String(userId) }).catch(() => {});
  };

  // Someone who can edit a hearth adds another group's fire to it with the code they were given.
  route('POST', '/api/servers/:id/joint-fires', async ({ user, params, body }) => {
    const serverId = Number(params[0]);
    if (!joining) throw new HttpError(404, "This server isn't set up to join fires on other servers.");
    allowed(serverId, user, 'burrow');
    if (ctx.serverKind(serverId) !== 'burrow') throw new HttpError(400, 'Joint fires go in a hearth.');
    let origin: string | null = null;
    let secret = '';
    try {
      const u = new URL(String(body.code ?? '').trim());
      origin = cleanOrigin(u.origin);
      secret = u.hash.slice(1);
    } catch { /* checked below */ }
    if (!origin || !/^[\w-]{40,64}$/.test(secret)) throw new HttpError(400, "That doesn't look like a joint fire code.");
    if (!servers.has(origin)) throw new HttpError(403, `This server isn't set up to join fires on ${new URL(origin).host}. Its admin can add it to JOINT_FIRE_SERVERS.`);
    const count = (db.prepare('SELECT COUNT(*) AS n FROM joint_fires f JOIN channels c ON c.id = f.channel_id WHERE c.server_id = ?').get(serverId) as { n: number }).n;
    if (count >= MAX_JOINED_PER_HEARTH) throw new HttpError(400, `A hearth can have ${MAX_JOINED_PER_HEARTH} joint fires at most.`);
    if (db.prepare('SELECT 1 FROM joint_fires f JOIN channels c ON c.id = f.channel_id WHERE c.server_id = ? AND f.origin = ? AND f.secret = ?').get(serverId, origin, secret))
      throw new HttpError(400, 'This hearth already has that fire.');
    const data = await askHost({ origin, secret }, 'GET', '/api/joint/fire');
    const hostName = `${cleanRemoteName(data.hearth)} · ${cleanRemoteName(data.fire)}`;
    const name = (typeof body.name === 'string' && body.name.trim() ? withoutBidi(body.name).trim() : cleanRemoteName(data.fire)).slice(0, 32);
    const last = (db.prepare("SELECT MAX(COALESCE(position, id)) AS p FROM channels WHERE server_id = ? AND kind != 'thread'").get(serverId) as { p: number | null }).p;
    const r = db.prepare("INSERT INTO channels (server_id, name, kind, private, created_at, position) VALUES (?, ?, 'voice', 0, ?, ?)").run(serverId, name, Date.now(), (last ?? 0) + 1);
    const channelId = Number(r.lastInsertRowid);
    db.prepare('INSERT INTO joint_fires (channel_id, origin, secret, host_name, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(channelId, origin, secret, hostName, user.id, Date.now());
    ctx.audit(serverId, user.id, 'joint_join', null, `#${name} on ${new URL(origin).host}`);
    ctx.sendServerUpdate(serverId);
    pollRemote({ channelId, origin, secret, hostName }).catch(() => {});
    return ctx.serverSummary(serverId, user.id);
  });

  /**
   * What a fire's summary adds: on the host, the guests sitting there (and whether it's open to
   * other groups); on a joined fire, the host and the people there from other servers. People from
   * elsewhere get ids below zero here, so they never collide with anyone's account on this server.
   */
  const voiceExtra = (channelId: number): { ids: number[]; info: Json } | null => {
    const fire = joining || hosting ? joinedFire(channelId) : undefined;
    if (fire) {
      const r = remote.get(channelId);
      // Someone is opening the hearth and the last answer is a few seconds old: ask now, and
      // everyone hears when it answers (a quiet hearth isn't asked at all, see pollAll).
      if (!r || Date.now() - r.at > Math.min(5000, pollMs)) pollRemote(fire).catch(() => {});
      // Our own people at the host's fire are already seated here (their app said so); the host
      // just says which of its guests they are.
      const people = (r?.people ?? []).map((p) =>
        p.remoteId !== undefined && /^\d{1,15}$/.test(p.remoteId)
          ? { identity: p.identity, id: Number(p.remoteId), own: true }
          : { identity: p.identity, id: -Number(p.identity), name: p.name, from: p.from ?? r?.hearth ?? null });
      return {
        ids: people.filter((p) => !('own' in p)).map((p) => p.id),
        info: { role: 'guest', host: fire.hostName, address: new URL(fire.origin).host, reachable: r?.ok ?? true, people },
      };
    }
    if (!hosting) return null;
    const here = guestsAt.get(channelId);
    const open = openLinkCount(channelId) > 0;
    if (!here && !open) return null;
    const people = [...(here ?? [])].map(([identity, g]) => ({ identity, id: Number(identity), name: g.name, from: g.from }));
    return { ids: people.map((p) => p.id), info: { role: 'host', open, people } };
  };

  return {
    guestsHere, guestCount, jointPass, jointKick, voiceExtra, pollTimer, clipsJoined, clipsHere,
    guestIds: (channelId: number) => [...(guestsAt.get(channelId)?.keys() ?? [])].map(Number),
    guestName: (channelId: number, id: number) => guestsAt.get(channelId)?.get(String(id))?.name ?? 'A guest',
    config: { host: hosting && !!liveKitAddress(), join: joining },
  };
}

/** A response body up to `max` bytes, or null if it's bigger (a server sending far too much). */
async function readCapped(res: Response, max: number) {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
