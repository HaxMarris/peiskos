// Meet-up: on the way to an event with a meeting place, the people going can share where they are,
// and everyone going sees how far off each of them is, in which direction, and about how long until
// they get there.
//
// Locations are kept in memory only, never in the database, and only while it's near the event:
// from MEETUP_BEFORE_MS before it starts until MEETUP_AFTER_MS after. Others never get anyone's
// coordinates, only a distance and a direction from the meeting place. The apps send updates only
// while they're open on screen, so a share that stops updating is dropped after MEETUP_STALE_MS.
import type { Db } from './db.ts';
import { HttpError, type Json } from './http.ts';
import type { Handler, User } from './app.ts';

export const MEETUP_BEFORE_MS = 2 * 3600_000;
export const MEETUP_AFTER_MS = 3 * 3600_000;
export const MEETUP_STALE_MS = 15 * 60_000;
/** Closer than this to the meeting place counts as there. */
export const MEETUP_HERE_M = 100;
/** Updates closer together than this are ignored: the apps send one about every 15 seconds. */
const MIN_GAP_MS = 4_000;
/** How far back the ETA looks to see how fast someone is closing in. */
const TRACK_MS = 5 * 60_000;

export interface MeetupContext {
  db: Db;
  isMember: (serverId: number, userId: number) => boolean;
  now: () => number;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => unknown;
  sendTo: (userIds: Iterable<number>, event: Json) => void;
}

type Share = {
  at: number;
  distance: number;
  bearing: number;
  accuracy: number;
  here: boolean;
  /** Distance to the meeting place over the last few minutes, for the ETA. */
  track: { t: number; d: number }[];
};

type MeetEvent = { id: number; serverId: number; startsAt: number; placeLat: number | null; placeLng: number | null };

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Metres between two points, and the compass direction from the first to the second. */
const FAR_M = 2000;

export function distanceAndBearing(lat1: number, lng1: number, lat2: number, lng2: number) {
  const φ1 = toRad(lat1), φ2 = toRad(lat2), Δφ = toRad(lat2 - lat1), Δλ = toRad(lng2 - lng1);
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const distance = 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)));
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return { distance, bearing: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 };
}

/** Seconds until they get there, from how fast they've been closing in; null when they aren't. */
export function etaSeconds(track: { t: number; d: number }[]) {
  if (track.length < 2) return null;
  const first = track[0], last = track[track.length - 1];
  const span = (last.t - first.t) / 1000;
  if (span < 30) return null;
  const speed = (first.d - last.d) / span; // metres a second, toward the place
  if (speed < 0.4) return null; // slower than a stroll, or going the other way
  const eta = last.d / speed;
  return eta > 6 * 3600 ? null : Math.round(eta);
}

export function meetup(ctx: MeetupContext) {
  const { db, isMember, now, route, sendTo } = ctx;
  const shares = new Map<number, Map<number, Share>>(); // event id -> user id -> where they are

  const eventById = (id: number) =>
    db
      .prepare('SELECT id, server_id AS serverId, starts_at AS startsAt, place_lat AS placeLat, place_lng AS placeLng FROM events WHERE id = ?')
      .get(id) as MeetEvent | undefined;
  const isOpen = (e: MeetEvent) => e.placeLat !== null && now() >= e.startsAt - MEETUP_BEFORE_MS && now() < e.startsAt + MEETUP_AFTER_MS;
  /** People who said going or maybe: the only ones who share and see. */
  const goingIds = (eventId: number) =>
    new Set(
      (db.prepare("SELECT user_id AS id FROM event_rsvps WHERE event_id = ? AND status IN ('going', 'maybe')").all(eventId) as { id: number }[]).map(
        (r) => r.id,
      ),
    );

  const peopleOf = (eventId: number) =>
    [...(shares.get(eventId) ?? [])].map(([userId, s]) => ({
      userId,
      here: s.here,
      at: s.at,
      // Rounded: enough to find each other, no more. Further than 2 km away, more roughly still,
      // since a close distance and direction from a known place come near to saying where you are.
      distance: s.here ? 0 : s.distance > FAR_M ? Math.round(s.distance / 500) * 500 : Math.round(s.distance / 10) * 10,
      bearing: s.here ? 0 : s.distance > FAR_M ? Math.round(s.bearing / 45) * 45 % 360 : Math.round(s.bearing / 5) * 5 % 360,
      accuracy: Math.round(s.accuracy),
      eta: s.here ? null : etaSeconds(s.track),
    }));
  const send = (eventId: number) => {
    const ids = goingIds(eventId);
    sendTo(ids, { type: 'meetup', eventId, people: peopleOf(eventId) });
  };

  /** Drops what shouldn't be kept any more for this event: gone, over, stale, or not going. */
  const tidy = (eventId: number) => {
    const list = shares.get(eventId);
    if (!list) return false;
    const e = eventById(eventId);
    if (!e || !isOpen(e)) {
      shares.delete(eventId);
      return true;
    }
    const going = goingIds(eventId);
    let changed = false;
    for (const [userId, s] of list)
      if (!going.has(userId) || !isMember(e.serverId, userId) || (!s.here && now() - s.at > MEETUP_STALE_MS)) {
        list.delete(userId);
        changed = true;
      }
    if (!list.size) shares.delete(eventId);
    return changed;
  };
  const changed = (eventId: number) => {
    // An event that's gone or over has no one left to tell, and its people were told by the hearth update.
    const had = shares.has(eventId);
    if (tidy(eventId) || had) send(eventId);
  };
  const sweep = () => {
    for (const eventId of [...shares.keys()]) if (tidy(eventId)) send(eventId);
  };
  const sweeper = setInterval(sweep, 60_000);
  sweeper.unref();

  /** The event, if you can take part in its meet-up now. */
  const openFor = (eventId: number, user: User) => {
    const e = eventById(eventId);
    if (!e || !isMember(e.serverId, user.id)) throw new HttpError(404, 'That event is gone. It may have been cancelled.');
    if (e.placeLat === null) throw new HttpError(400, 'This event has no meeting place.');
    if (!goingIds(e.id).has(user.id)) throw new HttpError(403, "Say you're going first.");
    return e;
  };

  route('GET', '/api/events/:id/meetup', ({ user, params }) => {
    const e = openFor(Number(params[0]), user);
    tidy(e.id);
    return { eventId: e.id, open: isOpen(e), people: peopleOf(e.id) };
  });

  // Where you are now, from the app while it's open. `here: true` says you've arrived yourself.
  route('POST', '/api/events/:id/location', ({ user, params, body }) => {
    const e = openFor(Number(params[0]), user);
    if (!isOpen(e)) throw new HttpError(400, 'Sharing opens 2 hours before the start, and turns off 3 hours after.');
    let list = shares.get(e.id);
    const prev = list?.get(user.id);
    const t = now();
    if (body.here === true) {
      const s = prev ?? { at: t, distance: 0, bearing: 0, accuracy: 0, here: true, track: [] };
      Object.assign(s, { at: t, here: true, track: [] });
      if (!list) shares.set(e.id, (list = new Map()));
      list.set(user.id, s);
      send(e.id);
      return { here: true };
    }
    const lat = Number(body.lat), lng = Number(body.lng);
    if (!(Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180))
      throw new HttpError(400, 'That location could not be read.');
    const accuracy = Math.min(Math.max(Number(body.accuracy) || 0, 0), 100_000);
    if (prev?.here) return { here: true };
    if (prev && t - prev.at < MIN_GAP_MS) return { here: false };
    const { distance, bearing } = distanceAndBearing(e.placeLat!, e.placeLng!, lat, lng);
    // A rough fix can't say much, so within its own radius counts as here too (up to 250 m).
    const here = distance <= MEETUP_HERE_M || distance <= Math.min(accuracy, 250);
    const track = [...(prev?.track ?? []).filter((p) => p.t > t - TRACK_MS), { t, d: distance }];
    if (!list) shares.set(e.id, (list = new Map()));
    list.set(user.id, { at: t, distance, bearing, accuracy, here, track: here ? [] : track });
    send(e.id);
    return { here };
  });

  route('DELETE', '/api/events/:id/location', ({ user, params }) => {
    const eventId = Number(params[0]);
    const e = eventById(eventId);
    if (!e || !isMember(e.serverId, user.id)) throw new HttpError(404, 'That event is gone. It may have been cancelled.');
    const list = shares.get(eventId);
    if (list?.delete(user.id)) {
      if (!list.size) shares.delete(eventId);
      send(eventId);
    }
    return { ok: true };
  });

  return {
    meetupChanged: changed,
    sweepMeetups: sweep,
    stopMeetups: () => clearInterval(sweeper),
  };
}
