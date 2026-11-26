import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import { distanceAndBearing, etaSeconds } from '../src/meetup.ts';
import { caller, listening } from './helpers.ts';

const db = openDb(':memory:');
const app = createApp({ db, publicDir: '/nonexistent' });
let base = '';
listening(app, (url) => (base = url));
const call = caller(() => base);

let n = 0;
async function people(...names: string[]) {
  const out: any[] = [];
  for (const name of names) out.push((await call('/api/register', { body: { username: `${name}${++n}`, password: 'password1' } })).data);
  return out;
}
async function hearth(host: any, ...others: any[]) {
  const server = (await call('/api/servers', { body: { name: 'Den' }, token: host.token })).data;
  for (const o of others) await call('/api/join', { body: { inviteCode: server.inviteCode }, token: o.token });
  return server.id as number;
}
function socket(token: string) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?token=${token}`);
  const got: any[] = [];
  ws.on('message', (raw) => got.push(JSON.parse(String(raw))));
  const next = (pred: (e: any) => boolean) =>
    new Promise<any>((resolve, reject) => {
      const started = Date.now();
      const look = () => {
        const i = got.findIndex(pred);
        if (i >= 0) return resolve(got.splice(i, 1)[0]);
        if (Date.now() - started > 3000) return reject(new Error('timed out waiting for a meetup message'));
        setTimeout(look, 10);
      };
      look();
    });
  return { ws, next, opened: new Promise((r) => ws.on('open', r)) };
}

// The meeting place, and spots about 1 km and 50 m north of it.
const PLACE = { lat: 59.9139, lng: 10.7522 };
const KM_NORTH = { lat: 59.9229, lng: 10.7522 };
const NEARBY = { lat: 59.91435, lng: 10.7522 };

test('distance, direction and ETA', () => {
  const { distance, bearing } = distanceAndBearing(PLACE.lat, PLACE.lng, KM_NORTH.lat, KM_NORTH.lng);
  assert.ok(Math.abs(distance - 1000) < 10, `about a kilometre, not ${distance}`);
  assert.ok(bearing < 1 || bearing > 359, 'north');
  assert.equal(distanceAndBearing(0, 0, 0, 1).bearing, 90);
  // 600 m closer in a minute: 400 m left is 40 seconds.
  assert.equal(etaSeconds([{ t: 0, d: 1000 }, { t: 60_000, d: 400 }]), 40);
  assert.equal(etaSeconds([{ t: 0, d: 400 }, { t: 60_000, d: 1000 }]), null, 'going the other way');
  assert.equal(etaSeconds([{ t: 0, d: 1000 }, { t: 10_000, d: 900 }]), null, 'too soon to tell');
});

test('meet-up: only people going share and see, and only a distance and direction', async () => {
  const [maya, theo, ines] = await people('maya', 'theo', 'ines');
  const serverId = await hearth(maya, theo, ines);

  // A meeting place needs coordinates that are on the map.
  const bad = await call(`/api/servers/${serverId}/events`, {
    body: { title: 'Picnic', startsAt: Date.now() + 3600e3, placeName: 'The park', placeLat: 95, placeLng: 10 }, token: maya.token,
  });
  assert.equal(bad.status, 400);

  const made = await call(`/api/servers/${serverId}/events`, {
    body: { title: 'Picnic', startsAt: Date.now() + 3600e3, placeName: 'The park', placeLat: PLACE.lat, placeLng: PLACE.lng }, token: maya.token,
  });
  assert.equal(made.status, 200);
  const ev = made.data.events[0];
  assert.deepEqual([ev.placeName, ev.placeLat, ev.placeLng], ['The park', PLACE.lat, PLACE.lng]);
  await call(`/api/events/${ev.id}/rsvp`, { body: { status: 'maybe' }, token: theo.token });

  // Ines hasn't said she's going: she can't share or look.
  assert.equal((await call(`/api/events/${ev.id}/meetup`, { token: ines.token })).status, 403);
  assert.equal((await call(`/api/events/${ev.id}/location`, { body: KM_NORTH, token: ines.token })).status, 403);

  const theoWs = socket(theo.token);
  const inesWs = socket(ines.token);
  await Promise.all([theoWs.opened, inesWs.opened]);
  const inesGot: any[] = [];
  inesWs.ws.on('message', (raw) => { const e = JSON.parse(String(raw)); if (e.type === 'meetup') inesGot.push(e); });

  const shared = await call(`/api/events/${ev.id}/location`, { body: { ...KM_NORTH, accuracy: 20 }, token: maya.token });
  assert.deepEqual(shared.data, { here: false });
  const seen = await theoWs.next((e) => e.type === 'meetup' && e.eventId === ev.id);
  assert.equal(seen.people.length, 1);
  const p = seen.people[0];
  assert.equal(p.userId, maya.user.id);
  assert.equal(p.here, false);
  assert.ok(Math.abs(p.distance - 1000) <= 10);
  assert.equal(p.bearing, 0);
  assert.equal(p.lat, undefined, 'no coordinates go out');
  assert.equal(p.lng, undefined);

  // Further away, only roughly: to 500 m and one of eight directions.
  await new Promise((r) => setTimeout(r, 4100));
  await call(`/api/events/${ev.id}/location`, { body: { lat: PLACE.lat + 0.039, lng: PLACE.lng + 0.045, accuracy: 20 }, token: maya.token });
  const far = (await theoWs.next((e) => e.type === 'meetup' && e.eventId === ev.id && e.people[0]?.distance > 2000)).people[0];
  assert.equal(far.distance % 500, 0);
  assert.equal(far.bearing % 45, 0);

  // Within 100 m counts as there, and stays so.
  await new Promise((r) => setTimeout(r, 4100));
  assert.deepEqual((await call(`/api/events/${ev.id}/location`, { body: { ...NEARBY, accuracy: 10 }, token: maya.token })).data, { here: true });
  const snap = (await call(`/api/events/${ev.id}/meetup`, { token: theo.token })).data;
  assert.equal(snap.open, true);
  assert.equal(snap.people[0].here, true);
  assert.equal(snap.people[0].distance, 0);

  // Theo says he's there himself, then changes his mind about going: his share goes with it.
  await call(`/api/events/${ev.id}/location`, { body: { here: true }, token: theo.token });
  await call(`/api/events/${ev.id}/rsvp`, { body: { status: 'no' }, token: theo.token });
  const after = (await call(`/api/events/${ev.id}/meetup`, { token: maya.token })).data;
  assert.deepEqual(after.people.map((x: any) => x.userId), [maya.user.id]);

  // Stopping takes you off for everyone.
  await call(`/api/events/${ev.id}/location`, { method: 'DELETE', token: maya.token });
  assert.deepEqual((await call(`/api/events/${ev.id}/meetup`, { token: maya.token })).data.people, []);
  assert.equal(inesGot.length, 0, 'Ines, not going, heard nothing');
  theoWs.ws.close();
  inesWs.ws.close();
});

test('meet-up is open only near the start, and only with a meeting place', async () => {
  const [maya] = await people('maya');
  const serverId = await hearth(maya);
  const later = (await call(`/api/servers/${serverId}/events`, {
    body: { title: 'Trip', startsAt: Date.now() + 5 * 3600e3, placeName: 'Station', placeLat: PLACE.lat, placeLng: PLACE.lng }, token: maya.token,
  })).data.events[0];
  assert.equal((await call(`/api/events/${later.id}/meetup`, { token: maya.token })).data.open, false);
  const early = await call(`/api/events/${later.id}/location`, { body: KM_NORTH, token: maya.token });
  assert.equal(early.status, 400);
  assert.match(early.data.error, /2 hours before/);

  const nowhere = (await call(`/api/servers/${serverId}/events`, { body: { title: 'Call', startsAt: Date.now() + 600e3 }, token: maya.token })).data.events
    .find((e: any) => e.title === 'Call');
  assert.equal(nowhere.placeLat, null);
  assert.equal((await call(`/api/events/${nowhere.id}/location`, { body: KM_NORTH, token: maya.token })).status, 400);

  // Moving the event out of the window turns sharing off.
  await call(`/api/events/${later.id}`, { method: 'PATCH', body: { startsAt: Date.now() + 600e3 }, token: maya.token });
  assert.equal((await call(`/api/events/${later.id}/location`, { body: KM_NORTH, token: maya.token })).status, 200);
  await call(`/api/events/${later.id}`, { method: 'PATCH', body: { startsAt: Date.now() + 5 * 3600e3 }, token: maya.token });
  assert.deepEqual((await call(`/api/events/${later.id}/meetup`, { token: maya.token })).data.people, []);

  // Clearing the place clears it.
  const cleared = (await call(`/api/events/${later.id}`, { method: 'PATCH', body: { placeName: '', placeLat: null, placeLng: null }, token: maya.token })).data;
  const ev = cleared.events.find((e: any) => e.id === later.id);
  assert.deepEqual([ev.placeName, ev.placeLat, ev.placeLng], [null, null, null]);
});
