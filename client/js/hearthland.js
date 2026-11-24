// ---------------------------------------------------------------- Hearthland: the hearth as a map
//
// A hearth whose managers turned the map on can be walked around: its fires, the dock and the
// casino are places on one map. Walking into a fire's ring joins that fire's call and walking out
// leaves it; "Sit down" opens the fire view. People who join from the list are drawn sitting at
// their fire. With "Hear by distance", the voices in your call come from where people stand
// (mixed by spatial.js, the same as spatial sound at the fire).
//
// The map is drawn on a canvas in pixel art. The server only keeps where people stand (in memory)
// and each person's look (server/src/hearthland.ts). The map is the same for every hearth: its
// fires take the fire spots in the hearth's order, and any past the last spot stay in the list.

const HL_T = 16, HL_W = 44, HL_H = 30; // tile size in pixels, map size in tiles (as MAP_W/MAP_H on the server)
// Where fires go, first to last. The first is the big one in the middle.
const HL_SPOTS = [
  { x: 22.5, y: 16.5, r: 4.2, seats: 6 },
  { x: 9.5, y: 8.8, r: 3.3, seats: 4 },
  { x: 34.5, y: 22.5, r: 3.2, seats: 4 },
  { x: 20.5, y: 5.6, r: 3, seats: 4 },
  { x: 25, y: 25.2, r: 2.7, seats: 4 },
];
const HL_CASINO = { x0: 6, y0: 19, w: 7, h: 4 }; // footprint in tiles
const HL_DOOR = { x: 9.5, y: 24 }; // the top of the red carpet
const HL_DOCK = { x: 32, y: 11.5 }; // the end of the dock
const HL_START = { x: 22.5, y: 22.8 }; // where you arrive: on the path just below the first fire

// Character parts. The server checks a look against the same counts and names (LOOK_PARTS).
const HL_SKINS = ['#f6d5b8', '#eec39a', '#d9a274', '#b57a50', '#8d5a3b', '#5e3a26'];
const HL_HAIR = ['#1d1612', '#4a2a16', '#8a4a22', '#c8893b', '#e3c47a', '#b9b3aa', '#c0483a', '#3d5f9e'];
const HL_TOPS = ['#e06a2a', '#c0383a', '#d9a441', '#5c8a4f', '#2f7f86', '#3d5f9e', '#7a4fa0', '#2f2f3a', '#e8e0d0'];
const HL_TOP_NAMES = ['Ember', 'Red', 'Mustard', 'Moss', 'Teal', 'Blue', 'Purple', 'Charcoal', 'Oat'];
const HL_PANTS = ['#2b2b3a', '#3d4a6b', '#5a4632', '#6b6b6b'];
const HL_PANT_NAMES = ['Navy', 'Denim', 'Brown', 'Grey'];
const HL_HAIR_STYLES = [['short', 'Short'], ['long', 'Long'], ['bun', 'Bun'], ['spiky', 'Spiky'], ['bald', 'None']];
const HL_TOP_STYLES = [['tee', 'T-shirt'], ['hoodie', 'Hoodie'], ['jacket', 'Jacket'], ['sweater', 'Knit sweater']];
const HL_HATS = [['none', 'None'], ['beanie', 'Beanie'], ['cap', 'Cap'], ['straw', 'Sun hat'], ['antlers', 'Antlers'], ['crown', 'Crown']];
const HL_HAT_COLORS = { beanie: '#c0483a', cap: '#3d5f9e', straw: '#e0c06a', antlers: '#8a6a44', crown: '#e2b03a' };

const hl = {
  open: false,
  serverId: null,
  world: null,        // the drawn map, for a number of fires
  me: { x: HL_START.x * HL_T, y: HL_START.y * HL_T, moving: false },
  walkers: new Map(), // user id -> { x, y, tx, ty, moving } in pixels, for the others on this map
  keys: new Set(),
  route: [],
  zone: null,         // the fire whose ring you're in (its channel id)
  pendingJoin: null,  // { id, timer } walking into a ring joins after a moment, so walking past doesn't
  failed: null,       // a fire that refused you: not tried again until you walk out
  sent: { at: 0, x: -1, y: -1, moving: false },
  returnToMap: false, // the fire view was opened from the map, so closing it comes back here
  backAt: null,       // where to stand when the map opens again (the casino door, the dock)
  current: null,      // what the banner offers here
  bannerKey: '',
  frame: 0,
  last: 0,
  spatialAt: 0,
  night: false,
};

// ---- your look

/** A look everyone starts with, different person to person, until they pick one. */
function defaultLook(userId) {
  let h = (Number(userId) || 1) * 2654435761 >>> 0;
  const next = (n) => { h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; return h % n; };
  return {
    skin: next(HL_SKINS.length), hairStyle: HL_HAIR_STYLES[next(4)][0], hair: next(HL_HAIR.length),
    top: HL_TOP_STYLES[next(HL_TOP_STYLES.length)][0], topColor: next(HL_TOPS.length), pants: next(HL_PANTS.length), hat: 'none',
  };
}
function lookOf(userId) {
  const s = state.servers.get(hl.serverId) ?? state.servers.get(state.serverId);
  const m = s?.members.find((x) => x.id === userId);
  return m?.look ?? (userId === state.me?.id ? state.me.look : null) ?? defaultLook(userId);
}

// ---- drawing

const hlPx = (g, c, x, y, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
const hlShade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(f < 1 ? v * f : v + (255 - v) * (f - 1)))));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
};

/** One character, feet at (x, y). `sil` draws it in one colour, for the outline. */
function hlSprite(g, look, x, y, t, { moving = false, sit = false } = {}, sil = null) {
  const r = (c, dx, dy, w = 1, h = 1) => hlPx(g, sil || c, x + dx, y + dy, w, h);
  const step = moving ? Math.floor(t * 8) % 2 : 0, o = sit ? 3 : 0;
  const top = HL_TOPS[look.topColor] ?? HL_TOPS[0], topD = hlShade(top, 0.72), skin = HL_SKINS[look.skin] ?? HL_SKINS[0];
  const hc = HL_HAIR[look.hair] ?? HL_HAIR[0], pants = HL_PANTS[look.pants] ?? HL_PANTS[0], shoe = '#1d1410';
  if (!sit) {
    const lL = step ? 4 : 5, lR = step ? 5 : 4;
    r(pants, -3, -6, 2, lL); r(shoe, -3, -6 + lL, 2, 1); r(pants, 1, -6, 2, lR); r(shoe, 1, -6 + lR, 2, 1);
  }
  r(top, -4, -12 + o, 8, 7); r(top, -5, -11 + o, 1, 4); r(top, 4, -11 + o, 1, 4); r(skin, -5, -7 + o); r(skin, 4, -7 + o);
  if (look.top === 'hoodie') { r(topD, -3, -12 + o, 6, 1); r(topD, -2, -8 + o, 4, 1); r('#f4ead8', -1, -11 + o, 1, 2); r('#f4ead8', 0, -11 + o, 1, 2); }
  if (look.top === 'jacket') { r('#f4ead8', -1, -12 + o, 2, 7); r(topD, -4, -6 + o, 8, 1); r(topD, -2, -12 + o, 1, 2); r(topD, 1, -12 + o, 1, 2); }
  if (look.top === 'sweater') { r('#f4ead8', -4, -10 + o, 8, 1); r(topD, -4, -9 + o, 8, 1); r('#f4ead8', -3, -10 + o); r(topD, -4, -6 + o, 8, 1); }
  if (look.top === 'tee') { r(topD, -4, -6 + o, 8, 1); r(skin, -5, -9 + o, 1, 2); r(skin, 4, -9 + o, 1, 2); }
  if (sit) { r(pants, -3, -5 + o, 6, 2); r(shoe, -3, -3 + o, 2, 1); r(shoe, 1, -3 + o, 2, 1); }
  r(skin, -3, -18 + o, 6, 6); r(hlShade(skin, 0.9), -3, -13 + o, 6, 1);
  r('#1d1410', -2, -15 + o); r('#1d1410', 1, -15 + o);
  if (!sil) { r('rgba(220,90,90,.35)', -3, -14 + o); r('rgba(220,90,90,.35)', 2, -14 + o); }
  const H = look.hairStyle;
  if (H !== 'bald') { r(hc, -3, -19 + o, 6, 2); r(hc, -4, -18 + o, 1, 3); r(hc, 3, -18 + o, 1, 2); r(hlShade(hc, 1.25), -2, -19 + o, 2, 1); }
  if (H === 'long') { r(hc, -4, -16 + o, 1, 6); r(hc, 3, -16 + o, 1, 6); }
  if (H === 'bun') r(hc, -1, -21 + o, 3, 2);
  if (H === 'spiky') { r(hc, -3, -20 + o); r(hc, -1, -21 + o, 1, 2); r(hc, 1, -20 + o); r(hc, 2, -21 + o); }
  if (H === 'bald') r(hlShade(skin, 1.15), -2, -18 + o, 2, 1);
  const hat = look.hat, c = HL_HAT_COLORS[hat];
  if (hat === 'beanie') { r(c, -4, -21 + o, 8, 4); r(hlShade(c, 0.75), -4, -18 + o, 8, 1); r('#f4ead8', -1, -22 + o, 2, 1); }
  if (hat === 'cap') { r(c, -3, -21 + o, 6, 3); r(hlShade(c, 0.7), -4, -18 + o, 8, 1); r('#f4ead8', 0, -20 + o); }
  if (hat === 'straw') { r(c, -3, -21 + o, 6, 3); r('#8a3b22', -3, -19 + o, 6, 1); r(c, -6, -18 + o, 12, 1); r(hlShade(c, 0.8), -6, -17 + o, 12, 1); }
  if (hat === 'antlers') { r(c, -4, -22 + o, 1, 3); r(c, -6, -23 + o, 2, 1); r(c, -5, -24 + o); r(c, 3, -22 + o, 1, 3); r(c, 4, -23 + o, 2, 1); r(c, 4, -24 + o); }
  if (hat === 'crown') { r(c, -3, -21 + o, 6, 2); r(c, -3, -22 + o); r(c, -1, -23 + o, 2, 2); r(c, 2, -22 + o); r('#d0343c', 0, -21 + o); }
}
/** A character with its shadow and dark outline, so it reads on any ground. */
function hlPerson(g, look, x, y, t, pose = {}) {
  x = Math.round(x); y = Math.round(y);
  hlPx(g, 'rgba(0,0,0,.25)', x - 5, y - 1, 10, 2); hlPx(g, 'rgba(0,0,0,.15)', x - 4, y + 1, 8, 1);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) hlSprite(g, look, x + dx, y + dy, t, pose, '#1a120d');
  hlSprite(g, look, x, y, t, pose);
}

const HL_G = 0, HL_DIRT = 1, HL_WATER = 2, HL_SAND = 3, HL_TREE = 4, HL_PINE = 5, HL_BLOCK = 6, HL_DOCKT = 7, HL_CARPET = 8;
const HL_FONT = { C: ['111', '100', '100', '100', '111'], A: ['010', '101', '111', '101', '101'], S: ['111', '100', '111', '001', '111'], I: ['111', '010', '010', '010', '111'], N: ['1001', '1101', '1011', '1001', '1001'], O: ['111', '101', '101', '101', '111'] };
function hlPixText(g, text, x, y, c) {
  let cx = x;
  for (const ch of text) { const f = HL_FONT[ch]; f.forEach((row, ry) => [...row].forEach((b, rx) => b === '1' && hlPx(g, c, cx + rx, y + ry))); cx += f[0].length + 1; }
}

/** The ground, trees and buildings for a map with `fires` fires and its camp (camp.js): drawn once, then reused every frame. */
function hlBuildWorld(fires, camp = null) {
  const T = HL_T, W = HL_W, H = HL_H;
  const tiles = new Uint8Array(W * H);
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? HL_TREE : tiles[y * W + x]);
  const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < W && y < H) tiles[y * W + x] = v; };
  let seed = 11;
  const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const spots = HL_SPOTS.slice(0, fires);
  const C = HL_CASINO, doorX = (C.x0 + C.w / 2) * T;

  const lakeD = (x, y) => { const dx = (x + 0.5 - 36.5) / 8, dy = (y + 0.5 - 9.5) / 6; return dx * dx + dy * dy; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const d = lakeD(x, y); if (d < 1) set(x, y, HL_WATER); else if (d < 1.35) set(x, y, HL_SAND); }
  const path = (ax, ay, bx, by) => {
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 3);
    for (let i = 0; i <= n; i++) {
      const px = ax + ((bx - ax) * i) / n, py = ay + ((by - ay) * i) / n;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const tx = Math.floor(px + ox * 0.45), ty = Math.floor(py + oy * 0.45); if (at(tx, ty) === HL_G) set(tx, ty, HL_DIRT); }
    }
  };
  const hub = HL_SPOTS[0];
  path(hub.x, hub.y, 10.5, 25.6); path(10.5, 25.6, 9.5, 25.6); path(hub.x, hub.y, 28, 11.5); path(hub.x, hub.y, HL_START.x, 27);
  spots.forEach((s, i) => { if (i) path(hub.x, hub.y, s.x, s.y + (i === 1 ? 1.7 : 0)); });
  for (let x = 28; x <= 33; x++) set(x, 11, HL_DOCKT);
  for (let y = 3; y <= 5; y++) for (let x = 6; x <= 10; x++) set(x, y, HL_BLOCK); // the lodge
  for (let y = C.y0; y < C.y0 + C.h; y++) for (let x = C.x0; x < C.x0 + C.w; x++) set(x, y, HL_BLOCK);
  set(9, 23, HL_CARPET); set(9, 24, HL_CARPET);
  for (const s of spots) set(Math.floor(s.x), Math.floor(s.y), HL_BLOCK); // the fire itself
  const clear = [...HL_SPOTS.map((s) => [s.x, s.y, s.r + 1.4]), [9.5, 7.5, 4.6], [9.5, 24, 4.6], [17.5, 20.6, 1.5], ...campClearings()];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (at(x, y) !== HL_G) continue;
    const border = x < 2 || y < 2 || x > W - 3 || y > H - 3;
    const inClear = clear.some(([cx, cy, r]) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < r);
    if (border || (!inClear && rnd() < 0.2)) set(x, y, rnd() < 0.62 ? HL_PINE : HL_TREE);
  }
  // The camp's builds are kept apart from the tiles: setting them there would change the trees and flowers drawn after.
  const built = campBlocked(camp, W);
  const solid = (tx, ty) => { const v = at(tx, ty); return v === HL_TREE || v === HL_PINE || v === HL_WATER || v === HL_BLOCK || built.has(ty * W + tx); };

  const ground = document.createElement('canvas');
  ground.width = W * T; ground.height = H * T;
  const gg = ground.getContext('2d');
  const px = (c, x, y, w, h) => hlPx(gg, c, x, y, w, h);
  const isGrass = (v) => v === HL_G || v === HL_TREE || v === HL_PINE;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = at(x, y), X = x * T, Y = y * T;
    if (v === HL_WATER || v === HL_DOCKT) {
      const d = lakeD(x, y);
      px(d < 0.45 ? '#2f6890' : d < 0.75 ? '#3876a0' : '#4385ae', X, Y, T, T);
      if (rnd() < 0.5) px('rgba(255,255,255,.12)', X + ((rnd() * 10) | 0), Y + ((rnd() * 14) | 0), 5, 1);
      [[0, -1, X, Y, T, 2], [0, 1, X, Y + T - 2, T, 2], [-1, 0, X, Y, 2, T], [1, 0, X + T - 2, Y, 2, T]].forEach(([dx, dy, a, b, w, h]) => { if (at(x + dx, y + dy) === HL_SAND) px('#a9d3e6', a, b, w, h); });
    } else if (v === HL_SAND) {
      px('#d9c48c', X, Y, T, T);
      for (let i = 0; i < 8; i++) px(rnd() < 0.5 ? '#cbb47b' : '#e6d6a6', X + ((rnd() * T) | 0), Y + ((rnd() * T) | 0), 1, 1);
    } else if (v === HL_DIRT || v === HL_CARPET) {
      px('#b08c5e', X, Y, T, T);
      for (let i = 0; i < 10; i++) px(['#9d7a4f', '#c09c6b', '#93714a'][(rnd() * 3) | 0], X + ((rnd() * T) | 0), Y + ((rnd() * T) | 0), 1, 1);
      if (rnd() < 0.25) px('#8f8a82', X + 3 + ((rnd() * 9) | 0), Y + 3 + ((rnd() * 9) | 0), 2, 1);
    } else {
      px((x * 7 + y * 13) % 5 === 0 ? '#5a8639' : '#5f8b3c', X, Y, T, T);
      for (let i = 0; i < 7; i++) px(rnd() < 0.5 ? '#557f35' : '#69974a', X + ((rnd() * T) | 0), Y + ((rnd() * T) | 0), 1, 1);
      if (rnd() < 0.35) { const a = X + 2 + ((rnd() * 11) | 0), b = Y + 3 + ((rnd() * 10) | 0); px('#4a7230', a, b, 1, 2); px('#4a7230', a + 2, b, 1, 2); px('#4a7230', a + 1, b + 1, 1, 2); }
      if (v === HL_G && rnd() < 0.07) { const c = ['#f3e7a0', '#e9a7c0', '#ffffff', '#b9c7f0'][(rnd() * 4) | 0], a = X + 4 + ((rnd() * 8) | 0), b = Y + 4 + ((rnd() * 8) | 0); px(c, a, b, 1, 1); px(c, a - 1, b + 1, 3, 1); px(c, a, b + 2, 1, 1); px('#d9a441', a, b + 1, 1, 1); }
    }
    if (v === HL_DIRT) {
      [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(([dx, dy]) => {
        if (!isGrass(at(x + dx, y + dy))) return;
        for (let i = 0; i < T; i++) {
          const k = (rnd() * 3) | 0;
          if (!k) continue;
          if (dy === -1) px('#5f8b3c', X + i, Y, 1, k);
          if (dy === 1) px('#5f8b3c', X + i, Y + T - k, 1, k);
          if (dx === -1) px('#5f8b3c', X, Y + i, k, 1);
          if (dx === 1) px('#5f8b3c', X + T - k, Y + i, k, 1);
        }
      });
    }
    if (v === HL_DOCKT) {
      px('rgba(0,0,0,.18)', X, Y + 14, T, 3);
      px('#a47a4d', X, Y + 2, T, 12); px('#b88c5c', X, Y + 2, T, 1);
      for (let i = 0; i < T; i += 4) px('#7d5a36', X + i, Y + 2, 1, 12);
      px('#5b3a22', X + 1, Y + 14, 2, 2); px('#5b3a22', X + 13, Y + 14, 2, 2);
    }
  }
  for (let i = 0; i < 26; i++) {
    const x = (rnd() * W) | 0, y = (rnd() * H) | 0;
    if (at(x, y) !== HL_G || HL_SPOTS.some((s) => Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y) < s.r + 0.5)) continue;
    const X = x * T + 4, Y = y * T + 6;
    if (rnd() < 0.5) { px('rgba(0,0,0,.18)', X, Y + 5, 8, 2); px('#8b8680', X, Y + 1, 8, 5); px('#a8a39b', X + 1, Y, 5, 2); px('#6f6a64', X + 2, Y + 5, 6, 1); }
    else { px('rgba(0,0,0,.18)', X, Y + 6, 9, 2); px('#3f7a3a', X, Y + 1, 9, 6); px('#4f8f45', X + 1, Y, 6, 3); px('#c0383a', X + 2, Y + 3, 1, 1); px('#c0383a', X + 6, Y + 2, 1, 1); }
  }
  const tree = (x, y, pine) => {
    const X = x * T, Y = y * T, ol = '#163a22';
    px('rgba(0,0,0,.22)', X + 1, Y + 13, 14, 3);
    px('#4b2f1c', X + 7, Y + 10, 3, 5); px('#6a4429', X + 7, Y + 10, 1, 5);
    if (pine) {
      const tiers = [[Y - 6, 4, 3], [Y - 2, 6, 4], [Y + 3, 8, 5]];
      for (const [ty, half, hgt] of tiers) for (let r = 0; r <= hgt + 1; r++) { const hw = Math.round(1 + ((half - 1) * r) / (hgt + 1)); px(ol, X + 8 - hw - 1, ty + r, hw * 2 + 2, 1); }
      for (const [ty, half, hgt] of tiers) for (let r = 0; r <= hgt; r++) {
        const hw = Math.round(1 + ((half - 1) * r) / (hgt + 1)), yy = ty + r;
        px('#2a5e37', X + 8 - hw, yy, hw * 2, 1); px('#3b7a48', X + 8 - hw, yy, Math.max(1, hw - 1), 1); px('#1f4a2c', X + 8 + hw - 2, yy, 2, 1);
      }
    } else {
      const cx = X + 8, cy = Y + 3;
      for (let dy = -8; dy <= 7; dy++) for (let dx = -8; dx <= 8; dx++) {
        const d = Math.hypot(dx, dy * 1.1);
        if (d > 7.8) continue;
        px(d > 6.9 ? ol : dx + dy < -4 ? '#4f9450' : dx + dy > 5 ? '#265c2e' : '#357a3a', cx + dx, cy + dy, 1, 1);
      }
      px('#5fa75c', cx - 3, cy - 4, 2, 1); px('#5fa75c', cx - 1, cy - 5, 2, 1);
    }
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = at(x, y); if (v === HL_TREE || v === HL_PINE) tree(x, y, v === HL_PINE); }

  // The lodge: a log cabin with a stone chimney.
  {
    const X = 6 * T, Y = 3 * T, w = 5 * T, h = 3 * T;
    px('rgba(0,0,0,.25)', X + 3, Y + h - 2, w, 5);
    for (let i = 0; i < 6; i++) { const yy = Y + 18 + i * 5; px(i % 2 ? '#7a4a2a' : '#6b4226', X, yy, w, 5); px('#5a361f', X, yy + 4, w, 1); px('#c99a66', X - 2, yy + 1, 3, 3); px('#c99a66', X + w - 1, yy + 1, 3, 3); }
    for (let r = 0; r < 16; r++) px(r % 4 === 3 ? '#6f2e1a' : r < 3 ? '#b4552f' : '#94402a', X - 4, Y + 2 + r, w + 8, 1);
    for (let i = 0; i < w + 8; i += 6) px('#7d3420', X - 4 + i, Y + 6, 1, 12);
    px('#4b2f1c', X - 4, Y + 18, w + 8, 1);
    px('#7a7570', X + 62, Y - 8, 10, 14); px('#9a958d', X + 63, Y - 8, 4, 2); px('#5d5954', X + 62, Y - 9, 10, 1);
    px('#3b2416', X + 34, Y + 30, 12, 18); px('#4e3020', X + 35, Y + 31, 10, 16); px('#d9a441', X + 43, Y + 39, 1, 2);
    for (const wx of [X + 10, X + 58]) { px('#c99a66', wx - 1, Y + 25, 14, 12); px('#2a1a12', wx, Y + 26, 12, 10); px('#c99a66', wx + 5, Y + 26, 1, 10); px('#c99a66', wx, Y + 30, 12, 1); px('#8a3b22', wx - 1, Y + 36, 14, 2); }
  }

  // The casino: a lit hall with a marquee, red carpet and velvet ropes.
  const marquee = { x: doorX - 26, y: C.y0 * T - 8, w: 52, h: 17 };
  const marqueeBulbs = [];
  {
    const X = C.x0 * T, Y = C.y0 * T, w = C.w * T, h = C.h * T;
    px('rgba(0,0,0,.28)', X + 3, Y + h - 2, w, 6);
    px('#3d2636', X - 2, Y + 2, w + 4, 8); px('#523548', X - 2, Y + 2, w + 4, 2);
    px('#c9953a', X - 3, Y + 10, w + 6, 2); px('#f1c76a', X - 3, Y + 10, w + 6, 1);
    px('#2a1826', X, Y + 12, w, 8); px('#c9953a', X, Y + 20, w, 1);
    px('#4a2a3e', X, Y + 21, w, h - 26);
    for (let yy = Y + 23; yy < Y + h - 5; yy += 4) for (let xx = X + ((yy / 4) % 2 ? 0 : 4); xx < X + w; xx += 8) px('#3f2335', xx, yy, 7, 1);
    px('#6d6470', X - 1, Y + h - 5, w + 2, 5); px('#857c88', X - 1, Y + h - 5, w + 2, 1);
    for (const o of [0, 24, 84, 108]) { px('#b5822f', X + o, Y + 12, 4, h - 17); px('#f1c76a', X + o + 1, Y + 12, 1, h - 17); px('#f1c76a', X + o - 1, Y + 12, 6, 1); }
    for (const o of [8, 92]) {
      px('#c9953a', X + o - 1, Y + 27, 14, 20); px('#ffd98a', X + o, Y + 28, 12, 18); px('#ffeab8', X + o + 2, Y + 30, 3, 6);
      px('#9e1f2c', X + o, Y + 28, 3, 18); px('#9e1f2c', X + o + 9, Y + 28, 3, 18); px('#7a1622', X + o, Y + 28, 12, 2);
      px('#c9953a', X + o + 5, Y + 30, 2, 16);
    }
    const suit = { s: ['00100', '01110', '11111', '00100', '01110'], h: ['01010', '11111', '11111', '01110', '00100'], d: ['00100', '01110', '11111', '01110', '00100'], c: ['01110', '01110', '11111', '00100', '01110'] };
    [['s', 8, '#f4ead8'], ['h', 16, '#e2434f'], ['d', 92, '#e2434f'], ['c', 100, '#f4ead8']].forEach(([k, o, c]) => suit[k].forEach((row, ry) => [...row].forEach((b, rx) => b === '1' && px(c, X + o + rx, Y + 13 + ry, 1, 1))));
    px('#c9953a', doorX - 14, Y + 30, 28, h - 35); px('#1a0c12', doorX - 12, Y + 32, 24, h - 37);
    px('#5a1420', doorX - 11, Y + 34, 10, h - 39); px('#5a1420', doorX + 1, Y + 34, 10, h - 39);
    px('#6e1a28', doorX - 10, Y + 36, 8, 8); px('#6e1a28', doorX + 2, Y + 36, 8, 8); px('#f1c76a', doorX - 3, Y + 46, 1, 3); px('#f1c76a', doorX + 2, Y + 46, 1, 3);
    for (let i = 0; i < 32; i++) px(i % 8 < 4 ? '#b3202e' : '#d8303e', doorX - 16 + i, Y + 25, 1, 6);
    for (let i = 0; i < 32; i += 4) px('#b3202e', doorX - 16 + i, Y + 31, 3, 1);
    px('#8a1622', doorX - 16, Y + 25, 32, 1);
    const m = marquee;
    px('#1a0c12', m.x - 2, m.y - 2, m.w + 4, m.h + 4); px('#c9953a', m.x - 1, m.y - 1, m.w + 2, m.h + 2); px('#14090f', m.x + 1, m.y + 1, m.w - 2, m.h - 2);
    px('#5b3a22', m.x + 8, m.y + m.h + 1, 2, 4); px('#5b3a22', m.x + m.w - 10, m.y + m.h + 1, 2, 4);
    for (let i = m.x + 1; i < m.x + m.w - 1; i += 4) { marqueeBulbs.push([i, m.y]); marqueeBulbs.push([i, m.y + m.h - 1]); }
    for (let j = m.y + 4; j < m.y + m.h - 3; j += 4) { marqueeBulbs.push([m.x, j]); marqueeBulbs.push([m.x + m.w - 1, j]); }
    const cy = Y + h;
    px('#8e1424', doorX - 9, cy, 18, 30); px('#a8192c', doorX - 8, cy, 16, 30); px('#d9a441', doorX - 9, cy, 1, 30); px('#d9a441', doorX + 8, cy, 1, 30);
    for (const sx of [doorX - 15, doorX + 14]) {
      for (const sy of [cy + 8, cy + 26]) { px('rgba(0,0,0,.2)', sx - 1, sy, 4, 2); px('#c9953a', sx, sy - 9, 2, 9); px('#f1c76a', sx - 1, sy - 10, 4, 2); }
      for (let i = 0; i <= 18; i++) px('#b3202e', sx, cy + i + Math.round(Math.sin((Math.PI * i) / 18) * 3), 2, 1);
    }
    for (const lx of [X - 6, X + w + 4]) { px('rgba(0,0,0,.2)', lx - 2, Y + h + 4, 6, 2); px('#2a2226', lx, Y + h - 18, 2, 22); px('#2a2226', lx - 2, Y + h - 20, 6, 2); }
  }

  campDrawGround(gg, camp);

  // Each fire's stone ring and log seats.
  const ring = (cx, cy, r) => {
    for (let a = 0; a < 18; a++) {
      const t = (a / 18) * Math.PI * 2, x = Math.round(cx + Math.cos(t) * r) - 1, y = Math.round(cy + Math.sin(t) * r * 0.8) - 1;
      px('#5d5954', x, y + 1, 4, 2); px(a % 2 ? '#8b8680' : '#a39e96', x, y, 4, 2); px('#bdb8b0', x + 1, y, 1, 1);
    }
  };
  for (const s of spots) {
    const cx = s.x * T, cy = s.y * T, big = s === HL_SPOTS[0];
    px('rgba(40,20,10,.35)', cx - 9, cy - 6, 18, 12);
    ring(cx, cy, big ? 9 : 7);
    for (const seat of hlSeats(s, s.seats)) {
      const sx = seat.x, sy = seat.y;
      px('rgba(0,0,0,.22)', sx - 7, sy + 1, 15, 2); px('#6e4326', sx - 7, sy - 4, 14, 5); px('#87562f', sx - 7, sy - 4, 14, 1);
      px('#d1a571', sx - 8, sy - 4, 2, 5); px('#a47a4d', sx - 8, sy - 2, 1, 1); px('#d1a571', sx + 6, sy - 4, 2, 5);
    }
  }

  const sparkles = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (at(x, y) === HL_WATER && rnd() < 0.12) sparkles.push([x * T + rnd() * T, y * T + rnd() * T, rnd() * 6]);
  const view = document.createElement('canvas');
  view.width = W * T; view.height = H * T;
  const light = document.createElement('canvas');
  light.width = W * T; light.height = H * T;
  return { fires, camp: campKey(camp), spots, solid, ground, view, light, marquee, marqueeBulbs, sparkles, doorX };
}

/** Seats round a fire spot, in pixels: `n` of them on an oval inside the ring, from the top clockwise. */
function hlSeats(spot, n) {
  const rx = spot.r * 0.74 * HL_T, ry = spot.r * 0.62 * HL_T;
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: spot.x * HL_T + Math.cos(a) * rx, y: spot.y * HL_T + Math.sin(a) * ry };
  });
}

function hlFlames(g, cx, cy, t, size) {
  hlPx(g, '#3a2416', cx - 7 * size, cy - 1, 14 * size, 3); hlPx(g, '#5b3a22', cx - 6 * size, cy - 2, 12 * size, 2); hlPx(g, '#6e4326', cx - 2, cy - 3 * size, 4, 6 * size);
  hlPx(g, '#ff7a2a', cx - 5 * size, cy - 1, 10 * size, 1);
  const cols = ['#d63a1a', '#ff8a2a', '#ffc94a', '#fff1b0'];
  for (let i = 0; i < 7; i++) {
    const fx = cx - 6 * size + i * 2 * size, hgt = (5 + 7 * Math.sin((Math.PI * (i + 0.5)) / 7) + 2.2 * Math.sin(t * 9 + i * 1.7)) * size;
    for (let c = 0; c < 4; c++) { const hh = Math.round(hgt * (1 - c * 0.25)); hlPx(g, cols[c], Math.round(fx + c * 0.4 * size), Math.round(cy - 2 - hh), Math.max(1, Math.round(2 * size - c * 0.4)), hh); }
  }
}
/** A fire nobody is at: logs and a few embers. */
function hlEmbers(g, cx, cy, t) {
  hlPx(g, '#3a2416', cx - 6, cy - 1, 12, 3); hlPx(g, '#5b3a22', cx - 5, cy - 2, 10, 2);
  for (let i = 0; i < 4; i++) hlPx(g, Math.sin(t * 2 + i * 1.9) > 0 ? '#ff7a2a' : '#a8401a', cx - 4 + i * 2.5, cy - 1, 2, 1);
}

// ---- the hearth's fires on the map

/** The hearth's fires that have a spot on the map, in order, with their spot. */
function mapFires(s) {
  const fires = (s?.channels ?? []).filter((c) => c.kind === 'voice');
  return fires.slice(0, HL_SPOTS.length).map((c, i) => ({ c, spot: HL_SPOTS[i] }));
}
const hlMapFires = () => mapFires(state.servers.get(hl.serverId));

/** The fire whose ring this pixel is in. Leaving takes a little more distance than coming in, so standing on the edge doesn't flicker. */
function hlZoneAt(x, y, was) {
  for (const f of hlMapFires()) {
    const d = Math.hypot(x / HL_T - f.spot.x, (y / HL_T - f.spot.y) / 0.85);
    if (d < f.spot.r + (f.c.id === was ? 0.6 : 0)) return f.c.id;
  }
  return null;
}

/** Who is sitting at each fire: everyone in its call who isn't walking about on the map. */
function hlSeated(f) {
  const ids = (f.c.voiceUsers ?? []).filter((id) => !hl.walkers.has(id) && id !== state.me.id);
  const seats = hlSeats(f.spot, Math.max(f.spot.seats, ids.length));
  return ids.map((id, i) => ({ id, ...seats[i] }));
}

// ---- hearing by distance

/**
 * Where everyone in your call is on the map, for spatial.js, while you're on the map and hearing
 * by distance. Null otherwise, and the fire's own setting applies.
 */
function mapHearing() {
  if (!hl.open || !state.voice || voicePrefs.fullVolume || lowPower()) return null;
  const f = hlMapFires().find((x) => x.c.id === state.voice.channelId);
  if (!f) return null;
  const spots = new Map();
  for (const [id, w] of hl.walkers) spots.set(id, { x: w.x / HL_T, y: w.y / HL_T });
  for (const p of hlSeated(f)) spots.set(p.id, { x: p.x / HL_T, y: p.y / HL_T });
  // Left and right are the screen's, as you see the map.
  const ear = { x: hl.me.x / HL_T, y: hl.me.y / HL_T, fx: 0, fy: -1 };
  // Anyone in the ring is heard fully; outside it they fade, but never out: they're still in your call.
  return { spots, ear, hearing: { near: f.spot.r * 1.2, far: f.spot.r + 10, floor: 0.25, width: 0.6 } };
}

// ---- opening and closing

const hlPrefKey = 'hearthOpensOn';
/** Whether hearths open on the map (yours to choose; phones start on the list). */
const mapFirst = () => (store.get(hlPrefKey) ?? (isPhone() ? 'list' : 'map')) === 'map';

function openMap(serverId = state.serverId) {
  const s = state.servers.get(serverId);
  if (!s?.hearthland) return;
  if (state.stageOpen) { closeStage(); hl.returnToMap = false; }
  if (hl.serverId !== serverId) { hl.walkers.clear(); hl.world = null; hl.backAt = null; }
  hl.serverId = serverId;
  hl.open = true;
  loadCamp(serverId);
  hl.returnToMap = false;
  // Back at the fire you're in, the casino door or the dock, or else on the path below the first fire.
  const fires = hlMapFires();
  const at = fires.find((f) => f.c.id === state.voice?.channelId);
  const spot = hl.backAt ?? (at ? { x: at.spot.x, y: at.spot.y + at.spot.r * 0.4 } : HL_START);
  hl.me.x = spot.x * HL_T; hl.me.y = spot.y * HL_T;
  hl.backAt = null;
  hl.route = []; hl.keys.clear();
  hl.zone = hlZoneAt(hl.me.x, hl.me.y, null);
  hl.failed = null;
  hl.bannerKey = '';
  hl.night = daylight().night > 0.5;
  $('#map-night').checked = hl.night;
  mapDistanceBox();
  $('#map-first').checked = mapFirst();
  $('#map-title').textContent = s.name;
  $('#hearthland').classList.remove('hidden');
  $('#app').classList.add('watching');
  hlSend(true);
  if (!hl.frame) hl.frame = requestAnimationFrame(hlFrame);
  renderChannels();
  updateSpatial();
  $('#map-canvas').focus({ preventScroll: true });
}

/** Off the map. `keepReturn` leaves the way back open (the fire view opened on top of it). */
function closeMap(keepReturn = false) {
  if (!keepReturn) hl.returnToMap = false;
  clearTimeout(hl.pendingJoin?.timer);
  hl.pendingJoin = null;
  if (!hl.open) return;
  hl.open = false;
  hl.keys.clear();
  $('#hearthland').classList.add('hidden');
  if (!state.stageOpen) $('#app').classList.remove('watching');
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type: 'map', serverId: null }));
  cancelAnimationFrame(hl.frame);
  hl.frame = 0;
  renderChannels();
  updateSpatial();
}

/** The fire view is opening: the map steps aside, and closing the fire view brings it back. */
function mapStageOpened() {
  if (!hl.open) return;
  closeMap(true);
  hl.returnToMap = true;
  $('#stage-close').textContent = 'Back to the map';
}
/** The fire view closed: back to the map if that's where it was opened from. */
function mapStageClosed() {
  $('#stage-close').textContent = 'Back to chat';
  if (!hl.returnToMap) return;
  hl.returnToMap = false;
  openMap(hl.serverId);
}
const mapWaiting = () => hl.returnToMap;

/** The hearth just opened: on the map, if that's how you like it. */
function mapOnArrival(s) {
  // Not over the fire view, which may have opened meanwhile (sitting down at a fire in another hearth).
  if (!s?.hearthland || isDm(s) || !mapFirst() || state.stageOpen || state.serverId !== s.id) return;
  showView('chat');
  openMap(s.id);
}

/** The ws came back: the server forgot where you stand. */
function mapReconnected() {
  if (hl.open) hlSend(true);
}

function hlSend(force = false) {
  const ws = state.ws;
  if (!hl.open || ws?.readyState !== WebSocket.OPEN) return;
  const x = hl.me.x / HL_T, y = hl.me.y / HL_T, now = performance.now();
  const s = hl.sent;
  const changed = Math.abs(x - s.x) > 0.02 || Math.abs(y - s.y) > 0.02 || hl.me.moving !== s.moving;
  if (!force && (!changed || now - s.at < 160)) return;
  hl.sent = { at: now, x, y, moving: hl.me.moving };
  ws.send(JSON.stringify({ type: 'map', serverId: hl.serverId, x, y, moving: hl.me.moving }));
}

function onMapEvent(ev) {
  if (ev.serverId !== hl.serverId) return;
  if (ev.type === 'map_state') {
    hl.walkers.clear();
    for (const w of ev.walkers) hl.walkers.set(w.userId, { x: w.x * HL_T, y: w.y * HL_T, tx: w.x * HL_T, ty: w.y * HL_T, moving: w.moving });
  } else if (ev.type === 'map_move') {
    const w = hl.walkers.get(ev.userId);
    if (w) Object.assign(w, { tx: ev.x * HL_T, ty: ev.y * HL_T, moving: ev.moving });
    else hl.walkers.set(ev.userId, { x: ev.x * HL_T, y: ev.y * HL_T, tx: ev.x * HL_T, ty: ev.y * HL_T, moving: ev.moving });
  } else if (ev.type === 'map_gone') {
    hl.walkers.delete(ev.userId);
  } else if (ev.type === 'map_elsewhere') {
    if (hl.open) { closeMap(); toast('You opened the map on another device.'); }
  }
}

// ---- the sidebar's way in, and the hearth setting

function renderMapRow(s) {
  const row = $('#map-row');
  const on = !!s?.hearthland && !state.inDms;
  row.classList.toggle('hidden', !on);
  row.classList.toggle('active', on && hl.open && hl.serverId === s.id);
  row.setAttribute('aria-current', on && hl.open ? 'page' : 'false');
  // Turned off while you were on it, or you're looking at another hearth now.
  if (hl.open && (!on || hl.serverId !== s?.id)) closeMap();
}
$('#map-row').onclick = () => { showView('chat'); openMap(state.serverId); };

// ---- walking about

function hlFeetBlocked(x, y) {
  const w = hl.world;
  // Nobody stands in the fire.
  if (hlMapFires().some((f) => Math.hypot(x / HL_T - f.spot.x, (y / HL_T - f.spot.y - 0.3) / 0.8) < 0.8)) return true;
  return [[-4, -3], [4, -3], [-4, 0], [4, 0]].some(([ox, oy]) => {
    const tx = Math.floor((x + ox) / HL_T), ty = Math.floor((y + oy) / HL_T);
    return tx < 0 || ty < 0 || tx >= HL_W || ty >= HL_H || w.solid(tx, ty);
  });
}

/** The way there round trees and water, tile by tile; to the nearest open tile if that one isn't. */
function hlFindRoute(tx, ty) {
  const solid = (x, y) => x < 0 || y < 0 || x >= HL_W || y >= HL_H || hl.world.solid(x, y);
  if (solid(tx, ty)) {
    let best = null, bd = 9;
    for (let oy = -3; oy <= 3; oy++) for (let ox = -3; ox <= 3; ox++) if (!solid(tx + ox, ty + oy) && Math.hypot(ox, oy) < bd) { bd = Math.hypot(ox, oy); best = [tx + ox, ty + oy]; }
    if (!best) return [];
    [tx, ty] = best;
  }
  const sx = Math.floor(hl.me.x / HL_T), sy = Math.floor((hl.me.y - 2) / HL_T);
  const prev = new Int32Array(HL_W * HL_H).fill(-1), q = [sy * HL_W + sx];
  prev[sy * HL_W + sx] = sy * HL_W + sx;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi], cx = c % HL_W, cy = (c / HL_W) | 0;
    if (cx === tx && cy === ty) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy, n = ny * HL_W + nx;
      if (solid(nx, ny) || prev[n] !== -1) continue;
      prev[n] = c;
      q.push(n);
    }
  }
  const end = ty * HL_W + tx;
  if (prev[end] === -1) return [];
  const out = [];
  for (let c = end; c !== prev[c]; c = prev[c]) out.unshift([((c % HL_W) + 0.5) * HL_T, (((c / HL_W) | 0) + 0.7) * HL_T]);
  return out;
}

const HL_MOVE_KEYS = { arrowup: 'u', w: 'u', arrowdown: 'd', s: 'd', arrowleft: 'l', a: 'l', arrowright: 'r', d: 'r' };
$('#map-canvas').addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (HL_MOVE_KEYS[k] && !e.ctrlKey && !e.metaKey && !e.altKey) {
    hl.keys.add(HL_MOVE_KEYS[k]);
    hl.route = [];
    e.preventDefault();
  } else if ((k === 'e' || k === 'enter') && hl.current?.run) {
    e.preventDefault();
    hl.current.run();
  }
});
$('#map-canvas').addEventListener('keyup', (e) => hl.keys.delete(HL_MOVE_KEYS[e.key.toLowerCase()]));
$('#map-canvas').addEventListener('blur', () => hl.keys.clear());
$('#map-canvas').addEventListener('pointerdown', (e) => {
  if (!hl.world) return;
  $('#map-canvas').focus({ preventScroll: true });
  const r = e.currentTarget.getBoundingClientRect();
  const { dpr, S, cam } = hl.view;
  hl.route = hlFindRoute(Math.floor((cam.x + ((e.clientX - r.left) * dpr) / S) / HL_T), Math.floor((cam.y + ((e.clientY - r.top) * dpr) / S) / HL_T));
});
hl.view = { dpr: 1, S: 3, cam: { x: 0, y: 0 } };
new ResizeObserver(() => {
  const canvas = $('#map-canvas'), v = hl.view;
  v.dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvas.clientWidth * v.dpr);
  canvas.height = Math.round(canvas.clientHeight * v.dpr);
  // About 24 tiles across, in whole pixels so the art stays crisp, and never smaller than the map.
  v.S = Math.max(2, Math.round(canvas.width / (24 * HL_T)));
  if (canvas.width / v.S > HL_W * HL_T) v.S = Math.ceil(canvas.width / (HL_W * HL_T));
  if (canvas.height / v.S > HL_H * HL_T) v.S = Math.max(v.S, Math.ceil(canvas.height / (HL_H * HL_T)));
}).observe($('#map-canvas'));

// ---- what's here: the banner's words and button

const hlNames = (ids) => {
  const names = ids.map((id) => nameOf(id));
  return names.length <= 3 ? names.join(names.length === 2 ? ' and ' : ', ').replace(/, ([^,]*)$/, ' and $1') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
};

/** Joins the fire for the casino or the dock, if you aren't at one in this hearth, then runs `then`. */
function hlAtAFire(then) {
  const here = hlMapFires().find((f) => f.c.id === state.voice?.channelId);
  const first = hlMapFires()[0];
  if (!here && !first) return;
  hl.backAt = { x: hl.me.x / HL_T, y: hl.me.y / HL_T };
  mapStageOpened();
  if (!here) joinVoice(first.c.id, { stay: true });
  then();
}

function hlContext() {
  const s = state.servers.get(hl.serverId);
  const fires = hlMapFires();
  const near = (p, r) => Math.hypot(hl.me.x / HL_T - p.x, hl.me.y / HL_T - p.y) < r;
  const here = fires.find((f) => f.c.id === state.voice?.channelId);
  const joinNote = here ? '' : fires[0] ? ` Going in joins ${escapeHtml(fires[0].c.name)}.` : '';
  if (hl.zone) {
    const f = fires.find((x) => x.c.id === hl.zone);
    if (!f) return { key: 'gone', html: 'That fire is gone.' };
    const name = `<b>${escapeHtml(f.c.name)}</b>`;
    if (!state.voiceEnabled) return { key: `nv${f.c.id}`, html: `${name} · Fires aren't set up on this server yet.` };
    if (hl.failed === f.c.id) return { key: `x${f.c.id}`, html: `${name} · Couldn't join. Walk out and back in to try again.` };
    if (state.voice?.channelId !== f.c.id) return { key: `j${f.c.id}`, html: `${name} · Joining…` };
    if (!voicePhase.is('connected', 'securing')) return { key: `c${f.c.id}`, html: `${name} · Connecting…` };
    const others = (f.c.voiceUsers ?? []).filter((id) => id !== state.me.id);
    const on = liveEventAt(s, f.c.id);
    const who = others.length ? `You're in the call with ${escapeHtml(hlNames(others))}.` : "You're in the call. Nobody else is here yet.";
    return { key: `in${f.c.id}:${others.join(',')}:${on?.title ?? ''}`, html: `${name} · ${who}${on ? ` ${escapeHtml(on.title)} is on now.` : ''}`, label: 'Sit down', run: goToVoice };
  }
  if (near(HL_DOCK, 1.8)) return { key: `dock${!!here}`, html: `<b>The dock</b> · Fish with Fireside Angler.${joinNote}`, label: 'Start fishing', run: () => hlAtAFire(openFishing) };
  if (near(HL_DOOR, 1.6)) return { key: `casino${!!here}`, html: `<b>Casino</b> · Hold 'em, blackjack, slots and cases.${joinNote}`, label: 'Go inside', run: () => hlAtAFire(() => openCasino()) };
  if (near({ x: 9.5, y: 25.5 }, 3.2)) return { key: 'casino-near', html: '<b>Casino</b> · Walk up the red carpet to go in.' };
  const site = campContext(campState.get(hl.serverId), hl.me.x / HL_T, hl.me.y / HL_T);
  if (site) return site;
  const more = (s?.channels ?? []).filter((c) => c.kind === 'voice').length - fires.length;
  return { key: `path${more}`, html: `Walk into a fire's ring to join its call.${more > 0 ? ` ${more === 1 ? 'One more fire is' : `${more} more fires are`} in the list.` : ''}` };
}

$('#map-act').onclick = () => hl.current?.run?.();
$('#map-back').onclick = () => { closeMap(); showView('rooms'); };
$('#map-close').onclick = () => closeMap();
$('#map-look').onclick = () => openLookEditor();
$('#map-camp').onclick = () => openCampPanel(hl.serverId);
$('#map-night').onchange = (e) => { hl.night = e.target.checked; };
/** "Hear by distance" is off while low resource mode is on, since that skips the mixing. */
function mapDistanceBox() {
  const box = $('#map-distance');
  box.checked = !voicePrefs.fullVolume && !lowPower();
  box.disabled = lowPower();
  box.closest('label').title = lowPower() ? 'Off in low resource mode.' : '';
}
$('#map-distance').onchange = (e) => { voicePrefs.fullVolume = !e.target.checked; saveVoicePrefs(); updateSpatial(); };
$('#map-first').onchange = (e) => store.set(hlPrefKey, e.target.checked ? 'map' : 'list');

// ---- each frame

function hlFrame(now) {
  hl.frame = 0;
  if (!hl.open) return;
  hl.frame = requestAnimationFrame(hlFrame);
  // Low resource mode: 20 frames a second while anyone moves, 2 while the map only flickers.
  if (lowPower()) {
    const busy = hl.keys.size || hl.route.length || [...hl.walkers.values()].some((p) => Math.abs(p.tx - p.x) + Math.abs(p.ty - p.y) > 0.5);
    if (now - (hl.last || 0) < (busy ? 48 : 500)) return;
  }
  const dt = Math.min(0.05, (now - (hl.last || now)) / 1000);
  hl.last = now;
  const t = now / 1000;
  const fires = hlMapFires();
  const camp = campState.get(hl.serverId) ?? null;
  if (!hl.world || hl.world.fires !== fires.length || hl.world.camp !== campKey(camp)) {
    hl.world = hlBuildWorld(fires.length, camp);
    // Something was just built where you stand: step back onto the path.
    if (hlFeetBlocked(hl.me.x, hl.me.y)) { hl.me.x = HL_START.x * HL_T; hl.me.y = HL_START.y * HL_T; hl.route = []; }
  }
  const w = hl.world, T = HL_T, me = hl.me;

  // You.
  let vx = 0, vy = 0;
  if (hl.keys.has('l')) vx -= 1;
  if (hl.keys.has('r')) vx += 1;
  if (hl.keys.has('u')) vy -= 1;
  if (hl.keys.has('d')) vy += 1;
  if (!vx && !vy && hl.route.length) {
    const [rx, ry] = hl.route[0], dx = rx - me.x, dy = ry - me.y, d = Math.hypot(dx, dy);
    if (d < 2) hl.route.shift();
    else { vx = dx / d; vy = dy / d; }
  }
  me.moving = !!(vx || vy);
  if (me.moving) {
    const sp = 78 * dt, n = Math.hypot(vx, vy) || 1;
    const nx = me.x + (vx / n) * sp, ny = me.y + (vy / n) * sp;
    if (!hlFeetBlocked(nx, me.y)) me.x = nx; else if (hl.route.length) hl.route = [];
    if (!hlFeetBlocked(me.x, ny)) me.y = ny; else if (hl.route.length) hl.route = [];
  }
  hlSend();
  // Everyone else glides to where they last said they were.
  for (const p of hl.walkers.values()) { const k = Math.min(1, dt * 10); p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k; }

  // Into a ring joins its call (after a moment, so walking past doesn't); out of it leaves.
  const zone = hlZoneAt(me.x, me.y, hl.zone);
  if (zone !== hl.zone) {
    const was = hl.zone;
    hl.zone = zone;
    clearTimeout(hl.pendingJoin?.timer);
    hl.pendingJoin = null;
    if (was !== null) {
      if (hl.failed === was) hl.failed = null;
      if (state.voice?.channelId === was) leaveVoice();
    }
    if (zone !== null && state.voice?.channelId !== zone && state.voiceEnabled) {
      hl.pendingJoin = {
        id: zone,
        timer: setTimeout(() => {
          hl.pendingJoin = null;
          if (!hl.open || hl.zone !== zone) return;
          joinVoice(zone, { stay: true }).then(() => { if (hl.zone === zone && state.voice?.channelId !== zone) hl.failed = zone; });
        }, 350),
      };
    }
  }
  if (state.voice && now - hl.spatialAt > 150) { hl.spatialAt = now; updateSpatial(); }

  // The world.
  const wg = w.view.getContext('2d');
  wg.drawImage(w.ground, 0, 0);
  for (const [sx, sy, ph] of w.sparkles) if (Math.sin(t * 2 + ph) > 0.7) hlPx(wg, '#d6ecf6', sx, sy, 2, 1);
  const s = state.servers.get(hl.serverId);
  for (const f of fires) {
    const cx = f.spot.x * T, cy = f.spot.y * T + 2, lit = (f.c.voiceUsers ?? []).length > 0;
    if (lit) hlFlames(wg, cx, cy, t * (1 + f.c.id % 3 * 0.07), f.spot === HL_SPOTS[0] ? 1 : 0.7);
    else hlEmbers(wg, cx, cy, t);
    // An event on now: string lights over the ring.
    if (liveEventAt(s, f.c.id)) {
      const ax = cx - f.spot.r * 0.95 * T, bx = cx + f.spot.r * 0.95 * T, top = cy - f.spot.r * 0.95 * T;
      hlPx(wg, '#5b3a22', ax - 1, top - 2, 2, 26); hlPx(wg, '#5b3a22', bx - 1, top - 2, 2, 26);
      for (let i = 0; i <= 12; i++) { const u = i / 12; hlPx(wg, ['#ffd35a', '#f08a4b', '#fff1c2'][(i + Math.floor(t * 2)) % 3], Math.round(ax + (bx - ax) * u) - 1, Math.round(top + Math.sin(Math.PI * u) * 9), 2, 2); }
    }
  }
  // The lodge's chimney smokes.
  for (let i = 0; i < 6; i++) { const p = (i / 6 + t * 0.12) % 1; wg.fillStyle = `rgba(220,215,205,${0.55 * (1 - p)})`; wg.beginPath(); wg.arc(6 * T + 67 + Math.sin(t + p * 6) * 3 + p * 8, 3 * T - 10 - p * 30, 2 + p * 4, 0, Math.PI * 2); wg.fill(); }
  const chase = Math.floor(t * 8), m = w.marquee;
  hlPixText(wg, 'CASINO', Math.round(m.x + (m.w - 27) / 2), m.y + 6, (chase >> 3) % 2 ? '#ffd35a' : '#ffe9a0');
  w.marqueeBulbs.forEach(([bx, by], i) => hlPx(wg, (i + chase) % 3 ? '#ffd35a' : '#7a5a1e', bx, by, 1, 1));
  const C = HL_CASINO;
  for (const lx of [C.x0 * T - 6, (C.x0 + C.w) * T + 4]) { hlPx(wg, '#ffe9a0', lx - 1, (C.y0 + C.h) * T - 23, 4, 3); hlPx(wg, '#c9953a', lx - 2, (C.y0 + C.h) * T - 24, 6, 1); }
  hlPx(wg, '#5b3a22', 33.6 * T, 11 * T - 6, 1, 8); hlPx(wg, '#2a2226', 33.6 * T - 2, 11 * T - 11, 5, 1); hlPx(wg, '#ffd35a', 33.6 * T - 1, 11 * T - 10, 3, 3);
  campDrawFrame(wg, camp, t);

  // People, back to front.
  const people = [{ id: state.me.id, x: me.x, y: me.y, moving: me.moving, me: true }];
  for (const [id, p] of hl.walkers) people.push({ id, x: p.x, y: p.y, moving: p.moving });
  for (const f of fires) for (const p of hlSeated(f)) people.push({ ...p, sit: true });
  people.sort((a, b) => a.y - b.y);
  for (const p of people) hlPerson(wg, lookOf(p.id), p.x, p.y, t, { moving: p.moving, sit: p.sit });

  if (hl.night) {
    const lg = w.light.getContext('2d');
    lg.globalCompositeOperation = 'source-over';
    lg.clearRect(0, 0, w.light.width, w.light.height);
    lg.fillStyle = 'rgba(12, 16, 42, .68)';
    lg.fillRect(0, 0, w.light.width, w.light.height);
    lg.globalCompositeOperation = 'destination-out';
    const glow = (x, y, r) => { const gr = lg.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); lg.fillStyle = gr; lg.fillRect(x - r, y - r, r * 2, r * 2); };
    for (const f of fires) { const lit = (f.c.voiceUsers ?? []).length > 0; glow(f.spot.x * T, f.spot.y * T, (lit ? f.spot.r * 20 : 26) + Math.sin(t * 7 + f.c.id) * 3); }
    glow(6 * T + 16, 3 * T + 31, 22); glow(6 * T + 64, 3 * T + 31, 22);
    glow(w.doorX, m.y + 8, 40); glow(w.doorX, (C.y0 + C.h) * T + 8, 40); glow(C.x0 * T + 14, C.y0 * T + 37, 22); glow(C.x0 * T + 98, C.y0 * T + 37, 22);
    glow(C.x0 * T - 5, (C.y0 + C.h) * T - 22, 26); glow((C.x0 + C.w) * T + 5, (C.y0 + C.h) * T - 22, 26);
    glow(33.6 * T, 10.5 * T, 26);
    glow(me.x, me.y - 8, 30);
    campGlows(glow, camp, t);
    wg.drawImage(w.light, 0, 0);
    campNightLights(wg, camp);
    hlPx(wg, 'rgba(255,196,107,.85)', 6 * T + 10, 3 * T + 26, 12, 10); hlPx(wg, 'rgba(255,196,107,.85)', 6 * T + 58, 3 * T + 26, 12, 10);
    hlPixText(wg, 'CASINO', Math.round(m.x + (m.w - 27) / 2), m.y + 6, '#ffe28a');
    w.marqueeBulbs.forEach(([bx, by], i) => (i + chase) % 3 && hlPx(wg, '#ffd35a', bx, by, 1, 1));
  }

  // Onto the screen, following you.
  const canvas = $('#map-canvas'), ctx = canvas.getContext('2d'), { dpr, S, cam } = hl.view;
  const vw = canvas.width / S, vh = canvas.height / S;
  cam.x = vw >= HL_W * T ? (HL_W * T - vw) / 2 : Math.max(0, Math.min(HL_W * T - vw, me.x - vw / 2));
  cam.y = vh >= HL_H * T ? (HL_H * T - vh) / 2 : Math.max(0, Math.min(HL_H * T - vh, me.y - vh / 2 - (28 * dpr) / S)); // a little low, clear of the banner
  cam.x = Math.round(cam.x * S) / S; cam.y = Math.round(cam.y * S) / S;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#1b2a17';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(w.view, cam.x, cam.y, vw, vh, 0, 0, canvas.width, canvas.height);
  const sx = (x) => (x - cam.x) * S, sy = (y) => (y - cam.y) * S;
  // The ring you're near, dashed, brighter when you're in it.
  for (const f of fires) {
    const d = Math.hypot(me.x / T - f.spot.x, me.y / T - f.spot.y);
    if (d > f.spot.r + 3) continue;
    ctx.save();
    ctx.globalAlpha = Math.min(0.7, (f.spot.r + 3 - d) / 3);
    ctx.strokeStyle = hl.zone === f.c.id ? '#ffc46b' : '#f4ead8';
    ctx.lineWidth = 2 * dpr;
    ctx.setLineDash([4 * dpr, 5 * dpr]);
    ctx.beginPath();
    ctx.ellipse(sx(f.spot.x * T), sy(f.spot.y * T), f.spot.r * T * S, f.spot.r * T * S * 0.85, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  const vg = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) * 0.45, canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(10,8,4,.32)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Talking rings (for the people in your call) and names.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fs = Math.max(11, Math.min(13, S * 3.4)) * dpr;
  for (const p of people) {
    const o = p.sit ? 3 : 0, hx = sx(p.x), hy = sy(p.y - 15 + o);
    if (hx < -60 || hy < -60 || hx > canvas.width + 60 || hy > canvas.height + 60) continue;
    if (state.speaking.has(p.id)) {
      ctx.save(); ctx.strokeStyle = '#f08a4b'; ctx.lineWidth = 2.5 * dpr;
      ctx.beginPath(); ctx.arc(hx, hy, (7 + Math.sin(t * 12) * 0.6) * S, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    const name = p.me ? 'You' : nameOf(p.id);
    const look = lookOf(p.id);
    ctx.font = `700 ${fs}px "Nunito Sans", system-ui, sans-serif`;
    const tw = ctx.measureText(name).width + 12 * dpr, top = look.hat === 'antlers' || look.hat === 'beanie' ? 26 : 23, ny = sy(p.y - top + o) - fs * 0.9;
    ctx.fillStyle = p.me ? 'rgba(185,80,26,.94)' : 'rgba(24,17,12,.72)';
    ctx.beginPath(); ctx.roundRect(hx - tw / 2, ny - fs * 0.75, tw, fs * 1.5, fs * 0.75); ctx.fill();
    ctx.fillStyle = '#fbf4ec';
    ctx.fillText(name, hx, ny + dpr * 0.5);
  }
  const label = (text, x, y) => {
    const lf = Math.max(12, Math.min(16, S * 4)) * dpr;
    ctx.font = `700 ${lf}px Fraunces, Georgia, serif`;
    const X = sx(x), Y = sy(y);
    if (X < -100 || Y < -40 || X > canvas.width + 100 || Y > canvas.height + 40) return;
    ctx.lineWidth = 4 * dpr; ctx.strokeStyle = 'rgba(24,17,12,.75)'; ctx.strokeText(text, X, Y);
    ctx.fillStyle = '#ffe2b8'; ctx.fillText(text, X, Y);
  };
  for (const f of fires) label(f.c.name.length > 20 ? f.c.name.slice(0, 19) + '…' : f.c.name, f.spot.x * T, (f.spot.y + f.spot.r * 0.85 + 0.9) * T);
  label('Dock', 30.5 * T, 12.6 * T);

  hl.current = hlContext();
  if (hl.current.key !== hl.bannerKey) {
    hl.bannerKey = hl.current.key;
    $('#map-banner-text').innerHTML = hl.current.html;
    $('#map-act').hidden = !hl.current.label;
    if (hl.current.label) $('#map-act').textContent = hl.current.label;
  }
}

// ---- your look: the editor

const HL_LOOK_GROUPS = [
  { label: 'Skin', key: 'skin', swatches: HL_SKINS.map((c, i) => [i, c, `Skin tone ${i + 1}`]) },
  { label: 'Hair', key: 'hairStyle', pills: HL_HAIR_STYLES },
  { label: 'Hair color', key: 'hair', swatches: HL_HAIR.map((c, i) => [i, c, `Hair color ${i + 1}`]) },
  { label: 'Top', key: 'top', pills: HL_TOP_STYLES },
  { label: 'Top color', key: 'topColor', swatches: HL_TOPS.map((c, i) => [i, c, HL_TOP_NAMES[i]]) },
  { label: 'Pants', key: 'pants', swatches: HL_PANTS.map((c, i) => [i, c, HL_PANT_NAMES[i]]) },
  { label: 'Hat', key: 'hat', pills: HL_HATS },
];

function openLookEditor() {
  const look = { ...lookOf(state.me.id) };
  modal(`<h2>Your look</h2>
    <p class="small muted">How you look on every hearth's map.</p>
    <div class="look-edit">
      <div class="look-preview"><div class="look-stage"><canvas id="look-canvas" width="24" height="30" role="img" aria-label="Your character"></canvas></div>
        <button type="button" class="btn secondary" id="look-shuffle">Shuffle</button></div>
      <div class="look-opts">${HL_LOOK_GROUPS.map((g) => `<div class="look-row"><span id="look-l-${g.key}">${g.label}</span><div class="look-set" role="group" aria-labelledby="look-l-${g.key}">${
        (g.pills ? g.pills.map(([v, text]) => `<button type="button" class="look-pill" data-key="${g.key}" data-val="${v}">${text}</button>`)
          : g.swatches.map(([v, c, text]) => `<button type="button" class="look-sw" data-key="${g.key}" data-val="${v}" style="background:${c}" aria-label="${text}" title="${text}"></button>`)).join('')
      }</div></div>`).join('')}</div>
    </div>
    <div class="error" id="modal-error"></div>
    <div class="modal-row"><button type="button" class="btn secondary" data-close>Cancel</button><button type="button" class="btn" id="look-save">Save</button></div>`, 'look-modal');
  const card = $('#modal-card');
  const sync = () => {
    for (const b of card.querySelectorAll('[data-key]')) b.setAttribute('aria-pressed', String(String(look[b.dataset.key]) === b.dataset.val));
    const c = $('#look-canvas'), g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    hlPerson(g, look, 12, 28, 0);
  };
  card.querySelectorAll('[data-key]').forEach((b) => (b.onclick = () => {
    const k = b.dataset.key;
    look[k] = ['skin', 'hair', 'topColor', 'pants'].includes(k) ? Number(b.dataset.val) : b.dataset.val;
    sync();
  }));
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  $('#look-shuffle').onclick = () => {
    Object.assign(look, {
      skin: Math.floor(Math.random() * HL_SKINS.length), hairStyle: pick(HL_HAIR_STYLES)[0], hair: Math.floor(Math.random() * HL_HAIR.length),
      top: pick(HL_TOP_STYLES)[0], topColor: Math.floor(Math.random() * HL_TOPS.length), pants: Math.floor(Math.random() * HL_PANTS.length), hat: pick(HL_HATS)[0],
    });
    sync();
  };
  $('#look-save').onclick = async () => {
    try {
      const r = await api('/api/me/look', { method: 'PUT', body: { look } });
      applyUser({ id: state.me.id, avatar: state.me.avatar, look: r.look });
      closeModal();
    } catch (err) { $('#modal-error').textContent = err.message; }
  };
  sync();
}
