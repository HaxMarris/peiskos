// Live backdrops: Under the sea, Volcano, Outer space and Casino lounge. Each has a still picture lit for the
// viewer's time of day (from daylight.js), and a few moving parts laid over it. The parts only move with
// transform and opacity, so the browser can hand them to the graphics chip instead of redrawing the scene.
// Part of Peiskos's client: plain scripts that index.html loads in order, sharing one global scope.
'use strict';

/**
 * A moving part of a live backdrop: a box at x,y, w×h in the scene's 1600×900 units, holding its own SVG drawn
 * from 0,0. `anim` names its motion (a class in style.css), `vars` tune it, and `op` is how much of it shows at
 * this time of day; parts that wouldn't show aren't made. `more` parts are left off small screens, and `go`
 * parts (a puff, a flash) only make sense moving, so they're left out when motion is reduced.
 */
function bdPart(x, y, w, h, svg, { anim = '', vars = '', op = 1, more = false, go = false, box = '', inner = null } = {}) {
  if (op < 0.03) return '';
  const cls = `bd-part${more ? ' bd-more' : ''}${go ? ' bd-go' : ''}`;
  const pos = `left:${(x / 16).toFixed(3)}%;top:${(y / 9).toFixed(3)}%;width:${(w / 16).toFixed(3)}%;height:${(h / 9).toFixed(3)}%;`;
  return `<div class="${cls}" style="${pos}${op < 0.99 ? `opacity:${op.toFixed(2)};` : ''}${box}"><div class="${anim}" style="${vars}">${inner ?? `<svg viewBox="0 0 ${w} ${h}">${svg}</svg>`}</div></div>`;
}
/** The vars for a part that crosses the whole scene sideways, starting off one edge: its own width is 100%. */
function bdCross(x, w, d, delay, leftward = false) {
  const from = (-(x + w) / w) * 100;
  const to = ((1600 - x) / w) * 100;
  return `--from:${(leftward ? to : from).toFixed(0)}%;--to:${(leftward ? from : to).toFixed(0)}%;--d:${d}s;--delay:${delay}s`;
}
const bdVars = (d, delay, more = '') => `--d:${d}s;--delay:${delay}s;${more}`;

/** A fish facing right, centred on x,y, len long. */
function bdFish(x, y, len, body, { fin = null, stripe = null, eye = '#08151e', left = false, opacity = 1 } = {}) {
  const L = len;
  const f = fin || body;
  let out = `<path d="M${x + L * 0.5} ${y}Q${x + L * 0.08} ${y - L * 0.34} ${x - L * 0.3} ${y}Q${x + L * 0.08} ${y + L * 0.34} ${x + L * 0.5} ${y}Z" fill="${body}"/>`;
  out += `<path d="M${x - L * 0.24} ${y}L${x - L * 0.5} ${y - L * 0.22}L${x - L * 0.42} ${y}L${x - L * 0.5} ${y + L * 0.22}Z" fill="${f}"/>`;
  out += `<path d="M${x + L * 0.06} ${y - L * 0.19}Q${x - L * 0.08} ${y - L * 0.36} ${x - L * 0.2} ${y - L * 0.12}Z" fill="${f}"/>`;
  if (stripe) out += `<path d="M${x + L * 0.2} ${y - L * 0.2}Q${x + L * 0.12} ${y} ${x + L * 0.2} ${y + L * 0.2}L${x + L * 0.1} ${y + L * 0.22}Q${x + L * 0.02} ${y} ${x + L * 0.1} ${y - L * 0.22}ZM${x - L * 0.08} ${y - L * 0.2}Q${x - L * 0.14} ${y} ${x - L * 0.08} ${y + L * 0.2}L${x - L * 0.16} ${y + L * 0.16}Q${x - L * 0.2} ${y} ${x - L * 0.16} ${y - L * 0.16}Z" fill="${stripe}"/>`;
  out += `<circle cx="${x + L * 0.32}" cy="${y - L * 0.04}" r="${Math.max(0.8, L * 0.045)}" fill="${eye}"/>`;
  const g = left ? ` transform="translate(${2 * x} 0) scale(-1 1)"` : '';
  return `<g${g}${opacity < 1 ? ` opacity="${opacity}"` : ''}>${out}</g>`;
}
/** Branching coral growing up from x,y. */
function bdCoral(seed, x, y, h, color, width = 9) {
  const rnd = bdRandom(seed);
  let d = '';
  const grow = (x0, y0, ang, len, depth) => {
    const x1 = x0 + Math.cos(ang) * len;
    const y1 = y0 + Math.sin(ang) * len;
    d += `M${x0.toFixed(0)} ${y0.toFixed(0)}Q${(x0 + Math.cos(ang + 0.3) * len * 0.5).toFixed(0)} ${(y0 + Math.sin(ang + 0.3) * len * 0.5).toFixed(0)} ${x1.toFixed(0)} ${y1.toFixed(0)}`;
    if (depth > 0) for (const s of [-1, 1]) grow(x1, y1, ang + s * (0.3 + rnd() * 0.35), len * (0.62 + rnd() * 0.15), depth - 1);
  };
  grow(x, y, -Math.PI / 2, h * 0.36, 3);
  return `<path d="${d}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" fill="none"/>`;
}
/** A five-armed star. */
function bdStarfish(x, y, r, fill, rot = 0) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 ? r * 0.42 : r;
    d += `${i ? 'L' : 'M'}${(x + Math.cos(a) * rr).toFixed(1)} ${(y + Math.sin(a) * rr).toFixed(1)}`;
  }
  return `<path d="${d}Z" fill="${fill}" stroke="${fill}" stroke-width="${(r * 0.25).toFixed(1)}" stroke-linejoin="round"/>`;
}
/** Something drawn w wide, twice side by side (and once more on each edge's far side), so it can slide by w forever. */
const bdTile = (svg, w) => [-w, 0, w, 2 * w].map((dx) => `<g transform="translate(${dx} 0)">${svg}</g>`).join('');
/** A soft round glow. Each gets its own gradient id, since parts sit in the page itself. */
let bdHaloCount = 0;
function bdHalo(x, y, r, color, a) {
  const id = `bdp-h${++bdHaloCount}`;
  return `<radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="${a.toFixed(3)}"/><stop offset=".4" stop-color="${color}" stop-opacity="${(a * 0.45).toFixed(3)}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient><circle cx="${x}" cy="${y}" r="${r}" fill="url(#${id})"/>`;
}

/* ---------------------------------------------------------------- Under the sea */

function bdOceanScene(t) {
  const nc = (c, k = 0.6) => dlMix(c, '#10203a', t.night * k); // colours fade blue in the dark
  const top = dlTone(t, '#0c2f52', '#43cfd0', '#d0907a', 0.5);
  const mid = dlTone(t, '#061c36', '#0d7592', '#2c5878');
  const deep = dlTone(t, '#020a16', '#05324c', '#0b2440');
  const sand = dlTone(t, '#1c2b3c', '#dcc28c', '#b08c70');
  const sandDeep = dlTone(t, '#0f1926', '#9a7a4e', '#6e5244');
  const rock = dlTone(t, '#08131f', '#1f4a58', '#283a52');
  const rockNear = dlTone(t, '#0b1824', '#2f5e66', '#3a4656');
  const [sx] = bdArc(t.sun, 200, 1400, 0, 0);
  const [mx] = bdArc(t.moon, 200, 1400, 0, 0);
  const moonA = t.moon.up ? t.night * (0.25 + t.moon.lit * 0.75) * Math.max(0.3, t.moon.alt) : 0;
  const rnd = bdRandom(301);
  let ripples = '';
  for (let i = 0; i < 26; i++) {
    const x = rnd() * 1600; const y = 790 + rnd() * 100; const w = 40 + rnd() * 70;
    ripples += `<path d="M${x.toFixed(0)} ${y.toFixed(0)}q${(w / 2).toFixed(0)} -9 ${w.toFixed(0)} 0" stroke="${sandDeep}" stroke-width="3" fill="none" opacity=".7"/>`;
  }
  let pebbles = '';
  for (let i = 0; i < 40; i++) pebbles += `<ellipse cx="${(rnd() * 1600).toFixed(0)}" cy="${(800 + rnd() * 100).toFixed(0)}" rx="${(3 + rnd() * 7).toFixed(1)}" ry="${(2 + rnd() * 3).toFixed(1)}" fill="${sandDeep}" opacity=".8"/>`;
  return `
    <defs>${bdGrad('w', [[0, top], [0.32, mid], [1, deep]])}${bdGrad('sd', [[0, sand], [1, sandDeep]])}${bdGrad('rk', [[0, rockNear], [1, rock]])}
      ${bdBlur('b', 16)}${bdBlur('b2', 5)}${bdVignette(0.6)}</defs>
    <rect width="1600" height="900" fill="url(#w)"/>
    <g filter="url(#b)">
      ${t.light > 0.05 ? `<ellipse cx="${sx.toFixed(0)}" cy="0" rx="420" ry="150" fill="#fff6d2" opacity="${(t.light * 0.55).toFixed(2)}"/><circle cx="${sx.toFixed(0)}" cy="40" r="46" fill="#fffbe6" opacity="${(t.light * 0.75).toFixed(2)}"/>` : ''}
      ${moonA > 0.03 ? `<ellipse cx="${mx.toFixed(0)}" cy="0" rx="300" ry="110" fill="#cfe2ff" opacity="${(moonA * 0.35).toFixed(2)}"/>` : ''}
    </g>
    ${moonA > 0.03 ? `<g filter="url(#b2)" opacity="${Math.min(0.9, moonA + 0.2).toFixed(2)}">${dlMoonSvg(mx, 52, 30, t.moon.phase, { color: '#e8f2ff', dark: '#9ab8d8', darkOpacity: 0.1, south: t.south, craters: false })}</g>` : ''}
    <path d="M-10 0V34${Array.from({ length: 17 }, (_, i) => `Q${i * 100 + 50 - 10} ${i % 2 ? 22 : 48} ${i * 100 + 100 - 10} 34`).join('')}V0Z" fill="${dlTone(t, '#1c4a6e', '#b8f0ee', '#e8b8a0')}" opacity=".35"/>
    <path d="M-10 900V430C30 390 110 380 170 420C240 465 250 540 300 580C350 620 370 720 390 900Z" fill="${rock}" opacity=".75"/>
    <path d="M1610 900V380C1560 350 1490 360 1450 410C1400 470 1420 540 1370 600C1320 660 1300 760 1290 900Z" fill="${rock}" opacity=".75"/>
    <path d="M1460 900V520C1480 470 1530 460 1560 500L1610 520V900Z" fill="${rock}"/>
    ${bdRidge(303, 760, 40, 9, dlMix(deep, rock, 0.5))}
    <path d="M-10 900V778C260 744 560 800 860 770S1380 748 1610 776V900Z" fill="url(#sd)"/>
    ${ripples}${pebbles}
    <path d="M-10 900V610C40 580 120 590 160 640C200 690 250 700 270 760C290 820 330 850 340 900Z" fill="url(#rk)"/>
    <path d="M1610 900V640C1560 610 1500 630 1470 680C1440 730 1400 760 1380 810C1365 850 1350 880 1345 900Z" fill="url(#rk)"/>
    ${bdCoral(311, 300, 860, 190, nc('#e8607a'), 11)}${bdCoral(313, 370, 880, 130, nc('#f08a5a'), 9)}
    ${bdCoral(317, 1250, 870, 170, nc('#c46ae0'), 10)}${bdCoral(319, 1180, 885, 110, nc('#f0b040'), 8)}
    <ellipse cx="460" cy="868" rx="56" ry="34" fill="${nc('#d88a4a')}"/>
    ${Array.from({ length: 5 }, (_, i) => `<path d="M${416 + i * 4} ${850 + i * 7}q22 -14 44 0t44 0" stroke="${nc('#a85a2a')}" stroke-width="3" fill="none"/>`).join('')}
    <g>${Array.from({ length: 14 }, (_, i) => { const a = -Math.PI * (0.15 + (0.7 * i) / 13); return `<path d="M1110 890Q${(1110 + Math.cos(a) * 30).toFixed(0)} ${(890 + Math.sin(a) * 60).toFixed(0)} ${(1110 + Math.cos(a) * 70).toFixed(0)} ${(890 + Math.sin(a) * 90).toFixed(0)}" stroke="${nc('#ff9ab8')}" stroke-width="7" stroke-linecap="round" fill="none"/>`; }).join('')}<ellipse cx="1110" cy="892" rx="34" ry="12" fill="${nc('#c0406a')}"/></g>
    <g opacity=".95">${(() => { let fan = ''; for (let i = 0; i < 11; i++) { const a = -Math.PI * (0.2 + (0.6 * i) / 10); fan += `M1500 880L${(1500 + Math.cos(a) * 170).toFixed(0)} ${(880 + Math.sin(a) * 200).toFixed(0)}`; } return `<path d="${fan}" stroke="${nc('#9a4ac8')}" stroke-width="4" fill="none"/>${[90, 140, 180].map((r) => `<path d="M${1500 - r * 0.8} ${880 - r * 0.6}Q1500 ${880 - r * 1.3} ${1500 + r * 0.8} ${880 - r * 0.6}" stroke="${nc('#9a4ac8')}" stroke-width="2.5" fill="none"/>`).join('')}`; })()}</g>
    ${bdStarfish(600, 868, 16, nc('#f07a3a'), 0.3)}${bdStarfish(1010, 880, 12, nc('#e8506a'), 1.1)}
    <path d="M760 884q14 -22 28 0Z" fill="${nc('#f2dcc0')}"/><path d="M846 878c6 -10 20 -10 24 2" stroke="${nc('#e8c8a8')}" stroke-width="4" fill="none"/>
    ${bdVignetteRect}`;
}

function bdOceanParts(t) {
  const rays = Math.min(1, t.light * 0.85 + (t.moon.up ? t.night * t.moon.lit * 0.3 : 0));
  const rayColor = t.light > 0.3 ? '#e6fdff' : '#c8dcff';
  const ray = (x, w, len, skew, d, delay, i) => bdPart(x, -20, w + len * skew, len,
    `<defs><linearGradient id="bdp-ray${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${rayColor}" stop-opacity=".5"/><stop offset="1" stop-color="${rayColor}" stop-opacity="0"/></linearGradient></defs><path d="M${len * skew} 0h${w}L${w * 0.6} ${len}H0Z" fill="url(#bdp-ray${i})"/>`,
    { anim: 'bd-pulse', vars: bdVars(d, delay, '--lo:.25'), op: rays * 0.8 });
  const kelp = (x, h, c, d, delay, more = false) => {
    let leaves = '';
    for (let i = 1; i < 8; i++) {
      const y = h - (h * i) / 8.2;
      const s = i % 2 ? 1 : -1;
      leaves += `<path d="M30 ${y.toFixed(0)}q${s * 22} -10 ${s * 30} -34q${s * -14} 6 ${s * -30} 22Z" fill="${c}"/>`;
    }
    return bdPart(x - 30, 900 - h, 60, h + 10, `<path d="M30 ${h + 10}C14 ${h * 0.7} 46 ${h * 0.4} 30 4" stroke="${c}" stroke-width="9" fill="none" stroke-linecap="round"/>${leaves}`,
      { anim: 'bd-sway', vars: bdVars(d, delay, '--a:4deg'), more });
  };
  const kc = (c) => dlMix(c, '#0e2234', t.night * 0.6);
  const school = (y, n, len, color, d, delay, leftward, seed, op = 1) => {
    const rnd = bdRandom(seed);
    let fish = '';
    for (let i = 0; i < n; i++) fish += bdFish(20 + (i % 4) * len * 1.3 + rnd() * 20, 18 + Math.floor(i / 4) * len * 0.6 + rnd() * 14, len, color, { left: leftward, eye: dlMix(color, '#000', 0.6) });
    const w = 60 + 4 * len * 1.3; const h = 30 + Math.ceil(n / 4) * len * 0.6;
    return bdPart(200, y, w, h, fish, { anim: 'bd-swim', vars: bdCross(200, w, d, delay, leftward), op });
  };
  const bubbles = (x, y, d, delay, more = false) => bdPart(x, y, 40, 70,
    '<g fill="none" stroke="#d8fbff" stroke-width="2"><circle cx="20" cy="60" r="6"/><circle cx="12" cy="34" r="4" opacity=".8"/><circle cx="24" cy="12" r="3" opacity=".7"/></g>',
    { anim: 'bd-rise', vars: bdVars(d, delay, `--rise:${(-(y - 40) / 70 * 100).toFixed(0)}%;--dx:30%`), more, op: 0.75 });
  const jelly = (x, y, s, c, d, delay, more = false) => bdPart(x, y, 80 * s, 130 * s,
    `<g transform="scale(${s})">${bdHalo(40, 30, 46, c, 0.25 + t.night * 0.6)}<path d="M8 34C8 4 72 4 72 34Q62 30 56 36Q48 30 40 36Q32 30 24 36Q16 30 8 34Z" fill="${c}" opacity=".75"/>
      <path d="M20 36q-6 30 4 56t-2 34M34 38q6 34 -2 60M46 38q-6 30 4 58t-4 30M60 36q6 26 -2 52" stroke="${c}" stroke-width="2.5" fill="none" opacity=".55"/></g>`,
    { anim: 'bd-bob bd-squish', vars: bdVars(d, delay, '--dy:-40%;--dx:6%'), more });
  const lone = (x, y, len, body, stripe, d, delay, left, more = false) => bdPart(x, y, len * 1.4, len,
    bdFish(len * 0.7, len * 0.5, len, kc(body), { stripe: stripe && kc(stripe), left }), { anim: 'bd-bob', vars: bdVars(d, delay, `--dx:${left ? -40 : 40}%;--dy:12%`), more });
  const plankton = (x, y, w, h, seed, delay) => {
    const rnd = bdRandom(seed);
    let dots = '';
    for (let i = 0; i < 38; i++) dots += `<circle cx="${(rnd() * w).toFixed(0)}" cy="${(rnd() * h).toFixed(0)}" r="${(1 + rnd() * 2).toFixed(1)}" fill="#7cf8ff" opacity="${(0.4 + rnd() * 0.6).toFixed(2)}"/>`;
    return bdPart(x, y, w, h, dots, { anim: 'bd-twinkle', vars: bdVars(4.5, delay, '--lo:.1'), op: t.night * 0.95 });
  };
  const caustic = (seed, delay) => {
    const rnd = bdRandom(seed);
    let d = '';
    for (let i = 0; i < 34; i++) { const x = rnd() * 1600; const y = 10 + rnd() * 110; d += `M${x.toFixed(0)} ${y.toFixed(0)}q${(20 + rnd() * 30).toFixed(0)} ${(-8 - rnd() * 10).toFixed(0)} ${(50 + rnd() * 40).toFixed(0)} ${(rnd() * 8 - 4).toFixed(0)}`; }
    return bdPart(0, 770, 1600, 130, `<path d="${d}" stroke="#fffbe0" stroke-width="3" fill="none" stroke-linecap="round"/>`, { anim: 'bd-pulse', vars: bdVars(3.4, delay, '--lo:0'), op: t.light * 0.4, more: true });
  };
  const turtle = bdPart(1000, 70, 190, 110, `<g fill="${kc('#4f8a5a')}"><path d="M40 30q-26 -22 -36 -8q14 8 30 18ZM44 82q-22 20 -34 10q12 -8 28 -16ZM150 36q22 -26 34 -16q-12 10 -28 22ZM146 78q20 18 30 8q-10 -8 -26 -14Z"/><ellipse cx="172" cy="56" rx="16" ry="12"/></g>
    <ellipse cx="96" cy="56" rx="62" ry="38" fill="${kc('#6a5a3a')}"/><path d="M60 40l20 14 -20 16M96 22v68M132 40l-20 14 20 16M80 54h32" stroke="${kc('#3e3424')}" stroke-width="3" fill="none"/><circle cx="178" cy="52" r="2.5" fill="#0a1410"/>`,
  { anim: 'bd-swim', vars: bdCross(1000, 190, 150, -60, true) });
  return [
    ray(240, 120, 760, 0.4, 9, -2, 1), ray(640, 80, 600, 0.3, 11, -6, 2), ray(1020, 140, 820, 0.25, 8, -4, 3), ray(1360, 70, 560, 0.2, 12, -9, 4),
    caustic(331, 0), caustic(337, -1.7),
    plankton(60, 120, 420, 520, 341, 0), plankton(1120, 140, 440, 520, 343, -2.2), plankton(520, 60, 560, 220, 347, -1.1),
    turtle,
    school(170, 8, 26, kc('#26607a'), 70, -12, false, 351, 0.9), school(120, 12, 16, kc('#1d4c64'), 95, -50, true, 353, 0.7),
    school(330, 6, 22, kc('#3a7e96'), 60, -38, false, 357, 0.8),
    jelly(140, 250, 1.1, '#f0a8e0', 9, -3), jelly(1400, 210, 0.9, '#b8a0ff', 11, -7), jelly(1240, 440, 0.7, '#9ae0ff', 8, -1, true),
    lone(380, 680, 48, '#f07a2a', '#fff4e8', 6, -1, false), lone(1130, 690, 44, '#3a8af0', null, 7, -3, true), lone(250, 560, 36, '#f6d23a', null, 5, -2, false, true), lone(1330, 600, 40, '#e8506a', '#ffe0e6', 6.5, -4, true, true),
    kelp(60, 560, kc('#1f8a6a'), 6, -1), kelp(150, 420, kc('#2a9a74'), 7.5, -3), kelp(225, 300, kc('#3aa47a'), 5.5, -2, true),
    kelp(1395, 380, kc('#2a9a74'), 7, -4, true), kelp(1475, 600, kc('#1f8a6a'), 6.5, -2), kelp(1555, 440, kc('#2a9a74'), 8, -5),
    bdLive.catch?.look ? bdCatchPart(t, bdLive.catch) : '',
    bubbles(330, 790, 11, -2), bubbles(470, 820, 14, -9), bubbles(1110, 830, 12, -5), bubbles(1255, 800, 10, -1), bubbles(720, 850, 15, -11, true), bubbles(940, 840, 13, -6, true),
  ].join('');
}

/* ---------------------------------------------------------------- Volcano */

const BD_CRATER = [1010, 330];

function bdVolcanoScene(t) {
  const [cx, cy] = BD_CRATER;
  const glow = 0.45 + t.night * 0.55;
  const skyTop = dlTone(t, '#0d0306', '#5f7ea0', '#2c1236');
  const skyMid = dlTone(t, '#2a0a0a', '#a49c9c', '#a8403a');
  const skyLow = dlTone(t, '#5c1808', '#dcb48c', '#ff8a3c');
  const far = dlTone(t, '#1a0707', '#5a5560', '#3e2232');
  const cone = dlTone(t, '#2e110e', '#4a3c38', '#3a2420');
  const coneDark = dlTone(t, '#120505', '#2a211f', '#1e1010');
  const ground = dlTone(t, '#100404', '#2c2420', '#1e1210');
  const ash = dlTone(t, '#2a1110', '#6e6662', '#4a2a2a');
  const [sx, sy] = bdArc(t.sun, 140, 1460, 470, 120);
  const [mx, my] = bdArc(t.moon, 140, 1460, 560, 110);
  const rnd = bdRandom(401);
  let gullies = '';
  for (let i = 0; i < 9; i++) {
    const x0 = cx - 80 + i * 20 + rnd() * 10;
    const x1 = x0 + (x0 - cx) * (3.2 + rnd());
    gullies += `<path d="M${x0.toFixed(0)} ${cy + 20}Q${((x0 + x1) / 2 + (rnd() - 0.5) * 60).toFixed(0)} ${(cy + 260).toFixed(0)} ${x1.toFixed(0)} 840" stroke="${coneDark}" stroke-width="${(3 + rnd() * 4).toFixed(1)}" fill="none" opacity=".6"/>`;
  }
  const flows = `M${cx - 10} ${cy + 30}C${cx - 30} ${cy + 120} ${cx + 10} ${cy + 200} ${cx - 40} ${cy + 290}S${cx - 60} ${cy + 400} ${cx - 100} 800M${cx + 30} ${cy + 26}C${cx + 70} ${cy + 100} ${cx + 90} ${cy + 180} ${cx + 150} ${cy + 240}S${cx + 230} ${cy + 380} ${cx + 280} 800M${cx + 4} ${cy + 30}C${cx + 20} ${cy + 140} ${cx + 50} ${cy + 260} ${cx + 30} ${cy + 360}`;
  let strata = '';
  for (let i = 0; i < 6; i++) {
    const y = cy + 70 + i * 70 + rnd() * 20;
    const half = 120 + (y - cy) * 1.05;
    strata += `<path d="M${(cx - half * 0.8).toFixed(0)} ${y.toFixed(0)}q${(half * 0.4).toFixed(0)} ${(10 + rnd() * 16).toFixed(0)} ${(half * 0.8).toFixed(0)} ${(4 + rnd() * 8).toFixed(0)}t${(half * 0.7).toFixed(0)} ${(-6 - rnd() * 6).toFixed(0)}" stroke="${dlMix(cone, '#ffffff', 0.08)}" stroke-width="2" fill="none" opacity=".5"/>`;
  }
  let boulders = '';
  for (let i = 0; i < 12; i++) {
    const x = 200 + rnd() * 1200; const y = 820 + rnd() * 60; const r = 6 + rnd() * 16;
    boulders += `<path d="M${(x - r).toFixed(0)} ${y.toFixed(0)}q${(r * 0.2).toFixed(0)} ${(-r * 1.1).toFixed(0)} ${r.toFixed(0)} ${(-r * 0.9).toFixed(0)}t${r.toFixed(0)} ${(r * 0.9).toFixed(0)}Z" fill="${dlMix(ground, '#000', 0.35)}"/><path d="M${(x - r * 0.6).toFixed(0)} ${(y - r * 0.6).toFixed(0)}q${(r * 0.5).toFixed(0)} ${(-r * 0.4).toFixed(0)} ${r.toFixed(0)} 0" stroke="#ff8a3a" stroke-width="1.5" fill="none" opacity="${(t.night * 0.4).toFixed(2)}"/>`;
  }
  let columns = '';
  for (const [x0, n, dir] of [[-20, 6, 1], [1620, 6, -1]]) {
    for (let i = 0; i < n; i++) {
      const w = 34 + ((i * 7) % 10);
      const x = x0 + dir * i * 36;
      const top = 700 + i * 30 + ((i * 37) % 40);
      columns += `<path d="M${x} 900V${top}l${dir * w / 2} -12l${dir * w / 2} 12V900Z" fill="${dlMix(ground, '#000', 0.25)}" stroke="${dlMix(ground, '#ffffff', 0.06)}" stroke-width="2"/>`;
    }
  }
  let cracks = '';
  for (let i = 0; i < 7; i++) {
    const x = 240 + rnd() * 1120; const y = 830 + rnd() * 55;
    cracks += `M${x.toFixed(0)} ${y.toFixed(0)}l${(20 + rnd() * 30).toFixed(0)} ${(rnd() * 10 - 5).toFixed(0)}l${(10 + rnd() * 30).toFixed(0)} ${(rnd() * 12 - 2).toFixed(0)}l${(20 + rnd() * 30).toFixed(0)} ${(rnd() * 10 - 6).toFixed(0)}`;
  }
  return `
    <defs>${bdGrad('s', [[0, skyTop], [0.5, skyMid], [0.82, skyLow]])}${bdGlow('g', '#ff5a14', 0.7)}${bdGlow('sun', '#fff2c8', 0.8)}
      ${bdGrad('vo', [[0, cone], [1, coneDark]])}${bdGrad('lava', [[0, '#ffe08a'], [0.4, '#ff6a1c'], [1, '#c4200c']])}${bdBlur('b', 16)}${bdBlur('b2', 5)}${bdVignette(0.6)}</defs>
    <rect width="1600" height="900" fill="url(#s)"/>
    <g opacity="${(t.night * 0.9).toFixed(2)}">${bdStars(401, 140, 380, '#ffe8d8')}</g>
    ${t.sun.up || t.warm > 0.6 ? `<circle cx="${sx.toFixed(0)}" cy="${sy.toFixed(0)}" r="200" fill="url(#sun)" opacity="${Math.max(t.light, t.warm) * 0.8}"/><circle cx="${sx.toFixed(0)}" cy="${sy.toFixed(0)}" r="38" fill="${dlMix('#fff3d6', t.sun.x < 0.5 ? '#ffb0a0' : '#ff9a4a', 1 - t.sun.alt * 3)}" opacity="${(0.5 + Math.max(t.light, t.warm) * 0.45).toFixed(2)}"/>` : ''}
    ${t.moon.up && t.night > 0.1 ? `<g opacity="${(t.night * 0.95).toFixed(2)}">${dlMoonSvg(mx, my, 34, t.moon.phase, { color: '#f6e6d4', dark: '#c8a898', south: t.south })}</g>` : ''}
    <ellipse cx="${cx}" cy="${cy}" rx="360" ry="230" fill="url(#g)" opacity="${glow.toFixed(2)}"/>
    <g filter="url(#b)" fill="${ash}"><ellipse cx="${cx - 40}" cy="${cy - 130}" rx="150" ry="90" opacity=".8"/><ellipse cx="${cx - 150}" cy="${cy - 220}" rx="210" ry="100" opacity=".65"/><ellipse cx="${cx - 300}" cy="${cy - 270}" rx="250" ry="90" opacity=".45"/></g>
    <g filter="url(#b)" fill="#ff6a2a" opacity="${(t.night * 0.35).toFixed(2)}"><ellipse cx="${cx - 30}" cy="${cy - 90}" rx="120" ry="50"/></g>
    ${bdMountains(403, 600, 170, 8, far)}
    <path d="M60 760L300 560Q330 545 360 560L560 740Z" fill="${dlMix(far, cone, 0.5)}"/>
    <path d="M300 560Q330 545 360 560L350 572 330 566 312 574Z" fill="#ffb060" opacity="${(0.2 + t.night * 0.6).toFixed(2)}"/>
    <path d="M440 860C620 760 760 600 ${cx - 120} ${cy + 20}Q${cx} ${cy - 18} ${cx + 120} ${cy + 20}C${cx + 260} 560 ${cx + 420} 760 1640 860V900H440Z" fill="url(#vo)"/>
    ${gullies}${strata}
    <path d="M${cx - 120} ${cy + 20}Q${cx} ${cy - 18} ${cx + 120} ${cy + 20}L${cx + 92} ${cy + 46} ${cx + 60} ${cy + 34} ${cx + 30} ${cy + 56} ${cx} ${cy + 36} ${cx - 34} ${cy + 52} ${cx - 64} ${cy + 34} ${cx - 92} ${cy + 46}Z" fill="url(#lava)"/>
    <g filter="url(#b2)" opacity="${(0.4 + t.night * 0.6).toFixed(2)}"><path d="${flows}" stroke="#ff5a14" stroke-width="18" fill="none"/></g>
    <path d="${flows}" stroke="${dlMix('#3a1a10', '#ff7a2a', 0.35 + t.night * 0.65)}" stroke-width="7" fill="none"/>
    <path d="${flows}" stroke="#ffd36b" stroke-width="2.5" fill="none" stroke-dasharray="40 26" opacity="${(0.3 + t.night * 0.7).toFixed(2)}"/>
    ${bdRidge(407, 830, 60, 7, ground)}
    <path d="M1240 900C1300 860 1380 850 1460 870S1560 880 1610 870V900Z" fill="url(#lava)" opacity="${(0.5 + t.night * 0.5).toFixed(2)}"/>
    <path d="${cracks}" stroke="#ff7a2a" stroke-width="3" fill="none" opacity="${(0.25 + t.night * 0.6).toFixed(2)}"/>
    ${boulders}${columns}
    ${bdVignetteRect}`;
}

function bdVolcanoParts(t) {
  const [cx, cy] = BD_CRATER;
  const smokeColor = dlTone(t, '#3a1a16', '#7a726c', '#5a3434');
  const puff = (d, delay, s) => bdPart(cx - 90, cy - 110, 180, 140,
    `<g fill="${smokeColor}"><circle cx="70" cy="80" r="${42 * s}"/><circle cx="110" cy="70" r="${36 * s}"/><circle cx="90" cy="50" r="${34 * s}"/></g>${t.night > 0.3 ? `<ellipse cx="90" cy="100" rx="50" ry="18" fill="#ff7a3a" opacity="${(t.night * 0.4).toFixed(2)}"/>` : ''}`,
    { anim: 'bd-billow', vars: bdVars(d, delay, '--dx:-140%;--dy:-170%;--s:2.6;--hi:.75'), go: true });
  const embers = (x, d, delay, seed, more = false) => {
    const rnd = bdRandom(seed);
    let dots = '';
    for (let i = 0; i < 9; i++) dots += `<circle cx="${(rnd() * 60).toFixed(0)}" cy="${(rnd() * 80).toFixed(0)}" r="${(1.5 + rnd() * 2.5).toFixed(1)}" fill="${rnd() < 0.5 ? '#ffd36b' : '#ff8a2a'}"/>`;
    return bdPart(x, cy - 40, 60, 80, dots, { anim: 'bd-rise', vars: bdVars(d, delay, `--rise:-${(260 + rnd() * 150).toFixed(0)}%;--dx:${(rnd() * 160 - 100).toFixed(0)}%`), more });
  };
  const bomb = (dx, up, down, d, delay, r) => bdPart(cx - 10, cy - 10, 20, 20,
    `<circle cx="10" cy="10" r="${r}" fill="#ffb84a"/><circle cx="10" cy="10" r="${r * 0.5}" fill="#fff0b0"/>`,
    { anim: 'bd-bomb-x', vars: bdVars(d, delay, `--dx:${dx}%`), go: true, inner: `<div class="bd-bomb-y" style="--up:${up}%;--down:${down}%;--d:${d}s;--delay:${delay}s"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="${r}" fill="#ffb84a"/><circle cx="10" cy="10" r="${r * 0.5}" fill="#fff0b0"/></svg></div>` });
  const bolt = (x, y, path, d, delay) => bdPart(x, y, 120, 160, `<path d="${path}" stroke="#e8e0ff" stroke-width="3" fill="none" stroke-linejoin="round"/><path d="${path}" stroke="#a89aff" stroke-width="9" fill="none" opacity=".35"/>`,
    { anim: 'bd-flash', vars: bdVars(d, delay), op: t.night, go: true });
  const flows = `M${cx - 10} ${cy + 30}C${cx - 30} ${cy + 120} ${cx + 10} ${cy + 200} ${cx - 40} ${cy + 290}S${cx - 60} ${cy + 400} ${cx - 100} 800M${cx + 30} ${cy + 26}C${cx + 70} ${cy + 100} ${cx + 90} ${cy + 180} ${cx + 150} ${cy + 240}S${cx + 230} ${cy + 380} ${cx + 280} 800`;
  const steam = (delay) => bdPart(300, 470, 80, 90, `<g fill="#d8d0cc"><circle cx="30" cy="60" r="20"/><circle cx="48" cy="44" r="18"/></g>`,
    { anim: 'bd-billow', vars: bdVars(12, delay, '--dx:-60%;--dy:-180%;--s:2.2;--hi:.35'), go: true, more: true });
  return [
    bdPart(cx - 260, cy - 160, 520, 320, bdHalo(260, 160, 250, '#ff6a1c', 0.9), { anim: 'bd-pulse', vars: bdVars(4.5, -1, '--lo:.35'), op: 0.4 + t.night * 0.6 }),
    bdPart(cx - 130, cy, 450, 520, `<g transform="translate(${130 - cx} ${-cy})"><path d="${flows}" stroke="#ffe08a" stroke-width="4" fill="none" stroke-linecap="round"/></g>`, { anim: 'bd-pulse', vars: bdVars(2.6, -0.5, '--lo:.1'), op: 0.35 + t.night * 0.65 }),
    puff(18, 0, 1), puff(18, -6, 0.9), puff(18, -12, 1.1),
    steam(0), steam(-6),
    bolt(cx - 210, cy - 300, 'M60 0L48 40L70 52L40 100L56 108L30 160', 13, -4), bolt(cx - 380, cy - 340, 'M70 0L80 34L56 50L74 92L50 104L66 150', 19, -11),
    embers(cx - 40, 5, 0, 411), embers(cx - 10, 6.5, -2, 413), embers(cx + 10, 5.5, -4, 417, true), embers(cx - 60, 7, -1, 419, true),
    bomb(-1400, -900, 400, 11, 0, 5), bomb(-700, -1300, -200, 11, -0.2, 4), bomb(900, -1100, 300, 11, -0.1, 4.5), bomb(1500, -700, 900, 11, -0.3, 3.5), bomb(300, -1500, -400, 11, -0.4, 3),
  ].join('');
}

/* ---------------------------------------------------------------- Outer space */

const BD_PLANET = [1150, 230, 132];
const BD_LAND = [[-50, -40, 1], [30, 20, 0.8], [-10, 70, 0.6], [70, -70, 0.5], [-90, 40, 0.5]];

function bdPlanetPhase(t) {
  // The planet shows the viewer's own day: fully lit at noon, dark with city lights at midnight.
  return (((t.hour - 12) / 24 + 0.5) % 1 + 1) % 1;
}

function bdSpaceScene(t) {
  const [px, py, pr] = BD_PLANET;
  const [sx, sy] = bdArc(t.sun, 180, 1420, 700, 150);
  const ground = dlTone(t, '#1c1e2a', '#8c8a96', '#6a5e66');
  const groundDark = dlTone(t, '#0c0d14', '#55535e', '#3e3640');
  const shadowDir = t.sun.up ? (t.sun.x < 0.5 ? 1 : -1) : 0;
  const shadowLen = t.sun.up ? 20 + (1 - t.sun.alt) * 70 : 0;
  const rnd = bdRandom(501);
  let land = '';
  for (const [x, y, s] of BD_LAND) {
    let d = '';
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const r = (34 + rnd() * 26) * s;
      d += `${i ? 'L' : 'M'}${(px + x + Math.cos(a) * r).toFixed(0)} ${(py + y + Math.sin(a) * r * 0.7).toFixed(0)}`;
    }
    land += `<path d="${d}Z" fill="${rnd() < 0.5 ? '#4a9a5a' : '#8aa060'}" stroke="#c8b07a" stroke-width="3" stroke-linejoin="round"/>`;
  }
  let craters = '';
  for (const [x, y, r] of [[380, 830, 46], [1130, 812, 30], [700, 868, 20], [1450, 852, 36], [180, 874, 24], [960, 846, 14], [560, 800, 12]]) {
    craters += `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${(r * 0.32).toFixed(1)}" fill="${groundDark}"/><path d="M${x - r} ${y}A${r} ${(r * 0.32).toFixed(1)} 0 0 0 ${x + r} ${y}" stroke="${dlMix(ground, '#ffffff', 0.15 + t.light * 0.15)}" stroke-width="2.5" fill="none"/>`;
  }
  let rocks = '';
  for (const [x, y, r] of [[90, 820, 34], [250, 846, 18], [1300, 836, 22], [1530, 812, 40], [640, 852, 9], [870, 860, 11]]) {
    if (shadowLen) rocks += `<ellipse cx="${x + shadowDir * shadowLen * (r / 30)}" cy="${y + r * 0.35}" rx="${(r + shadowLen * (r / 30)).toFixed(0)}" ry="${(r * 0.22).toFixed(1)}" fill="#000" opacity=".35"/>`;
    rocks += `<path d="M${x - r} ${y + r * 0.35}Q${x - r * 0.8} ${y - r * 0.6} ${x - r * 0.1} ${y - r * 0.7}Q${x + r * 0.9} ${y - r * 0.5} ${x + r} ${y + r * 0.35}Z" fill="${dlMix(ground, '#000', 0.2)}"/>`;
  }
  const windows = dlMix('#3a3a50', '#ffcf7a', t.night);
  return `
    <defs><radialGradient id="pl" cx=".4" cy=".35"><stop offset="0" stop-color="#5ab8f0"/><stop offset=".7" stop-color="#1e5aa8"/><stop offset="1" stop-color="#0e2c6a"/></radialGradient>
      <clipPath id="pc"><circle cx="${px}" cy="${py}" r="${pr}"/></clipPath>
      ${bdGrad('gr', [[0, ground], [1, groundDark]])}${bdGlow('sun', '#fff6dc', 0.9)}${bdBlur('b', 40)}${bdVignette(0.5)}</defs>
    <rect width="1600" height="900" fill="#03030c"/>
    <g filter="url(#b)"><ellipse cx="380" cy="260" rx="420" ry="170" fill="#7a3ad8" opacity=".42"/><ellipse cx="560" cy="330" rx="260" ry="110" fill="#d84a9a" opacity=".28"/><ellipse cx="1300" cy="520" rx="320" ry="140" fill="#3a6ad8" opacity=".28"/></g>
    <g opacity="${(1 - t.light * 0.35).toFixed(2)}">${bdStars(37, 380, 780, '#ffffff')}</g>
    ${t.sun.up ? `<circle cx="${sx.toFixed(0)}" cy="${sy.toFixed(0)}" r="230" fill="url(#sun)"/><path d="M${(sx - 170).toFixed(0)} ${sy.toFixed(0)}H${(sx + 170).toFixed(0)}M${sx.toFixed(0)} ${(sy - 110).toFixed(0)}V${(sy + 110).toFixed(0)}" stroke="#fff8e8" stroke-width="2" opacity=".5"/><circle cx="${sx.toFixed(0)}" cy="${sy.toFixed(0)}" r="26" fill="#fffdf4"/>` : ''}
    ${dlMoonSvg(300, 140, 24, t.moon.phase, { color: '#e8e0d0', dark: '#8a8aa0', darkOpacity: 0.18, south: t.south })}
    <circle cx="${px}" cy="${py}" r="${pr + 16}" fill="#6ac8ff" opacity=".12"/>
    <g clip-path="url(#pc)"><circle cx="${px}" cy="${py}" r="${pr}" fill="url(#pl)"/>${land}
      <path d="M${px - pr} ${py - pr * 0.82}h${pr * 2}v-40h${-pr * 2}Z" fill="#eef6ff"/><ellipse cx="${px}" cy="${py - pr + 6}" rx="${pr * 0.55}" ry="20" fill="#eef6ff"/><ellipse cx="${px + 10}" cy="${py + pr - 4}" rx="${pr * 0.45}" ry="16" fill="#eef6ff"/></g>
    <circle cx="${px}" cy="${py}" r="${pr + 1}" fill="none" stroke="#9adcff" stroke-width="4" opacity=".55"/>
    <path d="M-10 900V788Q400 740 800 760T1610 776V900Z" fill="url(#gr)"/>
    ${craters}${rocks}
    <g transform="translate(150 700)">
      <path d="M0 96h40V70h120v26h40" stroke="${groundDark}" stroke-width="8" fill="none"/>
      <path d="M10 96A90 70 0 0 1 190 96Z" fill="${dlTone(t, '#3a3e52', '#d8dae4')}"/>
      <path d="M40 96A60 64 0 0 1 100 30M100 30A60 64 0 0 1 160 96M18 70H182" stroke="${dlTone(t, '#2a2e3e', '#a8aab8')}" stroke-width="3" fill="none"/>
      ${[[52, 78], [84, 56], [116, 56], [148, 78]].map(([x, y]) => `<rect x="${x - 9}" y="${y - 6}" width="18" height="12" rx="3" fill="${windows}"/>`).join('')}
      ${t.night > 0.3 ? `<ellipse cx="100" cy="98" rx="140" ry="16" fill="#ffcf7a" opacity="${(t.night * 0.16).toFixed(2)}"/>` : ''}
      <path d="M190 96l40 -70" stroke="${dlTone(t, '#3a3e52', '#b8bac8')}" stroke-width="4"/><path d="M210 20q30 -6 40 24q-30 8 -40 -24Z" fill="${dlTone(t, '#4a4e62', '#e0e2ea')}"/>
    </g>
    <g transform="translate(1340 760)"><path d="M0 40l50 -40l90 0l-50 40Z" fill="#23305a" stroke="#6a7ab0" stroke-width="2"/><path d="M14 30l40 -32M30 30l40 -32M46 30l40 -32M62 30l40 -32M78 30l40 -32" stroke="#6a7ab0" stroke-width="1.5"/><path d="M70 40v16" stroke="${groundDark}" stroke-width="5"/></g>
    ${bdVignetteRect}`;
}

function bdSpaceParts(t) {
  const [px, py, pr] = BD_PLANET;
  const pp = bdPlanetPhase(t);
  const dark = dlLitPath(pr, pr, pr, pp + 0.5);
  const rnd = bdRandom(521);
  let cities = '';
  // Around the middles of the land in bdSpaceScene.
  for (const [lx, ly, ls] of BD_LAND) {
    for (let i = 0; i < 16 * ls; i++) {
      const a = rnd() * Math.PI * 2; const r = Math.sqrt(rnd()) * 40 * ls;
      cities += `<circle cx="${(pr + lx + Math.cos(a) * r).toFixed(0)}" cy="${(pr + ly + Math.sin(a) * r * 0.7).toFixed(0)}" r="${(0.8 + rnd() * 1.4).toFixed(1)}" fill="#ffd27a" opacity="${(0.5 + rnd() * 0.5).toFixed(2)}"/>`;
    }
  }
  let tile = '';
  for (let i = 0; i < 9; i++) {
    const x = rnd() * pr * 2; const y = 30 + rnd() * (pr * 2 - 60);
    tile += `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${(30 + rnd() * 40).toFixed(0)}" ry="${(6 + rnd() * 8).toFixed(0)}" fill="#ffffff" opacity="${(0.45 + rnd() * 0.35).toFixed(2)}"/>`;
  }
  const clouds = bdTile(tile, pr * 2);
  const twinkles = (seed, delay) => {
    const r2 = bdRandom(seed);
    let s = '';
    for (let i = 0; i < 26; i++) {
      const x = r2() * 1600; const y = r2() * 700;
      s += `<path d="M${x.toFixed(0)} ${(y - 6).toFixed(0)}L${(x + 1.2).toFixed(1)} ${(y - 1.2).toFixed(1)}L${(x + 6).toFixed(0)} ${y.toFixed(0)}L${(x + 1.2).toFixed(1)} ${(y + 1.2).toFixed(1)}L${x.toFixed(0)} ${(y + 6).toFixed(0)}L${(x - 1.2).toFixed(1)} ${(y + 1.2).toFixed(1)}L${(x - 6).toFixed(0)} ${y.toFixed(0)}L${(x - 1.2).toFixed(1)} ${(y - 1.2).toFixed(1)}Z" fill="#ffffff"/>`;
    }
    return bdPart(0, 0, 1600, 700, s, { anim: 'bd-twinkle', vars: bdVars(5, delay, '--lo:0'), op: 1 - t.light * 0.4, more: seed % 2 === 0 });
  };
  const station = `<g fill="none" stroke="#b8c4dc" stroke-width="5"><circle cx="50" cy="50" r="40"/><path d="M50 10V90M10 50H90"/></g><circle cx="50" cy="50" r="9" fill="#d8e0f0"/><g fill="#5a7ac8"><rect x="44" y="0" width="12" height="8"/><rect x="44" y="92" width="12" height="8"/></g>`;
  const sat = `<rect x="0" y="8" width="26" height="12" fill="#3a5aa8" stroke="#8aa0d8" stroke-width="1"/><rect x="44" y="8" width="26" height="12" fill="#3a5aa8" stroke="#8aa0d8" stroke-width="1"/><rect x="28" y="4" width="14" height="20" rx="2" fill="#d8d0b8"/><path d="M26 14h2M42 14h2" stroke="#8aa0d8" stroke-width="2"/>`;
  return [
    twinkles(531, 0), twinkles(532, -2.5), twinkles(533, -1.2),
    bdPart(px - pr, py - pr, pr * 2, pr * 2, '', { box: 'border-radius:50%;overflow:hidden;', anim: 'bd-drift', vars: bdVars(220, -40), inner: `<svg viewBox="0 0 ${pr * 4} ${pr * 2}" style="width:200%;height:100%">${clouds}</svg>` }),
    bdPart(px - pr, py - pr, pr * 2, pr * 2, dark ? `<clipPath id="bdp-night"><path d="${dark}"/></clipPath><g clip-path="url(#bdp-night)"><rect width="${pr * 2}" height="${pr * 2}" fill="#030616" opacity=".86"/>${cities}</g>` : ''),
    bdPart(560, 90, 90, 90, station, { anim: 'bd-spin', vars: bdVars(90, -20), op: 0.85, more: true }),
    bdPart(200, 70, 70, 28, `${sat}<circle cx="35" cy="2" r="2.5" fill="#ff5a5a" class="bd-blink"/>`, { anim: 'bd-swim', vars: bdCross(200, 70, 48, -10) }),
    bdPart(1100, 60, 160, 60, '<path d="M150 6L10 54" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity=".9"/><path d="M150 6L60 37" stroke="#cfe8ff" stroke-width="6" stroke-linecap="round" opacity=".35"/>', { anim: 'bd-meteor', vars: bdVars(17, -6), go: true }),
    bdPart(374, 702, 20, 20, '<circle cx="10" cy="10" r="4" fill="#ff4a4a"/><circle cx="10" cy="10" r="9" fill="#ff4a4a" opacity=".3"/>', { anim: 'bd-blink', vars: bdVars(2.4, 0) }),
  ].join('');
}

/* ---------------------------------------------------------------- Casino lounge */

const BD_WINDOWS = [[170, 80, 280, 390], [1150, 80, 280, 390]];

function bdLoungeScene(t) {
  const wall = dlTone(t, '#300610', '#64122a', '#581024');
  const wallLow = dlTone(t, '#40081a', '#741830', '#6a1428');
  const skyTop = dlTone(t, '#060a1e', '#5aa6e0', '#3a2a62');
  const skyLow = dlTone(t, '#1a1838', '#cfe6f2', '#ff9a5a');
  const city = dlTone(t, '#0c0c1c', '#6a7a98', '#3a2c48');
  const cityNear = dlTone(t, '#08081a', '#4a5a78', '#2a2038');
  const lamps = 0.35 + t.night * 0.65;
  const rnd = bdRandom(601);
  // The sun or moon shows in whichever window its place in the sky falls nearer.
  const body = (b) => { const [x, y, w] = BD_WINDOWS[b.x < 0.5 ? 0 : 1]; const f = b.x < 0.5 ? b.x * 2 : b.x * 2 - 1; return [x + 50 + f * (w - 100), y + 250 - b.alt * 170]; };
  const pane = ([x, y, w, h], i) => {
    let lights = '';
    let skyline = '';
    let bx = x - 10;
    while (bx < x + w) {
      const bw = 26 + rnd() * 34; const bh = 50 + rnd() * 110;
      skyline += `<rect x="${bx.toFixed(0)}" y="${(y + h - bh).toFixed(0)}" width="${bw.toFixed(0)}" height="${bh.toFixed(0)}" fill="${rnd() < 0.5 ? city : cityNear}"/>`;
      for (let wy = y + h - bh + 8; wy < y + h - 8; wy += 12) for (let wx = bx + 5; wx < bx + bw - 6; wx += 9) if (rnd() < 0.35) lights += `<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="4" height="5" fill="#ffd88a"/>`;
      bx += bw + 2;
    }
    return `<clipPath id="win${i}"><path d="M${x} ${y + h}V${y + w / 2}A${w / 2} ${w / 2} 0 0 1 ${x + w} ${y + w / 2}V${y + h}Z"/></clipPath>
      <g clip-path="url(#win${i})"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#sky)"/>
        <g opacity="${(t.night * 0.9).toFixed(2)}">${bdStars(611 + i, 30, 260, '#ffffff').replace(/cx="(\d+)"/g, (m, v) => `cx="${x + (v % w)}"`).replace(/cy="(\d+)"/g, (m, v) => `cy="${y + (v % 260)}"`)}</g>
        ${(t.sun.up || t.warm > 0.6) && (t.sun.x < 0.5) === (i === 0) ? (() => { const [bx2, by] = body(t.sun); const c = dlMix('#fff6dc', t.sun.x < 0.5 ? '#ffb8a8' : '#ffa850', 1 - t.sun.alt * 3); return `<circle cx="${bx2}" cy="${by}" r="80" fill="${c}" opacity=".35"/><circle cx="${bx2}" cy="${by}" r="26" fill="${c}"/>`; })() : ''}
        ${t.moon.up && t.night > 0.15 && (t.moon.x < 0.5) === (i === 0) ? (() => { const [bx2, by] = body(t.moon); return dlMoonSvg(bx2, by, 24, t.moon.phase, { color: '#f6f0e0', dark: '#8a8ab0', south: t.south }); })() : ''}
        ${skyline}<g opacity="${(t.night * 0.95).toFixed(2)}">${lights}</g></g>
      <path d="M${x} ${y + h}V${y + w / 2}A${w / 2} ${w / 2} 0 0 1 ${x + w} ${y + w / 2}V${y + h}" stroke="url(#gold)" stroke-width="12" fill="none"/>
      <path d="M${x + w / 2} ${y}V${y + h}M${x} ${y + h * 0.55}H${x + w}" stroke="url(#gold)" stroke-width="6"/>
      <rect x="${x - 18}" y="${y + h - 4}" width="${w + 36}" height="16" rx="3" fill="url(#gold)"/>`;
  };
  const shaft = ([x, , w]) => `<path d="M${x} 626H${x + w}L${x + w + 160} 900H${x + 90}Z" fill="#fff0c8" opacity="${(t.light * 0.14).toFixed(2)}"/>`;
  const chandelier = (x) => `${bdHalo(x, 120, 170, '#ffd890', lamps * 0.8)}<path d="M${x} 0v50" stroke="#d9b45a" stroke-width="3"/>
    <path d="M${x - 70} 100Q${x} 140 ${x + 70} 100M${x - 50} 70Q${x} 100 ${x + 50} 70" stroke="url(#gold)" stroke-width="5" fill="none"/><circle cx="${x}" cy="56" r="10" fill="url(#gold)"/>
    ${[-70, -35, 0, 35, 70].map((dx) => `<path d="M${x + dx} ${dx % 70 ? 112 : 100}v-16" stroke="#fff0c4" stroke-width="6" stroke-linecap="round"/><path d="M${x + dx} ${dx % 70 ? 118 : 106}l-5 14h10Z" fill="#f6e8c0" opacity=".8"/>`).join('')}`;
  let chips = '';
  for (const [x, y, c, n] of [[1290, 806, '#c82a3a', 6], [1340, 816, '#2a6ac8', 4], [1390, 802, '#1e1e1e', 7], [1316, 776, '#e8e0d0', 3]]) {
    for (let k = 0; k < n; k++) chips += `<ellipse cx="${x}" cy="${y - k * 7}" rx="22" ry="8" fill="${c}" stroke="#f4e6c0" stroke-width="2" stroke-dasharray="5 6"/>`;
  }
  return `
    <defs>${bdGrad('wall', [[0, wall], [1, wallLow]])}${bdGrad('sky', [[0, skyTop], [1, skyLow]])}<pattern id="fan" width="120" height="70" patternUnits="userSpaceOnUse"><path d="M0 70a60 60 0 0 1 120 0M15 70a45 45 0 0 1 90 0M30 70a30 30 0 0 1 60 0M60 70V10M60 70 25 22M60 70 95 22" fill="none" stroke="#d9b45a" stroke-width="2" opacity=".26"/></pattern>
      ${bdGrad('gold', [[0, '#f6dc8a'], [0.5, '#c8962a'], [1, '#8a6214']], 1, 0)}${bdGrad('cur', [[0, '#6a0c1e'], [0.3, '#a81a32'], [0.55, '#7a0e22'], [0.8, '#a01830'], [1, '#5a0818']], 1, 0)}
      ${bdGrad('floor', [[0, dlTone(t, '#1a0408', '#3a0c14')], [1, '#0c0204']])}<pattern id="carpet" width="80" height="80" patternUnits="userSpaceOnUse"><path d="M40 0 80 40 40 80 0 40Z" fill="none" stroke="#d9b45a" stroke-width="1.5" opacity=".18"/><circle cx="40" cy="40" r="4" fill="#d9b45a" opacity=".14"/></pattern>
      ${bdGrad('felt', [[0, '#1e7a4a'], [1, '#0e4a2a']])}${bdGrad('wood', [[0, '#7a4a24'], [1, '#3a200e']])}${bdVignette(0.55)}</defs>
    <rect width="1600" height="620" fill="url(#wall)"/>
    <rect width="1600" height="470" fill="url(#fan)"/>
    <rect y="470" width="1600" height="150" fill="${dlMix(wallLow, '#000', 0.3)}"/>
    ${Array.from({ length: 10 }, (_, i) => `<rect x="${30 + i * 160}" y="492" width="130" height="104" rx="4" fill="none" stroke="#d9b45a" stroke-width="2" opacity=".35"/>`).join('')}
    <rect y="464" width="1600" height="8" fill="url(#gold)"/>
    ${BD_WINDOWS.map(pane).join('')}
    ${[520, 1080].map((x) => `<rect x="${x - 20}" y="0" width="40" height="620" fill="url(#gold)" opacity=".85"/><rect x="${x - 28}" y="590" width="56" height="30" fill="url(#gold)"/><rect x="${x - 28}" y="0" width="56" height="24" fill="url(#gold)"/>`).join('')}
    <rect x="660" y="38" width="280" height="118" rx="14" fill="#14040a" stroke="url(#gold)" stroke-width="5"/>
    ${chandelier(590)}${chandelier(1010)}
    <rect y="610" width="1600" height="16" fill="url(#gold)"/>
    <rect y="626" width="1600" height="274" fill="url(#floor)"/><rect y="626" width="1600" height="274" fill="url(#carpet)"/>
    ${BD_WINDOWS.map(shaft).join('')}
    <ellipse cx="240" cy="900" rx="330" ry="150" fill="url(#wood)"/><ellipse cx="240" cy="904" rx="300" ry="128" fill="url(#felt)"/>
    <path d="M1180 900L1240 780H1610V900Z" fill="url(#wood)"/><path d="M1200 900L1252 792H1610V900Z" fill="url(#felt)"/>
    <path d="M1300 790a70 30 0 0 1 140 0" stroke="#e8d8a8" stroke-width="2" fill="none" opacity=".5"/>
    ${chips}
    <g transform="rotate(-12 1460 840)"><rect x="1430" y="800" width="44" height="62" rx="4" fill="#fbf6ea" stroke="#c8b890"/><path d="M1446 822l6 -8 6 8 -6 8Z" fill="#c82a3a"/></g>
    <g transform="rotate(8 1520 850)"><rect x="1490" y="812" width="44" height="62" rx="4" fill="#fbf6ea" stroke="#c8b890"/><path d="M1512 826c-8 8 -8 14 0 14c8 0 8 -6 0 -14ZM1512 838v8" fill="#1e1e1e" stroke="#1e1e1e" stroke-width="1.5"/></g>
    <path d="M0 0h190C170 160 210 360 150 620H0Z" fill="url(#cur)"/><path d="M1600 0h-190c20 160-20 360 40 620h150Z" fill="url(#cur)"/>
    <path d="M40 0c-10 200 20 400-10 620M90 0c10 200-20 400 20 620M140 0c-6 200 14 400-20 620M1560 0c10 200-20 400 10 620M1510 0c-10 200 20 400-20 620M1460 0c6 200-14 400 20 620" stroke="#3a0410" stroke-width="5" fill="none" opacity=".55"/>
    <path d="M0 300c60 40 140 40 180 10M1600 300c-60 40-140 40-180 10" stroke="url(#gold)" stroke-width="10" fill="none" stroke-linecap="round"/>
    <rect width="1600" height="900" fill="#000" opacity="${(t.night * 0.12).toFixed(2)}"/>
    ${bdVignetteRect}`;
}

function bdLoungeParts(t) {
  const suit = {
    spade: 'M0 -20C-14 -6 -22 2 -22 10C-22 20 -10 22 -3 15L-6 24H6L3 15C10 22 22 20 22 10C22 2 14 -6 0 -20Z',
    heart: 'M0 22C-16 8 -22 0 -22 -8C-22 -18 -8 -22 0 -12C8 -22 22 -18 22 -8C22 0 16 8 0 22Z',
    diamond: 'M0 -22L16 0L0 22L-16 0Z',
    club: 'M0 -20a9 9 0 1 1 0.1 0ZM-11 -2a9 9 0 1 1 0.1 0ZM11 -2a9 9 0 1 1 0.1 0ZM-3 4L-6 24H6L3 4Z',
  };
  const neon = (d, x, color) => `<g transform="translate(${x} 59)"><path d="${d}" fill="none" stroke="${color}" stroke-width="9" opacity=".35"/><path d="${d}" fill="none" stroke="${color}" stroke-width="3.5"/><path d="${d}" fill="none" stroke="#ffffff" stroke-width="1.2" opacity=".8"/></g>`;
  const bulbs = (odd) => {
    let s = '';
    let k = 0;
    for (let x = 6; x <= 274; x += 17) { if (k++ % 2 === odd) s += `<circle cx="${x}" cy="6" r="4"/><circle cx="${x}" cy="112" r="4"/>`; }
    for (let y = 23; y <= 95; y += 18) { if (k++ % 2 === odd) s += `<circle cx="6" cy="${y}" r="4"/><circle cx="274" cy="${y}" r="4"/>`; }
    return bdPart(660, 38, 280, 118, `<g fill="#ffe8a0">${s}</g>`, { anim: 'bd-blink2', vars: bdVars(1.2, odd ? -0.6 : 0) });
  };
  const sparkle = (x, delay) => {
    const r2 = bdRandom(x);
    let s = '';
    for (let i = 0; i < 8; i++) { const px = 10 + r2() * 160; const py = 90 + r2() * 50; s += `<path d="M${px} ${py - 7}L${px + 1.5} ${py - 1.5}L${px + 7} ${py}L${px + 1.5} ${py + 1.5}L${px} ${py + 7}L${px - 1.5} ${py + 1.5}L${px - 7} ${py}L${px - 1.5} ${py - 1.5}Z" fill="#fffbe8"/>`; }
    return bdPart(x - 90, 0, 180, 160, s, { anim: 'bd-twinkle', vars: bdVars(2.8, delay, '--lo:0'), op: 0.5 + t.night * 0.5 });
  };
  const wheel = () => {
    let s = '<circle cx="110" cy="110" r="106" fill="#5a3014" stroke="url(#bdp-g)" stroke-width="6"/>';
    for (let i = 0; i < 36; i++) {
      const a0 = (i / 36) * Math.PI * 2; const a1 = ((i + 1) / 36) * Math.PI * 2;
      const c = i === 0 ? '#1e8a4a' : i % 2 ? '#1a1a1a' : '#b81e2e';
      s += `<path d="M110 110L${(110 + Math.cos(a0) * 92).toFixed(1)} ${(110 + Math.sin(a0) * 92).toFixed(1)}A92 92 0 0 1 ${(110 + Math.cos(a1) * 92).toFixed(1)} ${(110 + Math.sin(a1) * 92).toFixed(1)}Z" fill="${c}"/>`;
    }
    s += '<circle cx="110" cy="110" r="60" fill="#6a3a18"/><circle cx="110" cy="110" r="44" fill="#4a2810" stroke="#d9b45a" stroke-width="3"/>';
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; s += `<path d="M110 110L${(110 + Math.cos(a) * 40).toFixed(1)} ${(110 + Math.sin(a) * 40).toFixed(1)}" stroke="#f0d070" stroke-width="5" stroke-linecap="round"/>`; }
    return `<defs><linearGradient id="bdp-g" x1="0" x2="1"><stop offset="0" stop-color="#f6dc8a"/><stop offset="1" stop-color="#8a6214"/></linearGradient></defs>${s}<circle cx="110" cy="110" r="12" fill="#f6dc8a"/>`;
  };
  const cloud = dlTone(t, '#3a3a5a', '#ffffff', '#ffb48a', 0.8);
  const clouds = (i) => {
    // Just inside the frame, so the clouds pass behind it.
    const [x, y, w] = BD_WINDOWS[i].map((v, k) => (k < 2 ? v + 8 : v - 16));
    const r2 = bdRandom(640 + i);
    let s = '';
    for (let k = 0; k < 4; k++) { const cx = r2() * w; const cy = 40 + r2() * 160; s += `<g fill="${cloud}" opacity="${(0.6 + r2() * 0.3).toFixed(2)}"><ellipse cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="46" ry="14"/><ellipse cx="${(cx + 20).toFixed(0)}" cy="${(cy - 10).toFixed(0)}" rx="26" ry="14"/></g>`; }
    return bdPart(x, y, w, 260, '', { box: `border-radius:50% 50% 0 0 / ${((w / 2 / 260) * 100).toFixed(1)}% ${((w / 2 / 260) * 100).toFixed(1)}% 0 0;overflow:hidden;`, anim: 'bd-drift', vars: bdVars(120, -30 * i), op: t.light * 0.9, inner: `<svg viewBox="0 0 ${w * 2} 260" style="width:200%;height:100%">${bdTile(s, w)}</svg>` });
  };
  const cityTwinkle = (i, delay) => {
    const [x, y, w, h] = BD_WINDOWS[i];
    const r2 = bdRandom(660 + i);
    let s = '';
    for (let k = 0; k < 14; k++) s += `<rect x="${(r2() * (w - 10)).toFixed(0)}" y="${(h - 30 - r2() * 110).toFixed(0)}" width="4" height="5" fill="#fff0b8"/>`;
    return bdPart(x, y, w, h, s, { anim: 'bd-twinkle', vars: bdVars(6, delay, '--lo:0'), op: t.night, more: true });
  };
  return [
    clouds(0), clouds(1), cityTwinkle(0, 0), cityTwinkle(1, -3),
    bulbs(0), bulbs(1),
    bdPart(660, 38, 280, 118, neon(suit.spade, 50, '#7ad8ff') + neon(suit.diamond, 230, '#ff6a8a'), { anim: 'bd-flicker', vars: bdVars(9, -2) }),
    bdPart(660, 38, 280, 118, neon(suit.heart, 110, '#ff4a6a') + neon(suit.club, 170, '#7ad8ff'), { anim: 'bd-flicker', vars: bdVars(13, -7) }),
    sparkle(590, 0), sparkle(1010, -1.4),
    bdPart(130, 700, 220, 220, wheel(), { anim: 'bd-spin', vars: bdVars(7, 0), box: 'transform:scaleY(.42);transform-origin:50% 50%;' }),
    bdPart(130, 700, 220, 220, '<circle cx="110" cy="22" r="7" fill="#ffffff"/>', { anim: 'bd-spin bd-rev', vars: bdVars(2.6, 0), box: 'transform:scaleY(.42);transform-origin:50% 50%;' }),
  ].join('');
}

/* ---------------------------------------------------------------- The quieter five */

/** Stars that come and go, in three sets taking turns, faded out by day. */
function bdTwinkles(t, h, seed, color = '#ffffff') {
  if (t.night < 0.1) return '';
  return [0, 1].map((k) => {
    const rnd = bdRandom(seed + k);
    let s = '';
    for (let i = 0; i < 22; i++) { const x = rnd() * 1600; const y = Math.pow(rnd(), 1.3) * h; s += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(1.4 + rnd() * 1.2).toFixed(1)}" fill="${color}"/>`; }
    return bdPart(0, 0, 1600, h, s, { anim: 'bd-twinkle', vars: bdVars(4 + k * 1.5, -k * 2, '--lo:0'), op: t.night, more: k > 0 });
  }).join('');
}
/** A few birds flapping across by day: wings drawn twice, taking turns. */
function bdBirds(t, y, d, delay, color, leftward = false) {
  const up = (x, yy, s) => `M${x - 10 * s} ${yy - 4 * s}q${5 * s} -4 ${10 * s} 4q${5 * s} -8 ${10 * s} -4`;
  const down = (x, yy, s) => `M${x - 10 * s} ${yy + 3 * s}q${5 * s} 2 ${10 * s} -3q${5 * s} 5 ${10 * s} 3`;
  const flock = [[20, 20, 1], [44, 30, 0.8], [36, 10, 0.7], [64, 22, 0.9], [80, 36, 0.6]];
  const wings = (f) => `<path d="${flock.map(([x, yy, s]) => f(x, yy, s)).join('')}" stroke="${color}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
  return bdPart(200, y, 100, 50, '', { anim: 'bd-swim', vars: bdCross(200, 100, d, delay, leftward), op: t.light, inner: `<svg viewBox="0 0 100 50"${leftward ? ' style="scale:-1 1"' : ''}><g class="bd-blink2" style="--d:.7s">${wings(up)}</g><g class="bd-blink2 bd-alt" style="--d:.7s;--delay:-.35s">${wings(down)}</g></svg>` });
}
/** Bits falling across the scene (snow, petals): each part a few of them, falling the height of the scene and drifting. */
function bdFalling(seed, n, draw, d0, d1, more = 0) {
  const rnd = bdRandom(seed);
  let out = '';
  for (let i = 0; i < n; i++) {
    const x = rnd() * 1600; const d = d0 + rnd() * (d1 - d0);
    out += bdPart(x, -80, 60, 80, draw(rnd), { anim: 'bd-rise', vars: bdVars(d.toFixed(1), (-rnd() * d).toFixed(1), `--rise:${(980 / 80 * 100).toFixed(0)}%;--dx:${(rnd() * 400 - 120).toFixed(0)}%`), more: i >= n - more });
  }
  return out;
}

function bdFjordParts(t) {
  const shine = bdShine(t, 140, 1460);
  return [
    bdTwinkles(t, 480, 701),
    shine ? bdPart(shine[0] - 80, 600, 160, 280, Array.from({ length: 10 }, (_, i) => `<rect x="${20 + ((i * 41) % 80)}" y="${20 + i * 26}" width="${30 + ((i * 29) % 40)}" height="2.5" rx="1" fill="${shine[1]}"/>`).join(''), { anim: 'bd-pulse', vars: bdVars(2.2, 0, '--lo:.2'), op: shine[2] + 0.3 }) : '',
    bdBirds(t, 300, 60, -20, '#24324a'),
  ].join('');
}
function bdPinesParts(t) {
  const flake = (rnd) => `<circle cx="${(10 + rnd() * 40).toFixed(0)}" cy="${(10 + rnd() * 30).toFixed(0)}" r="${(2 + rnd() * 2.5).toFixed(1)}" fill="#ffffff" opacity=".9"/><circle cx="${(10 + rnd() * 40).toFixed(0)}" cy="${(40 + rnd() * 30).toFixed(0)}" r="${(1.2 + rnd() * 1.5).toFixed(1)}" fill="#ffffff" opacity=".7"/>`;
  return [
    bdTwinkles(t, 400, 711, '#e8fbff'),
    t.night > 0.6 ? bdPart(-50, 80, 1700, 260, `<defs><linearGradient id="bdp-au" x1="0" x2="1"><stop offset="0" stop-color="#3fd6a0" stop-opacity="0"/><stop offset=".5" stop-color="#6be8b0" stop-opacity=".45"/><stop offset="1" stop-color="#7a6ff0" stop-opacity="0"/></linearGradient><filter id="bdp-aub" x="-10%" y="-60%" width="120%" height="220%"><feGaussianBlur stdDeviation="16"/></filter></defs><path d="M0 150C350 60 650 200 950 110S1450 60 1700 140" stroke="url(#bdp-au)" stroke-width="70" fill="none" filter="url(#bdp-aub)"/>`, { anim: 'bd-bob', vars: bdVars(14, -3, '--dx:3%;--dy:12%'), op: (t.night - 0.6) * 2.5 }) : '',
    bdFalling(721, 26, flake, 14, 22, 12),
  ].join('');
}
function bdCabinParts(t) {
  const puff = (delay) => bdPart(1300, 470, 70, 80, `<g fill="${dlTone(t, '#8a8098', '#e8eaee', '#d0b0b0')}"><circle cx="30" cy="50" r="18"/><circle cx="42" cy="36" r="14"/></g>`, { anim: 'bd-billow', vars: bdVars(10, delay, '--dx:-120%;--dy:-220%;--s:2.6;--hi:.5'), go: true });
  const fireflies = (seed, delay) => {
    const rnd = bdRandom(seed);
    let s = '';
    for (let i = 0; i < 10; i++) s += `<circle cx="${(rnd() * 600).toFixed(0)}" cy="${(rnd() * 160).toFixed(0)}" r="2.6" fill="#ffe88a"/><circle cx="${(rnd() * 600).toFixed(0)}" cy="${(rnd() * 160).toFixed(0)}" r="6" fill="#ffe88a" opacity=".25"/>`;
    return bdPart(seed % 2 ? 100 : 900, 680, 600, 160, s, { anim: 'bd-twinkle', vars: bdVars(3.2, delay, '--lo:0'), op: t.night * 0.9, more: seed % 2 === 0 });
  };
  return [
    bdTwinkles(t, 430, 731, '#fff4dc'),
    puff(0), puff(-3.3), puff(-6.6),
    bdPart(1100, 620, 320, 160, bdHalo(160, 80, 160, '#ffc46b', 0.5), { anim: 'bd-pulse', vars: bdVars(3, -1, '--lo:.6'), op: t.night * 0.8 }),
    fireflies(741, 0), fireflies(742, -1.6),
    bdBirds(t, 220, 55, -30, '#2a3448', true),
  ].join('');
}
function bdDunesParts(t) {
  const wisp = (y, d, delay, more = false) => bdPart(200, y, 260, 40, `<path d="M0 26C60 14 120 30 180 18S240 12 260 16" stroke="${dlTone(t, '#6a5a70', '#fff0d0', '#ffd0a0')}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".55"/><path d="M40 34C90 26 150 36 210 28" stroke="${dlTone(t, '#6a5a70', '#fff0d0', '#ffd0a0')}" stroke-width="2" fill="none" opacity=".4"/>`, { anim: 'bd-swim', vars: bdCross(200, 260, d, delay), more });
  const hawk = `<path d="M0 10Q14 0 30 8Q46 0 60 10Q46 6 30 14Q14 6 0 10Z" fill="${dlTone(t, '#1a1020', '#3a2a24', '#2a1418')}"/>`;
  return [
    bdTwinkles(t, 500, 751, '#fff0e0'),
    wisp(640, 16, -2), wisp(730, 12, -7), wisp(800, 14, -11, true),
    bdPart(1080, 220, 60, 20, hawk, { anim: 'bd-hover', vars: bdVars(24, -5), op: Math.max(t.light, t.warm) }),
  ].join('');
}
function bdBlossomParts(t) {
  const petal = (rnd) => {
    const c = dlMix(['#ffc8d8', '#f7a6c0', '#ffe2ea'][Math.floor(rnd() * 3)], '#3a2a50', t.night * 0.5);
    return `<ellipse cx="${(15 + rnd() * 30).toFixed(0)}" cy="${(15 + rnd() * 20).toFixed(0)}" rx="6" ry="3.5" fill="${c}" transform="rotate(${(rnd() * 180).toFixed(0)} 30 25)"/><ellipse cx="${(15 + rnd() * 30).toFixed(0)}" cy="${(45 + rnd() * 20).toFixed(0)}" rx="4.5" ry="2.8" fill="${c}" opacity=".85"/>`;
  };
  return [
    bdTwinkles(t, 400, 761, '#fff0f6'),
    bdFalling(771, 22, petal, 12, 20, 10),
    bdBirds(t, 260, 50, -14, '#4a3a58'),
  ].join('');
}

/* ---------------------------------------------------------------- Your catch of the day */

/** A fish from Fireside Angler as SVG, centred on 0,0 and len long, in its look from the game (see drawFish there). */
function bdAnglerFish(k, len) {
  const L = len;
  const n = (v) => +v.toFixed(1);
  const glow = k.glow ? bdHalo(0, 0, n(L * 0.62), k.glow, 0.5) : '';
  if (k.shape === 'eel') {
    const h = L * (k.h || 0.1);
    let spots = '';
    if (k.spots) for (let i = 0; i < 7; i++) spots += `<circle cx="${n(L * (0.3 - i * 0.1))}" cy="${n((i % 2 ? -1 : 1) * h * 0.2)}" r="${n(h * 0.12)}" fill="${k.spots}"/>`;
    return `${glow}<defs><linearGradient id="bdp-cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${k.body}"/><stop offset="1" stop-color="${k.belly}"/></linearGradient></defs>
      <path d="M${n(-L * 0.5)} 0Q${n(-L * 0.1)} ${n(-h * 1.1)} ${n(L * 0.3)} ${n(-h * 0.75)}L${n(L * 0.3)} ${n(h * 0.75)}Q${n(-L * 0.1)} ${n(h * 1.1)} ${n(-L * 0.5)} 0Z" fill="${k.fin}"/>
      <path d="M${n(L * 0.5)} 0Q${n(L * 0.45)} ${n(-h * 0.7)} ${n(L * 0.3)} ${n(-h * 0.6)}Q${n(-L * 0.1)} ${n(-h * 0.7)} ${n(-L * 0.48)} 0Q${n(-L * 0.1)} ${n(h * 0.7)} ${n(L * 0.3)} ${n(h * 0.6)}Q${n(L * 0.45)} ${n(h * 0.7)} ${n(L * 0.5)} 0Z" fill="url(#bdp-cg)"/>
      ${spots}<circle cx="${n(L * 0.4)}" cy="${n(-h * 0.15)}" r="${n(h * 0.14)}" fill="#111"/>`;
  }
  if (k.shape === 'ray') {
    return `${glow}<defs><radialGradient id="bdp-cg"><stop offset="0" stop-color="${k.belly}"/><stop offset="1" stop-color="${k.body}"/></radialGradient></defs>
      <rect x="${n(-L * 0.55)}" y="${n(-L * 0.012)}" width="${n(L * 0.4)}" height="${n(L * 0.024)}" fill="${k.fin}"/>
      <path d="M${n(L * 0.32)} 0Q${n(L * 0.05)} ${n(-L * 0.34)} ${n(-L * 0.02)} ${n(-L * 0.32)}Q${n(-L * 0.12)} ${n(-L * 0.05)} ${n(-L * 0.2)} 0Q${n(-L * 0.12)} ${n(L * 0.05)} ${n(-L * 0.02)} ${n(L * 0.32)}Q${n(L * 0.05)} ${n(L * 0.34)} ${n(L * 0.32)} 0Z" fill="url(#bdp-cg)"/>
      <circle cx="${n(L * 0.2)}" cy="${n(-L * 0.04)}" r="${n(L * 0.018)}" fill="#111"/><circle cx="${n(L * 0.2)}" cy="${n(L * 0.04)}" r="${n(L * 0.018)}" fill="#111"/>`;
  }
  const H = L * (k.h || 0.32);
  const body = `M${n(L * 0.5)} 0C${n(L * 0.38)} ${n(-H * 0.66)} ${n(-L * 0.26)} ${n(-H * 0.6)} ${n(-L * 0.42)} 0C${n(-L * 0.26)} ${n(H * 0.6)} ${n(L * 0.38)} ${n(H * 0.66)} ${n(L * 0.5)} 0Z`;
  let marks = '';
  if (k.stripes) for (let i = 0; i < 6; i++) marks += `<rect x="${n(L * (0.22 - i * 0.11))}" y="${n(-H)}" width="${n(L * 0.035)}" height="${n(H * 2)}" fill="${k.stripes}" opacity=".7"/>`;
  if (k.spots) for (let i = 0; i < 14; i++) marks += `<circle cx="${n(L * (0.3 - (i % 7) * 0.09))}" cy="${n(-H * (0.05 + (i > 6 ? 0.22 : 0)) + ((i * 37) % 9) * H * 0.015)}" r="${n(H * 0.055)}" fill="${k.spots}" opacity=".85"/>`;
  const dorsal = k.sail ? `M${n(-L * 0.2)} ${n(-H * 0.4)}Q${n(-L * 0.05)} ${n(-H * 1.25)} ${n(L * 0.16)} ${n(-H * 0.42)}Z` : `M${n(-L * 0.14)} ${n(-H * 0.42)}Q0 ${n(-H * 0.9)} ${n(L * 0.1)} ${n(-H * 0.44)}Z`;
  return `${glow}<defs><linearGradient id="bdp-cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${k.body}"/><stop offset=".55" stop-color="${k.body}"/><stop offset="1" stop-color="${k.belly}"/></linearGradient><clipPath id="bdp-cc"><path d="${body}"/></clipPath></defs>
    <path d="M${n(-L * 0.4)} 0L${n(-L * 0.58)} ${n(-H * 0.62)}Q${n(-L * 0.5)} 0 ${n(-L * 0.58)} ${n(H * 0.62)}Z${dorsal}M${n(-L * 0.08)} ${n(H * 0.42)}Q${n(-L * 0.02)} ${n(H * 0.78)} ${n(L * 0.06)} ${n(H * 0.42)}Z" fill="${k.fin}"/>
    <path d="${body}" fill="url(#bdp-cg)"/><g clip-path="url(#bdp-cc)">${marks}</g>
    <path d="M${n(L * 0.3)} ${n(-H * 0.32)}Q${n(L * 0.24)} 0 ${n(L * 0.3)} ${n(H * 0.32)}" stroke="rgba(0,0,0,.2)" stroke-width="${n(Math.max(1, L * 0.01))}" fill="none"/>
    <circle cx="${n(L * 0.38)}" cy="${n(-H * 0.1)}" r="${n(H * 0.11)}" fill="#fffaf3"/><circle cx="${n(L * 0.39)}" cy="${n(-H * 0.1)}" r="${n(H * 0.065)}" fill="#111"/>
    ${k.whiskers ? `<path d="M${n(L * 0.48)} ${n(H * 0.05)}Q${n(L * 0.56)} ${n(H * 0.4)} ${n(L * 0.5)} ${n(H * 0.7)}M${n(L * 0.47)} ${n(H * 0.02)}Q${n(L * 0.6)} ${n(H * 0.1)} ${n(L * 0.62)} ${n(H * 0.35)}" stroke="${k.fin}" stroke-width="${n(Math.max(1, L * 0.012))}" fill="none"/>` : ''}`;
}
/** Your catch of the day swimming slowly across, bigger the better it was, with its name under it. */
function bdCatchPart(t, fish) {
  const L = (150 + fish.score * 0.9) * (fish.giant ? 1.3 : 1);
  const w = L * 1.4;
  const h = L * 0.62 + 30;
  const x = 200;
  const name = `Today's catch: ${escapeHtml(fish.name)}`;
  return bdPart(x, 470, w, h, `<g transform="translate(${(w / 2).toFixed(0)} ${(L * 0.36).toFixed(0)})"${t.night > 0.5 ? ' opacity=".9"' : ''}>${bdAnglerFish(fish.look, L)}</g>
    <text x="${(w / 2).toFixed(0)}" y="${(h - 8).toFixed(0)}" text-anchor="middle" font-size="18" font-weight="700" fill="#effcff" opacity=".75">${name}</text>`,
  { anim: 'bd-swim', vars: bdCross(x, w, 80, -25) });
}
/** Looks up your catch of the day in this hearth for Under the sea: when it's shown, hourly, and after a new best. */
async function backdropCatch(hearth) {
  if (hearth) bdLive.hearth = hearth;
  if (bdLive.id !== 'ocean' || !bdLive.hearth) return;
  const key = `${bdLive.hearth}|${new Date().getHours()}`;
  if (bdLive.catchKey === key) return;
  bdLive.catchKey = key;
  let fish = null;
  try { fish = (await api(`/api/servers/${encodeURIComponent(bdLive.hearth)}/fishing/today`)).fish ?? null; } catch { return; }
  if (bdLive.id !== 'ocean' || JSON.stringify(fish) === JSON.stringify(bdLive.catch)) return;
  bdLive.catch = fish;
  bdLive.partsKey = '';
  backdropLiveTick();
}

Object.assign(BACKDROP_SCENES, { ocean: bdOceanScene, volcano: bdVolcanoScene, space: bdSpaceScene, lounge: bdLoungeScene });
/** The moving parts over a live backdrop, made for a time of day. */
const BACKDROP_LIVE = { ocean: bdOceanParts, volcano: bdVolcanoParts, space: bdSpaceParts, lounge: bdLoungeParts, fjord: bdFjordParts, pines: bdPinesParts, cabin: bdCabinParts, dunes: bdDunesParts, blossom: bdBlossomParts };

/**
 * Puts a live backdrop in the fire's sky layer, or takes it away (no layer). It looks at the clock every two
 * minutes: the picture is remade when the light has changed, and the moving parts on the hour or when day
 * turns to night, since remaking them starts their motion over.
 */
const bdLive = { id: null, layer: null, timer: 0, css: '', partsKey: '', hearth: null, catch: null, catchKey: '' };
function backdropLive(layer, id, hearth = null) {
  clearInterval(bdLive.timer);
  Object.assign(bdLive, { id: layer ? id : null, layer, timer: 0, css: '', partsKey: '', hearth, catch: null, catchKey: '' });
  if (!layer) return;
  layer.innerHTML = '<div class="bd-stage"></div>';
  backdropLiveTick();
  bdLive.timer = setInterval(backdropLiveTick, 120000);
}
function backdropLiveTick() {
  const stage = bdLive.layer?.querySelector('.bd-stage');
  if (!stage) return backdropLive(null);
  if (document.hidden && bdLive.css) return;
  const sky = daylight();
  const css = backdropCss(bdLive.id, sky);
  if (css !== bdLive.css) { stage.style.background = css; bdLive.css = css; fireGroundRefresh(); }
  const partsKey = [Math.round(sky.light * 8), Math.round(sky.warm * 4), sky.moon.up, sky.sun.up, Math.floor(sky.hour)].join();
  if (partsKey !== bdLive.partsKey) { stage.innerHTML = BACKDROP_LIVE[bdLive.id](sky); bdLive.partsKey = partsKey; }
  backdropCatch();
}
