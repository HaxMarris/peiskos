/*
 * Spatial sound: each voice is panned and faded by where its speaker is, mixed in the listener's own
 * app from the audio it already gets. Nothing changes on the voice server, so older apps hear
 * everyone as before.
 *
 * Kept apart from the fire on purpose. The mixer only needs a spot for each person and an ear:
 * the fire gives seats around a circle, and a map can give positions in the world with a hearing
 * range of its own (a `floor` of 0 fades people out entirely past `far`).
 */

/** How the fire carries sound: seats are on a circle of radius 1, so across it is 2 away. */
const FIRE_HEARING = { near: 0.6, far: 2, floor: 0.6, width: 0.75 };

/**
 * How one voice sounds to one ear. `ear` is { x, y, fx, fy }: where the listener is and which way
 * they face (y grows downward, as on screen). `spot` is { x, y }. Returns { pan, gain }: pan from
 * -1 (left) to 1 (right), gain from `floor` (at `far` and beyond) up to 1 (within `near`).
 * `width` keeps anyone from sounding as if they were only in one ear.
 */
function hearFrom(ear, spot, { near = 1, far = 2, floor = 0, width = 1 } = {}) {
  const dx = spot.x - ear.x, dy = spot.y - ear.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return { pan: 0, gain: 1 };
  // Facing (fx, fy) with y down, the right hand points to (-fy, fx).
  const side = (dx * -ear.fy + dy * ear.fx) / (d * (Math.hypot(ear.fx, ear.fy) || 1));
  const t = Math.min(1, Math.max(0, (d - near) / Math.max(1e-6, far - near)));
  return { pan: Math.max(-1, Math.min(1, side * width)), gain: 1 - (1 - floor) * t };
}

/** The angle of seat i of `total` round the fire; the same one the drawn ring uses (sizeRing). */
const seatAngle = (i, total) => (-90 + (180 + i * 360) / total) * (Math.PI / 180);

/** Who sits where at a fire: everyone there in the server's order, you included, and how many seats. */
function fireSeats(ch, meId) {
  const ids = [...(ch?.voiceUsers ?? [])];
  if (meId != null && !ids.includes(meId)) ids.push(meId);
  // A small fire keeps a few open seats; one with a seat limit shows all of its seats (up to a dozen).
  const total = Math.max(ch?.userLimit && ch.userLimit <= 12 ? ch.userLimit : 6, ids.length);
  return { ids, total };
}

/** Each person's spot on the circle, and the ear of whoever sits at `meId`, facing the fire. */
function fireLayout(ch, meId) {
  const { ids, total } = fireSeats(ch, meId);
  const spots = new Map(ids.map((id, i) => [id, { x: Math.cos(seatAngle(i, total)), y: Math.sin(seatAngle(i, total)) }]));
  const mine = spots.get(meId);
  return { spots, ear: mine ? { x: mine.x, y: mine.y, fx: -mine.x, fy: -mine.y } : null };
}

/*
 * The mixer. LiveKit already plays each voice through Web Audio (for volumes past 100%), and lets
 * nodes go in between: a panner then a gain go there, and the person's own volume still applies after.
 */
const mixNodes = new WeakMap(); // remote audio track -> { pan, gain }

function mixAt(track, { pan, gain }) {
  const ctx = track.audioContext;
  if (!ctx || !track.setWebAudioPlugins) return;
  let nodes = mixNodes.get(track);
  if (!nodes) {
    nodes = { pan: ctx.createStereoPanner(), gain: ctx.createGain() };
    nodes.pan.connect(nodes.gain);
    mixNodes.set(track, nodes);
    track.setWebAudioPlugins([nodes.pan, nodes.gain]);
  }
  // Eased, so someone sitting down or getting up doesn't make the others jump.
  nodes.pan.pan.setTargetAtTime(pan, ctx.currentTime, 0.15);
  nodes.gain.gain.setTargetAtTime(gain, ctx.currentTime, 0.15);
}

function mixOff(track) {
  const nodes = mixNodes.get(track);
  if (!nodes) return;
  mixNodes.delete(track);
  track.setWebAudioPlugins([]);
  nodes.pan.disconnect();
  nodes.gain.disconnect();
}

/** Whether you hear the fire you're at by seat: its managers turned it on, and you haven't turned it off. */
function spatialHere() {
  const voice = state.voice;
  return !!voice && !!roomById(voice.channelId)?.c?.spatialSound && !voicePrefs.fullVolume;
}

/** Places every voice at your fire. Run when people come or go, a voice arrives, or a setting changes. */
function updateSpatial() {
  const voice = state.voice;
  const LK = window.LivekitClient;
  if (!voice?.room || !LK) return;
  const on = spatialHere();
  const { spots, ear } = on ? fireLayout(roomById(voice.channelId)?.c, state.me.id) : { spots: new Map(), ear: null };
  for (const p of voice.room.remoteParticipants.values()) {
    const track = p.getTrackPublication(LK.Track.Source.Microphone)?.track;
    if (!track) continue;
    const spot = spots.get(pidOf(p.identity));
    if (ear && spot) mixAt(track, hearFrom(ear, spot, FIRE_HEARING));
    else mixOff(track);
  }
}
