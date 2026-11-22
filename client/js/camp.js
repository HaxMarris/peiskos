// ---------------------------------------------------------------- The camp grows
//
// What a hearth does together builds up its camp on the hearth map (js/hearthland.js): hours at
// the fires, games played together and fish caught add up to camp points, and each build goes up
// at a number of points and stays. Each season has one shared goal, and meeting it leaves a
// keepsake on the map. The server counts it all (server/src/camp.ts); this draws it and shows the
// camp panel.

// Where each build stands, in tiles. `block` is the tiles you can't walk through. The ground
// around every site is kept clear of trees from the start, so the map doesn't change shape as
// things go up: an empty clearing is where something will be built.
const CAMP_SITES = {
  woodpile: { x: 28.9, y: 16.6, block: [[28, 16], [29, 16]], clear: 1.6 },
  boat: { x: 30.8, y: 12.6, block: [], clear: 0 },
  cabin: { x: 38.5, y: 17.4, block: [[37, 16], [38, 16], [39, 16], [40, 16], [37, 17], [38, 17], [39, 17], [40, 17]], clear: 3.2 },
  garden: { x: 4.5, y: 14.6, block: [[3, 13], [4, 13], [5, 13], [3, 14], [4, 14], [5, 14]], clear: 2.6 },
  sauna: { x: 26.5, y: 7.8, block: [[25, 6], [26, 6], [27, 6], [25, 7], [26, 7], [27, 7]], clear: 2.6 },
  tower: { x: 16, y: 26.6, block: [[15, 25], [16, 25], [15, 26], [16, 26]], clear: 2.4 },
  flag: { x: 19.5, y: 23.8, block: [[19, 23]], clear: 1.4 },
};
// The lantern path: posts beside the paths out of the Campfire. They don't block the way.
const CAMP_LANTERNS = [[19.6, 21.2], [14.1, 21.1], [27.5, 13.7], [21.2, 22], [21.2, 26], [16.5, 15.2], [12.9, 13.5]];
// Each season's keepsake, round the Campfire, where it stays once the goal is met.
const CAMP_KEEPSAKES = { winter: [19, 12.2], spring: [25.2, 10.6], summer: [16.6, 18.4], autumn: [27.6, 19.6] };

/** Clearings to keep free of trees, as [x, y, radius] like hlBuildWorld's own. */
const campClearings = () => [
  ...Object.values(CAMP_SITES).filter((s) => s.clear).map((s) => [s.x, s.y - 0.6, s.clear]),
  ...CAMP_LANTERNS.map(([x, y]) => [x, y, 0.9]),
  ...Object.values(CAMP_KEEPSAKES).map(([x, y]) => [x, y, 1.3]),
];

const campState = new Map(); // hearth id -> the camp as the server last sent it

const campBuilt = (camp, id) => !!camp?.builds.find((b) => b.id === id && b.built);
/** What's built and kept on a camp, as one string, so the map knows when to draw itself again. */
const campKey = (camp) => (camp ? `${camp.builds.filter((b) => b.built).map((b) => b.id).join(',')}|${camp.keepsakes.map((k) => k.key).join(',')}` : '');
/** Tiles the camp's builds take up, as y * width + x. */
function campBlocked(camp, width) {
  const out = new Set();
  for (const [id, site] of Object.entries(CAMP_SITES)) if (campBuilt(camp, id)) for (const [x, y] of site.block) out.add(y * width + x);
  return out;
}

async function loadCamp(serverId) {
  try {
    const camp = await api(`/api/servers/${serverId}/camp`);
    campState.set(serverId, camp);
  } catch { /* the map draws without it, and tries again next time it opens */ }
}

/** Something went up, or the season's goal was met. */
function onCampEvent(ev) {
  campState.set(ev.serverId, ev.camp);
  const s = state.servers.get(ev.serverId);
  if (!s?.hearthland) return;
  if ($('#camp-panel')) openCampPanel(ev.serverId);
  const whose = state.servers.size > 1 || state.serverId !== ev.serverId ? `${s.name}'s camp` : 'The camp';
  const list = (names) => names.map((n) => n.toLowerCase()).join(' and ');
  if (ev.built?.length) toast(`${whose} has a new ${list(ev.built)}.`);
  if (ev.met) {
    const k = ev.camp.keepsakes.find((x) => x.name === ev.met);
    toast(`${s.name} met the ${ev.met} goal.${k ? ` The ${k.keepsake.toLowerCase()} stays on the map.` : ''}`);
  }
}

// ---- drawing

/** The builds and keepsakes that don't move, onto the map's ground (drawn once). */
function campDrawGround(g, camp) {
  const T = HL_T, px = (c, x, y, w = 1, h = 1) => hlPx(g, c, Math.round(x), Math.round(y), w, h);
  const has = (id) => campBuilt(camp, id);
  const at = (id) => ({ X: CAMP_SITES[id].x * T, Y: CAMP_SITES[id].y * T });

  if (has('woodpile')) {
    const { X, Y } = at('woodpile');
    px('rgba(0,0,0,.22)', X - 14, Y - 2, 30, 4);
    for (let row = 0; row < 3; row++) for (let i = 0; i < 5 - row; i++) {
      const lx = X - 13 + row * 3 + i * 6, ly = Y - 7 - row * 5;
      px('#6e4326', lx, ly, 6, 5); px('#87562f', lx, ly, 6, 1); px('#d1a571', lx + 1, ly + 1, 3, 3); px('#a47a4d', lx + 2, ly + 2, 1, 1);
    }
    px('#8a8a8a', X + 13, Y - 10, 1, 9); px('#5b3a22', X + 12, Y - 3, 3, 2); px('#b8b8b8', X + 11, Y - 11, 4, 2); // an axe in a stump
  }

  if (has('lanterns')) for (const [lx, ly] of CAMP_LANTERNS) {
    const X = lx * T, Y = ly * T;
    px('rgba(0,0,0,.2)', X - 3, Y, 7, 2); px('#3b2416', X - 1, Y - 13, 2, 13); px('#2a1a12', X - 3, Y - 15, 6, 2);
    px('#2a1a12', X - 3, Y - 21, 6, 1); px('#d9a441', X - 2, Y - 20, 4, 5); px('#2a1a12', X - 2, Y - 18, 4, 1);
  }

  if (has('cabin')) {
    const X = 37 * T, Y = 16 * T, w = 4 * T;
    px('rgba(0,0,0,.25)', X + 3, Y + 2 * T - 2, w, 5);
    for (let i = 0; i < 4; i++) { const yy = Y + 8 + i * 6; px(i % 2 ? '#8a5a34' : '#7a4f2d', X, yy, w, 6); px('#5a361f', X, yy + 5, w, 1); px('#c99a66', X - 2, yy + 1, 3, 3); px('#c99a66', X + w - 1, yy + 1, 3, 3); }
    for (let r = 0; r < 14; r++) px(r % 4 === 3 ? '#3a4a5c' : r < 3 ? '#6a8098' : '#55697f', X - 4 + Math.max(0, 6 - r), Y - 10 + r, w + 8 - 2 * Math.max(0, 6 - r), 1);
    px('#3b2416', X + 26, Y + 14, 12, 18); px('#4e3020', X + 27, Y + 15, 10, 16); px('#d9a441', X + 35, Y + 23, 1, 2);
    px('#c99a66', X + 7, Y + 15, 12, 10); px('#2a1a12', X + 8, Y + 16, 10, 8); px('#c99a66', X + 12, Y + 16, 1, 8); px('#c99a66', X + 8, Y + 19, 10, 1);
    px('#c99a66', X + 45, Y + 15, 12, 10); px('#2a1a12', X + 46, Y + 16, 10, 8); px('#c99a66', X + 50, Y + 16, 1, 8); px('#c99a66', X + 46, Y + 19, 10, 1);
  }

  if (has('garden')) {
    const X = 3 * T, Y = 13 * T, w = 3 * T, h = 2 * T;
    px('#6b4a2e', X + 2, Y + 3, w - 4, h - 6);
    for (let r = 0; r < 4; r++) {
      const ry = Y + 6 + r * 6;
      px('#5a3c24', X + 4, ry + 3, w - 8, 1);
      for (let i = 0; i < 6; i++) {
        const cx = X + 7 + i * 6;
        px('#4f8f45', cx, ry, 1, 3); px('#5fa75c', cx - 1, ry, 1, 1); px('#5fa75c', cx + 1, ry + 1, 1, 1);
        if ((r + i) % 3 === 0) px(r % 2 ? '#e06a2a' : '#c0383a', cx, ry - 1, 2, 2);
      }
    }
    for (let i = 0; i <= w; i += 6) { px('#c99a66', X + i - 1, Y - 2, 2, 7); px('#c99a66', X + i - 1, Y + h - 5, 2, 7); }
    for (let j = 0; j <= h; j += 6) { px('#c99a66', X - 1, Y + j - 2, 2, 5); px('#c99a66', X + w - 1, Y + j - 2, 2, 5); }
    px('#d9b580', X - 1, Y, w + 2, 1); px('#d9b580', X - 1, Y + h - 2, w + 2, 1);
  }

  if (has('sauna')) {
    const X = 25 * T, Y = 6 * T, w = 3 * T;
    px('rgba(0,0,0,.25)', X + 3, Y + 2 * T - 2, w, 5);
    px('#4a2e1c', X, Y + 6, w, 2 * T - 6);
    for (let i = 0; i < w; i += 4) px('#3a2416', X + i, Y + 6, 1, 2 * T - 6);
    for (let r = 0; r < 10; r++) px(r < 2 ? '#5d5954' : '#4a4642', X - 3 + Math.max(0, 4 - r), Y - 4 + r, w + 6 - 2 * Math.max(0, 4 - r), 1);
    px('#7a7570', X + 36, Y - 12, 6, 12); px('#5d5954', X + 36, Y - 13, 6, 1);
    px('#2a1a12', X + 8, Y + 14, 10, 18); px('#d9a441', X + 16, Y + 23, 1, 2);
    px('#c99a66', X + 26, Y + 14, 10, 7); px('#ffc46b', X + 27, Y + 15, 8, 5);
    px('#8a6a44', X + 2, Y + 2 * T, w - 4, 3); // a bench out front
    px('#6b6b6b', X + 40, Y + 2 * T - 4, 5, 5); px('#9a958d', X + 40, Y + 2 * T - 4, 5, 1); // the water bucket
  }

  if (has('tower')) {
    const X = 15 * T, Y = 27 * T;
    px('rgba(0,0,0,.25)', X - 2, Y - 3, 2 * T + 6, 5);
    for (const lx of [X + 1, X + 2 * T - 4]) { px('#5b3a22', lx, Y - 52, 3, 52); px('#6e4326', lx, Y - 52, 1, 52); }
    for (let j = 0; j < 3; j++) { const yy = Y - 14 - j * 14; for (let i = 0; i < 2 * T - 6; i++) px('#6e4326', X + 3 + i, yy + Math.round((i / (2 * T - 6)) * 10 * (j % 2 ? 1 : -1)) + (j % 2 ? -10 : 0), 1, 1); }
    px('#3b2416', X - 3, Y - 56, 2 * T + 6, 5); px('#87562f', X - 3, Y - 56, 2 * T + 6, 1);
    for (let i = 0; i < 2 * T + 6; i += 4) px('#5b3a22', X - 3 + i, Y - 64, 1, 8);
    px('#5b3a22', X - 3, Y - 64, 2 * T + 6, 1);
    for (let r = 0; r < 10; r++) px(r % 3 === 2 ? '#6f2e1a' : '#94402a', X + 16 - r * 2 - 4, Y - 76 + r, r * 4 + 8, 1);
    px('#3b2416', X + 13, Y - 66, 1, 10); px('#3b2416', X + 18, Y - 66, 1, 10);
  }

  if (has('flag')) {
    const X = CAMP_SITES.flag.x * T, Y = CAMP_SITES.flag.y * T;
    px('rgba(0,0,0,.22)', X - 6, Y - 2, 13, 3); px('#8b8680', X - 4, Y - 5, 9, 4); px('#a39e96', X - 4, Y - 5, 9, 1);
    px('#d9d2c6', X, Y - 52, 1, 48); px('#9a958d', X + 1, Y - 52, 1, 48); px('#e2b03a', X - 1, Y - 54, 3, 2);
  }

  // Keepsakes.
  for (const k of camp?.keepsakes ?? []) {
    const spot = CAMP_KEEPSAKES[k.key];
    if (!spot) continue;
    const X = spot[0] * T, Y = spot[1] * T;
    if (k.key === 'winter') {
      px('rgba(0,0,0,.2)', X - 7, Y - 1, 14, 3);
      for (const [r, cy] of [[6, -6], [4, -15], [3, -21]]) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) px(dx + dy > r * 0.6 ? '#cfd8e0' : '#f4f8fb', X + dx, Y + cy + dy);
      px('#1d1410', X - 1, Y - 22); px('#1d1410', X + 1, Y - 22); px('#e06a2a', X, Y - 21, 3, 1);
      px('#c0383a', X - 4, Y - 18, 8, 2); px('#c0383a', X + 2, Y - 17, 2, 4); px('#1d1410', X, Y - 14); px('#1d1410', X, Y - 11);
      px('#4b2f1c', X - 9, Y - 16, 5, 1); px('#4b2f1c', X + 5, Y - 15, 5, 1);
      px('#2a2226', X - 3, Y - 26, 6, 3); px('#2a2226', X - 4, Y - 24, 8, 1);
    } else if (k.key === 'spring') {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -10; dx <= 10; dx++) if ((dx / 10) ** 2 + (dy / 4) ** 2 <= 1) px('#6b4a2e', X + dx, Y - 4 + dy);
      ['#f3e7a0', '#e9a7c0', '#ffffff', '#b9c7f0', '#e06a2a', '#e9a7c0', '#f3e7a0'].forEach((c, i) => {
        const fx = X - 8 + i * 2.7, fy = Y - 6 + ((i * 5) % 4);
        px('#4f8f45', fx, fy, 1, 3); px(c, fx - 1, fy - 1, 3, 1); px(c, fx, fy - 2, 1, 3); px('#d9a441', fx, fy - 1, 1, 1);
      });
      for (let dx = -11; dx <= 11; dx += 2) px('#a39e96', X + dx, Y - Math.round(Math.sqrt(Math.max(0, 1 - (dx / 11) ** 2)) * -4) - 1, 2, 1);
    } else if (k.key === 'summer') {
      px('#e8e0d0', X - 10, Y - 4, 14, 6); for (let i = 0; i < 14; i += 4) px('#2f7f86', X - 10 + i, Y - 4, 2, 6);
      px('#d9d2c6', X + 6, Y - 22, 1, 22);
      for (let r = 0; r < 7; r++) for (let dx = -(4 + r * 2); dx <= 4 + r * 2; dx++) px(Math.floor((dx + 20) / 4) % 2 ? '#e06a2a' : '#f4ead8', X + 6 + dx, Y - 28 + r, 1, 1);
      px('rgba(0,0,0,.15)', X - 6, Y + 1, 26, 2);
    } else if (k.key === 'autumn') {
      px('#5b3a22', X - 1, Y - 24, 2, 24); px('#5b3a22', X - 8, Y - 18, 16, 2);
      px('#c8893b', X - 4, Y - 20, 8, 8); px('#d9a441', X - 3, Y - 27, 6, 6); px('#8a3b22', X - 5, Y - 28, 10, 2); px('#8a3b22', X - 3, Y - 31, 6, 3);
      px('#1d1410', X - 2, Y - 25); px('#1d1410', X + 1, Y - 25);
      for (const [ox, oy, r] of [[-9, -2, 4], [8, -1, 5], [2, 4, 3]]) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r - 1; dx <= r + 1; dx++) if ((dx / (r + 1)) ** 2 + (dy / r) ** 2 <= 1) px(Math.abs(dx) % 3 === 1 ? '#c8601e' : '#e07a2a', X + ox + dx, Y + oy + dy - r);
        px('#4f8f45', X + ox, Y + oy - 2 * r - 1, 1, 2);
      }
    }
  }
}

/** The camp's moving parts, each frame: the boat bobs, the sauna steams, the flag flies. */
function campDrawFrame(g, camp, t) {
  const T = HL_T, px = (c, x, y, w = 1, h = 1) => hlPx(g, c, Math.round(x), Math.round(y), w, h);
  if (campBuilt(camp, 'boat')) {
    const X = CAMP_SITES.boat.x * T, Y = CAMP_SITES.boat.y * T + Math.round(Math.sin(t * 1.6));
    px('rgba(20,40,60,.35)', X - 13, Y + 3, 26, 2);
    px('#5b3a22', X - 12, Y - 2, 24, 4); px('#6e4326', X - 10, Y + 2, 20, 1); px('#87562f', X - 12, Y - 2, 24, 1);
    px('#a47a4d', X - 9, Y - 1, 18, 2); px('#5b3a22', X - 2, Y - 2, 3, 3);
    px('#c99a66', X - 15, Y - 3, 8, 1); px('#c99a66', X + 7, Y + 1, 8, 1);
    px('#a47a4d', 30 * T, 11 * T + 10, 1, 6); // its rope to the dock
  }
  if (campBuilt(camp, 'sauna')) {
    for (let i = 0; i < 5; i++) {
      const p = (i / 5 + t * 0.18) % 1;
      g.fillStyle = `rgba(240,240,236,${0.6 * (1 - p)})`;
      g.beginPath(); g.arc(25 * T + 39 + Math.sin(t * 1.3 + p * 5) * 2 + p * 5, 6 * T - 14 - p * 26, 1.5 + p * 4, 0, Math.PI * 2); g.fill();
    }
  }
  if (campBuilt(camp, 'flag')) {
    const X = CAMP_SITES.flag.x * T + 1, Y = CAMP_SITES.flag.y * T - 51;
    for (let i = 0; i < 16; i++) {
      const dy = Math.round(Math.sin(t * 4 - i * 0.5) * (i / 8));
      px(i < 2 ? '#b9501a' : '#e06a2a', X + i, Y + dy, 1, 10);
      if (i > 4 && i < 11) px('#ffc94a', X + i, Y + dy + 3 + Math.abs(i - 8) / 2, 1, 4 - Math.abs(i - 8) / 1.5); // a flame on it
    }
  }
}

/** Light the camp gives off at night, as calls to the map's glow(x, y, r). Lit windows and lanterns go on top after. */
function campGlows(glow, camp, t) {
  const T = HL_T;
  if (campBuilt(camp, 'lanterns')) for (const [x, y] of CAMP_LANTERNS) glow(x * T, y * T - 17, 22 + Math.sin(t * 5 + x) * 1.5);
  if (campBuilt(camp, 'cabin')) { glow(37 * T + 13, 16 * T + 20, 18); glow(37 * T + 51, 16 * T + 20, 18); }
  if (campBuilt(camp, 'sauna')) glow(25 * T + 31, 6 * T + 17, 16);
}
function campNightLights(g, camp) {
  const T = HL_T;
  if (campBuilt(camp, 'lanterns')) for (const [x, y] of CAMP_LANTERNS) hlPx(g, '#ffe28a', Math.round(x * T) - 2, Math.round(y * T) - 20, 4, 5);
  if (campBuilt(camp, 'cabin')) { hlPx(g, 'rgba(255,196,107,.85)', 37 * T + 8, 16 * T + 16, 10, 8); hlPx(g, 'rgba(255,196,107,.85)', 37 * T + 46, 16 * T + 16, 10, 8); }
}

/** What the banner says when you're standing at a camp site, built or not yet. */
function campContext(camp, x, y) {
  if (!camp) return null;
  for (const b of camp.builds) {
    const site = CAMP_SITES[b.id];
    if (!site || !site.clear || Math.hypot(x - site.x, y - site.y) > site.clear + 0.6) continue;
    return b.built
      ? { key: `camp-${b.id}`, html: `<b>${escapeHtml(b.name)}</b> · Built by this hearth.`, label: 'See camp', run: () => openCampPanel(hl.serverId) }
      : { key: `camp-${b.id}-todo`, html: `<b>${escapeHtml(b.name)}</b> goes here at ${b.points} camp points. The camp has ${camp.points}.`, label: 'See camp', run: () => openCampPanel(hl.serverId) };
  }
  return null;
}

// ---- the camp panel

const campNum = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });

function openCampPanel(serverId = hl.serverId) {
  const camp = campState.get(serverId);
  if (!camp) { loadCamp(serverId).then(() => campState.has(serverId) && openCampPanel(serverId)); return; }
  const next = camp.builds.find((b) => !b.built);
  const prev = [...camp.builds].reverse().find((b) => b.built)?.points ?? 0;
  const se = camp.season;
  // Seasons turn at midnight Eastern, as the fishing board's days do.
  const ends = new Date(se.ends - 1).toLocaleDateString(undefined, { month: 'long', day: 'numeric', timeZone: 'America/New_York' });
  const fishPoints = Math.floor(camp.from.fish / 20);
  modal(`<h2 id="camp-panel">Camp</h2>
    <p class="small muted">Time at the fires, games played together and fish caught build up this hearth's camp on the map. Builds stay up once they're built.</p>
    <div class="camp-points"><b>${campNum(camp.points)}</b> camp points</div>
    <p class="small muted">${campNum(camp.from.hours)} hours at the fires, ${campNum(camp.from.games)} ${camp.from.games === 1 ? 'game' : 'games'} played together and ${campNum(camp.from.fish)} fish (${campNum(fishPoints)} ${fishPoints === 1 ? 'point' : 'points'}: one for every 20).</p>
    ${next ? `<label class="camp-bar"><span>Next: ${escapeHtml(next.name)} at ${next.points}</span>
      <progress max="${next.points - prev}" value="${Math.max(0, Math.min(next.points - prev, camp.points - prev))}"></progress></label>` : '<p>Everything is built.</p>'}
    <h3>${escapeHtml(se.name)} goal</h3>
    <label class="camp-bar"><span>${campNum(se.goal)} ${escapeHtml(se.counts)}: ${campNum(Math.min(se.done, se.goal))} so far</span>
      <progress max="${se.goal}" value="${Math.min(se.done, se.goal)}"></progress></label>
    <p class="small muted">${se.met ? `Met. The ${escapeHtml(se.keepsake.toLowerCase())} stays on the map.` : `Meet it by ${ends} and a ${escapeHtml(se.keepsake.toLowerCase())} stays on the map.`}</p>
    <h3>Builds</h3>
    <ul class="camp-builds">${camp.builds.map((b) => `<li class="${b.built ? 'built' : ''}"><span>${escapeHtml(b.name)}</span><span class="small muted">${b.built ? 'Built' : `${b.points} points`}</span></li>`).join('')}</ul>
    ${camp.keepsakes.length ? `<h3>Keepsakes</h3><ul class="camp-builds">${camp.keepsakes.map((k) => `<li class="built"><span>${escapeHtml(k.keepsake)}</span><span class="small muted">${escapeHtml(k.name)}</span></li>`).join('')}</ul>` : ''}
    <div class="modal-row"><button type="button" class="btn" data-close>Done</button></div>`, 'camp-modal');
}
