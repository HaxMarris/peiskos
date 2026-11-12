// The fire on the ground: what's drawn around and under it. Logs, the stone ring, the seats people sit on,
// a patch of ground for backdrops whose floor is water, sky or mountainside, and the casino lounge's card table.
// Everything is SVG text; campfire.js places it. Shapes are made from a fixed seed, so they look the same each time.
// Part of Peiskos's client: plain scripts that index.html loads in order, sharing one global scope.
'use strict';

const FIRE_ART = (() => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const f = (n) => n.toFixed(1);

  // ---------- fire logs (viewBox 200x220, ground under the flame at 100,190) ----------
  const STY = {
    oak: { bark: '#6a4228', dark: '#3e2414', hi: '#8f6040', cap: '#d6ad78', ring: '#a87a48', rim: '#4a2c16' },
    birch: { bark: '#ebe5d8', dark: '#2a2420', hi: '#ffffff', cap: '#e6cc98', ring: '#bf9660', rim: '#b5ac9c' },
  };
  /** A log from x1,y1 to x2,y2 (the cut end you can see), radius r. */
  function log(x1, y1, x2, y2, r, s = STY.oak, { cap = true } = {}) {
    const L = Math.hypot(x2 - x1, y2 - y1), a = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    let marks = '';
    for (let i = 0; i < Math.max(3, L / 14); i++) {
      const x = 4 + rnd() * (L - 14), y = (rnd() * 1.4 - .7) * r, w = 6 + rnd() * 16;
      if (s === STY.birch) marks += `<rect x="${f(x)}" y="${f(y - 1)}" width="${f(2 + rnd() * 3)}" height="${f(2 + rnd() * r * .5)}" rx="1" fill="${s.dark}" opacity=".85"/>`;
      else marks += `<path d="M${f(x)} ${f(y)}h${f(w)}" stroke="${s.dark}" stroke-width="1.8" stroke-linecap="round" opacity=".8"/>`;
    }
    const capSvg = cap
      ? `<ellipse cx="${f(L)}" cy="0" rx="${f(r * .5)}" ry="${f(r)}" fill="${s.cap}" stroke="${s.rim}" stroke-width="${f(r * .22)}"/>` +
        `<ellipse cx="${f(L)}" cy="0" rx="${f(r * .3)}" ry="${f(r * .62)}" fill="none" stroke="${s.ring}" stroke-width="1.2"/>` +
        `<ellipse cx="${f(L)}" cy="0" rx="${f(r * .12)}" ry="${f(r * .26)}" fill="${s.ring}"/>`
      : `<ellipse cx="${f(L)}" cy="0" rx="${f(r * .45)}" ry="${f(r)}" fill="${s.bark}"/>`;
    return `<g transform="translate(${f(x1)} ${f(y1)}) rotate(${f(a)})"><ellipse cx="0" cy="0" rx="${f(r * .45)}" ry="${f(r)}" fill="${s.dark}"/>` +
      `<rect x="0" y="${f(-r)}" width="${f(L)}" height="${f(2 * r)}" fill="${s.bark}"/>` +
      `<rect x="0" y="${f(-r)}" width="${f(L)}" height="${f(r * .55)}" fill="${s.hi}" opacity=".55"/>` +
      `<rect x="0" y="${f(r * .45)}" width="${f(L)}" height="${f(r * .55)}" fill="#000" opacity=".25"/>${marks}${capSvg}</g>`;
  }
  const embers = (n, cx = 100, cy = 192, rx = 46, ry = 9) => {
    let s = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#ff7a2a" opacity=".35"/>`;
    for (let i = 0; i < n; i++) { const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()); s += `<circle cx="${f(cx + Math.cos(a) * rx * d)}" cy="${f(cy + Math.sin(a) * ry * d)}" r="${f(1.2 + rnd() * 2)}" fill="${rnd() > .5 ? '#ffb347' : '#ff6a1a'}"/>`; }
    return s;
  };

  const LOGS = {
    crossed: () => { seed = 3; return { back: log(150, 172, 46, 205, 12) + log(50, 172, 154, 205, 12) + embers(18), front: '' }; },
    birch: () => { seed = 3; return { back: log(150, 172, 46, 205, 12, STY.birch) + log(50, 172, 154, 205, 12, STY.birch) + embers(18), front: '' }; },
    money: () => {
      // Banknote bundles, chip stacks and coins.
      seed = 31;
      const bundle = (cx, by, w, h, d, sk = 0) => {
        const x0 = cx - w / 2, x1 = cx + w / 2, dx = d * .45 + sk;
        let edges = ''; for (let y = by - h + 2; y < by; y += 2.2) edges += `<path d="M${f(x0)} ${f(y)}H${f(x1)}" stroke="#e6f0d8" stroke-width=".7" opacity=".7"/>`;
        return `<g><path d="M${f(x1)} ${f(by - h)}L${f(x1 + dx)} ${f(by - h - d)}V${f(by - d)}L${f(x1)} ${f(by)}Z" fill="#3e7a48"/>` +
          `<rect x="${f(x0)}" y="${f(by - h)}" width="${w}" height="${h}" fill="#5f9a5a"/>${edges}` +
          `<path d="M${f(x0)} ${f(by - h)}H${f(x1)}L${f(x1 + dx)} ${f(by - h - d)}H${f(x0 + dx)}Z" fill="#9cc98a" stroke="#4e8650" stroke-width=".8"/>` +
          `<path d="M${f(x0 + 4 + dx * .15)} ${f(by - h - d * .15)}H${f(x1 - 4 + dx * .15)}L${f(x1 - 4 + dx * .85)} ${f(by - h - d * .85)}H${f(x0 + 4 + dx * .85)}Z" fill="none" stroke="#4e8650" stroke-width=".9"/>` +
          `<ellipse cx="${f(cx + dx / 2)}" cy="${f(by - h - d / 2)}" rx="${f(w * .12)}" ry="${f(d * .32)}" fill="#7ab070" stroke="#4e8650" stroke-width=".8"/>` +
          `<path d="M${f(cx - 4)} ${f(by)}V${f(by - h)}L${f(cx - 4 + dx)} ${f(by - h - d)}H${f(cx + 4 + dx)}L${f(cx + 4)} ${f(by - h)}V${f(by)}Z" fill="#e8c35a"/>` +
          `<path d="M${f(cx + 4)} ${f(by - h)}L${f(cx + 4 + dx)} ${f(by - h - d)}" stroke="#b8902a" stroke-width=".8"/></g>`;
      };
      const chips = (cx, by, n, col, rx = 9) => {
        let s = ''; for (let i = 0; i < n; i++) { const y = by - i * 3.2; s += `<path d="M${cx - rx} ${f(y - 3)}v3a${rx} ${rx * .38} 0 0 0 ${2 * rx} 0v-3Z" fill="${col}"/><path d="M${f(cx - rx * .6)} ${f(y - 1.5)}h2M${f(cx - 1)} ${f(y - .4)}h2M${f(cx + rx * .5)} ${f(y - 1.5)}h2" stroke="#fff" stroke-width="2"/>`; }
        const ty = by - n * 3.2;
        return s + `<ellipse cx="${cx}" cy="${f(ty)}" rx="${rx}" ry="${f(rx * .38)}" fill="${col}"/><ellipse cx="${cx}" cy="${f(ty)}" rx="${f(rx * .62)}" ry="${f(rx * .24)}" fill="none" stroke="#fff" stroke-width="1" stroke-dasharray="2 2.4"/>`;
      };
      const coin = (x, y, r = 4.5) => `<ellipse cx="${x}" cy="${y + 1}" rx="${r}" ry="${r * .45}" fill="#a8781e"/><ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * .45}" fill="#f2c84a" stroke="#c8962a" stroke-width=".8"/>`;
      const back = embers(10, 100, 186, 50, 10) + bundle(68, 182, 40, 12, 10) + bundle(128, 180, 42, 12, 10, 2) + bundle(98, 174, 44, 10, 9) + chips(40, 190, 6, '#b8262c') + chips(162, 190, 8, '#1f1f24') + chips(150, 184, 4, '#2456a8');
      const front = bundle(70, 208, 42, 14, 10) + bundle(126, 207, 40, 13, 10, -2) + chips(100, 212, 3, '#2a8a4a') + coin(46, 206) + coin(56, 212) + coin(152, 210) + coin(162, 204) + coin(98, 200, 4) +
        `<g transform="rotate(-18 34 200)"><rect x="18" y="194" width="30" height="13" rx="1.5" fill="#9cc98a" stroke="#4e8650"/><ellipse cx="33" cy="200.5" rx="4" ry="3.5" fill="#7ab070"/></g>` +
        `<g transform="rotate(14 170 196)"><rect x="156" y="190" width="30" height="13" rx="1.5" fill="#9cc98a" stroke="#4e8650"/><ellipse cx="171" cy="196.5" rx="4" ry="3.5" fill="#7ab070"/></g>`;
      return { back, front };
    },
  };

  // ---------- seats (viewBox 130x60, face sits on y≈18-28, things can rise to y≈-70 behind the face) ----------
  const sh = (rx = 56, op = .35) => `<ellipse cx="65" cy="54" rx="${rx}" ry="7" fill="#000" opacity="${op}"/>`;
  const SEATS = {
    shadow: `<ellipse cx="65" cy="44" rx="56" ry="11" fill="#000" opacity=".4"/>`,
    stump: `${sh()}<path d="M17 40Q6 50 0 54Q14 54 26 49ZM113 40Q124 50 130 54Q116 54 104 49ZM60 52Q58 58 54 60Q66 60 72 53Z" fill="#4a2c16"/><path d="M17 22v20q0 12 48 12t48-12V22Z" fill="#5a3820"/><path d="M28 30v18M44 34v18M62 35v19M80 34v18M98 30v17" stroke="#3a2210" stroke-width="3" stroke-linecap="round"/><ellipse cx="65" cy="22" rx="48" ry="13" fill="#d6ad78"/><ellipse cx="65" cy="22" rx="36" ry="9.5" fill="none" stroke="#b08250" stroke-width="1.8"/><ellipse cx="65" cy="22" rx="24" ry="6.3" fill="none" stroke="#b08250" stroke-width="1.8"/><ellipse cx="65" cy="22" rx="11" ry="3" fill="none" stroke="#b08250" stroke-width="1.8"/><ellipse cx="65" cy="22" rx="48" ry="13" fill="none" stroke="#7a4e2a" stroke-width="3"/>`,
    rock: `${sh(58)}<path d="M12 42Q8 20 34 13Q62 5 94 11Q122 19 118 42Q114 57 65 57Q16 57 12 42Z" fill="#6e6a64"/><path d="M14 44Q20 54 65 55Q110 54 116 44Q112 57 65 58Q18 57 14 44Z" fill="#000" opacity=".25"/><path d="M20 27Q38 11 66 11Q98 11 112 27Q94 36 66 36Q36 36 20 27Z" fill="#908b83"/><path d="M28 23Q46 12 70 13Q92 15 100 23Q82 30 60 29Q40 29 28 23Z" fill="#5f7a3a"/><circle cx="48" cy="20" r="2" fill="#86a352"/><circle cx="74" cy="17" r="2.5" fill="#86a352"/><circle cx="88" cy="23" r="1.6" fill="#86a352"/><path d="M34 40l6 6 4-2M88 38l-4 7 5 4" stroke="#4a4640" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
    bench: `${sh(60)}<path d="M24 30h20v20q-10 4-20 0Z M86 30h20v20q-10 4-20 0Z" fill="#5a3820"/><path d="M28 34v14M34 34v15M90 34v14M98 34v15" stroke="#3a2210" stroke-width="2"/><path d="M4 26L126 26L124 36Q65 46 6 36Z" fill="#5a3820"/><path d="M8 33Q65 42 122 33" stroke="#3a2210" stroke-width="2" fill="none"/><path d="M4 26L126 26L120 12L10 12Z" fill="#d2a46c"/><path d="M14 16Q40 14 60 18T112 16M10 21Q44 19 70 22T120 21" stroke="#a8784a" stroke-width="1.4" fill="none"/><path d="M126 26L120 12L122 12L128 25Z" fill="#7a4e2a"/>`,
    cushion: `${sh(58, .3)}<path d="M8 24v12q0 16 57 16t57-16V24Z" fill="#a8461f"/><path d="M8 34q0 16 57 16t57-16" fill="none" stroke="#7a2e12" stroke-width="2.5"/><ellipse cx="65" cy="24" rx="57" ry="14" fill="#d9703c"/><ellipse cx="65" cy="24" rx="57" ry="14" fill="none" stroke="#f2b06a" stroke-width="2" stroke-dasharray="3 4"/><g fill="#8a3a1a"><circle cx="42" cy="22" r="2.4"/><circle cx="88" cy="22" r="2.4"/><circle cx="65" cy="17" r="2.4"/><circle cx="65" cy="29" r="2.4"/></g><path d="M42 22L65 17L88 22L65 29Z" fill="none" stroke="#b8532a" stroke-width="1.2"/><path d="M6 30l-6 10h10ZM124 30l6 10h-10Z" fill="#e8b04a"/><path d="M14 30q2 6 8 9" stroke="#fff" stroke-width="2" opacity=".18" fill="none"/>`,
    blankets: (() => {
      const layer = (by, w, h, d, top, front, stripe, kind) => {
        const x0 = 65 - w / 2, x1 = 65 + w / 2, dx = 7;
        let pat = '';
        if (kind === 'plaid') pat = `<path d="M${x0 + 10} ${by - h - d}l${dx} 0M${x0} ${by - h - d * .5}H${x1 + dx}" stroke="${stripe}" stroke-width="2.5" opacity=".7"/>` + [20, 44, 68, 92].map((x) => `<path d="M${x0 + x * w / 104} ${by - h}l${dx} ${-d}" stroke="${stripe}" stroke-width="2.5" opacity=".7"/>`).join('');
        if (kind === 'knit') pat = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<path d="M${x0 + 8 + i * (w - 16) / 7 + dx * .5} ${by - h - d * .5 - 2.5}l2.5 2.5-2.5 2.5-2.5-2.5Z" fill="${stripe}"/>`).join('');
        if (kind === 'stripe') pat = `<path d="M${x0 + dx * .3} ${by - h - d * .3}H${x1 + dx * .3}M${x0 + dx * .7} ${by - h - d * .7}H${x1 + dx * .7}" stroke="${stripe}" stroke-width="1.8"/>`;
        return `<path d="M${x1} ${by - h}L${x1 + dx} ${by - h - d}V${by - d - 2}Q${x1 + dx} ${by - d + 2} ${x1} ${by}Z" fill="${front}" style="filter:brightness(.8)"/>` +
          `<rect x="${x0}" y="${by - h}" width="${w}" height="${h}" rx="${h / 2}" fill="${front}"/><path d="M${x0 + 4} ${by - h / 2}H${x1 - 4}" stroke="#000" stroke-width="1.2" opacity=".18"/>` +
          `<path d="M${x0 + h / 2} ${by - h}H${x1}L${x1 + dx} ${by - h - d}H${x0 + dx + h / 2}Q${x0} ${by - h - d / 2} ${x0 + h / 2} ${by - h}Z" fill="${top}"/>${pat}`;
      };
      return `${sh(60, .32)}` + layer(54, 110, 13, 9, '#c84a34', '#a8382a', '#2a1a14', 'plaid') + layer(41, 100, 12, 9, '#efe4c8', '#d8caa8', '#b8432a', 'knit') + layer(29, 92, 11, 9, '#4a6e92', '#3a5a7a', '#e8d0a0', 'stripe') +
        `<path d="M24 20q-4 10 2 22q4-2 6 2q-2-12 0-22Z" fill="#4a6e92"/>`;
    })(),
    hay: (() => {
      seed = 41; let straw = '';
      for (let i = 0; i < 46; i++) { const x = 16 + rnd() * 92, y = 24 + rnd() * 24; straw += `<path d="M${f(x)} ${f(y)}l${f(rnd() * 8 - 4)} ${f(1 + rnd() * 2)}" stroke="#a8802a" stroke-width="1.2"/>`; }
      for (let i = 0; i < 18; i++) { const x = 20 + rnd() * 96, y = 13 + rnd() * 8; straw += `<path d="M${f(x)} ${f(y)}l${f(rnd() * 8 - 4)} ${f(rnd() * 2)}" stroke="#c8a040" stroke-width="1.1"/>`; }
      return `${sh(60)}<path d="M110 22L124 12V40L110 50Z" fill="#b8902e"/><rect x="12" y="22" width="98" height="28" fill="#d8b04a"/><path d="M12 22H110L124 12H26Z" fill="#ecc860"/>${straw}<path d="M40 22V50M84 22V50M40 22L54 12M84 22L98 12" stroke="#6a4a2a" stroke-width="2.2"/><path d="M12 50h98" stroke="#8a6a20" stroke-width="2"/><path d="M8 22l4 2M118 14l6-4M14 50l-6 3" stroke="#d8b04a" stroke-width="1.5"/>`;
    })(),
    barrel: `${sh(46)}<path d="M28 16Q19 34 28 50Q65 59 102 50Q111 34 102 16Z" fill="#7a4a26"/><path d="M42 18Q36 36 42 54M56 19Q53 36 56 56M74 19Q77 36 74 56M88 18Q94 36 88 54" stroke="#5a3418" stroke-width="1.6" fill="none"/><path d="M24 25Q65 34 106 25" stroke="#3a3a3e" stroke-width="4" fill="none"/><path d="M24 44Q65 54 106 44" stroke="#3a3a3e" stroke-width="4" fill="none"/><path d="M24 25Q65 34 106 25" stroke="#8a8a90" stroke-width="1" fill="none"/><path d="M28 16Q19 34 28 50" stroke="#fff" stroke-width="3" opacity=".12" fill="none"/><ellipse cx="65" cy="16" rx="37" ry="9" fill="#9a6a3a"/><path d="M40 11V21M54 8V24M76 8V24M90 11V21" stroke="#7a4a26" stroke-width="1.4"/><ellipse cx="65" cy="16" rx="37" ry="9" fill="none" stroke="#3a3a3e" stroke-width="3"/>`,
    knit: (() => {
      let st = '';
      for (let r = 0; r < 3; r++) for (let c = 0; c < 13; c++) { const x = 20 + c * 7.6, y = 27 + r * 9 + Math.abs(c - 6) * .35; st += `<path d="M${x.toFixed(1)} ${y.toFixed(1)}l3 4 3-4" stroke="#cbbb9c" stroke-width="1.6" fill="none" stroke-linecap="round"/>`; }
      let band = ''; for (let c = 0; c < 9; c++) { const x = 24 + c * 10.2, y = 38 + Math.abs(c - 4) * .4; band += `<path d="M${x.toFixed(1)} ${(y - 4).toFixed(1)}l4 4-4 4-4-4Z" fill="#b8432a"/>`; }
      return `${sh(54)}<path d="M14 22V44Q14 56 65 56Q116 56 116 44V22Z" fill="#e6d8bc"/>${st}${band}<path d="M14 44Q14 56 65 56Q116 56 116 44" fill="none" stroke="#b8a888" stroke-width="2"/><path d="M14 30Q16 50 30 54" stroke="#000" stroke-width="6" opacity=".06" fill="none"/><ellipse cx="65" cy="22" rx="51" ry="12" fill="#f2e8d4"/><path d="M65 22L24 18M65 22L106 18M65 22L40 31M65 22L90 31M65 22L65 10" stroke="#d8c8a6" stroke-width="1.4"/><circle cx="65" cy="22" r="3.2" fill="#b8432a"/><ellipse cx="65" cy="22" rx="51" ry="12" fill="none" stroke="#cbbb9c" stroke-width="2"/>`;
    })(),
    beanbag: `${sh(60, .3)}<path d="M8 40Q2 15 34 9Q65 1 96 9Q128 15 122 40Q118 57 65 57Q12 57 8 40Z" fill="#c8562a"/><path d="M10 44Q20 56 65 56Q110 56 120 44Q118 58 65 59Q12 58 10 44Z" fill="#000" opacity=".22"/><ellipse cx="65" cy="22" rx="38" ry="10" fill="#9a3c18" opacity=".55"/><path d="M18 26Q20 12 40 9" stroke="#fff" stroke-width="4" opacity=".22" fill="none" stroke-linecap="round"/><path d="M30 48Q65 40 100 48" stroke="#8a3412" stroke-width="1.4" fill="none" stroke-dasharray="3 3"/>`,
    velvet: `${sh(58, .35)}<path d="M8 25Q4 32 10 38L18 46Q65 54 112 46L120 38Q126 32 122 25Z" fill="#7a1420"/><path d="M14 44Q65 53 116 44" stroke="#d4a84a" stroke-width="2.2" fill="none"/><path d="M12 24Q6 14 22 11Q65 4 108 11Q124 14 118 24Q124 34 108 36Q65 42 22 36Q6 34 12 24Z" fill="#b8323e"/><path d="M12 24Q6 14 22 11Q65 4 108 11Q124 14 118 24Q124 34 108 36Q65 42 22 36Q6 34 12 24Z" fill="none" stroke="#e8c35a" stroke-width="2.4"/><path d="M38 14L52 23L38 32M65 10L79 20L65 30L51 20Z M92 14L78 23L92 32" stroke="#8a1824" stroke-width="1.3" fill="none"/><g fill="#5a0c16">${[[38,14],[65,10],[92,14],[52,23],[79,23],[38,32],[65,30],[92,32]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r="2.2"/>`).join('')}</g><path d="M22 14Q30 10 44 9" stroke="#fff" stroke-width="2.5" opacity=".22" fill="none" stroke-linecap="round"/><g fill="#e8c35a"><circle cx="9" cy="24" r="3"/><path d="M6 26L3 38H15L12 26Z"/><circle cx="121" cy="24" r="3"/><path d="M118 26L115 38H127L124 26Z"/></g>`,
    royal: `<ellipse cx="65" cy="55" rx="60" ry="7" fill="#000" opacity=".38"/><path d="M4 36Q2 44 10 48Q65 58 120 48Q128 44 126 36Z" fill="#2c1440"/><path d="M6 34Q2 26 16 24Q65 18 114 24Q128 26 124 34Q128 42 114 44Q65 50 16 44Q2 42 6 34Z" fill="#4a2468"/><path d="M6 34Q2 26 16 24Q65 18 114 24Q128 26 124 34Q128 42 114 44Q65 50 16 44Q2 42 6 34Z" fill="none" stroke="#e8c35a" stroke-width="2.2"/><path d="M14 46Q65 56 116 46" stroke="#e8c35a" stroke-width="1.6" fill="none" stroke-dasharray="4 3"/><path d="M22 30Q16 36 22 38L30 40Q65 46 100 40L108 38Q114 36 108 30Z" fill="#8a1a24"/><path d="M24 24Q18 16 32 14Q65 8 98 14Q112 16 106 24Q112 32 98 34Q65 39 32 34Q18 32 24 24Z" fill="#b8323e" stroke="#e8c35a" stroke-width="2"/><path d="M40 24Q52 16 65 24Q78 32 90 24M40 24Q52 32 65 24Q78 16 90 24" stroke="#e8c35a" stroke-width="1.3" fill="none" opacity=".85"/><path d="M65 15l4 4-4 5-4-5Z" fill="#ff9a3a" stroke="#fff3c4" stroke-width=".8"/><circle cx="65" cy="19" r="8" fill="#ff9a3a" opacity=".25"/><g fill="#e8c35a"><circle cx="5" cy="34" r="3.2"/><path d="M2 36L-2 50H12L8 36Z"/><circle cx="125" cy="34" r="3.2"/><path d="M122 36L118 50H132L128 36Z"/><circle cx="23" cy="24" r="2.4"/><circle cx="107" cy="24" r="2.4"/></g><path d="M0 50h12M118 50h14" stroke="#b8902a" stroke-width="1.4"/>`,
  };

  // ---------- ground for scenes where the bottom is water, sky or mountainside ----------
  function ground(id, W, H, g, ry, sky) {
    const top = g - ry * 2.05;
    const shape = `M-20 ${f(top + H * .06)}C${f(W * .22)} ${f(top - H * .02)} ${f(W * .78)} ${f(top - H * .02)} ${f(W + 20)} ${f(top + H * .06)}V${H}H-20Z`;
    const L = sky.light; const m = (n, d) => dlMix(n, d, L);
    seed = 51; let extra = '', a, b, edge = '';
    if (id === 'ocean') {
      a = m('#4a4a50', '#d6c08c'); b = m('#24242c', '#9c8456');
      for (let i = 0; i < 9; i++) { const x = rnd() * W, y = top + H * .08 + rnd() * (H - top) * .8; extra += `<path d="M${f(x)} ${f(y)}q20 -6 40 0t40 0" stroke="${m('#5a5a60', '#bfa874')}" stroke-width="3" fill="none" opacity=".8"/>`; }
      for (const [x, y, s] of [[.08, .3, 1], [.9, .25, 1.2], [.18, .75, .8], [.84, .7, .9]]) {
        const X = W * x, Y = top + (H - top) * y;
        extra += `<ellipse cx="${f(X)}" cy="${f(Y)}" rx="${28 * s}" ry="${14 * s}" fill="${m('#232c40', '#7a6e5c')}"/>` + [0, 1, 2].map((k) => `<path d="M${f(X - 10 + k * 10)} ${f(Y - 8)}q${-8 + k * 4} -30 ${4 - k * 2} -${48 * s}" stroke="${m('#24503a', '#4a8a4a')}" stroke-width="5" fill="none" stroke-linecap="round"/>`).join('');
      }
      edge = m('#6a6a6e', '#e8d6a6');
    } else if (id === 'volcano') {
      a = m('#2c2024', '#4e3c36'); b = m('#120c0e', '#241a18');
      for (let i = 0; i < 7; i++) { let x = rnd() * W, y = top + H * .1 + rnd() * (H - top) * .75, d = `M${f(x)} ${f(y)}`; for (let k = 0; k < 5; k++) { x += 14 + rnd() * 24; y += rnd() * 16 - 8; d += `L${f(x)} ${f(y)}`; } extra += `<path d="${d}" stroke="#ff6a1a" stroke-width="7" opacity=".25" fill="none"/><path d="${d}" stroke="#ff9a3a" stroke-width="2.4" fill="none"/>`; }
      for (let i = 0; i < 10; i++) { const x = rnd() * W, y = top + H * .06 + rnd() * (H - top) * .8; extra += `<path d="M${f(x)} ${f(y)}l10 -12 14 4 6 8Z" fill="${m('#3a2c2c', '#5e4a42')}"/>`; }
      edge = '#ff7a2a';
    } else if (id === 'space') {
      a = '#7c7c8a'; b = '#3a3a48';
      for (let i = 0; i < 12; i++) { const x = rnd() * W, y = top + H * .07 + rnd() * (H - top) * .85, r = 10 + rnd() * 36; extra += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(r)}" ry="${f(r * .32)}" fill="#55556a"/><path d="M${f(x - r)} ${f(y)}a${f(r)} ${f(r * .32)} 0 0 0 ${f(2 * r)} 0" stroke="#a8a8b8" stroke-width="2" fill="none"/>`; }
      edge = '#b8b8c8';
    } else if (id === 'fjord') {
      a = m('#22301e', '#5e8040'); b = m('#10180c', '#34501f');
      for (let i = 0; i < 40; i++) { const x = rnd() * W, y = top + H * .06 + rnd() * (H - top) * .9; extra += `<path d="M${f(x)} ${f(y)}l-3 -9M${f(x + 3)} ${f(y)}l1 -11M${f(x + 6)} ${f(y)}l4 -8" stroke="${m('#2c3c24', '#7aa050')}" stroke-width="2" stroke-linecap="round"/>`; }
      for (let i = 0; i < 6; i++) { const x = rnd() * W, y = top + H * .1 + rnd() * (H - top) * .7; extra += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${14 + rnd() * 14}" ry="8" fill="${m('#3a3a3a', '#8a8478')}"/>`; }
      edge = m('#4a4a48', '#a8a294');
    } else return '';
    return `<svg class="fire-ground" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="fg-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="${f(top / H)}" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>` +
      `<path d="${shape}" fill="url(#fg-ground)"/><path d="M-20 ${f(top + H * .06)}C${f(W * .22)} ${f(top - H * .02)} ${f(W * .78)} ${f(top - H * .02)} ${f(W + 20)} ${f(top + H * .06)}" stroke="${edge}" stroke-width="${id === 'volcano' ? 2.5 : 7}" fill="none" opacity=".75"/>${extra}</svg>`;
  }

  // ---------- the casino table ----------
  function table(W, H, g, rx, ry, total) {
    const tx = rx * .8, ty = ry * .66, th = Math.max(12, ry * .2);
    const w = tx * 2 + 40, h = ty * 2 + th + 40, cx = w / 2, cy = ty + 20;
    let spots = '';
    for (let i = 0; i < total; i++) {
      const an = (-90 + (180 + i * 360) / total) * Math.PI / 180, x = cx + Math.cos(an) * tx * .72, y = cy + Math.sin(an) * ty * .7;
      const s = Math.max(1, rx / 260);
      spots += `<g transform="translate(${f(x)} ${f(y)}) scale(${f(s)})"><rect x="-13" y="-8" width="14" height="19" rx="2" fill="#fff" stroke="#888" stroke-width=".8" transform="rotate(-10)"/><rect x="-2" y="-9" width="14" height="19" rx="2" fill="#fff" stroke="#888" stroke-width=".8" transform="rotate(8)"/><path d="M4 -2l2 3 -2 3 -2 -3Z" fill="#c4262c" transform="rotate(8)"/>` +
        `<ellipse cx="22" cy="6" rx="7" ry="2.8" fill="#b8262c"/><ellipse cx="22" cy="3" rx="7" ry="2.8" fill="#1f1f24"/><ellipse cx="22" cy="0" rx="7" ry="2.8" fill="#2456a8" stroke="#fff" stroke-width=".8" stroke-dasharray="2 2"/></g>`;
    }
    return `<svg class="fire-table" style="left:${f(W / 2 - cx)}px;top:${f(g - cy)}px" width="${f(w)}" height="${f(h)}" viewBox="0 0 ${f(w)} ${f(h)}"><defs><radialGradient id="fg-felt" cx=".5" cy=".55" r=".6"><stop offset="0" stop-color="#2f9a62"/><stop offset=".7" stop-color="#1c6e44"/><stop offset="1" stop-color="#11502f"/></radialGradient><linearGradient id="fg-rail" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a2a1c"/><stop offset="1" stop-color="#2a1008"/></linearGradient></defs>` +
      `<ellipse cx="${cx}" cy="${f(cy + th + 8)}" rx="${f(tx + 12)}" ry="${f(ty + 10)}" fill="#000" opacity=".4"/>` +
      `<ellipse cx="${cx}" cy="${f(cy + th)}" rx="${f(tx + 14)}" ry="${f(ty + 12)}" fill="#3a1a0c"/><rect x="${f(cx - tx - 14)}" y="${f(cy)}" width="${f(2 * tx + 28)}" height="${f(th)}" fill="#3a1a0c"/>` +
      `<ellipse cx="${cx}" cy="${f(cy)}" rx="${f(tx + 14)}" ry="${f(ty + 12)}" fill="url(#fg-rail)"/><ellipse cx="${cx}" cy="${f(cy - 2)}" rx="${f(tx + 12)}" ry="${f(ty + 10)}" fill="none" stroke="#8a4a32" stroke-width="2" opacity=".6"/>` +
      `<ellipse cx="${cx}" cy="${f(cy)}" rx="${f(tx)}" ry="${f(ty)}" fill="#d4a84a"/><ellipse cx="${cx}" cy="${f(cy)}" rx="${f(tx - 3)}" ry="${f(ty - 3)}" fill="url(#fg-felt)"/>` +
      `<ellipse cx="${cx}" cy="${f(cy)}" rx="${f(tx * .55)}" ry="${f(ty * .5)}" fill="none" stroke="#e8c35a" stroke-width="1.6" opacity=".55"/>${spots}</svg>`;
  }

  
  // ---------- what's around the fire: stones or none (drawn in a pw x ph box, centre of the fire in the middle) ----------
  function blob(cx, cy, rx, ry, jit = .18, n = 8) {
    const pts = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, k = 1 + (rnd() * 2 - 1) * jit; pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k * (Math.sin(a) < 0 ? 1.05 : .9)]); }
    let d = ''; for (let i = 0; i < n; i++) { const [x, y] = pts[i], [x2, y2] = pts[(i + 1) % n]; const mx = (x + x2) / 2, my = (y + y2) / 2; d += i === 0 ? `M${f(mx)} ${f(my)}` : `Q${f(x)} ${f(y)} ${f(mx)} ${f(my)}`; }
    const [x0, y0] = pts[0]; const [x1, y1] = pts[1]; return d + `Q${f(x0)} ${f(y0)} ${f((x0 + x1) / 2)} ${f((y0 + y1) / 2)}Z`;
  }
  function stone(cx, cy, rx, ry, col, back, flat = false) {
    const h = flat ? ry * .45 : ry * .8;
    let s = `<ellipse cx="${f(cx)}" cy="${f(cy + ry * .55)}" rx="${f(rx * 1.05)}" ry="${f(ry * .45)}" fill="#000" opacity=".35"/>`;
    s += `<path d="${blob(cx, cy, rx, ry)}" fill="${col}"/>`;
    s += `<path d="${blob(cx, cy + ry * .25, rx * .92, ry * .7, .1)}" fill="#000" opacity=".22"/>`;
    s += `<path d="${blob(cx - rx * .12, cy - ry * .32, rx * .62, h * .42, .2, 7)}" fill="#fff" opacity="${flat ? .1 : .12}"/>`;
    if (back) s += `<path d="${blob(cx, cy + ry * .3, rx * .8, ry * .45, .15)}" fill="#ff8a3a" opacity=".1"/>`;
    return s;
  }
  function pit(pw, ph) {
    const cx = pw / 2, cy = ph / 2; let back = '', front = ''; seed = 77;
    const ash = (k = 1) => `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(pw * .36 * k)}" ry="${f(ph * .3 * k)}" fill="url(#fg-ash)"/><ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(pw * .26 * k)}" ry="${f(ph * .2 * k)}" fill="#1a0e08" opacity=".85"/><ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(pw * .2 * k)}" ry="${f(ph * .15 * k)}" fill="#ff7a2a" opacity=".45"/>`;
    const defs = `<defs><radialGradient id="fg-ash"><stop offset=".55" stop-color="#3a322c"/><stop offset=".8" stop-color="#4a423c" stop-opacity=".7"/><stop offset="1" stop-color="#4a423c" stop-opacity="0"/></radialGradient></defs>`;
    const ring = (n, rk, sz, cols, flat = false, jitA = .15) => {
      const st = [];
      for (let i = 0; i < n; i++) { const a = ((i + (rnd() - .5) * jitA * 2) / n) * Math.PI * 2; const sn = Math.sin(a); const sc = .82 + .18 * (sn + 1) / 2; const rx = pw * sz * (.8 + rnd() * .45) * sc; st.push({ a, sn, x: cx + Math.cos(a) * pw * rk, y: cy + sn * ph * rk * 1.05, rx, ry: rx * (flat ? .4 : .66) }); }
      st.sort((p, q) => p.y - q.y);
      for (const t of st) { const svg = stone(t.x, t.y, t.rx, t.ry, cols[Math.floor(rnd() * cols.length)], t.sn < 0, flat); if (t.sn < .15) back += svg; else front += svg; }
    };
    back += ash(); ring(15, .36, .072, ['#77706a', '#6a645f', '#857c72', '#5f5954']);
    return { back: defs + back, front };
  }

  return { LOGS, SEATS, ground, table, pit };
})();

// Backdrops whose own floor is water, sky or a mountainside get a patch of ground for the circle to sit on.
const FIRE_GROUND = new Set(['ocean', 'volcano', 'space', 'fjord']);
const fireGround = { key: '', ring: null, geo: null, logs: '' };

/** What burns in the fire: crossed logs (birch for the birch look), or a pile of money at the card table. */
function fireLogs(kind) {
  if (fireGround.logs === kind) return;
  fireGround.logs = kind;
  const L = FIRE_ART.LOGS[kind]();
  const t = `translate(100 192) scale(${kind === 'money' ? 1.45 : 1.3}) translate(-100 -192)`;
  // In winter there's snow on the far ends of the logs.
  const snow = kind === 'money' ? '' : '<g class="fire-snow" fill="#fbfdff"><ellipse cx="138" cy="166" rx="11" ry="3.4" transform="rotate(-17.6 138 166)"/><ellipse cx="62" cy="166" rx="11" ry="3.4" transform="rotate(17.6 62 166)"/></g>';
  $('#fire-ring .fire-logs').innerHTML = `<g transform="${t}">${L.back}${snow}</g>`;
  $('#fire-ring .fire-logs-front').innerHTML = L.front ? `<g transform="${t}">${L.front}</g>` : '';
}

/**
 * Lays out what's on the ground around the fire, for the ring campfire.js sized: the firelight on the
 * ground, the stone ring (or the card table in the casino lounge), and a patch of ground for backdrops that
 * need one. Only redrawn when the size, the backdrop or the number of seats changes.
 */
function fireGroundLayout(ring, geo) {
  const wrap = ring.parentElement;
  const sky = FIRE_GROUND.has(geo.backdrop) ? daylight() : null;
  const key = [geo.W, geo.H, Math.round(geo.g), geo.total, geo.backdrop, geo.phone, wrap.clientWidth, wrap.clientHeight, sky ? Math.round(sky.light * 8) : ''].join();
  fireGround.ring = ring;
  fireGround.geo = geo;
  if (key === fireGround.key && ring.querySelector('.fire-pool')) return;
  fireGround.key = key;
  ring.querySelectorAll('.fire-ground, .fire-pool, .fire-pit, .fire-table').forEach((e) => e.remove());
  const { W, H, g, rx, ry, fire, phone, total, backdrop } = geo;
  if (sky) {
    const ox = -ring.offsetLeft, oy = -ring.offsetTop, gw = wrap.clientWidth, gh = wrap.clientHeight;
    ring.insertAdjacentHTML('afterbegin', FIRE_ART.ground(backdrop, gw, gh, g - oy, ry, sky));
    const el = ring.querySelector('.fire-ground');
    if (el) Object.assign(el.style, { left: `${ox}px`, top: `${oy}px` });
  }
  ring.insertAdjacentHTML('beforeend', `<div class="fire-pool" style="top:${g}px;width:${rx * 2.7}px;height:${ry * 2.9}px"></div>`);
  if (backdrop === 'lounge') {
    ring.insertAdjacentHTML('beforeend', FIRE_ART.table(W, H, g, rx, ry, total));
  } else {
    const pw = fire * (phone ? 0.6 : 0.5), ph = pw * 0.34;
    const pit = FIRE_ART.pit(pw, ph);
    const box = (z, inner) => `<svg class="fire-pit ${z}" style="top:${g}px" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" viewBox="0 0 ${pw.toFixed(1)} ${ph.toFixed(1)}" overflow="visible">${inner}</svg>`;
    ring.insertAdjacentHTML('beforeend', box('back', pit.back) + box('front', pit.front));
  }
}
/** The light changed: the patch of ground is redrawn in it. */
function fireGroundRefresh() {
  if (fireGround.ring && fireGround.geo && FIRE_GROUND.has(fireGround.geo.backdrop)) fireGroundLayout(fireGround.ring, fireGround.geo);
}

/** The seat someone sits on, under their face: a stump, or a cushion at the card table. */
function fireSeatArt(holder, kind) {
  let el = holder.querySelector(':scope > .seat-art');
  if (el?.dataset.kind === kind) return;
  if (!el) { el = document.createElement('span'); el.className = 'seat-art'; holder.append(el); }
  el.dataset.kind = kind;
  el.innerHTML = `<svg viewBox="0 0 130 60" aria-hidden="true">${FIRE_ART.SEATS[kind] ?? FIRE_ART.SEATS.stump}</svg>`;
}
