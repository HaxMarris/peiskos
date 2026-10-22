// The casino's pictures: playing cards, slot symbols, and the weapons (with their skins) that come out of cases.
// All drawn here, so nothing is borrowed from a real game.

const SUIT_SIGNS = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RANK_SIGNS = { T: '10' };

/** A playing card, face up ("Ah"), or its back ("??"). */
function cardHtml(card, extra = '') {
  if (!card || card === '??') return `<span class="pcard back ${extra}" aria-label="Face-down card"></span>`;
  const rank = RANK_SIGNS[card[0]] ?? card[0];
  const suit = SUIT_SIGNS[card[1]];
  const red = card[1] === 'h' || card[1] === 'd';
  return `<span class="pcard ${red ? 'red' : ''} ${extra}" aria-label="${rank} of ${{ s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' }[card[1]]}"><b>${rank}</b><i>${suit}</i><em>${suit}</em></span>`;
}

const SLOT_ART = {
  cherry: '🍒', lemon: '🍋', bell: '🔔', star: '⭐', diamond: '💎',
  seven: '<span class="sym-seven">7</span>',
  flame: '<span class="logo-mark sym-flame"></span>',
};
const SLOT_NAMES = { cherry: 'Cherry', lemon: 'Lemon', bell: 'Bell', star: 'Star', diamond: 'Diamond', seven: 'Seven', flame: 'Flame' };

const RARITY = {
  milspec: { name: 'Mil-Spec', color: '#4b69ff' },
  restricted: { name: 'Restricted', color: '#8847ff' },
  classified: { name: 'Classified', color: '#d32ce6' },
  covert: { name: 'Covert', color: '#eb4b4b' },
  rare: { name: 'Rare Special', color: '#e4ae39' },
};

// Silhouettes, drawn facing right in a 200 by 80 box.
const WEAPON_SHAPES = {
  rifle: 'M6 36 L30 31 L40 27 L46 27 L50 24 L118 23 L121 19 L133 19 L135 23 L170 23 L171 21 L177 21 L178 24 L194 24 L194 29 L150 30 L148 34 L124 35 L116 54 L103 57 L99 55 L106 36 L86 36 L80 49 L67 49 L70 37 L52 38 L44 41 L14 52 L6 50 Z',
  sniper: 'M4 38 L24 33 L34 28 L56 27 L60 24 L72 24 L74 16 L118 15 L120 24 L130 24 L196 24 L196 28 L134 29 L132 34 L112 35 L106 50 L94 50 L98 36 L76 37 L68 49 L56 49 L58 38 L42 40 L12 54 L4 52 Z M80 12 L114 12 L114 15 L80 15 Z',
  pistol: 'M52 20 L148 20 L150 24 L150 34 L104 35 L101 38 L94 38 L92 35 L86 35 L84 40 L80 64 L56 64 L60 40 L54 35 L50 34 Z M91 38 L100 38 L98 46 L88 46 Z',
  smg: 'M18 30 L44 28 L50 24 L132 23 L135 20 L144 20 L146 24 L172 24 L172 29 L140 30 L138 35 L112 36 L108 60 L96 60 L98 37 L84 37 L78 50 L66 50 L70 38 L52 38 L24 44 L18 42 Z',
  shotgun: 'M4 36 L32 30 L46 26 L120 25 L122 22 L192 22 L192 27 L164 28 L162 33 L132 33 L130 30 L122 30 L120 36 L86 37 L80 48 L68 48 L71 38 L52 40 L14 52 L4 50 Z',
  knife: 'M14 44 C30 34 46 36 62 40 L74 38 C104 30 140 24 190 30 C160 40 120 50 80 52 L66 50 C50 52 34 56 20 54 C10 52 8 48 14 44 Z M22 46 C24 42 32 42 32 46 C30 50 24 50 22 46 Z',
  gloves: 'M60 70 L56 40 C54 34 56 26 62 26 L66 26 L68 12 C69 8 76 8 76 12 L77 26 L80 8 C81 4 88 4 88 8 L88 26 L92 10 C93 6 100 6 100 10 L98 28 L104 16 C106 12 112 13 111 18 L104 44 L102 70 Z M112 70 L108 40 C106 34 108 26 114 26 L118 26 L120 12 C121 8 128 8 128 12 L129 26 L132 8 C133 4 140 4 140 8 L140 26 L144 10 C145 6 152 6 152 10 L150 28 L156 16 C158 12 164 13 163 18 L156 44 L154 70 Z',
};

let artId = 0;
/** The pattern a skin is painted with, for a <defs>. */
function skinPaint(skin, id) {
  const [a, b, c] = skin.colors;
  switch (skin.pattern) {
    case 'fade':
      return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0.4"><stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>`;
    case 'stripes':
      return `<pattern id="${id}" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="14" height="14" fill="${a}"/><rect width="5" height="14" fill="${b}"/><rect x="9" width="1.5" height="14" fill="${c}"/></pattern>`;
    case 'camo':
      return `<pattern id="${id}" width="56" height="40" patternUnits="userSpaceOnUse"><rect width="56" height="40" fill="${a}"/><path d="M4 8 C14 0 26 6 22 14 C18 22 6 20 4 8Z M34 22 C44 14 56 22 50 30 C44 38 30 34 34 22Z" fill="${b}"/><path d="M20 28 C26 24 32 30 28 36 C22 40 16 34 20 28Z M40 2 C46 0 52 6 46 10 C40 12 36 6 40 2Z" fill="${c}"/></pattern>`;
    case 'hex':
      return `<pattern id="${id}" width="18" height="31" patternUnits="userSpaceOnUse"><rect width="18" height="31" fill="${a}"/><path d="M9 0 L18 5 L18 15.5 L9 20.5 L0 15.5 L0 5 Z M9 20.5 L9 31" fill="none" stroke="${b}" stroke-width="1.8"/><circle cx="9" cy="10" r="2" fill="${c}"/></pattern>`;
    case 'flames':
      return `<pattern id="${id}" width="40" height="80" patternUnits="userSpaceOnUse"><rect width="40" height="80" fill="${a}"/><path d="M0 80 C4 60 12 56 10 40 C18 52 20 60 22 48 C26 56 30 62 28 44 C36 56 40 66 40 80Z" fill="${b}"/><path d="M8 80 C10 68 16 64 16 56 C22 66 24 70 26 62 C30 70 32 74 32 80Z" fill="${c}"/></pattern>`;
    case 'marble':
      return `<pattern id="${id}" width="70" height="50" patternUnits="userSpaceOnUse"><rect width="70" height="50" fill="${a}"/><path d="M0 12 C14 4 22 22 38 14 S60 2 70 10 M0 34 C12 26 26 44 42 34 S62 24 70 32" fill="none" stroke="${b}" stroke-width="5" opacity=".85"/><path d="M0 22 C18 18 30 30 46 24 S64 16 70 20" fill="none" stroke="${c}" stroke-width="2"/></pattern>`;
    case 'waves':
      return `<pattern id="${id}" width="60" height="24" patternUnits="userSpaceOnUse"><rect width="60" height="24" fill="${a}"/><path d="M0 8 Q15 0 30 8 T60 8 V14 Q45 22 30 14 T0 14Z" fill="${b}"/><path d="M0 19 Q15 15 30 19 T60 19" fill="none" stroke="${c}" stroke-width="2"/></pattern>`;
    case 'digital':
      return `<pattern id="${id}" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="${a}"/><path d="M0 0h6v6H0z M12 6h6v6h-6z M6 12h6v6H6z M18 18h6v6h-6z" fill="${b}"/><path d="M6 0h6v6H6z M18 6h6v6h-6z M12 18h6v6h-6z" fill="${c}"/></pattern>`;
    case 'carbon':
      return `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="${a}"/><path d="M0 0h4v4H0z M4 4h4v4H4z" fill="${b}"/><path d="M0 0h4v1H0z M4 4h4v1H4z" fill="${c}" opacity=".6"/></pattern>`;
    default:
      return `<linearGradient id="${id}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${a}"/></linearGradient>`;
  }
}

/** A skin's picture: its weapon's shape, painted in the skin. */
function skinArt(skin) {
  const id = `skin-paint-${++artId}`;
  const shine = `skin-shine-${artId}`;
  const shape = WEAPON_SHAPES[skin.kind] ?? WEAPON_SHAPES.rifle;
  return `<svg class="skin-art" viewBox="0 0 200 80" aria-hidden="true"><defs>${skinPaint(skin, id)}
    <linearGradient id="${shine}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient></defs>
    <path d="${shape}" fill="url(#${id})" stroke="rgba(0,0,0,.55)" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="${shape}" fill="url(#${shine})"/></svg>`;
}

/** A case's picture: a crate in its colours, with its best weapon on the front. */
function caseArt(box) {
  const [a, b] = box.colors;
  const id = `case-${++artId}`;
  return `<svg class="case-art" viewBox="0 0 160 110" aria-hidden="true"><defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <rect x="12" y="22" width="136" height="80" rx="10" fill="url(#${id})"/>
    <rect x="12" y="22" width="136" height="80" rx="10" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="2"/>
    <rect x="22" y="14" width="116" height="16" rx="6" fill="${a}" stroke="rgba(0,0,0,.35)" stroke-width="2"/>
    <rect x="68" y="56" width="24" height="16" rx="3" fill="rgba(0,0,0,.35)"/><rect x="74" y="60" width="12" height="8" rx="2" fill="${b}"/>
    <path d="M12 44 H148 M12 84 H148" stroke="rgba(0,0,0,.25)" stroke-width="2"/></svg>`;
}

/** Wear from a float, the way CS names it. */
function wearOf(float, wears) {
  return wears.find((w) => float < w.max) ?? wears[wears.length - 1];
}
