// The fun extras: the seasons around the fire, decorations unlocked by time at the fire, toasting
// marshmallows, birthdays, each hearth's message of the day, and the year in review.
// Part of Peiskos's client: plain scripts that index.html loads in order, sharing one global scope.
'use strict';

// ---------------------------------------------------------------- the seasons

// theme.js puts the season and any holiday on <html> (data-season, data-holiday) before the first
// paint; this fills the fire with whatever is falling or floating this time of year.
function seasonLayer() {
  const layer = $('#season-layer');
  const root = document.documentElement;
  const kind = root.dataset.holiday || root.dataset.season || 'none';
  if (layer.dataset.kind === kind) return;
  layer.dataset.kind = kind;
  const count = { winter: 26, autumn: 16, spring: 14, summer: 12, halloween: 16, yule: 26, newyear: 20, midsummer: 14 }[kind] ?? 0;
  const bits = [];
  for (let i = 0; i < count; i++) {
    // Spread across the circle, at their own speeds and sizes, already partway through so it starts full.
    const dur = 6 + Math.random() * 7;
    bits.push(`<span style="--x:${(Math.random() * 100).toFixed(1)}%;--y:${(Math.random() * 100).toFixed(1)}%;--s:${(0.6 + Math.random() * 0.8).toFixed(2)};--d:${dur.toFixed(1)}s;--delay:${(-Math.random() * dur).toFixed(1)}s;--hue:${Math.floor(Math.random() * 4)}"></span>`);
  }
  layer.innerHTML = bits.join('');
}

// Sparks for hearths whose fire has them.
function sparksLayer(on) {
  const layer = $('#fire-sparks');
  if (!on) return layer.replaceChildren();
  if (layer.childElementCount) return;
  layer.innerHTML = Array.from({ length: 12 }, () => {
    const dur = 1.6 + Math.random() * 1.8;
    return `<span style="--x:${(Math.random() * 0.2 - 0.1).toFixed(3)};--drift:${(Math.random() * 40 - 20).toFixed(0)}px;--d:${dur.toFixed(2)}s;--delay:${(-Math.random() * dur).toFixed(2)}s"></span>`;
  }).join('');
}

// ---------------------------------------------------------------- decorations by the fire

// What can sit by your seat, matching FIRE_ITEMS in server/src/extras.ts (the server decides
// what's unlocked; this is how each one looks): little pixel pictures, 16×16, one letter per
// pixel ('.' is empty). Rows of 8 are the left half, mirrored to make the right.
const FIRE_ITEM_NAMES = {
  cocoa: 'A mug of cocoa', marshmallow: 'Marshmallows', mushroom: 'A forest mushroom', guitar: 'A guitar', hedgehog: 'A hedgehog',
  fox: 'A fox', owl: 'An owl', deer: 'A deer', bear: 'A bear', wolf: 'A wolf',
  // Premium pets, bought with chips in a hearth's casino (PETS in server/src/casino-items.ts).
  blackcat: 'A black cat', penguin: 'A penguin', redpanda: 'A red panda', unicorn: 'A unicorn', dragon: 'A dragon', phoenix: 'A phoenix', goldwolf: 'A golden wolf',
  bunny: 'A bunny', frog: 'A frog', corgi: 'A corgi', axolotl: 'An axolotl', octopus: 'An octopus', ghost: 'A ghost', icedragon: 'An ice dragon', diamondcat: 'A diamond cat',
};
const PREMIUM_PETS = ['blackcat', 'penguin', 'redpanda', 'unicorn', 'dragon', 'phoenix', 'goldwolf', 'bunny', 'frog', 'corgi', 'axolotl', 'octopus', 'ghost', 'icedragon', 'diamondcat'];
const PIXEL_COLORS = {
  k: '#2b1d16', w: '#fbf3e6', c: '#efd9bd', o: '#e27b30', O: '#b4521b', b: '#8a5a36', B: '#5c3a22', l: '#c99a6b',
  g: '#9a9ca3', G: '#62656d', L: '#d5d7dc', r: '#cf4a33', R: '#982f22', p: '#f2b8b4', y: '#f6cf5a', Y: '#d99a2b',
  m: '#e8ddcf', M: '#b8a690', s: '#a07a5a', e: '#f8f4ec',
  d: '#4caf6a', D: '#2e7d4a', f: '#ff6a2a', h: '#f58fc4', u: '#6fc3f0',
  v: '#9a6ad8', V: '#6a3ab0', a: '#f7b2c8', A: '#e27a9e', i: '#cdeeff', I: '#5aa6e0', n: '#2f5fb0',
};
const PIXEL_ART = {
  cocoa: [
    '................',
    '.....e...e......',
    '......e...e.....',
    '.....e...e......',
    '......e...e.....',
    '................',
    '..mmmmmmmmmm....',
    '..mBbbbbbbBm....',
    '..mmmmmmmmmmMM..',
    '..mmmmmmmmmm.M..',
    '..mmrmrmmmmm.M..',
    '..mmrrrmmmmm.M..',
    '..mmmrmmmmmmMM..',
    '..mmmmmmmmmm....',
    '...MmmmmmmM.....',
    '....MMMMMM......',
  ],
  marshmallow: [
    '................',
    '...........ww...',
    '..........wwww..',
    '..........wcww..',
    '...........ww...',
    '........ww.s....',
    '.......wwwws....',
    '.......wcwws....',
    '........wws.....',
    '.....ww..s......',
    '....wwwws.......',
    '....wcwws.......',
    '.....wws........',
    '.......s........',
    '......s.........',
    '.....s..........',
  ],
  mushroom: [
    '........', '........', '.....rrr', '...rrrrr', '..rrwwrr', '.rrrwwrr', '.rrrrrrr', 'rwwrrrrw',
    'rwwrrrrr', 'RRRRRRRR', '....cccc', '....cccc', '....cccc', '....cccc', '...ccccc', '........',
  ],
  guitar: [
    '......BB', '......Bk', '......BB', '.......b', '.......b', '.......b', '.......b', '....llll',
    '...lllll', '...llllb', '....llkk', '...lllkk', '..llllll', '..llllBB', '...lllll', '.....lll',
  ],
  hedgehog: [
    '........', '........', '.....B.B', '...BBBBB', '..BbBbBb', '.BBBBBBB', '.BbBcccc', 'BBBcckcc',
    'BBBccccc', 'BbBcccck', 'BBBBcccc', '.BBBBccc', '.BBBBBcc', '..BBBBBB', '...cc...', '........',
  ],
  fox: [
    '........', '..O.....', '..OO....', '..OpO...', '..oooooo', '.ooooooo', '.ooookoo', '.wwooooo',
    '..wwwwwk', '...wwwww', '....oooo', '...owwww', '...owwww', '...oowww', '...kkooo', '........',
  ],
  owl: [
    '........', '..b.....', '..bb....', '..bbbbbb', '.bbbbbbb', '.bwwwbbb', 'bwykywbb', 'bwyyywbb',
    'bbwwwbYY', 'bbbbbbbY', 'bbllbllb', 'bblllllb', 'bbllbllb', '.bbllllb', '..YY.YY.', '........',
  ],
  deer: [
    '.B....B.', 'B.B..B..', '.BBB.B..', '..BBB...', '....BB..', '..llllll', '.lllllll', '..llklll',
    '...lllll', '...lllck', '....llll', '...lllww', '...llwww', '...llwww', '...kklll', '........',
  ],
  bear: [
    '........', '.bb.....', '.blbbbbb', '.bbbbbbb', '.bbbbbbb', '.bbbkbbb', '.bbbbbll', '.bbbbllk',
    '..bbblll', '...bbbbb', '..bbbbbb', '.bbbblll', '.bbbblll', '.bbbblll', '.BBbbbbb', '........',
  ],
  wolf: [
    '........', '..G.....', '..GG....', '..GLG...', '..gggggg', '.ggggggg', '.ggggkgg', '.LLggggg',
    '..LLLLLk', '...LLLLL', '....gggg', '...gLLLL', '...gLLLL', '...ggLLL', '...GGggg', '........',
  ],
  blackcat: [
    '........', '.k......', '.kk.....', '.kpk....', '.kkkkkkk', 'kkkkkkkk', 'kkyykkkk', 'kkykkkkk',
    'kkkkkkkp', '.kkkkkkk', '..kkkkkk', '..kkkkkk', '.kkkkkkk', '.kkkkkkk', '.kk..kkk', '........',
  ],
  penguin: [
    '........', '.....kkk', '....kkkk', '...kkkkk', '...kkwww', '...kwkww', '...kwwwY', '..kkwwww',
    '.kkwwwww', '.kkwwwww', 'kkkwwwww', '.kkwwwww', '..kwwwww', '..kkwwww', '...YYY..', '........',
  ],
  redpanda: [
    '........', '.oo.....', 'owwo....', '.ooooooo', 'oooooooo', 'owwwoooo', 'owkwoooo', 'oowwowww',
    '.ooowwwk', '..oooooo', '...OOOOO', '..OOOOOO', '..OOOOOO', '..OOoOOO', '..kk..kk', '........',
  ],
  unicorn: [
    '.......y', '.......y', '......yY', '..ww...y', '..wwwwww', '.hwwwwww', 'hhwuwwww', 'hhwkwwww',
    'hhwwwwww', '.hwwwwww', '.h.wwwww', '...wwpww', '....wwww', '...wwwww', '...MM.MM', '........',
  ],
  dragon: [
    '........', '....D...', '....Dddd', 'D..ddddd', 'DD.dyddd', 'DdDddddd', 'DddDdddd', 'DdddDddd',
    'DdddDyyy', '.DddDyyy', '..DdDyyy', '...DDyyy', '....dyyy', '....dddd', '....DD..', '........',
  ],
  phoenix: [
    '........', '......y.', '.....yfy', '......ff', '.....fff', '....ffkf', '....fffY', 'Y....fff',
    'fY..ffff', 'ffY.ffff', 'rffYffyy', '.rffffyy', '..rrffff', '....ffff', '...fYfYf', '...Y.Y.Y',
  ],
};
PIXEL_ART.bunny = [
  '........', '....mw..', '...wpw..', '...wpw..', '...wpw..', '...www..', '..wwwwww', '.wwwwwww',
  '.wwkwwww', '.wwwwwwp', '..wwwwww', '..wwwwww', '.wwwwwww', '.mwwwwww', '..mm.mmm', '........',
];
PIXEL_ART.frog = [
  '........', '........', '..www...', '.wwkww..', '.dwwwddd', 'dddddddd', 'dddddddd', 'ddDDDDDD',
  'dddddddd', '.ddyyyyy', '.ddyyyyy', '.ddyyyyy', 'dddyyyyy', 'dDdddddd', 'dd.dd...', '........',
];
PIXEL_ART.corgi = [
  '........', '.o......', '.oo.....', '.opo....', '.ooooooo', '.oooooow', '.ookooww', '.oooowww',
  '..owwwwk', '...wwwww', '..oooooo', '.ooowwww', '.ooowwww', '.ooowwww', '.ww..www', '........',
];
PIXEL_ART.axolotl = [
  '........', '........', 'A.......', 'AA..aaaa', '.AAaaaaa', 'AAaaaaaa', '.Aaakaaa', 'AAaaaaaa',
  '..aaaaaA', '...aaaaa', '..aaaaaa', '.aaaaaaa', '.aaaaaaa', '..aaaaaa', '..aa..aa', '........',
];
PIXEL_ART.octopus = [
  '........', '....vvvv', '...vvvvv', '..vvvvvv', '..vvvvvv', '..vwwvvv', '..vwkvvv', '..vvvvvv',
  '..vvvvVV', '.vvvvvvv', 'v.v.v.vv', 'v.v.v.v.', 'vv.v.vv.', '.v.vv.v.', '.vv..v..', '........',
];
PIXEL_ART.ghost = [
  '........', '....eeee', '...eeeee', '..eeeeee', '..eeeeee', '.eekkeee', '.eekkeee', '.eeeeeee',
  '.eeeeeek', '.eeeeeee', '.eeeeeee', '.eeeeeee', '.eeeeeee', '.ee.eeee', '.e...ee.', '........',
];
// The ice dragon is the dragon in ice; the diamond cat is the black cat cut from diamond.
PIXEL_ART.icedragon = PIXEL_ART.dragon.map((row) => row.replace(/d/g, 'i').replace(/D/g, 'I').replace(/y/g, 'e'));
PIXEL_ART.diamondcat = PIXEL_ART.blackcat.map((row, y) => row.replace(/k/g, (_, x) => ((x + y) % 5 ? 'u' : 'i')).replace(/y/g, 'n').replace(/p/g, 'I'));
// The golden wolf is the wolf, in gold.
PIXEL_ART.goldwolf = PIXEL_ART.wolf.map((row) => row.replace(/g/g, 'y').replace(/G/g, 'Y').replace(/L/g, 'e'));
/** Turns one of PIXEL_ART into crisp SVG, a rect per run of one color. */
function pixelSvg(id) {
  const rows = PIXEL_ART[id];
  if (!rows) return '';
  let rects = '';
  rows.forEach((half, y) => {
    const row = half.length === 8 ? half + [...half].reverse().join('') : half;
    for (let x = 0; x < row.length;) {
      const ch = row[x];
      let n = 1;
      while (row[x + n] === ch) n++;
      if (PIXEL_COLORS[ch]) rects += `<rect x="${x}" y="${y}" width="${n}" height="1" fill="${PIXEL_COLORS[ch]}"/>`;
      x += n;
    }
  });
  return `<svg class="pixel-art" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}
const FIRE_LOOK_ART = { classic: '🪵', birch: '🤍', sparks: '✨', blue: '💙' };
// The sky above a hearth's fires, matching SKY_LOOKS on the server.
const SKY_ART = { evening: '🌆', stars: '✨', moon: '🌕', aurora: '🌌', meteors: '🌠' };

/** What someone has by their seat: a premium pet they have out in this fire's hearth, or what they picked. */
function fireItemOf(userId) {
  const here = state.voice && roomById(state.voice.channelId)?.s;
  const pet = here?.members?.find((x) => x.id === userId)?.pet;
  if (pet && PIXEL_ART[pet]) return pet;
  if (userId === state.me.id) return state.me.fireItem ?? null;
  for (const s of state.servers.values()) {
    const m = s.members?.find((x) => x.id === userId);
    if (m) return m.fireItem ?? null;
  }
  return null;
}

/** What someone sits on at this fire: the seat they picked in its hearth, else a stump (a cushion at the card table). */
function seatKindOf(userId) {
  const here = state.voice && roomById(state.voice.channelId)?.s;
  const seat = here?.members?.find((x) => x.id === userId)?.seat;
  if (seat && FIRE_ART.SEATS[seat]) return seat;
  return $('#fire-ring').classList.contains('at-table') ? 'velvet' : 'stump';
}

/** Called by renderFire for each seat: the thing by it, and the look of the whole fire. */
function decorateSeat(wrap, userId) {
  const id = fireItemOf(userId);
  const el = wrap.querySelector('.seat-item');
  if (!id || !PIXEL_ART[id]) return el?.remove();
  if (el?.dataset.item === id) return;
  el?.remove();
  wrap.insertAdjacentHTML('beforeend', `<span class="seat-item${PREMIUM_PETS.includes(id) ? ' premium' : ''}" data-item="${id}" title="${escapeHtml(FIRE_ITEM_NAMES[id])}">${pixelSvg(id)}</span>`);
}
function decorateFire(s) {
  const hearth = s && !isDm(s);
  const look = hearth ? s.fireLook || 'classic' : 'classic';
  $('#fire-ring').dataset.look = look;
  sparksLayer(look === 'sparks');
  // A backdrop someone chose for themselves wins over one put up for the whole hearth; either hides the sky.
  const backdrop = hearth ? (BACKDROP_SCENES[s.myBackdrop] && s.myBackdrop) || (BACKDROP_SCENES[s.backdrop] && s.backdrop) || null : null;
  backdropLayer(backdrop, hearth ? s.id : null);
  fireLogs(backdrop === 'lounge' ? 'money' : look === 'birch' ? 'birch' : 'crossed');
  if (!backdrop) skyLayer(hearth ? s.skyLook || 'evening' : 'evening');
  seasonLayer();
}

/** A bought scene behind the fire, or none. Night colors around it, like any sky but the evening. */
function backdropLayer(id, hearthId = null) {
  const wrap = $('.fire-ring-wrap');
  if (!id) {
    if (wrap.dataset.backdrop) { delete wrap.dataset.backdrop; wrap.style.background = ''; delete wrap.dataset.sky; backdropLive(null); $('#sky-layer').replaceChildren(); }
    return;
  }
  // The same scene in another hearth: only your catch of the day (in Under the sea) changes.
  if (wrap.dataset.backdrop === id) return BACKDROP_LIVE[id] && backdropCatch(hearthId);
  wrap.dataset.backdrop = id;
  wrap.dataset.sky = 'backdrop';
  // The live ones move and follow the time of day, in the sky layer; the rest are one still picture.
  if (BACKDROP_LIVE[id]) {
    wrap.style.background = '';
    backdropLive($('#sky-layer'), id, hearthId);
  } else {
    backdropLive(null);
    $('#sky-layer').replaceChildren();
    wrap.style.background = backdropCss(id);
  }
}

// The sky above the fire: stars scattered over it, with a moon, northern lights or shooting stars.
function skyLayer(sky) {
  const wrap = $('.fire-ring-wrap');
  const layer = $('#sky-layer');
  if (sky === 'evening') { delete wrap.dataset.sky; return layer.replaceChildren(); }
  if (wrap.dataset.sky === sky) return;
  wrap.dataset.sky = sky;
  const bits = [];
  for (let i = 0; i < 70; i++) {
    // Thicker towards the top, where the firelight doesn't reach.
    const y = Math.pow(Math.random(), 1.6) * 85;
    const dur = 2.5 + Math.random() * 4;
    bits.push(`<span class="star" style="--x:${(Math.random() * 100).toFixed(1)}%;--y:${y.toFixed(1)}%;--s:${(1 + Math.random() * 1.6).toFixed(1)}px;--d:${dur.toFixed(1)}s;--delay:${(-Math.random() * dur).toFixed(1)}s"></span>`);
  }
  if (sky === 'moon') bits.push('<span class="moon"></span>');
  if (sky === 'aurora') bits.push('<span class="aurora a1"></span><span class="aurora a2"></span><span class="aurora a3"></span>');
  if (sky === 'meteors') {
    for (let i = 0; i < 4; i++) {
      const dur = 5 + Math.random() * 6;
      bits.push(`<span class="meteor" style="--x:${(20 + Math.random() * 75).toFixed(1)}%;--y:${(Math.random() * 30).toFixed(1)}%;--d:${dur.toFixed(1)}s;--delay:${(-Math.random() * dur).toFixed(1)}s"></span>`);
    }
  }
  layer.innerHTML = bits.join('');
}

const hoursText = (h) => (h < 1 ? `${Math.round(h * 60)} minutes` : `${h < 10 ? h.toFixed(1).replace(/\.0$/, '') : Math.floor(h)} hour${h >= 1 && h < 1.05 ? '' : 's'}`);

async function openFireDecor() {
  const s = fireServer();
  const hearth = s && !isDm(s) ? s : null;
  let mine, fire, pets;
  try {
    [mine, fire, pets] = await Promise.all([
      api('/api/me/fire'),
      hearth ? api(`/api/servers/${hearth.id}/fire`) : null,
      hearth ? api(`/api/servers/${hearth.id}/casino/pets`) : null,
    ]);
  } catch (err) { return alertError(err); }
  // A premium pet out in this hearth sits by your seat in place of the animal you picked.
  const petOut = pets?.pet ?? null;
  const item = (it) => {
    const open = mine.hours >= it.hours;
    const on = !petOut && mine.item === it.id;
    return `<button type="button" class="decor-pick${on ? ' chosen' : ''}" data-item="${it.id}" ${open ? '' : 'disabled'} aria-pressed="${on}">
      <span class="decor-art">${open ? pixelSvg(it.id) || '?' : '🔒'}</span><span>${escapeHtml(it.name)}</span><span class="small muted">${open ? (on ? 'By your seat' : 'Unlocked') : `At ${it.hours} hours`}</span></button>`;
  };
  const pet = (p) => {
    const owned = pets.myPets.includes(p.id);
    const on = petOut === p.id;
    if (owned) return `<button type="button" class="decor-pick premium${on ? ' chosen' : ''}" data-pet="${p.id}" aria-pressed="${on}">
      <span class="decor-art">${pixelSvg(p.id)}</span><span>${escapeHtml(p.name)}</span><span class="small muted">${on ? 'By your seat' : 'Yours'}</span></button>`;
    return `<button type="button" class="decor-pick premium" data-pet-buy="${p.id}" ${pets.chips >= p.price ? '' : 'disabled'}>
      <span class="decor-art">${pixelSvg(p.id)}</span><span>${escapeHtml(p.name)}</span><span class="small decor-price"><span class="chip-icon sm" aria-hidden="true"></span>${p.price.toLocaleString()}</span></button>`;
  };
  // Backdrops: click one you own to see it behind this hearth's fires (again to put it away).
  const backdrop = (b) => {
    const owned = pets.myBackdrops.includes(b.id);
    const on = pets.backdrop === b.id;
    const art = `<span class="backdrop-art" data-bd-art="${b.id}"></span>`;
    if (owned) return `<button type="button" class="decor-pick backdrop-pick${on ? ' chosen' : ''}" data-bd="${b.id}" aria-pressed="${on}">
      ${art}<span>${escapeHtml(b.name)}</span><span class="small muted">${on ? 'Showing for you' : pets.hearthBackdrop === b.id ? 'Up for everyone' : 'Yours'}</span></button>`;
    return `<button type="button" class="decor-pick backdrop-pick" data-bd-buy="${b.id}" ${pets.chips >= b.price ? '' : 'disabled'}>
      ${art}<span>${escapeHtml(b.name)}</span><span class="small decor-price"><span class="chip-icon sm" aria-hidden="true"></span>${b.price.toLocaleString()}</span></button>`;
  };
  // Seats: click one you have to sit on it at this hearth's fires.
  const seatPick = (x) => {
    const owned = pets.mySeats.includes(x.id);
    const on = (pets.seat ?? 'stump') === x.id;
    const art = `<span class="decor-art seat-pick-art"><svg viewBox="-4 -14 138 76" aria-hidden="true">${FIRE_ART.SEATS[x.id] ?? ''}</svg></span>`;
    if (owned) return `<button type="button" class="decor-pick${on ? ' chosen' : ''}" data-seat="${x.id}" aria-pressed="${on}">
      ${art}<span>${escapeHtml(x.name)}</span><span class="small muted">${on ? 'Sitting on it' : x.price ? 'Yours' : 'Free'}</span></button>`;
    return `<button type="button" class="decor-pick" data-seat-buy="${x.id}" ${pets.chips >= x.price ? '' : 'disabled'}>
      ${art}<span>${escapeHtml(x.name)}</span><span class="small decor-price"><span class="chip-icon sm" aria-hidden="true"></span>${x.price.toLocaleString()}</span></button>`;
  };
  const look = (l) => {
    const open = fire.hours >= l.hours;
    return `<button type="button" class="decor-pick${fire.look === l.id ? ' chosen' : ''}" data-look="${l.id}" ${open && fire.canChange ? '' : 'disabled'} aria-pressed="${fire.look === l.id}">
      <span class="decor-art">${open ? FIRE_LOOK_ART[l.id] ?? '🔥' : '🔒'}</span><span>${escapeHtml(l.name)}</span><span class="small muted">${open ? (fire.look === l.id ? 'Burning now' : 'Unlocked') : `At ${l.hours} hours`}</span></button>`;
  };
  const sky = (l) => {
    const open = fire.hours >= l.hours;
    return `<button type="button" class="decor-pick${fire.sky === l.id ? ' chosen' : ''}" data-sky="${l.id}" ${open && fire.canChange ? '' : 'disabled'} aria-pressed="${fire.sky === l.id}">
      <span class="decor-art">${open ? SKY_ART[l.id] ?? '✨' : '🔒'}</span><span>${escapeHtml(l.name)}</span><span class="small muted">${open ? (fire.sky === l.id ? 'Overhead now' : 'Unlocked') : `At ${l.hours} hours`}</span></button>`;
  };
  const canToast = mine.hours >= mine.marshmallowHours;
  modal(`<h2>By the fire</h2>
    <p class="muted">You've spent <b>${hoursText(mine.hours)}</b> at fires. More time there unlocks more to keep by your seat, which everyone at the fire sees.</p>
    <div class="decor-grid" id="decor-items">
      <button type="button" class="decor-pick${mine.item || petOut ? '' : ' chosen'}" data-item="" aria-pressed="${!mine.item && !petOut}"><span class="decor-art">·</span><span>Nothing</span><span class="small muted">Just you</span></button>
      ${mine.items.map(item).join('')}
    </div>
    <div class="admin-row"><button type="button" class="btn secondary" id="decor-toast" ${canToast && state.voice ? '' : 'disabled'}>🍡 Toast a marshmallow</button>
      <span class="small muted">${canToast ? (state.voice ? 'Or click the fire.' : 'Sit down at a fire first.') : `Marshmallows unlock after ${mine.marshmallowHours} hours at the fire.`}</span></div>
    ${pets ? `<h3>Premium pets</h3>
      <p class="small muted">Bought with chips from ${escapeHtml(hearth.name)}'s casino (you have <b>${pets.chips.toLocaleString()}</b> there). They're yours in ${escapeHtml(hearth.name)} only, and sit by your seat at its fires.</p>
      <div class="decor-grid" id="decor-pets">${pets.pets.map(pet).join('')}</div>
      <h3>Seats</h3>
      <p class="small muted">What you sit on at ${escapeHtml(hearth.name)}'s fires. Two are free; the rest are bought with its chips.</p>
      <div class="decor-grid" id="decor-seats">${pets.seats.map(seatPick).join('')}</div>
      <h3>Backgrounds</h3>
      <p class="small muted">Scenes behind ${escapeHtml(hearth.name)}'s fires, bought with its chips. The one you pick shows for you.</p>
      <div class="decor-grid backdrop-grid" id="decor-backdrops">${pets.backdrops.map(backdrop).join('')}</div>
      ${pets.canPutUp ? `<label class="admin-row bd-hearth-row small"><span>For everyone at ${escapeHtml(hearth.name)}'s fires:</span>
        <select id="decor-bd-hearth"><option value="">No background</option>${pets.backdrops.filter((b) => pets.myBackdrops.includes(b.id) || pets.hearthBackdrop === b.id).map((b) => `<option value="${b.id}" ${pets.hearthBackdrop === b.id ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('')}</select></label>` : ''}` : ''}
    ${fire ? `<h3>${escapeHtml(hearth.name)}'s fire</h3>
      <p class="small muted">Everyone's time around ${escapeHtml(hearth.name)}'s fires together: <b>${hoursText(fire.hours)}</b>. ${fire.canChange ? 'Pick how its fires burn.' : 'People who can edit the hearth pick how its fires burn.'}</p>
      <div class="decor-grid" id="decor-looks">${fire.looks.map(look).join('')}</div>
      <h3>The sky above</h3>
      <div class="decor-grid" id="decor-skies">${fire.skies.map(sky).join('')}</div>` : ''}`, 'decor-modal');
  /** Puts a premium pet out in this hearth (or away, with null). */
  const setPet = (id) => {
    const me = hearth.members?.find((m) => m.id === state.me.id);
    if (me) me.pet = id;
  };
  for (const b of document.querySelectorAll('#decor-items [data-item]')) b.onclick = async () => {
    try {
      const r = await api('/api/me/fire', { method: 'PUT', body: { item: b.dataset.item || null } });
      state.me.fireItem = r.item;
      if (petOut) {
        await api(`/api/servers/${hearth.id}/casino/pet`, { method: 'PUT', body: { pet: null } });
        setPet(null);
      }
      renderFire();
      openFireDecor();
    } catch (err) { alertError(err); }
  };
  for (const b of document.querySelectorAll('#decor-pets [data-pet]')) b.onclick = async () => {
    try {
      const r = await api(`/api/servers/${hearth.id}/casino/pet`, { method: 'PUT', body: { pet: b.dataset.pet } });
      setPet(r.pet);
      renderFire();
      openFireDecor();
    } catch (err) { alertError(err); }
  };
  for (const b of document.querySelectorAll('#decor-pets [data-pet-buy]')) b.onclick = async () => {
    const p = pets.pets.find((x) => x.id === b.dataset.petBuy);
    if (!(await askConfirm(`Buy ${p.name.toLowerCase()} for ${p.price.toLocaleString()} chips from ${hearth.name}'s casino?`))) return;
    try {
      const r = await api(`/api/servers/${hearth.id}/casino/pets/${p.id}`, { method: 'POST', body: {} });
      setPet(r.pet);
      if (typeof setWallet === 'function') setWallet(r.wallet, hearth.id);
      renderFire();
      openFireDecor();
    } catch (err) { alertError(err); }
  };
  /** Sits you on a seat in this hearth. */
  const setSeat = (id) => {
    const me = hearth.members?.find((m) => m.id === state.me.id);
    if (me) me.seat = id;
  };
  for (const b of document.querySelectorAll('#decor-seats [data-seat]')) b.onclick = async () => {
    try {
      const r = await api(`/api/servers/${hearth.id}/casino/seat`, { method: 'PUT', body: { seat: b.dataset.seat } });
      setSeat(r.seat);
      renderFire();
      openFireDecor();
    } catch (err) { alertError(err); }
  };
  for (const b of document.querySelectorAll('#decor-seats [data-seat-buy]')) b.onclick = async () => {
    const x = pets.seats.find((y) => y.id === b.dataset.seatBuy);
    if (!(await askConfirm(`Buy the ${x.name.toLowerCase()} for ${x.price.toLocaleString()} chips from ${hearth.name}'s casino?`))) return;
    try {
      const r = await api(`/api/servers/${hearth.id}/casino/seats/${x.id}`, { method: 'POST', body: {} });
      setSeat(r.seat);
      if (typeof setWallet === 'function') setWallet(r.wallet, hearth.id);
      renderFire();
      openFireDecor();
    } catch (err) { alertError(err); }
  };
  for (const el of document.querySelectorAll('[data-bd-art]')) el.style.background = backdropCss(el.dataset.bdArt);
  for (const b of document.querySelectorAll('#decor-backdrops [data-bd]')) b.onclick = async () => {
    try {
      const r = await api(`/api/servers/${hearth.id}/casino/backdrop`, { method: 'PUT', body: { backdrop: pets.backdrop === b.dataset.bd ? null : b.dataset.bd } });
      hearth.myBackdrop = r.backdrop;
      renderFire();
      openFireDecor();
    } catch (err) { alertError(err); }
  };
  for (const b of document.querySelectorAll('#decor-backdrops [data-bd-buy]')) b.onclick = async () => {
    const bd = pets.backdrops.find((x) => x.id === b.dataset.bdBuy);
    if (!(await askConfirm(`Buy the ${bd.name} background for ${bd.price.toLocaleString()} chips from ${hearth.name}'s casino?`))) return;
    try {
      const r = await api(`/api/servers/${hearth.id}/casino/backdrops/${bd.id}`, { method: 'POST', body: {} });
      hearth.myBackdrop = r.backdrop;
      if (typeof setWallet === 'function') setWallet(r.wallet, hearth.id);
      renderFire();
      openFireDecor();
    } catch (err) { alertError(err); }
  };
  const putUp = $('#decor-bd-hearth');
  if (putUp) putUp.onchange = async () => {
    try {
      const r = await api(`/api/servers/${hearth.id}/casino/backdrop`, { method: 'PUT', body: { backdrop: putUp.value || null, hearth: true } });
      hearth.backdrop = r.hearthBackdrop;
      renderFire();
      openFireDecor();
    } catch (err) { alertError(err); }
  };
  for (const b of document.querySelectorAll('#decor-looks [data-look]')) b.onclick = async () => {
    try {
      await api(`/api/servers/${hearth.id}/fire`, { method: 'PUT', body: { look: b.dataset.look } });
      hearth.fireLook = b.dataset.look;
      renderFire();
      openFireDecor();
    } catch (err) { alertError(err); }
  };
  for (const b of document.querySelectorAll('#decor-skies [data-sky]')) b.onclick = async () => {
    try {
      await api(`/api/servers/${hearth.id}/fire`, { method: 'PUT', body: { sky: b.dataset.sky } });
      hearth.skyLook = b.dataset.sky;
      renderFire();
      openFireDecor();
    } catch (err) { alertError(err); }
  };
  $('#decor-toast').onclick = () => { closeModal(); toastMarshmallow(); };
}
$('#fire-decor').onclick = openFireDecor;

// ---------------------------------------------------------------- marshmallows

async function toastMarshmallow() {
  if (!state.voice) return;
  try {
    await api('/api/voice/marshmallow', { method: 'POST', body: {} });
  } catch (err) {
    fireNote(err.message);
  }
}
$('#fire-ring .fire-core').addEventListener('click', toastMarshmallow);

const MARSHMALLOW_LINES = {
  golden: (n, me) => `${me ? 'You' : n} toasted a golden marshmallow`,
  perfect: (n, me) => `${me ? 'You' : n} toasted a perfect marshmallow ✨`,
  burnt: (n, me) => `${me ? 'Your' : `${n}'s`} marshmallow caught fire 🔥`,
  dropped: (n, me) => `${me ? 'You dropped your' : `${n} dropped their`} marshmallow in the fire`,
  sticky: (n, me) => `${me ? 'You have' : `${n} has`} marshmallow all over ${me ? 'your' : 'their'} fingers`,
};
function onMarshmallow(ev) {
  if (state.voice?.channelId !== ev.channelId) return;
  fireNote((MARSHMALLOW_LINES[ev.outcome] ?? MARSHMALLOW_LINES.golden)(nameOf(ev.userId), ev.userId === state.me.id));
  // A marshmallow on a stick over the flame, toasting to how it turned out.
  const m = $('#marshmallow');
  m.className = `marshmallow ${ev.outcome}`;
  void m.offsetWidth; // start the animation again
  m.classList.add('go');
}

// ---------------------------------------------------------------- birthdays

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const birthdayText = (b) => `${Number(b.slice(3))} ${MONTHS[Number(b.slice(0, 2)) - 1]}`;
/** Whether it's their birthday where you are. 29 February is celebrated on the 28th in other years. */
function isBirthdayToday(b) {
  if (!b) return false;
  const now = new Date();
  const today = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const leap = new Date(now.getFullYear(), 1, 29).getMonth() === 1;
  return b === today || (b === '02-29' && !leap && today === '02-28');
}

/** The birthday picker in your profile. */
function birthdayField(b) {
  const month = b ? Number(b.slice(0, 2)) : 0, day = b ? Number(b.slice(3)) : 0;
  return `<div class="birthday-row">
      <label>Birthday<select id="profile-bday-month"><option value="">Month</option>${MONTHS.map((m, i) => `<option value="${i + 1}" ${month === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <label><span class="sr-only">Day</span><select id="profile-bday-day"><option value="">Day</option>${Array.from({ length: 31 }, (_, i) => `<option ${day === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
    </div>
    <span class="small muted">Only the month and day. People in your hearths see a 🎂 by your name that day.</span>`;
}
function readBirthday() {
  const m = $('#profile-bday-month').value, d = $('#profile-bday-day').value;
  return m && d ? `${m.padStart(2, '0')}-${d.padStart(2, '0')}` : null;
}

// ---------------------------------------------------------------- the hearth today: birthdays and the message of the day

const dayNumber = () => {
  const now = new Date();
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 864e5);
};
const todayKey = () => new Date().toDateString();

function renderToday(s) {
  const box = $('#hearth-today');
  if (!s || isDm(s)) return box.classList.add('hidden');
  const parts = [];
  const birthdays = (s.members ?? []).filter((m) => !m.deleted && isBirthdayToday(m.birthday));
  for (const m of birthdays.slice(0, 3)) {
    const mine = m.id === state.me.id;
    parts.push(`<div class="today-birthday"><span class="today-cake" aria-hidden="true">🎂</span><span>${mine ? '<b>Happy birthday!</b> from everyone here' : `It's <b>${escapeHtml(nameOfPerson(m))}</b>'s birthday today`}</span>
      ${mine ? '' : `<button type="button" class="btn secondary tiny-btn" data-wish="${m.id}">Wish them well</button>`}</div>`);
  }
  if (birthdays.length > 3) parts.push(`<div class="small muted">and ${birthdays.length - 3} more birthdays today</div>`);
  const motd = s.motd ?? [];
  const hidden = store.get(`motdHidden:${s.id}`) === todayKey();
  if (motd.length && !hidden) {
    const m = motd[dayNumber() % motd.length];
    parts.push(`<div class="today-motd">
        ${m.picture ? `<button type="button" class="today-photo" title="Open the photo"><img src="${escapeHtml(state.serverUrl + m.picture)}" alt="" loading="lazy" /></button>` : ''}
        ${m.text ? `<p>${escapeHtml(m.text)}</p>` : ''}
        <button type="button" class="icon-btn today-hide" title="Hide until tomorrow" aria-label="Hide until tomorrow">✕</button>
      </div>`);
  }
  const month = new Date().getMonth();
  if (month === 11 || month === 0) {
    const year = month === 11 ? new Date().getFullYear() : new Date().getFullYear() - 1;
    parts.push(`<button type="button" class="today-review" data-year="${year}">✨ ${escapeHtml(s.name)}'s ${year} in review</button>`);
  }
  box.classList.toggle('hidden', !parts.length);
  box.innerHTML = parts.join('');
  for (const b of box.querySelectorAll('[data-wish]')) b.onclick = () => wishHappyBirthday(s, Number(b.dataset.wish));
  box.querySelector('.today-hide')?.addEventListener('click', () => { store.set(`motdHidden:${s.id}`, todayKey()); renderToday(s); });
  box.querySelector('.today-photo')?.addEventListener('click', () => {
    const m = motd[dayNumber() % motd.length];
    window.open(state.serverUrl + m.picture, '_blank', 'noopener');
  });
  box.querySelector('.today-review')?.addEventListener('click', (e) => openYearReview(s.id, Number(e.currentTarget.dataset.year)));
}

/** Goes to the hearth's welcome room (or the first room you can write in) with a wish ready to send. */
async function wishHappyBirthday(s, userId) {
  const m = s.members.find((x) => x.id === userId);
  const writable = s.channels.filter((c) => c.kind === 'text' && !c.archived && c.canPost !== false);
  const room = writable.find((c) => c.id === s.welcomeChannelId) ?? writable[0];
  if (!room || !m) return;
  if (state.channelId !== room.id) await selectChannel(room.id);
  input.value = `Happy birthday @${m.username}! 🎂`;
  autosize();
  input.focus();
}

// Managing the messages of the day, for people who can edit the hearth.
function openMotd(serverId) {
  const s = state.servers.get(serverId);
  if (!s) return closeModal();
  const list = s.motd ?? [];
  modal(`<h2>Message of the day</h2>
    <p class="small muted">A line or a photo at the top of ${escapeHtml(s.name)}, a different one each day, in turn. Everyone sees today's above the rooms.</p>
    <ul class="motd-list">${list.map((m, i) => `<li data-id="${m.id}">
        ${m.picture ? `<img src="${escapeHtml(state.serverUrl + m.picture)}" alt="" />` : ''}
        <span class="motd-text">${m.text ? escapeHtml(m.text) : '<span class="muted">Just the photo</span>'}${i === dayNumber() % list.length ? ' <span class="small muted">· today</span>' : ''}</span>
        <button type="button" class="btn secondary tiny-btn" data-edit="${m.id}">Edit</button>
        <button type="button" class="icon-btn" data-delete="${m.id}" title="Delete" aria-label="Delete">✕</button>
      </li>`).join('') || '<li class="small muted">None yet. Add a joke, a quote, a reminder or a favourite photo.</li>'}</ul>
    <form id="motd-new">
      <input id="motd-text" maxlength="200" placeholder="Write a message of the day" />
      <div class="admin-row">
        <button type="submit" class="btn">Add</button>
        ${state.maxUploadBytes ? '<button type="button" class="btn secondary" id="motd-photo">Add with a photo</button><input type="file" id="motd-file" accept="image/png,image/jpeg,image/gif,image/webp" hidden />' : ''}
      </div>
      <div class="error" id="motd-error"></div>
    </form>`, 'motd-modal');
  const done = (r) => { s.motd = r.motd; renderToday(state.servers.get(state.serverId) === s ? s : null); openMotd(serverId); };
  const fail = (err) => { $('#motd-error').textContent = err.message; };
  $('#motd-new').onsubmit = async (e) => {
    e.preventDefault();
    try { done(await api(`/api/servers/${serverId}/motd`, { method: 'POST', body: { text: $('#motd-text').value } })); } catch (err) { fail(err); }
  };
  $('#motd-photo')?.addEventListener('click', () => $('#motd-file').click());
  $('#motd-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    $('#motd-photo').disabled = true;
    $('#motd-photo').textContent = 'Uploading…';
    try {
      done(await uploadPicture(`/api/servers/${serverId}/motd/picture?text=${encodeURIComponent($('#motd-text').value)}`, await fitPicture(file, 1280)));
    } catch (err) {
      fail(err);
      $('#motd-photo').disabled = false;
      $('#motd-photo').textContent = 'Add with a photo';
    }
  });
  for (const b of document.querySelectorAll('.motd-list [data-delete]')) b.onclick = async () => {
    try { done(await api(`/api/motd/${b.dataset.delete}`, { method: 'DELETE' })); } catch (err) { fail(err); }
  };
  for (const b of document.querySelectorAll('.motd-list [data-edit]')) b.onclick = async () => {
    const m = list.find((x) => x.id === Number(b.dataset.edit));
    const text = await askText('Edit message of the day', m.text);
    if (text === null) return;
    try { done(await api(`/api/motd/${m.id}`, { method: 'PATCH', body: { text } })); } catch (err) { fail(err); }
  };
}

// ---------------------------------------------------------------- the year in review

async function openYearReview(serverId, year = new Date().getFullYear()) {
  const s = state.servers.get(serverId);
  if (!s) return;
  let r;
  try { r = await api(`/api/servers/${serverId}/review/${year}`); } catch (err) { return alertError(err); }
  const n = (x) => Number(x).toLocaleString();
  const day = r.busiestDay ? new Date(`${r.busiestDay.day}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) : null;
  const list = (items, line) => items.length ? `<ol class="review-list">${items.map(line).join('')}</ol>` : '<p class="small muted">Nothing yet.</p>';
  const empty = !r.messages && r.fireHours < 0.05;
  modal(`<div class="review-head">
      <span class="review-kicker">${escapeHtml(s.name)}</span>
      <h2>${year} in review</h2>
      ${r.years.length > 1 ? `<select id="review-year" aria-label="Year">${r.years.map((y) => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select>` : ''}
    </div>
    ${empty ? '<p class="muted">Nothing to look back on yet.</p>' : `
    <div class="review-stats">
      <div><b>${n(r.messages)}</b><span>messages</span></div>
      <div><b>${r.fireHours < 1 ? Math.round(r.fireHours * 60) : n(Math.round(r.fireHours))}</b><span>${r.fireHours < 1 ? 'minutes' : 'hours'} around the fire</span></div>
      <div><b>${n(r.newPeople)}</b><span>new ${r.newPeople === 1 ? 'face' : 'faces'}</span></div>
    </div>
    <div class="review-grid">
      <section><h3>Busiest rooms</h3>${list(r.topRooms, (x) => `<li><span>#${escapeHtml(x.name)}</span><span class="muted">${n(x.messages)}</span></li>`)}</section>
      <section><h3>Favourite reactions</h3>${r.topReactions.length ? `<div class="review-emoji">${r.topReactions.map((x) => `<span title="${n(x.n)} times">${emojiHtml(x.emoji)}<small>${n(x.n)}</small></span>`).join('')}</div>` : '<p class="small muted">No reactions yet.</p>'}</section>
      <section><h3>Most talkative</h3>${list(r.topPeople, (x) => `<li><span>${escapeHtml(x.name)}</span><span class="muted">${n(x.n)}</span></li>`)}</section>
      <section><h3>Keepers of the fire</h3>${list(r.topFire, (x) => `<li><span>${escapeHtml(x.name)}</span><span class="muted">${hoursText(x.hours)}</span></li>`)}</section>
    </div>
    ${r.mostLoved ? `<section class="review-loved"><h3>Most loved message</h3><blockquote>${escapeHtml(r.mostLoved.content)}</blockquote><span class="small muted">${escapeHtml(r.mostLoved.author)} · ${n(r.mostLoved.reactions)} reactions</span></section>` : ''}
    ${day ? `<p class="small muted">The busiest day was ${escapeHtml(day)}, with ${n(r.busiestDay.n)} messages.</p>` : ''}
    <section class="review-you"><h3>You</h3><p>${n(r.you.messages)} messages, ${n(r.you.reactions)} reactions and ${hoursText(r.you.fireHours)} at the fire.</p></section>`}`, 'review-modal');
  $('#review-year')?.addEventListener('change', (e) => openYearReview(serverId, Number(e.target.value)));
}

// ---------------------------------------------------------------- best of and the photo album

/** Messages enough people put 🔥 on, newest first. */
async function openBestOf(serverId) {
  const s = state.servers.get(serverId);
  if (!s) return;
  modal(`<h2>Best of ${escapeHtml(s.name)}</h2><p class="small muted" id="best-note">Messages that get enough 🔥 reactions land here.</p>
    <div id="best-list" class="card-list">${placeholder('cards', 3)}</div>
    <div class="modal-row"><button type="button" class="btn secondary hidden" id="best-more">Show older</button></div>`, 'best-modal');
  let offset = 0;
  const more = async (first) => {
    let r;
    try { r = await api(`/api/servers/${serverId}/best-of?offset=${offset}`); } catch (err) { if ($('#best-list')) $('#best-list').textContent = err.message; return; }
    const list = $('#best-list');
    if (!list) return;
    $('#best-note').textContent = `Messages that ${r.needs} or more people put 🔥 on land here.`;
    if (first && !r.results.length) return (list.innerHTML = emptyNote('Nothing yet', `React 🔥 to a message you love. Once ${r.needs} people do, it's kept here.`));
    const cards = r.results.map((x) => messageCard(x.message, x.place, { onOpen: () => { closeModal(); jumpTo(x.message.channelId, x.message.id); } }));
    first ? list.replaceChildren(...cards) : list.append(...cards);
    offset += r.results.length;
    $('#best-more').classList.toggle('hidden', !r.more);
  };
  $('#best-more').onclick = (e) => { e.target.disabled = true; more(false).finally(() => (e.target.disabled = false)); };
  more(true);
}

/** Every picture and video shared in a hearth, by month. */
async function openAlbum(serverId) {
  const s = state.servers.get(serverId);
  if (!s) return;
  modal(`<h2>${escapeHtml(s.name)} photo album</h2>
    <div id="album">${placeholder('grid', 12)}</div>
    <div class="modal-row"><button type="button" class="btn secondary hidden" id="album-more">Show older</button></div>`, 'album-modal');
  $('#modal-card').classList.add('wide');
  let before = 0;
  let month = '';
  const box = $('#album');
  const items = [];
  const more = async (first) => {
    let r;
    try { r = await api(`/api/servers/${serverId}/album${before ? `?before=${before}` : ''}`); } catch (err) { box.textContent = err.message; return; }
    if (first) box.replaceChildren();
    if (first && !r.items.length) return (box.innerHTML = emptyNote('No pictures yet', 'Pictures and videos shared in this hearth show up here.'));
    let grid = box.lastElementChild?.classList.contains('album-grid') ? box.lastElementChild : null;
    for (const a of r.items) {
      const m = new Date(a.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      if (m !== month) {
        month = m;
        box.insertAdjacentHTML('beforeend', `<h3 class="album-month">${escapeHtml(m)}</h3><div class="album-grid"></div>`);
        grid = box.lastElementChild;
      }
      const url = state.serverUrl + a.url;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'album-item';
      b.dataset.i = String(items.push(a) - 1);
      b.setAttribute('aria-label', a.alt || a.name);
      b.innerHTML = a.type.startsWith('video/')
        ? (a.thumb ? `<img loading="lazy" alt="" src="${escapeHtml(state.serverUrl + a.thumb)}" />` : '') + '<span class="album-play" aria-hidden="true">▶</span>'
        : `<img loading="lazy" alt="" src="${escapeHtml(a.thumb ? state.serverUrl + a.thumb : url)}" />`;
      grid.append(b);
    }
    before = r.items.at(-1)?.messageId ?? before;
    $('#album-more').classList.toggle('hidden', !r.more);
  };
  box.onclick = (e) => {
    const b = e.target.closest('.album-item');
    if (!b) return;
    const a = items[Number(b.dataset.i)];
    if (a.type.startsWith('video/')) { closeModal(); jumpTo(a.channelId, a.messageId); return; }
    // Closing the picture goes back to the album, where you were in it.
    const card = $('#modal-card');
    // On a computer the settings pane scrolls, on a phone the card. The album opens from Hearth
    // settings, so its frame comes back with it, or its side menu would do nothing.
    const pane = card.querySelector('.settings-pane');
    const album = { kind: card.className, nodes: [...card.childNodes], scroll: card.scrollTop, paneScroll: pane?.scrollTop ?? 0, frame: settingsFrame };
    let leaving = false;
    openImage(a, state.serverUrl + a.url);
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'btn secondary';
    go.textContent = 'Go to message';
    go.onclick = () => { leaving = true; closeModal(); jumpTo(a.channelId, a.messageId); };
    $('#modal-card .lightbox .modal-row')?.prepend(go);
    onModalClose = () => setTimeout(() => {
      // Not if you left for the message, or something else opened in its place.
      // Nor after jumping to a message from a notification or reminder.
      if (leaving || performance.now() - lastJumpAt < 1000 || !$('#modal').classList.contains('hidden')) return;
      settingsFrame = album.frame;
      placeLayer('#modal');
      card.className = album.kind;
      card.replaceChildren(...album.nodes);
      $('#modal').classList.remove('hidden');
      $('#modal').setAttribute('aria-label', card.querySelector('h2')?.textContent.trim() || 'Dialog');
      card.scrollTop = album.scroll;
      if (pane) pane.scrollTop = album.paneScroll;
    });
  };
  $('#album-more').onclick = (e) => { e.target.disabled = true; more(false).finally(() => (e.target.disabled = false)); };
  more(true);
}

/** Someone in a hearth put a premium pet out (or away): it shows by their seat at its fires. */
function onCasinoBackdrop(ev) {
  const s = state.servers.get(ev.serverId);
  if (s) s.myBackdrop = ev.backdrop;
  if (state.voice) renderFire();
}
function onCasinoPet(ev) {
  const m = state.servers.get(ev.serverId)?.members?.find((x) => x.id === ev.userId);
  if (m) m.pet = ev.pet;
  if (state.voice) renderFire();
}
function onCasinoSeat(ev) {
  const m = state.servers.get(ev.serverId)?.members?.find((x) => x.id === ev.userId);
  if (m) m.seat = ev.seat;
  if (state.voice) renderFire();
}

// ---------------------------------------------------------------- Home
// One page for what's happening across every hearth: who's at a fire, what's for you, what's
// unread, today's events and birthdays, and which friends are around. Everything comes from what
// the app already knows, so it opens at once and keeps itself up to date.

const HOME_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.5 11h2.7v9.5h5.3v-6h3v6h5.3V11h2.7L12 3Z"/></svg>';

function openHome() {
  closeSwitcher();
  state.atHome = true;
  $('#app').classList.add('at-home');
  $('#home-view').classList.remove('hidden');
  renderServers();
  renderHome();
  showView('chat');
}
function closeHome() {
  if (!state.atHome) return;
  state.atHome = false;
  $('#app').classList.remove('at-home');
  $('#home-view').classList.add('hidden');
}

// ---- a new friend's first week: a few steps on Home that make Peiskos feel like theirs. Each ticks
// itself off when done, and the list goes once they're all done, after a week, or when hidden.
const FIRST_WEEK_MS = 7 * 864e5;
let firstWeekAsked = null; // the account it was asked for
// Per account: someone else logging in on this device hasn't said hi yet.
const saidKey = () => `firstWeekSaid:${state.me?.id}`;
function firstWeekSteps() {
  const hearth = state.serverOrder.map((id) => state.servers.get(id)).find(Boolean);
  return [
    { id: 'picture', label: 'Add a profile picture', done: !!state.me.avatar, run: () => openAccount('profile') },
    { id: 'say', label: 'Say hi in a room', done: store.get(saidKey()) === '1', run: () => hearth && selectServer(hearth.id).then(() => showView('chat')) },
    state.voiceEnabled && { id: 'fire', label: 'Sit down at a fire', done: store.get('firstWeekFire') === '1', run: () => hearth && selectServer(hearth.id) },
    { id: 'friend', label: 'Add a friend', done: (state.friends?.friends?.length ?? 0) > 0, run: () => openFriends() },
    'Notification' in window && { id: 'alerts', label: 'Turn on alerts', done: Notification.permission !== 'default', run: () => Notification.requestPermission().then(renderHome) },
  ].filter(Boolean);
}
function firstWeekHtml() {
  const joined = state.me?.joinedAt;
  if (!joined || Date.now() - joined > FIRST_WEEK_MS || store.get('firstWeekHidden') === '1') return '';
  const steps = firstWeekSteps();
  const left = steps.filter((x) => !x.done).length;
  if (!left) return '';
  // You may have said hi from another device: ask once whether there's anything of yours.
  if (store.get(saidKey()) !== '1' && firstWeekAsked !== state.me.id) {
    firstWeekAsked = state.me.id;
    api(`/api/search?from=${state.me.id}`).then((r) => {
      if (!r.results?.length) return;
      store.set(saidKey(), '1');
      if (state.atHome) renderHome(); else renderServers(); // the Home dot goes too
    }).catch(() => {});
  }
  const rows = steps.map((x) => `<li><button type="button" class="home-row first-week-step${x.done ? ' done' : ''}" data-first-week="${x.id}" ${x.done ? 'disabled' : ''}>
    <span class="home-main"><span class="first-week-tick" aria-hidden="true"></span>${escapeHtml(x.label)}</span>${x.done ? '<span class="small muted">Done</span>' : ''}</button></li>`);
  return `<section class="home-section first-week"><h3>Getting started · ${steps.length - left} of ${steps.length}</h3><ul>${rows.join('')}</ul>
    <button type="button" class="link-btn small" id="first-week-hide">Hide this</button></section>`;
}
function wireFirstWeek(view) {
  const steps = firstWeekSteps();
  view.querySelectorAll('[data-first-week]').forEach((b) => (b.onclick = () => steps.find((x) => x.id === b.dataset.firstWeek)?.run()));
  const hide = view.querySelector('#first-week-hide');
  if (hide) hide.onclick = () => { store.set('firstWeekHidden', '1'); renderHome(); };
}

function renderHome() {
  const hearths = state.serverOrder.map((id) => state.servers.get(id)).filter(Boolean);
  const section = (title, items) => (items.length ? `<section class="home-section"><h3>${escapeHtml(title)}</h3><ul>${items.join('')}</ul></section>` : '');
  const row = (data, main, sub, button = '') =>
    `<li><button type="button" class="home-row" ${data}><span class="home-main">${main}</span><span class="small muted">${sub}</span></button>${button}</li>`;

  // Fires with people at them.
  const fires = hearths.flatMap((s) => s.channels.filter((c) => c.kind === 'voice' && c.voiceUsers?.length).map((c) => {
    const names = c.voiceUsers.map((id) => nameOfPerson(s.members.find((m) => m.id === id))).filter(Boolean);
    const here = state.voice?.channelId === c.id;
    return row(`data-hearth="${s.id}"`, escapeHtml(names.slice(0, 3).join(', ') + (names.length > 3 ? ` and ${names.length - 3} more` : '')),
      `${escapeHtml(fireName(c))} in ${escapeHtml(s.name)}`,
      here ? '<span class="small muted home-side">You\'re here</span>' : state.voiceEnabled ? `<button type="button" class="btn tiny-btn home-side" data-join="${c.id}">Join</button>` : '');
  }));

  // Mentions and replies waiting, room by room; then rooms with anything new.
  const rooms = [...hearths, ...state.dmOrder.map((id) => state.servers.get(id))].filter(Boolean)
    .flatMap((s) => [...s.channels, ...(s.threads ?? [])].map((c) => ({ s, c })));
  const placeName = ({ s, c }) => (isDm(s) ? escapeHtml(dmTitle(s)) : `#${escapeHtml(c.name)} <span class="muted">in ${escapeHtml(s.name)}</span>`);
  const forYou = rooms.filter(({ s, c }) => c.mentions && notifyState(s, c).level !== 'none')
    .map((r) => row(`data-room="${r.c.id}"`, placeName(r), `${r.c.mentions} for you`));
  const unread = rooms.filter(({ s, c }) => !c.mentions && isUnread(c) && roomLoud(s, c))
    .map((r) => row(`data-room="${r.c.id}"`, placeName(r), `${r.c.unread > 99 ? '99+' : r.c.unread} new`));

  // Today: events starting in the next day, and birthdays.
  const soon = Date.now() + 24 * 3600e3;
  const today = [
    ...hearths.flatMap((s) => (s.events ?? []).filter((e) => e.startsAt <= soon).map((e) =>
      row(`data-event="${s.id}:${e.id}"`, escapeHtml(e.title), `${e.startsAt <= Date.now() ? 'Happening now' : escapeHtml(formatTime(new Date(e.startsAt), { short: true }))} · ${escapeHtml(s.name)}`))),
    ...[...new Map(hearths.flatMap((s) => s.members.filter((m) => !m.deleted && m.id !== state.me.id && isBirthdayToday(m.birthday)).map((m) => [m.id, m]))).values()]
      .map((m) => row(`data-person="${m.id}"`, `${escapeHtml(nameOfPerson(m))}'s birthday`, 'Today')),
  ];

  // Coming up: what you're going to (or might) in the next two weeks, after today's.
  const comingUp = hearths.flatMap((s) => (s.events ?? [])
    .filter((e) => e.startsAt > soon && e.startsAt < Date.now() + 14 * 864e5 && ['going', 'maybe'].includes(e.rsvps.find((r) => r.userId === state.me.id)?.status))
    .map((e) => ({ s, e })))
    .sort((a, b) => a.e.startsAt - b.e.startsAt)
    .map(({ s, e }) => row(`data-event="${s.id}:${e.id}"`, escapeHtml(e.title), `${escapeHtml(countdown(e.startsAt))} · ${escapeHtml(s.name)}`));

  // Friends who are around.
  const friends = (state.friends?.friends ?? []).filter((f) => f.online)
    .map((f) => row(`data-dm="${f.id}"`, `<span class="avatar home-av" data-av="${f.id}"></span><span class="home-name">${escapeHtml(nameOfPerson(f))}</span>`, presenceLine(f) || escapeHtml(STATUS_LABELS[statusOf(f)])));

  // Every hearth at a glance: who's on, and whether anything is waiting there.
  const cards = hearths.map((s) => {
    const online = s.members.filter((m) => m.online && !m.deleted).length;
    const mentions = [...s.channels, ...(s.threads ?? [])].reduce((n, c) => n + (c.mentions || 0), 0);
    const lit = s.channels.some((c) => c.kind === 'voice' && c.voiceUsers?.length);
    const badge = mentions ? `<span class="home-badge">${mentions > 99 ? '99+' : mentions}</span>` : serverUnread(s) ? '<span class="home-dot" aria-label="New messages"></span>' : '';
    return `<li><button type="button" class="home-hearth" data-hearth="${s.id}"><span data-tile="${s.id}"></span>
      <span class="home-hearth-text"><b>${escapeHtml(s.name)}</b><span class="small muted">${online} online${lit ? ' · fire lit' : ''}</span></span>${badge}</button></li>`;
  });

  const main = [
    firstWeekHtml(),
    section('At a fire now', fires),
    section('For you', forYou),
    section('New messages', unread.slice(0, 12)),
  ].join('');
  const side = [
    section('Today', today),
    section('Coming up', comingUp.slice(0, 6)),
    friends.length ? section('Friends online', friends)
      : `<section class="home-section"><h3>Friends online</h3><div class="empty-note home-quiet"><span>${(state.friends?.friends ?? []).length ? 'None of your friends are online right now.' : 'Add friends to see when they\'re around.'}</span>
        <button type="button" class="btn secondary tiny-btn" id="home-friends">Friends</button></div></section>`,
  ].join('');
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const view = $('#home-view');
  view.innerHTML = `<header class="home-head"><div><h2>${greeting}, ${escapeHtml(state.me.displayName || state.me.username)}</h2>
      <p class="muted home-date">${escapeHtml(new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))}</p></div>
      ${unread.length || forYou.length ? '<button type="button" class="btn secondary tiny-btn" id="home-read-all">Mark everything as read</button>' : ''}</header>
    ${cards.length ? `<section class="home-section"><h3>Your hearths</h3><ul class="home-hearths">${cards.join('')}</ul></section>` : ''}
    <div class="home-cols${side ? '' : ' single'}">
      <div class="home-col">${main || '<div class="empty-note home-quiet"><b>Nothing new</b><span>No unread messages, mentions or fires right now.</span></div>'}</div>
      ${side ? `<div class="home-col">${side}</div>` : ''}
    </div>`;
  view.querySelectorAll('[data-tile]').forEach((el) => { const h = state.servers.get(Number(el.dataset.tile)); if (h) el.replaceWith(burrowTile(h)); });
  view.querySelectorAll('[data-av]').forEach((el) => {
    const f = (state.friends?.friends ?? []).find((x) => x.id === Number(el.dataset.av));
    if (f) setAvatar(el, f.username, avatarOf(f.id, f.avatar));
  });
  view.querySelectorAll('[data-room]').forEach((b) => (b.onclick = () => { const w = roomById(Number(b.dataset.room)); if (w) selectServer(w.s.id, false, { channelId: w.c.id }).then(() => showView('chat')); }));
  view.querySelectorAll('[data-hearth]').forEach((b) => (b.onclick = () => selectServer(Number(b.dataset.hearth))));
  view.querySelectorAll('[data-join]').forEach((b) => (b.onclick = () => joinVoice(Number(b.dataset.join))));
  view.querySelectorAll('[data-event]').forEach((b) => (b.onclick = () => { const [s, e] = b.dataset.event.split(':').map(Number); openEvent(s, e); }));
  view.querySelectorAll('[data-person]').forEach((b) => (b.onclick = () => openPersonById(Number(b.dataset.person))));
  view.querySelectorAll('[data-dm]').forEach((b) => (b.onclick = () => openDm(Number(b.dataset.dm))));
  wireFirstWeek(view);
  view.querySelector('#home-friends')?.addEventListener('click', () => openFriends());
  const all = $('#home-read-all');
  if (all) all.onclick = () => { for (const s of state.servers.values()) if (serverUnread(s) || [...s.channels, ...(s.threads ?? [])].some((c) => c.mentions)) markServerRead(s); };
}
