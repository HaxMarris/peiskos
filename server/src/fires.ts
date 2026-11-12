// Fires and LiveKit: keeping who Peiskos shows at a fire and who LiveKit really has in the room
// the same. People who lose access are taken out of LiveKit, and LiveKit's own list (told by a
// signed webhook, and checked every minute) seats people whose app never said they sat down.
// voice.ts is what talks to LiveKit; app.ts keeps the seats themselves (setVoice).
import type { Db } from './db.ts';
import { HttpError, readLimited, send } from './http.ts';
import { closeRoom, openRooms, readWebhook, removeFromRoom, roomIdentities, type VoiceOptions } from './voice.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebSocket } from 'ws';
import type { AppOptions, Channel, User } from './app.ts';

export interface FiresContext {
  opts: AppOptions;
  canSee: (channel: Channel, userId: number) => boolean;
  channelById: (id: number) => Channel | undefined;
  checkSeat: (channel: Channel, userId: number) => void;
  db: Db;
  inVoice: Map<number, number>;
  setVoice: (userId: number, channelId: number | null, flags?: { muted: boolean; deafened: boolean; }) => void;
  userById: (id: number) => User | undefined;
  usersInVoice: (channelId: number) => number[];
  voiceSockets: Map<number, WebSocket>;
}

export function firesInLiveKit(ctx: FiresContext) {
  const {
    opts, canSee, channelById, checkSeat, db, inVoice, setVoice, userById, usersInVoice, voiceSockets,
  } = ctx;

  // LiveKit only checks who may join when they join, so people who lose access are disconnected
  // there too. (The key keeper also stops handing them voice keys; see the app.)
  const tellLiveKit = (what: string, call: (voice: VoiceOptions) => Promise<void>) => {
    if (opts.voice) call(opts.voice).catch((err) => console.warn(`Couldn't ${what}: ${err.message}`));
  };
  // The fire each person last got a LiveKit pass for. An app could join LiveKit without saying so
  // here, so moderation reaches that fire too, not only the one they announced.
  const voiceTokens = new Map<number, { channelId: number; at: number }>();
  /** The fire someone is at, or may be at in LiveKit without having said so (a pass from the last day). */
  const liveFire = (userId: number) => {
    const said = inVoice.get(userId);
    if (said !== undefined) return said;
    const t = voiceTokens.get(userId);
    if (t && Date.now() - t.at < 24 * 3600_000) return t.channelId;
    voiceTokens.delete(userId);
    return undefined;
  };
  /** Takes someone out of a voice room: off the room's list, and disconnected from LiveKit. */
  const kickFromVoice = (userId: number, channelId = inVoice.get(userId)) => {
    if (channelId === undefined) return;
    if (inVoice.get(userId) === channelId) setVoice(userId, null);
    tellLiveKit(`take user ${userId} out of room-${channelId}`, (v) => removeFromRoom(v, `room-${channelId}`, String(userId)));
  };
  const closeVoiceRoom = (channelId: number) => {
    for (const [u, c] of inVoice) if (c === channelId) setVoice(u, null);
    tellLiveKit(`close room-${channelId}`, (v) => closeRoom(v, `room-${channelId}`));
  };
  const voiceRoomIds = (serverId: number) =>
    (db.prepare("SELECT id FROM channels WHERE server_id = ? AND kind = 'voice'").all(serverId) as { id: number }[]).map((r) => r.id);

  // ---- what LiveKit itself says -------------------------------------------
  // The app says when it sits down and gets up, but LiveKit is where people really are: an app
  // can join there without saying so, or drop its connection here and stay. So LiveKit tells
  // Peiskos when someone comes or goes (a signed webhook, below), and Peiskos then matches the
  // fire against LiveKit's own list. The webhook is only ever a nudge to look; what's acted on is
  // the list, so one that's late, repeated or replayed does no harm.
  const seatedByApp = (userId: number) => voiceSockets.get(userId)?.readyState === WebSocket.OPEN;
  const FIRE_SECOND_LOOK_MS = 10_000;
  const fireChecks = new Map<number, Promise<void>>(); // one look at a fire at a time, in order
  const fireWaiting = new Map<string, Promise<void>>(); // the look at a fire that's queued and hasn't started
  const fireTimers = new Set<NodeJS.Timeout>();
  let liveKitQuiet = false; // said once that LiveKit can't be reached, until it can again
  const matchFire = async (channelId: number, secondLook = false) => {
    const channel = channelById(channelId);
    if (!opts.voice || channel?.kind !== 'voice') return;
    const identities = await roomIdentities(opts.voice, `room-${channelId}`);
    const there = new Set(identities.map(Number));
    liveKitQuiet = false;
    // The room may have been deleted while LiveKit answered (deleting it closes it there too).
    if (!channelById(channelId)) return;
    for (const identity of identities) {
      const userId = Number(identity);
      if (inVoice.get(userId) === channelId) continue;
      // Lost their place in the hearth after getting a pass: out of LiveKit too.
      if (!Number.isInteger(userId) || !userById(userId) || !canSee(channel, userId)) {
        tellLiveKit(`take ${identity.replace(/[^\w-]/g, "").slice(0, 40)} out of room-${channelId}`, (v) => removeFromRoom(v, `room-${channelId}`, identity));
        continue;
      }
      // A pass taken while there was room doesn't hold a seat: the fire filled up since, so they're
      // out of LiveKit again, the same as the app is told when it asks to sit down.
      try {
        checkSeat(channel, userId);
      } catch {
        tellLiveKit(`take user ${userId} out of the full room-${channelId}`, (v) => removeFromRoom(v, `room-${channelId}`, identity));
        continue;
      }
      const other = inVoice.get(userId);
      if (other !== undefined) {
        // They're down as being at another fire. Changing fires or devices looks like this for a
        // moment, so look once more shortly. Still in both by then, the newer fire is theirs: one
        // person sits at one fire, so they're taken out of the other.
        if (!secondLook) { matchFireSoon(channelId, FIRE_SECOND_LOOK_MS, true); continue; }
        if (seatedByApp(userId)) voiceSockets.get(userId)!.send(JSON.stringify({ type: 'voice_elsewhere', channelId }));
        voiceSockets.delete(userId);
        tellLiveKit(`take user ${userId} out of room-${other}`, (v) => removeFromRoom(v, `room-${other}`, String(userId)));
      }
      setVoice(userId, channelId);
    }
    // Only people Peiskos seated from LiveKit's word are taken away on it; an app that said it
    // sat down says when it gets up (and may be reconnecting to LiveKit right now).
    for (const userId of usersInVoice(channelId)) if (!there.has(userId) && !seatedByApp(userId)) setVoice(userId, null);
  };
  const checkFire = (channelId: number, secondLook = false) => {
    // A look that hasn't started yet will see whatever is true by then, so one waiting is enough
    // however many webhooks come in meanwhile.
    const key = `${channelId}:${secondLook}`;
    const waiting = fireWaiting.get(key);
    if (waiting) return waiting;
    const check = (fireChecks.get(channelId) ?? Promise.resolve())
      .then(() => {
        fireWaiting.delete(key);
        return matchFire(channelId, secondLook);
      })
      .catch((err) => {
        if (!liveKitQuiet) console.warn(`Couldn't ask LiveKit who is in room-${channelId}: ${err.message}`);
        liveKitQuiet = true;
      })
      .finally(() => { if (fireChecks.get(channelId) === check) fireChecks.delete(channelId); });
    fireChecks.set(channelId, check);
    fireWaiting.set(key, check);
    return check;
  };
  function matchFireSoon(channelId: number, ms: number, secondLook = false) {
    const timer = setTimeout(() => {
      fireTimers.delete(timer);
      checkFire(channelId, secondLook);
    }, ms);
    timer.unref();
    fireTimers.add(timer);
  }
  // A webhook can be lost (Peiskos was restarting when LiveKit sent it), so every minute the fires
  // LiveKit has open, and the ones with someone seated on LiveKit's word, are matched again.
  const sweepFires = async () => {
    if (!opts.voice) return;
    const ids = new Set<number>();
    for (const [userId, channelId] of inVoice) if (!seatedByApp(userId)) ids.add(channelId);
    try {
      for (const name of await openRooms(opts.voice)) if (/^room-\d+$/.test(name)) ids.add(Number(name.slice(5)));
      liveKitQuiet = false;
    } catch (err) {
      if (!liveKitQuiet) console.warn(`Couldn't ask LiveKit which rooms are open: ${(err as Error).message}`);
      liveKitQuiet = true;
      return;
    }
    await Promise.all([...ids].map((id) => checkFire(id)));
  };
  const fireSweepTimer = setInterval(sweepFires, 60_000);
  fireSweepTimer.unref();
  const LIVEKIT_EVENTS = new Set(['room_started', 'room_finished', 'participant_joined', 'participant_left', 'participant_connection_aborted']);
  const handleLiveKitWebhook = async (req: IncomingMessage, res: ServerResponse) => {
    if (!opts.voice) throw new HttpError(404, 'Not found');
    const raw = await readLimited(req, 64 * 1024, new HttpError(413, "That's too much to send at once"));
    const event = readWebhook(opts.voice, req.headers.authorization, raw);
    if (!event) throw new HttpError(401, "That didn't come from this server's LiveKit");
    const room = typeof event.room?.name === 'string' ? event.room.name.match(/^room-(\d+)$/) : null;
    // Answered straight away: LiveKit sends the next one only once this one is taken.
    if (room && LIVEKIT_EVENTS.has(event.event)) checkFire(Number(room[1]));
    send(res, 200, { ok: true });
  };

  return {
    voiceTokens, voiceRoomIds, kickFromVoice, closeVoiceRoom, liveFire, tellLiveKit, handleLiveKitWebhook,
    matchFireSoon, sweepFires, checkFire, fireSweepTimer, fireTimers,
  };
}
