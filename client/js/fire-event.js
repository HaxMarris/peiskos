// An event that's on now at a fire: string lights on two posts around the circle with the event's
// name on a cloth banner, seats kept for people who said they're going and aren't there yet, and a
// line on the fire's row in the sidebar.
//
// Events have no end time, so one counts as on for EVENT_ON_HOURS after it starts (the server lists
// events for that long too).

const EVENT_ON_HOURS = 3;

/** The event on now at this room or fire, if any: the one that started last. */
function liveEventAt(s, channelId) {
  const now = Date.now();
  let best = null;
  for (const e of s?.events ?? []) {
    if (e.channelId !== channelId || e.startsAt > now || e.startsAt <= now - EVENT_ON_HOURS * 3600e3) continue;
    if (!best || e.startsAt > best.startsAt) best = e;
  }
  return best;
}

/** The posts, the string and its bulbs, for this width, sag and post height. The string ties on 8px down. */
function fireEventLightsSvg(span, sag, postH, pw) {
  const n = Math.max(8, Math.round(span / 34));
  let bulbs = '';
  for (let i = 1; i < n; i++) {
    const t = i / n, x = (span * t).toFixed(1), y = 8 + sag * 4 * t * (1 - t);
    bulbs += `<circle cx="${x}" cy="${(y + 7).toFixed(1)}" r="11" fill="rgba(255,190,90,.2)"/><path d="M${x} ${(y + 1).toFixed(1)}v3" stroke="#3b2a1f" stroke-width="2"/><circle class="bulb" cx="${x}" cy="${(y + 8).toFixed(1)}" r="4.5" fill="#ffd27a"/>`;
  }
  const post = (x) => `<g transform="translate(${(x - pw / 2).toFixed(1)} 0)">
    <ellipse cx="${pw / 2}" cy="${postH}" rx="${pw * 1.8}" ry="${pw * 0.5}" fill="#000" opacity=".38"/>
    <rect width="${pw}" height="${postH}" rx="2" fill="#7b4d2c"/>
    <rect x="${pw * 0.62}" width="${pw * 0.38}" height="${postH}" fill="#4e2f19" opacity=".7"/>
    <rect x="-2" y="-4" width="${pw + 4}" height="6" rx="2" fill="#5a361e"/>
    <path d="M${-pw * 0.3} ${postH}q${pw * 0.3} -5 ${pw * 0.6} 0M${pw * 0.7} ${postH}q${pw * 0.3} -5 ${pw * 0.6} 0" stroke="#3a2416" stroke-width="2" fill="none"/>
    <circle cx="${pw / 2}" cy="8" r="2.4" fill="#2a1a10"/></g>`;
  return `<svg width="${(span + 40).toFixed(1)}" height="${(postH + 12).toFixed(1)}" viewBox="-20 -6 ${(span + 40).toFixed(1)} ${(postH + 12).toFixed(1)}" overflow="visible" aria-hidden="true">
    ${post(0)}${post(span)}
    <path d="M0 8Q${(span / 2).toFixed(1)} ${(8 + sag * 2).toFixed(1)} ${span.toFixed(1)} 8" fill="none" stroke="#9a7a58" stroke-width="2"/>${bulbs}</svg>`;
}

/**
 * Puts the lights and banner up when an event is on at this fire, or takes them down, and keeps open
 * seats for whoever's still coming. Called by renderFire once the seats are placed, and again when
 * the circle is resized.
 */
function fireEventScene(ring, s, ch, here) {
  const e = s && ch && !isDm(s) ? liveEventAt(s, ch.id) : null;
  fireEventSeats(ring, e, here);
  let box = ring.querySelector('.fire-event');
  if (!e) return box?.remove();
  if (!box) {
    box = document.createElement('div');
    box.className = 'fire-event';
    box.innerHTML = '<div class="fire-event-lights"></div><button class="fire-event-banner"><small>On now</small><b></b></button>';
    ring.append(box);
  }
  const banner = box.querySelector('.fire-event-banner');
  const title = banner.querySelector('b');
  title.textContent = e.title;
  banner.title = e.title;
  banner.setAttribute('aria-label', `${e.title} is on now. Open the event`);
  banner.onclick = (ev) => { ev.stopPropagation(); openEvent(s.id, e.id); };
  // Short names get big, spaced-out letters; longer ones get smaller and wrap onto a second line.
  const len = [...e.title].length;
  banner.dataset.size = len <= 12 ? 'short' : len <= 22 ? 'medium' : 'long';
  fireEventPlace(ring, box);
}

/** Lays the lights out around the circle as it's drawn now. */
function fireEventPlace(ring, box = ring.querySelector('.fire-event')) {
  if (!box) return;
  const phone = matchMedia('(max-width: 760px)').matches;
  const ground = ring.querySelector('.fire-pit.back, .fire-pool');
  if (!ground) return;
  // The fire's own ground line, which is ground on every backdrop: the posts stand on it, out past
  // the side seats, so they never look planted in the sky. Seats are drawn in front of them.
  const cx = ring.clientWidth / 2;
  const g = parseFloat(ground.style.top) || ring.clientHeight * 0.68;
  const seatsX = [...ring.querySelectorAll('.seat')].map((el) => Math.abs(parseFloat(el.style.left) - cx));
  const reach = Math.max(100, ...seatsX.filter((x) => x >= 0)) + (phone ? 34 : 70);
  const width = Math.min(ring.clientWidth, ring.parentElement.clientWidth);
  const span = Math.max(160, Math.min(width - (phone ? 24 : 60), reach * 2));
  const foot = g + (phone ? 6 : 10);

  // The banner hangs above the back row's names: when the circle is full, the string goes up.
  const banner = box.querySelector('.fire-event-banner');
  const rr = ring.getBoundingClientRect();
  const tops = [...ring.querySelectorAll('.seat[data-row="back"] :is(.seat-name, .seat-status)')]
    .map((el) => el.getBoundingClientRect()).filter((r) => r.height).map((r) => r.top - rr.top);
  const roof = tops.length ? Math.min(...tops) - 6 : g - 120;
  const bh = banner.getBoundingClientRect().height;
  let sag = phone ? 46 : 64;
  let top = phone ? 70 : 60;
  if (roof - bh - top < sag) {
    sag = Math.max(16, roof - bh - top);
    top = Math.max(12, roof - bh - sag);
  }
  const postH = Math.max(40, foot - top + 6);
  const pw = phone ? 9 : 12;

  const lights = box.querySelector('.fire-event-lights');
  const key = [span, sag, postH, pw].map(Math.round).join();
  if (lights.dataset.key !== key) {
    lights.dataset.key = key;
    lights.innerHTML = fireEventLightsSvg(span, sag, postH, pw);
  }
  lights.style.left = `${cx - span / 2 - 20}px`;
  lights.style.top = `${top - 6}px`;
  banner.style.left = `${cx}px`;
  banner.style.top = `${top + sag + 4}px`;
}

/** Open seats, back row first, are kept for people who said they're going and aren't here yet. */
function fireEventSeats(ring, e, here) {
  const coming = e ? e.rsvps.filter((r) => r.status === 'going' && !here.includes(r.userId)).map((r) => r.userId) : [];
  const open = [...ring.querySelectorAll('.seat.open')]
    .sort((a, b) => (b.dataset.row === 'back') - (a.dataset.row === 'back') || a.dataset.i - b.dataset.i);
  open.forEach((el, i) => {
    const id = coming[i];
    const status = el.querySelector('.seat-status');
    el.classList.toggle('saved', !!id);
    el.querySelector('.saved-blanket')?.remove();
    if (!id) return void (status.textContent = 'Open seat');
    el.querySelector('.seat-face').insertAdjacentHTML('beforeend', '<span class="saved-blanket" aria-hidden="true"></span>');
    status.textContent = `Saved for ${nameOf(id, 'someone')}`;
  });
}

// Events start and stop being on with nobody touching anything, so once a minute the sidebar and the
// fire look again and redraw when that changed.
let fireEventKey = '';
setInterval(() => {
  if (!state.me) return;
  const key = [...state.servers.values()]
    .flatMap((s) => (s.events ?? []).filter((e) => e.channelId && liveEventAt(s, e.channelId) === e).map((e) => e.id)).join();
  if (key === fireEventKey) return;
  fireEventKey = key;
  renderChannels();
}, 60e3);
