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

const BACKDROP_SCENES = {
  fjord: () => `
    <defs>${bdGrad('s', [[0, '#060c22'], [0.5, '#142448'], [0.78, '#2c4470']])}${bdGrad('w', [[0, '#1e3558'], [1, '#050c1c']])}
      ${bdGrad('m1', [[0, '#3c5683'], [1, '#22355a']])}${bdGrad('m2', [[0, '#253b62'], [1, '#162641']])}${bdGrad('m3', [[0, '#16253f'], [1, '#0c1628']])}
      ${bdGlow('moon', '#f6edd2', 0.35)}${bdGrad('col', [[0, '#f6edd2', 0.4], [1, '#f6edd2', 0]])}${bdVignette(0.6)}</defs>
    <rect width="1600" height="900" fill="url(#s)"/>
    ${bdStars(7, 260, 520)}
    <circle cx="1210" cy="175" r="190" fill="url(#moon)"/>
    <circle cx="1210" cy="175" r="54" fill="#f6edd2"/><circle cx="1194" cy="162" r="9" fill="#e4d8b8"/><circle cx="1226" cy="190" r="6" fill="#e4d8b8"/><circle cx="1220" cy="150" r="4" fill="#e4d8b8"/>
    ${bdMountains(11, 470, 230, 9, 'url(#m1)', '#c7d6ea')}
    ${bdMountains(17, 540, 200, 7, 'url(#m2)', '#9fb3d0')}
    ${bdRidge(23, 585, 60, 8, 'url(#m3)')}
    ${bdForest(29, 588, 20, 60, 70, '#0a1424', { gap: 0.25 })}
    <rect y="600" width="1600" height="300" fill="url(#w)"/>
    <path d="M1180 600h60l30 300h-120Z" fill="url(#col)"/>
    ${Array.from({ length: 14 }, (_, i) => `<rect x="${1150 + ((i * 37) % 70)}" y="${612 + i * 18}" width="${40 + ((i * 53) % 60)}" height="2" rx="1" fill="#f6edd2" opacity="${(0.55 - i * 0.03).toFixed(2)}"/>`).join('')}
    ${bdRidge(31, 860, 120, 6, '#040810')}
    ${bdForest(37, 880, 160, 300, 16, '#03070e', { gap: 0.55 })}
    ${bdVignetteRect}`,

  pines: () => `
    <defs>${bdGrad('s', [[0, '#081a24'], [0.55, '#1a3a48'], [1, '#43697a']])}${bdGrad('sn', [[0, '#7f9aa8'], [1, '#4e6878']])}${bdGrad('sn2', [[0, '#6a8696'], [1, '#3a5262']])}
      ${bdGrad('au', [[0, '#3fd6a0', 0], [0.5, '#5fe8b0', 0.35], [1, '#7a6ff0', 0]], 1, 0)}${bdBlur('b', 18)}${bdVignette(0.55)}</defs>
    <rect width="1600" height="900" fill="url(#s)"/>
    ${bdStars(3, 180, 420, '#e8fbff')}
    <path d="M-50 210C300 120 600 260 900 170S1400 110 1650 200" stroke="url(#au)" stroke-width="90" fill="none" filter="url(#b)"/>
    ${bdRidge(5, 500, 90, 7, '#24485a')}
    ${bdForest(41, 505, 40, 90, 90, '#1a3646', { snow: '#8aa6b4' })}
    ${bdRidge(9, 600, 50, 6, 'url(#sn)')}
    ${bdForest(43, 605, 60, 150, 40, '#12303c', { snow: '#a9c2ce', gap: 0.3 })}
    ${bdRidge(13, 720, 30, 5, 'url(#sn2)')}
    ${bdForest(47, 880, 260, 460, 12, '#0a2028', { snow: '#c4d8e0', gap: 0.62 })}
    ${bdBits(53, 220, 0, 0, 1600, 900, 1, 3.4, '#ffffff', 0.35, 0.95)}
    ${bdVignetteRect}`,

  cabin: () => `
    <defs>${bdGrad('s', [[0, '#0b0a1c'], [0.55, '#221e3c'], [1, '#3f3152']])}${bdGlow('moon', '#efe6ff', 0.3)}${bdGlow('win', '#ffc46b', 0.5)}
      ${bdGrad('h1', [[0, '#2c2744'], [1, '#1f1b32']])}${bdGrad('h2', [[0, '#1d192c'], [1, '#141120']])}${bdGrad('gr', [[0, '#1a1526'], [1, '#0e0b16']])}
      ${bdGrad('roof', [[0, '#4a3328'], [1, '#2e1f18']])}${bdGrad('wall', [[0, '#6a4630'], [1, '#4a2f1f']])}${bdBlur('sm', 6)}${bdVignette(0.6)}</defs>
    <rect width="1600" height="900" fill="url(#s)"/>
    ${bdStars(5, 220, 450, '#fff4dc')}
    <circle cx="300" cy="150" r="150" fill="url(#moon)"/><circle cx="300" cy="150" r="40" fill="#efe6ff"/>
    ${bdRidge(61, 470, 110, 7, 'url(#h1)')}
    ${bdForest(63, 472, 40, 80, 110, '#191530')}
    ${bdRidge(67, 590, 60, 6, 'url(#h2)')}
    ${bdForest(71, 596, 70, 150, 60, '#110e1e', { gap: 0.25 })}
    <path d="M-10 900V700C400 680 1200 690 1610 700V900Z" fill="url(#gr)"/>
    ${bdForest(73, 712, 120, 230, 30, '#0c0914', { gap: 0.42, clear: [1120, 1400] })}
    <ellipse cx="1260" cy="702" rx="280" ry="70" fill="url(#win)"/>
    <g transform="translate(1160 556)">
      <rect x="150" y="-10" width="26" height="70" fill="#2a1d18"/>
      <path d="M-18 70 100 -4 218 70Z" fill="url(#roof)"/>
      <path d="M-18 70 100 -4 218 70" stroke="#1a110c" stroke-width="5" fill="none"/>
      <rect x="0" y="66" width="200" height="80" fill="url(#wall)"/>
      ${Array.from({ length: 6 }, (_, i) => `<path d="M0 ${78 + i * 12}h200" stroke="#3a2416" stroke-width="2.5"/>`).join('')}
      <rect x="22" y="86" width="38" height="30" fill="#ffc96a"/><rect x="140" y="86" width="38" height="30" fill="#ffc96a"/>
      <path d="M41 86v30M22 101h38M159 86v30M140 101h38" stroke="#4a2f1f" stroke-width="3"/>
      <rect x="84" y="92" width="32" height="54" fill="#2e1d14"/><circle cx="110" cy="121" r="2.5" fill="#d9a45a"/>
      <path d="M-8 146h216" stroke="#0e0b16" stroke-width="6"/>
      <g filter="url(#sm)" fill="#8a8098"><circle cx="164" cy="-28" r="12" opacity=".4"/><circle cx="176" cy="-58" r="18" opacity=".28"/><circle cx="196" cy="-96" r="24" opacity=".18"/></g>
    </g>
    ${bdForest(79, 900, 300, 520, 8, '#07050c', { gap: 0.7 })}
    ${bdVignetteRect}`,

  dunes: () => `
    <defs>${bdGrad('s', [[0, '#1c1036'], [0.45, '#6a2f5e'], [0.75, '#d4664a'], [1, '#f6b765']])}${bdGlow('sun', '#ffd88a', 0.7)}
      ${bdGrad('d1', [[0, '#c8693e'], [1, '#9a4a30']], 1, 0.3)}${bdGrad('d2', [[0, '#9a4630'], [1, '#6e2e22']], 1, 0.3)}${bdGrad('d3', [[0, '#5e2620'], [1, '#3a1416']], 1, 0.3)}${bdVignette(0.5)}</defs>
    <rect width="1600" height="900" fill="url(#s)"/>
    ${bdStars(9, 90, 260, '#fff0e0')}
    <circle cx="420" cy="520" r="330" fill="url(#sun)"/><circle cx="420" cy="520" r="96" fill="#ffe2a0"/>
    <path d="M980 560h40v-70h110v40h40v-60h90v90h60v40H980Z" fill="#7a3a48" opacity=".75"/>
    <path d="M-10 900V600C200 540 420 560 640 610S1100 560 1300 580 1610 600 1610 600V900Z" fill="url(#d1)"/>
    <path d="M640 610C800 600 900 640 1000 700" stroke="#e08a5a" stroke-width="3" fill="none" opacity=".6"/>
    <path d="M-10 900V700C300 630 700 640 950 700S1400 690 1610 660V900Z" fill="url(#d2)"/>
    <path d="M-10 900V800C400 740 900 760 1200 810S1610 790 1610 790V900Z" fill="url(#d3)"/>
    <g fill="#24100f"><path d="M1320 820v-150a14 14 0 0 1 28 0v150Z"/><path d="M1320 740h-24a12 12 0 0 1-12-12v-40a12 12 0 0 1 24 0v28h12Z"/><path d="M1348 720h22v-34a12 12 0 0 1 24 0v46a12 12 0 0 1-12 12h-34Z"/>
      <path d="M190 840v-90a10 10 0 0 1 20 0v90Z"/><path d="M190 790h-16a9 9 0 0 1-9-9v-24a9 9 0 0 1 18 0v15h7Z"/></g>
    ${bdVignetteRect}`,

  blossom: () => `
    <defs>${bdGrad('s', [[0, '#2a1a44'], [0.5, '#8a4a80'], [0.85, '#e89aa8'], [1, '#f6c6b8']])}${bdGlow('sun', '#ffe0cc', 0.6)}
      ${bdGrad('mt', [[0, '#9a6a9a'], [1, '#6a4270']])}${bdGrad('h1', [[0, '#5a3462'], [1, '#43264a']])}${bdGrad('h2', [[0, '#3a1f40'], [1, '#2a1430']])}${bdVignette(0.5)}</defs>
    <rect width="1600" height="900" fill="url(#s)"/>
    <circle cx="820" cy="470" r="300" fill="url(#sun)"/>
    <path d="M253 900 760 330Q800 300 840 330L1347 900Z" fill="url(#mt)"/>
    <path d="M760 330Q800 300 840 330L900 400 860 390 830 410 800 385 770 405 740 392 700 400Z" fill="#f4e6f0"/>
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
          const d = Math.sqrt(rnd()) * kr;
          const cx = x + dir * (kx + Math.cos(a) * d);
          const cy = ky + Math.sin(a) * d * 0.75;
          const c = ['#ffc8d8', '#f7a6c0', '#ffe2ea'][Math.floor(rnd() * 3)];
          out += `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${(8 + rnd() * 18).toFixed(0)}" fill="${c}" opacity="${(0.7 + rnd() * 0.3).toFixed(2)}"/>`;
        }
        return out;
      };
      return tree(40, 1, 87) + tree(1560, -1, 89);
    })()}
    ${bdBits(91, 70, 0, 0, 1600, 900, 2, 5, '#ffd4e2', 0.5, 0.95)}
    <rect y="820" width="1600" height="80" fill="#24101e"/>
    ${bdVignetteRect}`,
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
