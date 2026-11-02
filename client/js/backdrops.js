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
    <path d="M520 600 760 330Q800 300 840 330L1080 600Z" fill="url(#mt)"/>
    <path d="M760 330Q800 300 840 330L900 400 860 390 830 410 800 385 770 405 740 392 700 400Z" fill="#f4e6f0"/>
    ${bdRidge(81, 640, 70, 7, 'url(#h1)')}
    ${bdRidge(83, 740, 60, 6, 'url(#h2)')}
    ${(() => {
      // Two cherry trees framing the scene: a dark trunk and branches, then blossom in three pinks.
      const tree = (x, dir, seed) => {
        const rnd = bdRandom(seed);
        let out = `<path d="M${x} 900C${x + dir * 20} 760 ${x + dir * 10} 640 ${x + dir * 80} 520S${x + dir * 260} 380 ${x + dir * 380} 300M${x + dir * 60} 600C${x + dir * 140} 560 ${x + dir * 200} 520 ${x + dir * 260} 420M${x + dir * 120} 470C${x + dir * 80} 380 ${x + dir * 40} 300 ${x + dir * 10} 200" stroke="#2a1420" stroke-width="22" fill="none" stroke-linecap="round"/>`;
        for (let i = 0; i < 160; i++) {
          const cx = x + dir * (rnd() * 420);
          const cy = 140 + rnd() * 420;
          const c = ['#ffc8d8', '#f7a6c0', '#ffe2ea'][Math.floor(rnd() * 3)];
          out += `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${(10 + rnd() * 22).toFixed(0)}" fill="${c}" opacity="${(0.65 + rnd() * 0.35).toFixed(2)}"/>`;
        }
        return out;
      };
      return tree(40, 1, 87) + tree(1560, -1, 89);
    })()}
    ${bdBits(91, 70, 0, 0, 1600, 900, 2, 5, '#ffd4e2', 0.5, 0.95)}
    <rect y="820" width="1600" height="80" fill="#24101e"/>
    ${bdVignetteRect}`,

  volcano: () => `
    <defs>${bdGrad('s', [[0, '#120404'], [0.5, '#3a0c0a'], [1, '#7a2410']])}${bdGlow('g', '#ff6a1c', 0.65)}${bdGrad('vo', [[0, '#3a1612'], [1, '#160807']])}
      ${bdGrad('lava', [[0, '#ffd36b'], [0.4, '#ff6a1c'], [1, '#c4200c']])}${bdBlur('b', 14)}${bdBlur('b2', 4)}${bdVignette(0.6)}</defs>
    <rect width="1600" height="900" fill="url(#s)"/>
    <g filter="url(#b)" fill="#2a1414"><ellipse cx="1150" cy="190" rx="160" ry="90" opacity=".8"/><ellipse cx="1260" cy="110" rx="200" ry="100" opacity=".6"/><ellipse cx="1050" cy="80" rx="220" ry="90" opacity=".5"/></g>
    <ellipse cx="1150" cy="330" rx="300" ry="190" fill="url(#g)"/>
    ${bdRidge(101, 640, 90, 7, '#2a0e0c')}
    <path d="M700 820 1060 330Q1150 300 1240 330L1600 820Z" fill="url(#vo)"/>
    <path d="M1060 330Q1150 300 1240 330L1210 360 1180 350 1160 380 1135 352 1110 368 1085 350Z" fill="url(#lava)"/>
    <g filter="url(#b2)"><path d="M1160 370C1150 450 1185 520 1150 600S1160 720 1130 820" stroke="#ff6a1c" stroke-width="16" fill="none"/><path d="M1190 360C1220 430 1240 500 1290 560S1340 680 1380 760" stroke="#ff6a1c" stroke-width="10" fill="none"/></g>
    <path d="M1160 370C1150 450 1185 520 1150 600S1160 720 1130 820M1190 360C1220 430 1240 500 1290 560S1340 680 1380 760" stroke="#ffcf6a" stroke-width="4" fill="none"/>
    ${bdBits(103, 70, 900, 80, 520, 520, 1.2, 3.6, '#ffb04f', 0.4, 1)}
    ${bdRidge(107, 820, 70, 6, '#0e0404')}
    ${bdVignetteRect}`,

  ocean: () => `
    <defs>${bdGrad('s', [[0, '#1aa0b0'], [0.35, '#0a5c74'], [1, '#021628']])}${bdGrad('ray', [[0, '#d8fbff', 0.38], [1, '#d8fbff', 0]])}${bdGrad('sand', [[0, '#d8bc84'], [1, '#8a6a42']])}
      ${bdBlur('b', 10)}${bdVignette(0.6)}</defs>
    <rect width="1600" height="900" fill="url(#s)"/>
    <g filter="url(#b)"><path d="M260 -20h140L180 760H80ZM640 -20h90L560 620h-70ZM1060 -20h160l-90 800h-110ZM1380 -20h70l-40 560h-60Z" fill="url(#ray)"/></g>
    ${(() => {
      const rnd = bdRandom(111);
      let fish = '';
      for (let i = 0; i < 9; i++) {
        const x = rnd() < 0.5 ? 120 + rnd() * 380 : 1100 + rnd() * 380;
        const y = 140 + rnd() * 320;
        const s = 0.6 + rnd() * 0.8;
        fish += `<path d="M${x.toFixed(0)} ${y.toFixed(0)}q${(18 * s).toFixed(1)} ${(-12 * s).toFixed(1)} ${(36 * s).toFixed(1)} 0q${(-18 * s).toFixed(1)} ${(12 * s).toFixed(1)} ${(-36 * s).toFixed(1)} 0Zm${(36 * s).toFixed(1)} 0l${(12 * s).toFixed(1)} ${(-8 * s).toFixed(1)}v${(16 * s).toFixed(1)}Z" fill="#0a3a50" opacity=".7"/>`;
      }
      const bubbles = Array.from({ length: 50 }, () => `<circle cx="${(rnd() * 1600).toFixed(0)}" cy="${(rnd() * 820).toFixed(0)}" r="${(2 + rnd() * 6).toFixed(1)}" fill="none" stroke="#c8f6ff" stroke-width="1.5" opacity="${(0.25 + rnd() * 0.5).toFixed(2)}"/>`).join('');
      return fish + bubbles;
    })()}
    <path d="M-10 900V770C300 730 600 790 900 760S1400 740 1610 770V900Z" fill="url(#sand)"/>
    ${Array.from({ length: 7 }, (_, i) => `<path d="M${120 + i * 210} ${820 + (i % 3) * 18}q40 -10 80 0" stroke="#b89a64" stroke-width="3" fill="none"/>`).join('')}
    ${(() => {
      const kelp = (x, h, c) => `<path d="M${x} 900C${x - 30} ${900 - h * 0.3} ${x + 30} ${900 - h * 0.6} ${x} ${900 - h}" stroke="${c}" stroke-width="16" fill="none" stroke-linecap="round"/>${Array.from({ length: 6 }, (_, i) => `<ellipse cx="${x + (i % 2 ? 16 : -16)}" cy="${(900 - (h * (i + 1)) / 7).toFixed(0)}" rx="16" ry="7" fill="${c}" transform="rotate(${i % 2 ? -30 : 30} ${x} ${(900 - (h * (i + 1)) / 7).toFixed(0)})"/>`).join('')}`;
      return kelp(90, 520, '#1f8a6a') + kelp(170, 380, '#2a9a74') + kelp(1440, 560, '#1f8a6a') + kelp(1530, 400, '#2a9a74');
    })()}
    <g><circle cx="300" cy="830" r="34" fill="#e8607a"/><circle cx="330" cy="818" r="24" fill="#f07a8e"/><circle cx="1270" cy="836" r="30" fill="#f0a040"/><path d="M1320 860c0-40 20-60 30-90m-10 30c20-10 30-30 32-50" stroke="#c84a6a" stroke-width="10" fill="none" stroke-linecap="round"/></g>
    ${bdVignetteRect}`,

  space: () => `
    <defs><radialGradient id="p" cx=".32" cy=".3"><stop offset="0" stop-color="#9ad8ff"/><stop offset=".55" stop-color="#3a6ad0"/><stop offset="1" stop-color="#0a1442"/></radialGradient>
      ${bdGrad('ring', [[0, '#e8dcff', 0.1], [0.5, '#e8dcff', 0.8], [1, '#e8dcff', 0.1]], 1, 0)}${bdBlur('b', 40)}
      ${bdGrad('gr', [[0, '#6a6672'], [1, '#2e2b34']])}<radialGradient id="cr" cx=".5" cy=".35"><stop offset="0" stop-color="#26232c"/><stop offset="1" stop-color="#4a4652"/></radialGradient>${bdVignette(0.5)}</defs>
    <rect width="1600" height="900" fill="#03030c"/>
    <g filter="url(#b)"><ellipse cx="380" cy="260" rx="420" ry="170" fill="#7a3ad8" opacity=".45"/><ellipse cx="560" cy="330" rx="260" ry="110" fill="#d84a9a" opacity=".3"/><ellipse cx="1300" cy="520" rx="320" ry="140" fill="#3a6ad8" opacity=".3"/></g>
    ${bdStars(37, 420, 820, '#ffffff')}
    <circle cx="320" cy="140" r="22" fill="#e8e0d0"/><circle cx="312" cy="133" r="21" fill="#03030c" opacity=".4"/>
    <path d="M1025 230A215 40 0 0 1 1455 230" transform="rotate(-14 1240 230)" fill="none" stroke="url(#ring)" stroke-width="12"/>
    <circle cx="1240" cy="230" r="118" fill="url(#p)"/>
    <path d="M1128 214Q1240 190 1352 230M1124 250Q1240 226 1356 266" stroke="#cfe8ff" stroke-width="5" fill="none" opacity=".2"/>
    <path d="M1025 230A215 40 0 0 0 1455 230" transform="rotate(-14 1240 230)" fill="none" stroke="url(#ring)" stroke-width="12"/>
    <path d="M-10 900V790Q800 690 1610 790V900Z" fill="url(#gr)"/>
    ${[[380, 830, 40], [1130, 810, 26], [700, 860, 18], [1450, 850, 32], [180, 870, 20]].map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${(r * 0.35).toFixed(1)}" fill="url(#cr)"/>`).join('')}
    ${bdVignetteRect}`,

  lounge: () => `
    <defs>${bdGrad('wall', [[0, '#3a0812'], [1, '#5a0e1f']])}<pattern id="fan" width="120" height="70" patternUnits="userSpaceOnUse"><path d="M0 70a60 60 0 0 1 120 0M15 70a45 45 0 0 1 90 0M30 70a30 30 0 0 1 60 0M60 70V10M60 70 25 22M60 70 95 22" fill="none" stroke="#d9b45a" stroke-width="2" opacity=".28"/></pattern>
      ${bdGrad('gold', [[0, '#f6dc8a'], [0.5, '#c8962a'], [1, '#8a6214']], 1, 0)}${bdGrad('cur', [[0, '#7a0e22'], [0.5, '#a81a32'], [1, '#5a0818']], 1, 0)}${bdGlow('lamp', '#ffd890', 0.45)}
      ${bdGrad('floor', [[0, '#1e0408'], [1, '#0e0204']])}<pattern id="carpet" width="80" height="80" patternUnits="userSpaceOnUse"><path d="M40 0 80 40 40 80 0 40Z" fill="none" stroke="#d9b45a" stroke-width="1.5" opacity=".18"/></pattern>${bdVignette(0.55)}</defs>
    <rect width="1600" height="620" fill="url(#wall)"/>
    <rect width="1600" height="620" fill="url(#fan)"/>
    ${[260, 560, 1040, 1340].map((x) => `<rect x="${x - 22}" y="0" width="44" height="620" fill="url(#gold)" opacity=".85"/><rect x="${x - 30}" y="590" width="60" height="30" fill="url(#gold)"/>`).join('')}
    ${[410, 1190].map((x) => `<circle cx="${x}" cy="170" r="150" fill="url(#lamp)"/><path d="M${x} 0v90" stroke="#d9b45a" stroke-width="3"/><path d="M${x - 46} 90h92l-16 44h-60Z" fill="url(#gold)"/><path d="M${x - 30} 134h60l-6 10h-48Z" fill="#fff0c4"/>`).join('')}
    <rect y="610" width="1600" height="16" fill="url(#gold)"/>
    <rect y="626" width="1600" height="274" fill="url(#floor)"/><rect y="626" width="1600" height="274" fill="url(#carpet)"/>
    <path d="M0 0h170C150 160 190 360 130 620H0Z" fill="url(#cur)"/><path d="M1600 0h-170c20 160-20 360 40 620h130Z" fill="url(#cur)"/>
    <path d="M40 0c-10 200 20 400-10 620M90 0c10 200-20 400 20 620M1560 0c10 200-20 400 10 620M1510 0c-10 200 20 400-20 620" stroke="#4a0410" stroke-width="5" fill="none" opacity=".6"/>
    <path d="M0 300c60 40 120 40 160 10M1600 300c-60 40-120 40-160 10" stroke="url(#gold)" stroke-width="10" fill="none" stroke-linecap="round"/>
    ${bdVignetteRect}`,
};

/** A backdrop as an SVG image, cropped to fill. Each one's ids get its name, so two never clash. */
function backdropSvg(id) {
  const scene = BACKDROP_SCENES[id];
  if (!scene) return '';
  const body = scene().replace(/id="(\w+)"/g, `id="${id}-$1"`).replace(/url\(#(\w+)\)/g, `url(#${id}-$1)`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
}
/** As a CSS background, made once each: the scenes never change. */
const backdropCssMade = new Map();
function backdropCss(id) {
  if (!backdropCssMade.has(id)) backdropCssMade.set(id, `url("data:image/svg+xml,${encodeURIComponent(backdropSvg(id))}") center / cover no-repeat`);
  return backdropCssMade.get(id);
}
