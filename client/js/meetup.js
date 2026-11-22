// Meet-up: on the way to an event with a meeting place, the people going can share where they are,
// and see how far off each other is, which way, and about how long until they get there.
//
// The server gets your coordinates and sends others only a distance and a direction from the
// meeting place (server/src/meetup.ts). Sharing runs only while Peiskos is open on screen: it pauses
// when the app goes to the background, and turns off on arrival, when you stop it, or 3 hours after
// the start. Desktop apps can look but not share: Electron has no location of its own.

const MEETUP_BEFORE_MS = 2 * 3600e3;
const MEETUP_AFTER_MS = 3 * 3600e3;
/** How often your location goes out while you share: every 15 seconds, or sooner after 40 m. */
const MEETUP_SEND_MS = 15e3;

const meetState = {
  eventId: null, // the event you're sharing for
  serverId: null,
  stopWatch: null, // stops the location watch while it runs
  lastSent: null, // { t, lat, lng }
  offTimer: 0,
  people: new Map(), // event id -> what the server last said about who's sharing
  error: '',
};

const canShareLocation = () => !isDesktop && (isPhoneApp || 'geolocation' in navigator);
const meetupOpen = (e) => e.placeLat != null && Date.now() >= e.startsAt - MEETUP_BEFORE_MS && Date.now() < e.startsAt + MEETUP_AFTER_MS;

/** "59.91, 10.75", or a Google, Apple or OpenStreetMap link, as a place on the map. */
function parsePlace(text) {
  let t = String(text ?? '').trim();
  if (!t) return null;
  try { t = decodeURIComponent(t); } catch { /* keep it as typed */ }
  // Google's place links say where the place itself is after !3d and !4d; the @ part is the view.
  const m = t.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) || t.match(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/)
    || t.match(/mlat=(-?\d+(?:\.\d+)?)&mlon=(-?\d+(?:\.\d+)?)/);
  if (!m) return undefined;
  const lat = Number(m[1]), lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : undefined;
}

/** The meeting place in the phone's own maps app. */
function mapsLink(e) {
  const at = `${e.placeLat},${e.placeLng}`;
  return phonePlatform === 'ios' || /Mac|iPhone|iPad/.test(navigator.platform)
    ? `https://maps.apple.com/?ll=${at}&q=${encodeURIComponent(e.placeName || 'Meeting place')}`
    : `https://www.google.com/maps/search/?api=1&query=${at}`;
}

const useMiles = () => /^en-(US|GB|LR|MM)\b/.test(navigator.language || '');
function meetDistance(m) {
  if (useMiles()) {
    const mi = m / 1609.34;
    if (mi < 0.1) return `${Math.max(50, Math.round((m * 3.281) / 50) * 50)} ft`;
    return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
  }
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${m < 10000 ? (m / 1000).toFixed(1) : Math.round(m / 1000)} km`;
}
const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
const compassWord = (deg) => COMPASS[Math.round(deg / 45) % 8];
function etaText(s) {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `about ${min} min`;
  return `about ${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

/** What the list says about someone: where they are, or that they're not sharing. */
function meetLine(p) {
  if (!p) return 'Not sharing';
  if (p.here) return 'Here';
  const parts = [`${meetDistance(p.distance)} ${compassWord(p.bearing)}`];
  if (p.eta) parts.push(etaText(p.eta));
  const age = Date.now() - p.at;
  if (age > 2 * 60e3) parts.push(`${Math.round(age / 60e3)} min ago`);
  return parts.join(' · ');
}

// ---- sharing

/** Watches where the phone or browser is, until the returned function is called. */
function watchLocation(onPos, onError) {
  if (isPhoneApp) {
    let id = null, stopped = false;
    native('Geolocation', 'requestPermissions', { permissions: ['location'] })
      .then((p) => {
        if (stopped) return;
        if (p.location !== 'granted' && p.coarseLocation !== 'granted') throw Object.assign(new Error('denied'), { code: 1 });
        id = window.Capacitor.nativeCallback('Geolocation', 'watchPosition', { enableHighAccuracy: true, timeout: 30e3, maximumAge: 10e3, minimumUpdateInterval: 10e3, interval: MEETUP_SEND_MS },
          (pos, err) => (err ? onError(err) : pos && onPos(pos.coords)));
      })
      .catch(onError);
    return () => { stopped = true; if (id) native('Geolocation', 'clearWatch', { id }).catch(() => {}); };
  }
  const id = navigator.geolocation.watchPosition((pos) => onPos(pos.coords), onError, { enableHighAccuracy: true, maximumAge: 10e3 });
  return () => navigator.geolocation.clearWatch(id);
}

function locationError(err) {
  const denied = err?.code === 1 || /denied|permission/i.test(err?.message ?? '');
  if (denied) return isPhoneApp ? "Peiskos can't see your location. Allow it for Peiskos in your phone's settings, then try again."
    : "This browser blocked your location for Peiskos. Allow it in the site settings, then try again.";
  return "Your location couldn't be found. Try again outside or by a window.";
}

/** Metres between two points, near enough for "has this moved". */
function roughMetres(a, b) {
  const x = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot(x, b.lat - a.lat) * 111_320;
}

async function sendLocation(coords) {
  const id = meetState.eventId;
  if (!id) return;
  const here = { lat: coords.latitude, lng: coords.longitude };
  const last = meetState.lastSent;
  const since = last ? Date.now() - last.t : Infinity;
  if (since < 5e3 || (since < MEETUP_SEND_MS && roughMetres(last, here) < 40)) return;
  meetState.lastSent = { t: Date.now(), ...here };
  try {
    const r = await api(`/api/events/${id}/location`, { method: 'POST', body: { ...here, accuracy: coords.accuracy } });
    if (r.here && meetState.eventId === id) stopSharing({ arrived: true });
  } catch (err) {
    meetState.error = err.message;
    stopSharing({ quiet: true });
  }
}

function runWatch() {
  if (meetState.stopWatch || !meetState.eventId) return;
  meetState.stopWatch = watchLocation(sendLocation, (err) => {
    // No fix for a while (indoors, or standing still) isn't a reason to stop; being refused is.
    if (err?.code === 2 || err?.code === 3) return console.warn('meet-up: no location fix yet', err.message);
    meetState.error = locationError(err);
    stopSharing({ quiet: true });
  });
}
function pauseWatch() {
  meetState.stopWatch?.();
  meetState.stopWatch = null;
}

function startSharing(serverId, e) {
  if (meetState.eventId && meetState.eventId !== e.id) stopSharing({ quiet: true });
  Object.assign(meetState, { eventId: e.id, serverId, lastSent: null, error: '' });
  clearTimeout(meetState.offTimer);
  meetState.offTimer = setTimeout(() => stopSharing({ ended: true }), e.startsAt + MEETUP_AFTER_MS - Date.now());
  runWatch();
  renderMeetupChip();
  renderMeetupView();
}

/** Stops sharing, and takes you off everyone's list unless you arrived (you stay "Here"). */
function stopSharing({ arrived = false, ended = false, quiet = false } = {}) {
  const id = meetState.eventId;
  if (!id) return;
  pauseWatch();
  clearTimeout(meetState.offTimer);
  meetState.eventId = null;
  if (!arrived && !ended) api(`/api/events/${id}/location`, { method: 'DELETE' }).catch(() => {});
  if (arrived) toast("You're there. Sharing turned off.");
  else if (ended && !quiet) toast('Location sharing turned off: the meet-up is over.');
  renderMeetupChip();
  renderMeetupView();
}

// Only while Peiskos is on screen: off in the background, back on when it's open again.
document.addEventListener('visibilitychange', () => {
  if (!meetState.eventId) return;
  if (document.hidden) pauseWatch();
  else { meetState.lastSent = null; runWatch(); }
});
if (isPhoneApp) {
  window.Capacitor.addListener('App', 'pause', () => pauseWatch());
  window.Capacitor.addListener('App', 'resume', () => { if (meetState.eventId) { meetState.lastSent = null; runWatch(); } });
}

/** A small reminder at the top while you share, which opens the meet-up. */
function renderMeetupChip() {
  let chip = $('#meetup-chip');
  if (!meetState.eventId) return chip?.remove();
  const e = state.servers.get(meetState.serverId)?.events?.find((x) => x.id === meetState.eventId);
  if (!chip) {
    chip = document.createElement('button');
    chip.type = 'button';
    chip.id = 'meetup-chip';
    chip.innerHTML = '<span class="event-dot" aria-hidden="true"></span><span class="meetup-chip-text"></span>';
    document.body.append(chip);
  }
  chip.querySelector('.meetup-chip-text').textContent = `Sharing your location${e ? ` for ${e.title}` : ''}`;
  chip.setAttribute('aria-label', `${chip.textContent}. Open the meet-up`);
  chip.onclick = () => openMeetup(meetState.serverId, meetState.eventId);
}

// ---- the meet-up view

function onMeetup(ev) {
  meetState.people.set(ev.eventId, ev.people);
  // Someone said you're no longer going, or the server dropped you: stop sending.
  if (ev.eventId === meetState.eventId && meetState.lastSent && Date.now() - meetState.lastSent.t > 5e3
    && !ev.people.some((p) => p.userId === state.me.id)) stopSharing({ quiet: true });
  renderMeetupView();
}

async function openMeetup(serverId, eventId) {
  const s = state.servers.get(serverId);
  const e = s?.events?.find((x) => x.id === eventId);
  if (!e) return modal('<h2>Meet-up</h2><p class="muted">This event is over or was cancelled.</p>');
  modal(`<div id="meetup-view" data-event="${e.id}" data-server="${serverId}"></div>`, 'meetup-modal');
  renderMeetupView();
  try {
    const r = await api(`/api/events/${e.id}/meetup`);
    meetState.people.set(e.id, r.people);
  } catch (err) { meetState.error = err.message; }
  renderMeetupView();
}

function renderMeetupView() {
  const view = $('#meetup-view');
  if (!view) return;
  const serverId = Number(view.dataset.server), eventId = Number(view.dataset.event);
  const s = state.servers.get(serverId);
  const e = s?.events?.find((x) => x.id === eventId);
  if (!e) return (view.innerHTML = '<h2>Meet-up</h2><p class="muted">This event is over or was cancelled.</p>');
  const people = meetState.people.get(e.id) ?? [];
  const byId = new Map(people.map((p) => [p.userId, p]));
  const going = e.rsvps.filter((r) => r.status === 'going' || r.status === 'maybe').map((r) => r.userId);
  const mineGoing = going.includes(state.me.id);
  const sharing = meetState.eventId === e.id;
  const meHere = byId.get(state.me.id)?.here;
  const order = (id) => { const p = byId.get(id); return p ? (p.here ? -1 : p.distance) : Infinity; };
  const rows = [...going].sort((a, b) => order(a) - order(b)).map((id) => `
    <li class="meetup-row${byId.has(id) ? '' : ' off'}" data-user="${id}">
      <span class="avatar xs"></span>
      <span class="meetup-who"><b>${escapeHtml(nameOf(id, 'Someone'))}${id === state.me.id ? ' (you)' : ''}</b><span class="small">${escapeHtml(meetLine(byId.get(id)))}</span></span>
    </li>`).join('');
  const open = meetupOpen(e);
  const note = !open ? (Date.now() < e.startsAt ? 'Sharing opens 2 hours before the start.' : 'This meet-up is over.')
    : !canShareLocation() ? 'Share your location from the phone app or a browser.'
      : "People going see how far you are and which way, not your exact spot. Sharing pauses when Peiskos isn't open, and turns off when you get there or 3 hours after the start.";
  view.innerHTML = `
    <h2>Meet up for ${escapeHtml(e.title)}</h2>
    <p class="meetup-place small">${MAP_PIN_ICON}<span>${escapeHtml(e.placeName || 'Meeting place')}</span>
      <a href="${escapeHtml(mapsLink(e))}" target="_blank" rel="noopener">Open in Maps</a></p>
    ${meetupRadar(people)}
    <ul class="meetup-list" aria-label="People going">${rows}</ul>
    <p class="small muted">${note}</p>
    <div class="error" id="modal-error" role="alert">${escapeHtml(meetState.error)}</div>
    <div class="modal-row">
      <button type="button" class="btn secondary" id="meet-back">Back to the event</button>
      <span class="spacer"></span>
      ${open && mineGoing && !meHere ? '<button type="button" class="btn secondary" id="meet-here">I\'m here</button>' : ''}
      ${open && mineGoing && canShareLocation() && !meHere ? `<button type="button" class="btn${sharing ? ' danger' : ''}" id="meet-share">${sharing ? 'Stop sharing' : 'Share my location'}</button>` : ''}
    </div>`;
  view.querySelectorAll('.meetup-row').forEach((li) => {
    const id = Number(li.dataset.user);
    const m = s.members.find((x) => x.id === id);
    setAvatar(li.querySelector('.avatar'), m?.username ?? '?', avatarOf(id, m?.avatar));
  });
  meetState.error = '';
  $('#meet-back').onclick = () => openEvent(serverId, e.id);
  $('#meet-share')?.addEventListener('click', () => (sharing ? stopSharing() : startSharing(serverId, e)));
  $('#meet-here')?.addEventListener('click', async () => {
    if (sharing) stopSharing({ arrived: true });
    try { await api(`/api/events/${e.id}/location`, { method: 'POST', body: { here: true } }); }
    catch (err) { meetState.error = err.message; renderMeetupView(); }
  });
}
// "3 min ago" keeps counting while the view is open.
setInterval(() => { if ($('#meetup-view') && !$('#meetup-view').contains(document.activeElement)) renderMeetupView(); }, 30e3);

const MAP_PIN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';
const RING_STEPS = [1, 2.5, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10e3, 20e3, 50e3];
/** Round distances for the rings, in metres: 100 m, 250 m, 500 m, 1 km... or 0.1, 0.25, 0.5, 1 mile... */
const ringSteps = () => RING_STEPS.map((x) => (useMiles() ? x * 160.934 : x * 100));

/**
 * The meeting place in the middle and everyone sharing around it, north up. Farther out is
 * squeezed (square root), so someone across town and someone round the corner both fit. The list
 * below says the same in words, so this is hidden from screen readers.
 */
function ringLabel(m) {
  if (!useMiles()) return m < 1000 ? `${Math.round(m)} m` : `${Math.round(m / 1000)} km`;
  return `${+(m / 1609.34).toFixed(2)} mi`;
}
function meetupRadar(people) {
  const R = 128, C = 150;
  const out = people.filter((p) => !p.here);
  const far = Math.max(400, ...out.map((p) => p.distance)) * 1.12;
  const rings = ringSteps().filter((d) => d < far).slice(-3);
  const at = (d) => R * Math.sqrt(d / far);
  const initial = (id) => escapeHtml((nameOf(id, '?')[0] ?? '?').toUpperCase());
  const dot = (p, x, y) => `<g class="meet-dot${p.userId === state.me.id ? ' me' : ''}${Date.now() - p.at > 2 * 60e3 ? ' old' : ''}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
      <circle r="13"/><text dy="4.5" text-anchor="middle">${initial(p.userId)}</text></g>`;
  const here = people.filter((p) => p.here).map((p, i, all) => {
    const a = (i / Math.max(all.length, 1)) * 2 * Math.PI - Math.PI / 2;
    return dot(p, C + 30 * Math.cos(a), C + 30 * Math.sin(a));
  });
  const away = out.map((p) => {
    const r = Math.max(at(p.distance), 46), a = ((p.bearing - 90) * Math.PI) / 180;
    return dot(p, C + r * Math.cos(a), C + r * Math.sin(a));
  });
  return `<svg class="meetup-radar" viewBox="0 0 300 300" aria-hidden="true">
    <circle class="meet-ground" cx="${C}" cy="${C}" r="${R + 8}"/>
    ${rings.map((d) => `<circle class="meet-ring" cx="${C}" cy="${C}" r="${at(d).toFixed(1)}"/>
      <text class="meet-ring-label" x="${C}" y="${(C + at(d) - 4).toFixed(1)}" text-anchor="middle">${ringLabel(d)}</text>`).join('')}
    <text class="meet-north" x="${C}" y="${C - R - 14}" text-anchor="middle">N</text>
    <circle class="meet-place-glow" cx="${C}" cy="${C}" r="20"/>
    <path class="meet-place" transform="translate(${C - 9} ${C - 13}) scale(.75)" d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-7 .5 2 1.5 3 3 3-1-3-1-5 0-8z"/>
    ${here.join('')}${away.join('')}
  </svg>`;
}
