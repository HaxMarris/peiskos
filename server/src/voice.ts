import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface VoiceOptions {
  apiKey: string;
  apiSecret: string;
  /** Public LiveKit address for clients. Unset means "same host as Burrow", with Caddy routing to LiveKit. */
  url?: string;
  /** Where Burrow itself reaches LiveKit's API, to take people out of rooms. */
  apiUrl?: string;
}

const b64url = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

function sign(opts: VoiceOptions, claims: Record<string, unknown>, ttlSeconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const payload = b64url({ iss: opts.apiKey, nbf: now - 10, exp: now + ttlSeconds, ...claims });
  const sig = createHmac('sha256', opts.apiSecret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

/** What someone may send: everything, or (muted for everyone by a moderator) everything but their microphone. */
const sources = (canSpeak: boolean) => [...(canSpeak ? ['microphone'] : []), 'camera', 'screen_share', 'screen_share_audio'];

/**
 * A LiveKit access token (HS256 JWT) that lets one user join one voice room, with their mic, camera and screen.
 * It's only for joining (the app asks for a fresh one each time, and LiveKit renews it while they're in), so it
 * runs out soon: someone removed from a hearth can't use one they kept to sit back down.
 */
export function voiceToken(opts: VoiceOptions, user: { id: number; username: string }, room: string, ttlSeconds = 15 * 60, canSpeak = true) {
  return sign(
    opts,
    {
      sub: String(user.id),
      name: user.username,
      video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true, canPublishSources: sources(canSpeak) },
    },
    ttlSeconds,
  );
}

async function twirp(opts: VoiceOptions, method: string, grant: Record<string, unknown>, body: Record<string, unknown>) {
  const token = sign(opts, { video: grant }, 60);
  const res = await fetch(`${(opts.apiUrl ?? 'http://localhost:7880').replace(/\/$/, '')}/twirp/livekit.RoomService/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  // Someone who isn't in the room, or a room nobody is in, is already what we wanted.
  if (!res.ok && res.status !== 404) throw new Error(`LiveKit said ${res.status} to ${method}`);
  return res.ok ? ((await res.json().catch(() => ({}))) as Record<string, unknown>) : {};
}
const roomService = (opts: VoiceOptions, method: string, room: string, body: Record<string, unknown>) =>
  twirp(opts, method, { room, roomAdmin: true, roomCreate: true }, { room, ...body });

/** Disconnects someone from a voice room right away, for when they're removed or lose access. */
export const removeFromRoom = async (opts: VoiceOptions, room: string, identity: string) => {
  await roomService(opts, 'RemoveParticipant', room, { identity });
};

/** Who LiveKit itself has in a voice room right now, by identity (nobody, for a room that isn't open). */
export async function roomIdentities(opts: VoiceOptions, room: string) {
  const { participants } = await roomService(opts, 'ListParticipants', room, {});
  return (Array.isArray(participants) ? participants : [])
    .filter((p) => p?.state !== 'DISCONNECTED')
    .map((p) => String(p?.identity ?? ''))
    .filter(Boolean);
}

/** The voice rooms LiveKit has open right now, by name. */
export async function openRooms(opts: VoiceOptions) {
  const { rooms } = await twirp(opts, 'ListRooms', { roomList: true }, {});
  return (Array.isArray(rooms) ? rooms : []).map((r) => String(r?.name ?? '')).filter(Boolean);
}

/** Disconnects everyone from a voice room, for when the room or its burrow is deleted. */
export const closeRoom = async (opts: VoiceOptions, room: string) => {
  await roomService(opts, 'DeleteRoom', room, {});
};

/** Lets someone already in a room speak again, or stops their microphone being sent at all. */
export const setCanSpeak = async (opts: VoiceOptions, room: string, identity: string, canSpeak: boolean) => {
  await roomService(opts, 'UpdateParticipant', room, {
    identity,
    permission: { canSubscribe: true, canPublish: true, canPublishData: true, canPublishSources: sources(canSpeak).map((s) => s.toUpperCase()) },
  });
};

const sameBytes = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

/**
 * Checks that a webhook really came from our LiveKit, and returns what it says (or nothing).
 * LiveKit sends a JWT in the Authorization header, signed with the shared secret, that carries a
 * hash of the body: so nobody without the secret can make one up, or change one on its way.
 */
export function readWebhook(opts: VoiceOptions, authorization: string | undefined, body: Buffer): Record<string, any> | undefined {
  const [header, payload, sig, ...more] = (authorization ?? '').replace(/^Bearer /, '').split('.');
  if (!header || !payload || !sig || more.length) return;
  const expected = createHmac('sha256', opts.apiSecret).update(`${header}.${payload}`).digest();
  if (!sameBytes(expected, Buffer.from(sig, 'base64url'))) return;
  try {
    // Only the kind of token we checked: a "none" or public-key header means nothing here.
    if (JSON.parse(Buffer.from(header, 'base64url').toString()).alg !== 'HS256') return;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const now = Date.now() / 1000;
    if (claims.iss !== opts.apiKey || typeof claims.exp !== 'number' || claims.exp < now || (claims.nbf ?? 0) > now + 60) return;
    if (typeof claims.sha256 !== 'string' || !sameBytes(createHash('sha256').update(body).digest(), Buffer.from(claims.sha256, 'base64'))) return;
    const event = JSON.parse(body.toString('utf8'));
    return event && typeof event === 'object' ? event : undefined;
  } catch {
    return;
  }
}
