// Backdrops: whole scenes behind the fire, bought with chips in a hearth's casino (BACKDROPS in
// server/src/casino-items.ts). Each is one SVG, drawn 1600×900 and cropped to fit the fire's space.
// The middle stays calm, since that's where the fire and the seats are.
// Part of Peiskos's client: plain scripts that index.html loads in order, sharing one global scope.
'use strict';

/** A random number source that gives the same scene every time. */
function bdRandom(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
const bdGrad = (id, stops, x2 = 0, y2 = 1) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;
const bdGlow = (id, color, a = 1) => `<radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="${a}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;
const bdBlur = (id, sd) => `<filter id="${id}" filterUnits="userSpaceOnUse" x="-200" y="-200" width="2000" height="1300"><feGaussianBlur stdDeviation="${sd}"/></filter>`;

/** A smooth skyline from the left edge to the right around height y, rising and falling by up to amp. */
function bdRidge(seed, y, amp, n, fill) {
  const rnd = bdRandom(seed);
  const pts = Array.from({ length: n + 1 }, (_, i) => [(i * 1600) / n, y - rnd() * amp]);
  let d = `M-10 900L-10 ${pts[0][1].toFixed(0)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const mx = (x0 + (x1 - x0) / 2).toFixed(0);
    d += `C${mx} ${y0.toFixed(0)} ${mx} ${y1.toFixed(0)} ${x1.toFixed(0)} ${y1.toFixed(0)}`;
  }
  return `<path d="${d}L1610 ${pts[n][1].toFixed(0)}L1610 900Z" fill="${fill}"/>`;
}
/** Mountains: sharp peaks, with snow on the ones that reach high enough. */
function bdMountains(seed, y, amp, n, fill, snow) {
  const rnd = bdRandom(seed);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    pts.push([(i * 1600) / n + (rnd() - 0.5) * 60, y - (i % 2 ? amp * (0.6 + rnd() * 0.4) : amp * rnd() * 0.35)]);
  }
  let out = `<path d="M-10 900L-10 ${pts[0][1].toFixed(0)}${pts.map(([x, py]) => `L${x.toFixed(0)} ${py.toFixed(0)}`).join('')}L1610 ${pts[n][1].toFixed(0)}L1610 900Z" fill="${fill}"/>`;
  if (snow) {
    for (let i = 1; i < n; i += 2) {
      const [px, py] = pts[i];
      if (py > y - amp * 0.7) continue;
      const [lx, ly] = pts[i - 1];
      const [rx, ry] = pts[i + 1];
      const t = 0.22;
      const ax = px + (lx - px) * t; const ay = py + (ly - py) * t;
      const bx = px + (rx - px) * t; const by = py + (ry - py) * t;
      out += `<path d="M${px.toFixed(0)} ${py.toFixed(0)}L${ax.toFixed(0)} ${ay.toFixed(0)}L${(ax + (px - ax) * 0.3).toFixed(0)} ${(ay + 10).toFixed(0)}L${((ax + bx) / 2).toFixed(0)} ${(Math.max(ay, by) - 4).toFixed(0)}L${(bx + (px - bx) * 0.3).toFixed(0)} ${(by + 12).toFixed(0)}L${bx.toFixed(0)} ${by.toFixed(0)}Z" fill="${snow}"/>`;
    }
  }
  return out;
}
/** A spruce with its foot at x,y, h tall: jagged tiers that widen downwards, and a little trunk. */
function bdTree(x, y, h, fill, snow) {
  const tiers = 6;
  const w = h * 0.34;
  let left = '';
  let right = '';
  for (let i = 0; i < tiers; i++) {
    const ty = y - h + (h * 0.9 * (i + 1)) / tiers;
    const tw = (w * (i + 1)) / tiers;
    const iy = ty - ((h * 0.9) / tiers) * 0.45;
    left = `L${(x - tw).toFixed(1)} ${ty.toFixed(1)}L${(x - tw * 0.45).toFixed(1)} ${iy.toFixed(1)}` + left;
    right += `L${(x + tw * 0.45).toFixed(1)} ${iy.toFixed(1)}L${(x + tw).toFixed(1)} ${ty.toFixed(1)}`;
  }
  const body = `M${x.toFixed(1)} ${(y - h).toFixed(1)}${right}L${(x + w * 0.12).toFixed(1)} ${(y - h * 0.1).toFixed(1)}L${(x - w * 0.12).toFixed(1)} ${(y - h * 0.1).toFixed(1)}${left}Z`;
  let out = `<path d="${body}" fill="${fill}"/><rect x="${(x - h * 0.025).toFixed(1)}" y="${(y - h * 0.11).toFixed(1)}" width="${(h * 0.05).toFixed(1)}" height="${(h * 0.11).toFixed(1)}" fill="${fill}"/>`;
  if (snow) {
    for (let i = 1; i < tiers; i++) {
      const ty = y - h + (h * 0.9 * (i + 1)) / tiers;
      const tw = (w * (i + 1)) / tiers;
      out += `<path d="M${(x - tw * 0.9).toFixed(1)} ${(ty - 2).toFixed(1)}Q${x.toFixed(1)} ${(ty - h * 0.07).toFixed(1)} ${(x + tw * 0.9).toFixed(1)} ${(ty - 2).toFixed(1)}" stroke="${snow}" stroke-width="${(h * 0.012).toFixed(1)}" opacity=".85" fill="none" stroke-linecap="round"/>`;
    }
  }
  return out;
}
/** A row of trees along a line, bigger towards the edges so the middle (the fire) stays clear. */
function bdForest(seed, y, minH, maxH, count, fill, { snow = null, gap = 0, clear = null } = {}) {
  const rnd = bdRandom(seed);
  const trees = [];
  for (let i = 0; i < count; i++) {
    const x = rnd() * 1600;
    const edge = Math.abs(x - 800) / 800; // 0 in the middle, 1 at the edges
    const dy = rnd() * 14;
    const scale = 0.7 + rnd() * 0.3;
    if ((gap && edge < gap) || (clear && x > clear[0] && x < clear[1])) continue;
    trees.push([x, y + dy, minH + (maxH - minH) * (0.35 + 0.65 * edge) * scale]);
  }
  return trees.sort((a, b) => a[1] - b[1]).map(([x, ty, h]) => bdTree(x, ty, h, fill, snow)).join('');
}
/** Stars: many faint, a few bright with a soft glow. */
function bdStars(seed, n, h, color = '#fff8e8') {
  const rnd = bdRandom(seed);
  let out = '';
  for (let i = 0; i < n; i++) {
    const x = rnd() * 1600;
    const y = Math.pow(rnd(), 1.4) * h;
    const r = rnd() < 0.08 ? 1.6 + rnd() * 1.2 : 0.5 + rnd() * 0.9;
    out += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" fill="${color}" opacity="${(0.35 + rnd() * 0.65).toFixed(2)}"/>`;
    if (r > 1.6) out += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(r * 4).toFixed(1)}" fill="${color}" opacity=".08"/>`;
  }
  return out;
}
/** Scattered round bits over an area (snow, petals, embers). */
function bdBits(seed, n, x0, y0, w, h, r0, r1, fill, a0 = 0.4, a1 = 1) {
  const rnd = bdRandom(seed);
  let out = '';
  for (let i = 0; i < n; i++) out += `<circle cx="${(x0 + rnd() * w).toFixed(0)}" cy="${(y0 + rnd() * h).toFixed(0)}" r="${(r0 + rnd() * (r1 - r0)).toFixed(1)}" fill="${fill}" opacity="${(a0 + rnd() * (a1 - a0)).toFixed(2)}"/>`;
  return out;
}
/** Darker corners, so the middle reads as lit by the fire. */
const bdVignette = (a = 0.55) => `<radialGradient id="v" cx=".5" cy=".55" r=".75"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${a}"/></radialGradient>`;
const bdVignetteRect = '<rect width="1600" height="900" fill="url(#v)"/>';

/** Where the sun or moon sits in a sky running from x0 to x1, rising at y0 and highest at y1. */
const bdArc = (body, x0, x1, y0, y1) => [x0 + (x1 - x0) * body.x, y0 - (y0 - y1) * body.alt];
/**
 * A sky lit for the time of day: colours for night, day, dawn and dusk (top, middle, horizon), stars that fade
 * out by day, and the sun and the moon (in its real phase) on their way across. They rise and set at `horizon`,
 * so whatever is drawn after hides them as they go down.
 */
function bdSky(t, { night, day, dawn, dusk, horizon = 600, top = 110, stars = 7, starN = 220, starH = 520, starColor = '#fff8e8', sunR = 44, moonR = 40, x0 = 140, x1 = 1460 }) {
  const glow = t.sun.x < 0.5 ? dawn : dusk;
  const c = [0, 1, 2].map((i) => dlMix(dlMix(night[i], day[i], t.light), glow[i], t.warm * 0.8));
  const [sx, sy] = bdArc(t.sun, x0, x1, horizon, top);
  const [mx, my] = bdArc(t.moon, x0, x1, horizon, top);
  const sunShows = t.sun.up || t.warm > 0.6;
  const sunColor = dlMix('#fff6dc', t.sun.x < 0.5 ? '#ffc0b0' : '#ffb060', 1 - t.sun.alt * 3);
  return `<defs>${bdGrad('sky', [[0, c[0]], [0.55, c[1]], [0.9, c[2]]])}${bdGlow('sunglow', sunColor, 0.75)}${bdGlow('moonglow', '#f6edd2', 0.28)}</defs>
    <rect width="1600" height="900" fill="url(#sky)"/>
    ${t.night > 0.05 ? `<g opacity="${t.night.toFixed(2)}">${bdStars(stars, starN, starH, starColor)}</g>` : ''}
    ${sunShows ? `<circle cx="${sx.toFixed(0)}" cy="${sy.toFixed(0)}" r="${sunR * 5}" fill="url(#sunglow)"/><circle cx="${sx.toFixed(0)}" cy="${sy.toFixed(0)}" r="${sunR}" fill="${sunColor}"/>` : ''}
    ${t.moon.up && t.night > 0.1 ? `<g opacity="${Math.min(1, t.night * 1.2).toFixed(2)}"><circle cx="${mx.toFixed(0)}" cy="${my.toFixed(0)}" r="${moonR * 4}" fill="url(#moonglow)" opacity="${t.moon.lit.toFixed(2)}"/>${dlMoonSvg(mx, my, moonR, t.moon.phase, { color: '#f6edd2', dark: '#c8c0b0', darkOpacity: 0.14, south: t.south })}</g>` : ''}`;
}
/** Where the sun or moon's light falls on water, if it's out: [x, colour, strength]. */
function bdShine(t, x0, x1) {
  if (t.sun.up && t.light > 0.2) return [x0 + (x1 - x0) * t.sun.x, t.sun.alt < 0.3 ? '#ffc890' : '#fff6dc', 0.5];
  if (t.moon.up && t.night > 0.5) return [x0 + (x1 - x0) * t.moon.x, '#f6edd2', 0.55 * (0.3 + t.moon.lit * 0.7)];
  return null;
}

const BACKDROP_SCENES = {
  fjord: (t) => {
    const shine = bdShine(t, 140, 1460);
    const d = (night, day, dusk) => dlTone(t, night, day, dusk, 0.4);
    return `
    ${bdSky(t, { night: ['#060c22', '#142448', '#2c4470'], day: ['#3f7fc8', '#86b6e2', '#cfe2f0'], dawn: ['#2c2c66', '#b47aa8', '#ffb8a8'], dusk: ['#24224e', '#c0604e', '#ffb060'], horizon: 500, stars: 7, starN: 260, starH: 520 })}
    <defs>${bdGrad('w', [[0, d('#1e3558', '#3c78a8', '#7a6a8a')], [1, d('#050c1c', '#123a5c', '#1c2240')]])}
      ${bdGrad('m1', [[0, d('#3c5683', '#7088a4', '#8a6a8a')], [1, d('#22355a', '#4a6080', '#4a3a5a')]])}${bdGrad('m2', [[0, d('#253b62', '#4e6a88', '#5a4a6a')], [1, d('#162641', '#30465e', '#2e2640')]])}${bdGrad('m3', [[0, d('#16253f', '#2e4a40', '#2a2a3a')], [1, d('#0c1628', '#1e3228', '#1a1a28')]])}
      ${shine ? bdGrad('col', [[0, shine[1], shine[2]], [1, shine[1], 0]]) : ''}${bdVignette(0.6)}</defs>
    ${bdMountains(11, 470, 230, 9, 'url(#m1)', d('#c7d6ea', '#ffffff', '#ffd8d0'))}
    ${bdMountains(17, 540, 200, 7, 'url(#m2)', d('#9fb3d0', '#eef4fa', '#f0c0b8'))}
    ${bdRidge(23, 585, 60, 8, 'url(#m3)')}
    ${bdForest(29, 588, 20, 60, 70, d('#0a1424', '#1c3a2a', '#1a1a28'), { gap: 0.25 })}
    <rect y="600" width="1600" height="300" fill="url(#w)"/>
    ${shine ? `<path d="M${shine[0] - 30} 600h60l30 300h-120Z" fill="url(#col)"/>${Array.from({ length: 14 }, (_, i) => `<rect x="${(shine[0] - 60 + ((i * 37) % 70)).toFixed(0)}" y="${612 + i * 18}" width="${40 + ((i * 53) % 60)}" height="2" rx="1" fill="${shine[1]}" opacity="${(0.55 - i * 0.03).toFixed(2)}"/>`).join('')}` : ''}
    ${bdRidge(31, 860, 120, 6, d('#040810', '#142418', '#0c0c16'))}
    ${bdForest(37, 880, 160, 300, 16, d('#03070e', '#0e2016', '#08080e'), { gap: 0.55 })}
    ${bdVignetteRect}`;
  },

  pines: (t) => {
    const d = (night, day, dusk) => dlTone(t, night, day, dusk, 0.4);
    return `
    ${bdSky(t, { night: ['#081a24', '#1a3a48', '#43697a'], day: ['#6a9cc0', '#a8c8dc', '#e2ecf2'], dawn: ['#34405e', '#c08ca6', '#f4c4b4'], dusk: ['#262c46', '#a86a6e', '#f2a87a'], horizon: 520, stars: 3, starN: 180, starH: 420, starColor: '#e8fbff' })}
    <defs>${bdGrad('sn', [[0, d('#7f9aa8', '#e4eef4', '#e8c8c8')], [1, d('#4e6878', '#b8ccd8', '#a88a98')]])}${bdGrad('sn2', [[0, d('#6a8696', '#dae6ee', '#d8b8bc')], [1, d('#3a5262', '#a8bccb', '#8a7084')]])}
      ${bdGrad('au', [[0, '#3fd6a0', 0], [0.5, '#5fe8b0', 0.35], [1, '#7a6ff0', 0]], 1, 0)}${bdBlur('b', 18)}${bdVignette(0.55)}</defs>
    ${bdRidge(5, 500, 90, 7, d('#24485a', '#7a98a8', '#7a6a80'))}
    ${bdForest(41, 505, 40, 90, 90, d('#1a3646', '#2c4a42', '#2a2a3a'), { snow: d('#8aa6b4', '#f2f8fa', '#f0d0d0') })}
    ${bdRidge(9, 600, 50, 6, 'url(#sn)')}
    ${bdForest(43, 605, 60, 150, 40, d('#12303c', '#22402e', '#20222e'), { snow: d('#a9c2ce', '#ffffff', '#ffe0dc'), gap: 0.3 })}
    ${bdRidge(13, 720, 30, 5, 'url(#sn2)')}
    ${bdForest(47, 880, 260, 460, 12, d('#0a2028', '#163020', '#141420'), { snow: d('#c4d8e0', '#ffffff', '#ffe8e4'), gap: 0.62 })}
    ${bdVignetteRect}`;
  },

  cabin: (t) => {
    const d = (night, day, dusk) => dlTone(t, night, day, dusk, 0.45);
    const lamp = 0.3 + t.night * 0.7;
    return `
    ${bdSky(t, { night: ['#0b0a1c', '#221e3c', '#3f3152'], day: ['#5590c8', '#98c2e2', '#dbe9ec'], dawn: ['#2e2a5c', '#c486a4', '#ffc4a8'], dusk: ['#241e4e', '#bc6652', '#ffac62'], horizon: 470, stars: 5, starN: 220, starH: 450, starColor: '#fff4dc' })}
    <defs>${bdGlow('win', '#ffc46b', 0.5)}
      ${bdGrad('h1', [[0, d('#2c2744', '#5a7a6a', '#5a4a62')], [1, d('#1f1b32', '#41604e', '#3a3048')]])}${bdGrad('h2', [[0, d('#1d192c', '#3c5a40', '#3a2c40')], [1, d('#141120', '#2c4630', '#2a2030')]])}${bdGrad('gr', [[0, d('#1a1526', '#38502e', '#2e2430')], [1, d('#0e0b16', '#22361e', '#1c1620')]])}
      ${bdGrad('roof', [[0, '#4a3328'], [1, '#2e1f18']])}${bdGrad('wall', [[0, d('#6a4630', '#8a5e3e', '#7a4e38')], [1, d('#4a2f1f', '#6a4428', '#5a3826')]])}${bdBlur('sm', 6)}${bdVignette(0.6)}</defs>
    ${bdRidge(61, 470, 110, 7, 'url(#h1)')}
    ${bdForest(63, 472, 40, 80, 110, d('#191530', '#2a4a34', '#2a2238'))}
    ${bdRidge(67, 590, 60, 6, 'url(#h2)')}
    ${bdForest(71, 596, 70, 150, 60, d('#110e1e', '#1e3a26', '#1e1828'), { gap: 0.25 })}
    <path d="M-10 900V700C400 680 1200 690 1610 700V900Z" fill="url(#gr)"/>
    ${bdForest(73, 712, 120, 230, 30, d('#0c0914', '#16301c', '#16101c'), { gap: 0.42, clear: [1120, 1400] })}
    <ellipse cx="1260" cy="702" rx="280" ry="70" fill="url(#win)" opacity="${lamp.toFixed(2)}"/>
    <g transform="translate(1160 556)">
      <rect x="150" y="-10" width="26" height="70" fill="#2a1d18"/>
      <path d="M-18 70 100 -4 218 70Z" fill="url(#roof)"/>
      <path d="M-18 70 100 -4 218 70" stroke="#1a110c" stroke-width="5" fill="none"/>
      <rect x="0" y="66" width="200" height="80" fill="url(#wall)"/>
      ${Array.from({ length: 6 }, (_, i) => `<path d="M0 ${78 + i * 12}h200" stroke="#3a2416" stroke-width="2.5"/>`).join('')}
      <rect x="22" y="86" width="38" height="30" fill="${dlMix('#6a5a48', '#ffc96a', lamp)}"/><rect x="140" y="86" width="38" height="30" fill="${dlMix('#6a5a48', '#ffc96a', lamp)}"/>
      <path d="M41 86v30M22 101h38M159 86v30M140 101h38" stroke="#4a2f1f" stroke-width="3"/>
      <rect x="84" y="92" width="32" height="54" fill="#2e1d14"/><circle cx="110" cy="121" r="2.5" fill="#d9a45a"/>
      <path d="M-8 146h216" stroke="#0e0b16" stroke-width="6"/>
    </g>
    ${bdForest(79, 900, 300, 520, 8, d('#07050c', '#0e2214', '#0c0810'), { gap: 0.7 })}
    ${bdVignetteRect}`;
  },

  dunes: (t) => {
    const d = (night, day, dusk) => dlTone(t, night, day, dusk, 0.7);
    return `
    ${bdSky(t, { night: ['#0a0820', '#1c1838', '#3a2a48'], day: ['#3a7ac8', '#8ab8e0', '#f0dcb0'], dawn: ['#3a2a5a', '#d07a8a', '#ffc8a0'], dusk: ['#1c1036', '#d4664a', '#f6b765'], horizon: 600, stars: 9, starN: 200, starH: 520, starColor: '#fff0e0', sunR: 70 })}
    <defs>${bdGrad('d1', [[0, d('#4a3450', '#e8b070', '#c8693e')], [1, d('#30223a', '#c88a4e', '#9a4a30')]], 1, 0.3)}${bdGrad('d2', [[0, d('#36263e', '#d09858', '#9a4630')], [1, d('#24182c', '#a86c3a', '#6e2e22')]], 1, 0.3)}${bdGrad('d3', [[0, d('#22141e', '#8a5a30', '#5e2620')], [1, d('#140a12', '#6a401e', '#3a1416')]], 1, 0.3)}${bdVignette(0.5)}</defs>
    <path d="M980 560h40v-70h110v40h40v-60h90v90h60v40H980Z" fill="${d('#2a2036', '#b89a88', '#7a3a48')}" opacity=".75"/>
    ${t.night > 0.4 ? `<g fill="#ffc870" opacity="${t.night.toFixed(2)}"><rect x="1050" y="520" width="6" height="8"/><rect x="1160" y="540" width="6" height="8"/><rect x="1220" y="510" width="6" height="8"/></g>` : ''}
    <path d="M-10 900V600C200 540 420 560 640 610S1100 560 1300 580 1610 600 1610 600V900Z" fill="url(#d1)"/>
    <path d="M640 610C800 600 900 640 1000 700" stroke="${d('#6a4a5a', '#f8c890', '#e08a5a')}" stroke-width="3" fill="none" opacity=".6"/>
    <path d="M-10 900V700C300 630 700 640 950 700S1400 690 1610 660V900Z" fill="url(#d2)"/>
    <path d="M-10 900V800C400 740 900 760 1200 810S1610 790 1610 790V900Z" fill="url(#d3)"/>
    <g fill="${d('#100810', '#3a4a26', '#24100f')}"><path d="M1320 820v-150a14 14 0 0 1 28 0v150Z"/><path d="M1320 740h-24a12 12 0 0 1-12-12v-40a12 12 0 0 1 24 0v28h12Z"/><path d="M1348 720h22v-34a12 12 0 0 1 24 0v46a12 12 0 0 1-12 12h-34Z"/>
      <path d="M190 840v-90a10 10 0 0 1 20 0v90Z"/><path d="M190 790h-16a9 9 0 0 1-9-9v-24a9 9 0 0 1 18 0v15h7Z"/></g>
    ${bdVignetteRect}`;
  },

  blossom: (t) => {
    const d = (night, day, dusk) => dlTone(t, night, day, dusk, 0.5);
    const pink = (c) => dlMix(c, '#3a2a50', t.night * 0.55);
    return `
    ${bdSky(t, { night: ['#0e0a24', '#2a1a44', '#4a2a5a'], day: ['#78aee0', '#b8d4ee', '#f6dce4'], dawn: ['#2a1a44', '#8a4a80', '#f6c6b8'], dusk: ['#2a1a44', '#c8607a', '#ffb090'], horizon: 560, stars: 13, starN: 160, starH: 420, starColor: '#fff0f6' })}
    <defs>${bdGrad('mt', [[0, d('#4a3a6a', '#8aa0c8', '#9a6a9a')], [1, d('#30244a', '#6a80a8', '#6a4270')]])}${bdGrad('h1', [[0, d('#2a1a3a', '#6a9a6a', '#5a3462')], [1, d('#1e1230', '#4e7a50', '#43264a')]])}${bdGrad('h2', [[0, d('#1a0e26', '#4a7040', '#3a1f40')], [1, d('#120a1c', '#365830', '#2a1430')]])}${bdVignette(0.5)}</defs>
    <path d="M253 900 760 330Q800 300 840 330L1347 900Z" fill="url(#mt)"/>
    <path d="M760 330Q800 300 840 330L900 400 860 390 830 410 800 385 770 405 740 392 700 400Z" fill="${d('#c8bcd8', '#ffffff', '#f4e6f0')}"/>
    ${bdRidge(81, 640, 70, 7, 'url(#h1)')}
    ${bdRidge(83, 740, 60, 6, 'url(#h2)')}
    ${(() => {
      // Two cherry trees framing the scene: a dark trunk and branches, then blossom in three pinks.
      const tree = (x, dir, seed) => {
        const rnd = bdRandom(seed);
        let out = `<path d="M${x} 900C${x + dir * 20} 760 ${x + dir * 10} 640 ${x + dir * 80} 520S${x + dir * 260} 380 ${x + dir * 380} 300M${x + dir * 60} 600C${x + dir * 140} 560 ${x + dir * 200} 520 ${x + dir * 260} 420M${x + dir * 120} 470C${x + dir * 80} 380 ${x + dir * 40} 300 ${x + dir * 10} 200" stroke="#2a1420" stroke-width="22" fill="none" stroke-linecap="round"/>`;
        // Clouds of blossom round the branch ends, thicker in the middle of each.
        const clumps = [[380, 300, 120], [260, 420, 110], [10, 200, 110], [170, 290, 130], [90, 470, 100], [300, 190, 100]];
        for (let i = 0; i < 190; i++) {
          const [kx, ky, kr] = clumps[i % clumps.length];
          const a = rnd() * Math.PI * 2;
          const dd = Math.sqrt(rnd()) * kr;
          const cx = x + dir * (kx + Math.cos(a) * dd);
          const cy = ky + Math.sin(a) * dd * 0.75;
          const c = pink(['#ffc8d8', '#f7a6c0', '#ffe2ea'][Math.floor(rnd() * 3)]);
          out += `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${(8 + rnd() * 18).toFixed(0)}" fill="${c}" opacity="${(0.7 + rnd() * 0.3).toFixed(2)}"/>`;
        }
        return out;
      };
      return tree(40, 1, 87) + tree(1560, -1, 89);
    })()}
    <rect y="820" width="1600" height="80" fill="${d('#1a0c18', '#2e3a20', '#24101e')}"/>
    ${bdVignetteRect}`;
  },
};

/** A backdrop as an SVG image, cropped to fill, lit for a time of day (see daylight.js). Each one's ids get its name, so two never clash. */
function backdropSvg(id, sky = daylight()) {
  const scene = BACKDROP_SCENES[id];
  if (!scene) return '';
  const body = scene(sky).replace(/id="(\w+)"/g, `id="${id}-$1"`).replace(/url\(#(\w+)\)/g, `url(#${id}-$1)`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
}
/** The sky rounded off, so a picture is only remade once the light has visibly moved on. */
const bdSkyKey = (sky) => [sky.light, sky.warm, sky.sun.x, sky.sun.alt, sky.moon.x, sky.moon.alt, sky.moon.phase].map((v) => Math.round(v * 40)).join(',') + (sky.sun.up ? 's' : '') + (sky.moon.up ? 'm' : '');
/** As a CSS background, made once each (once for each look of the sky, for the ones lit by the time of day). */
const backdropCssMade = new Map();
function backdropCss(id, sky = daylight()) {
  const key = BACKDROP_LIVE[id] ? `${id}|${bdSkyKey(sky)}` : id;
  if (!backdropCssMade.has(key)) {
    if (backdropCssMade.size > 60) backdropCssMade.clear();
    backdropCssMade.set(key, `url("data:image/svg+xml,${encodeURIComponent(backdropSvg(id, sky))}") center / cover no-repeat`);
  }
  return backdropCssMade.get(key);
}
