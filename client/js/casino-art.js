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

// Slot symbols, drawn in a 100 by 100 box. Their gradients live once on the page (SLOT_DEFS, added with the machine).
const SLOT_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <radialGradient id="sl-cherry" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#ff8a8a"/><stop offset=".35" stop-color="#e3202f"/><stop offset="1" stop-color="#7a0612"/></radialGradient>
  <radialGradient id="sl-lemon" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#fff7b0"/><stop offset=".45" stop-color="#ffd92e"/><stop offset="1" stop-color="#c98a00"/></radialGradient>
  <linearGradient id="sl-leaf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8fe36a"/><stop offset="1" stop-color="#2f7a1f"/></linearGradient>
  <radialGradient id="sl-gold" cx=".35" cy=".25" r=".9"><stop offset="0" stop-color="#fff4c2"/><stop offset=".4" stop-color="#ffc93a"/><stop offset=".8" stop-color="#d0870c"/><stop offset="1" stop-color="#8a4f05"/></radialGradient>
  <linearGradient id="sl-star" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff2a6"/><stop offset=".5" stop-color="#ffbf1f"/><stop offset="1" stop-color="#e2501d"/></linearGradient>
  <linearGradient id="sl-gem" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8fbff"/><stop offset=".5" stop-color="#4fc3f7"/><stop offset="1" stop-color="#1546a8"/></linearGradient>
  <linearGradient id="sl-seven" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6b5e"/><stop offset=".5" stop-color="#d4141f"/><stop offset="1" stop-color="#7a0612"/></linearGradient>
  <linearGradient id="sl-flame" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#b8231a"/><stop offset=".45" stop-color="#f26a1b"/><stop offset="1" stop-color="#ffb04f"/></linearGradient>
  <radialGradient id="sl-core" cx=".5" cy=".65" r=".5"><stop offset="0" stop-color="#fffbe0"/><stop offset=".6" stop-color="#ffe066"/><stop offset="1" stop-color="#ffb030"/></radialGradient>
</defs></svg>`;
const slotSvg = (body) => `<svg class="sym" viewBox="0 0 100 100" aria-hidden="true">${body}</svg>`;
const SLOT_ART = {
  cherry: slotSvg(`<path d="M34 58 C38 36 48 22 66 12 M64 60 C64 40 64 26 66 12" fill="none" stroke="#3d6b1f" stroke-width="4" stroke-linecap="round"/>
    <path d="M66 12 C74 6 88 8 92 16 C82 22 72 20 66 12Z" fill="url(#sl-leaf)" stroke="#24521a" stroke-width="1.5"/>
    <circle cx="32" cy="70" r="20" fill="url(#sl-cherry)" stroke="#5a0410" stroke-width="2"/><circle cx="66" cy="72" r="20" fill="url(#sl-cherry)" stroke="#5a0410" stroke-width="2"/>
    <ellipse cx="25" cy="62" rx="6" ry="4" fill="#fff" opacity=".7" transform="rotate(-30 25 62)"/><ellipse cx="59" cy="64" rx="6" ry="4" fill="#fff" opacity=".7" transform="rotate(-30 59 64)"/>`),
  lemon: slotSvg(`<path d="M8 52 C10 46 16 42 20 40 C30 22 70 20 82 38 C86 40 92 44 92 50 C92 56 86 60 82 62 C70 80 30 80 20 62 C16 60 10 58 8 52Z" fill="url(#sl-lemon)" stroke="#9a6a00" stroke-width="2"/>
    <ellipse cx="38" cy="38" rx="14" ry="6" fill="#fff" opacity=".55" transform="rotate(-12 38 38)"/>
    <g fill="#c98a00" opacity=".45"><circle cx="56" cy="56" r="1.4"/><circle cx="66" cy="48" r="1.4"/><circle cx="46" cy="62" r="1.4"/><circle cx="70" cy="60" r="1.4"/><circle cx="34" cy="54" r="1.4"/></g>`),
  bell: slotSvg(`<path d="M50 10 C54 10 56 13 56 16 C72 20 78 34 78 52 C78 64 84 70 90 76 L10 76 C16 70 22 64 22 52 C22 34 28 20 44 16 C44 13 46 10 50 10Z" fill="url(#sl-gold)" stroke="#7a4300" stroke-width="2.4" stroke-linejoin="round"/>
    <rect x="8" y="74" width="84" height="10" rx="5" fill="url(#sl-gold)" stroke="#7a4300" stroke-width="2.4"/>
    <circle cx="50" cy="88" r="7" fill="url(#sl-gold)" stroke="#7a4300" stroke-width="2.2"/>
    <path d="M34 28 C30 36 30 48 32 60" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".6"/>`),
  star: slotSvg(`<path d="M50 6 L62 36 L94 38 L69 58 L78 90 L50 72 L22 90 L31 58 L6 38 L38 36Z" fill="url(#sl-star)" stroke="#9a3a0a" stroke-width="2.6" stroke-linejoin="round"/>
    <path d="M50 22 L57 40 L76 41 L61 53 L66 72 L50 61 L34 72 L39 53 L24 41 L43 40Z" fill="#fff" opacity=".28"/>
    <circle cx="40" cy="34" r="4" fill="#fff" opacity=".8"/>`),
  diamond: slotSvg(`<path d="M26 18 L74 18 L94 40 L50 92 L6 40Z" fill="url(#sl-gem)" stroke="#0f2f6b" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M6 40 L94 40 M26 18 L36 40 L50 92 L64 40 L74 18 M36 40 L50 18 L64 40" fill="none" stroke="#0f2f6b" stroke-width="1.4" opacity=".6"/>
    <path d="M26 18 L36 40 L6 40Z M50 18 L36 40 L64 40Z" fill="#fff" opacity=".45"/><path d="M64 40 L94 40 L50 92Z" fill="#0b2a6b" opacity=".3"/>`),
  seven: slotSvg(`<path d="M16 12 L86 12 L86 26 C70 42 58 62 54 90 L32 90 C36 64 48 42 62 30 L16 30Z" fill="url(#sl-seven)" stroke="#ffd36b" stroke-width="5" stroke-linejoin="round" paint-order="stroke"/>
    <path d="M16 12 L86 12 L86 26 C70 42 58 62 54 90 L32 90 C36 64 48 42 62 30 L16 30Z" fill="none" stroke="#5a0410" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M20 16 L80 16" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".55"/>`),
  flame: slotSvg(`<path d="M50 4 C54 20 70 30 76 46 C84 66 72 92 50 94 C28 92 16 68 24 48 C28 38 34 34 36 26 C42 34 42 40 44 44 C46 30 46 16 50 4Z" fill="url(#sl-flame)" stroke="#6a1408" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M50 44 C54 54 64 60 62 74 C60 84 54 88 50 88 C44 88 38 82 38 74 C38 64 46 58 50 44Z" fill="url(#sl-core)"/>
    <rect x="22" y="70" width="56" height="18" rx="5" fill="#1f1813" stroke="#ffd36b" stroke-width="2"/>
    <text x="50" y="84" text-anchor="middle" font-family="Nunito Sans, sans-serif" font-weight="900" font-size="14" fill="#ffd36b" letter-spacing="1.5">WILD</text>`),
};
const SLOT_NAMES = { cherry: 'Cherry', lemon: 'Lemon', bell: 'Bell', star: 'Star', diamond: 'Diamond', seven: 'Seven', flame: 'Flame' };

const RARITY = {
  milspec: { name: 'Mil-Spec', color: '#4b69ff' },
  restricted: { name: 'Restricted', color: '#8847ff' },
  classified: { name: 'Classified', color: '#d32ce6' },
  covert: { name: 'Covert', color: '#eb4b4b' },
  rare: { name: 'Rare Special', color: '#e4ae39' },
};

// The weapons, drawn facing right in a 256 by 100 box. Each is a list of parts:
//   p: painted with the skin    d: dark polymer    m: gunmetal    h: a hole or a dark recess
//   l: a seam (dark line)       s: a shine (light line)    t: a metal stroke (wire stocks, trigger guards), with its width
const WEAPON_MODELS = {
  ak: [
    ['p', 'M6 44 L66 37 L70 39 L70 55 L64 57 L16 70 Q6 72 5 63 Z'],
    ['l', 'M20 50 L64 44 M24 62 L64 52'],
    ['m', 'M150 29 L203 29 Q206 30 206 34 L150 34 Z'],
    ['p', 'M152 28 L190 28 L193 34 L152 35 Z'],
    ['m', 'M147 28 L160 25 L162 35 L147 35 Z'],
    ['p', 'M68 35 L150 34 L152 37 L152 52 L68 54 Z'],
    ['l', 'M72 40 L148 39 M70 47 L88 47'],
    ['m', 'M196 41 L238 41 L238 46 L196 46 Z M221 41 L223 30 L229 30 L230 41 Z M236 39 L251 39 L251 48 L236 48 Z'],
    ['h', 'M240 41 h8 v2 h-8z M240 44 h8 v2 h-8z'],
    ['p', 'M152 37 L196 37 L199 40 L199 50 L152 51 Z'],
    ['l', 'M160 44 L192 44'],
    ['t', 'M92 54 Q95 67 110 65 L113 54', 2.6],
    ['m', 'M101 54 Q104 60 100 63 L98 62 Q101 59 99 54 Z'],
    ['d', 'M89 53 L106 53 L100 80 Q98 84 92 83 L83 82 Z'],
    ['l', 'M92 60 L102 60 M90 66 L100 66 M88 72 L98 72'],
    ['p', 'M114 52 L136 52 C138 66 144 76 154 86 L136 94 C126 82 118 68 114 52 Z'],
    ['l', 'M121 62 L139 60 M126 72 L144 70 M132 82 L149 80'],
    ['m', 'M80 48 m-1.4 0 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 M142 48 m-1.4 0 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0'],
    ['s', 'M70 36.5 L150 35.5 M154 38.5 L196 38.5 M8 45 L64 38.5'],
  ],
  m4: [
    ['p', 'M8 40 L46 37 L50 39 L50 56 L16 64 Q8 66 7 58 Z'],
    ['l', 'M14 46 L46 43 M12 52 L46 49'],
    ['m', 'M48 42 L70 42 L70 50 L48 50 Z'],
    ['m', 'M70 24 L146 24 L146 30 L70 30 Z M74 17 L84 17 L86 24 L72 24 Z M200 30 L203 17 L211 17 L211 30 Z'],
    ['h', 'M74 24 v3 M79 24 v3 M84 24 v3 M89 24 v3 M94 24 v3 M99 24 v3 M104 24 v3 M109 24 v3 M114 24 v3 M119 24 v3 M124 24 v3 M129 24 v3 M134 24 v3 M139 24 v3'],
    ['p', 'M68 30 L146 30 L146 41 L68 41 Z'],
    ['h', 'M112 32 h22 v6 h-22z'],
    ['p', 'M68 40 L138 40 L138 56 L68 56 Z'],
    ['l', 'M72 44 L134 44 M100 48 L112 48'],
    ['m', 'M202 38 L234 38 L234 43 L202 43 Z M232 35.5 L249 35.5 L249 45.5 L232 45.5 Z'],
    ['h', 'M236 37.5 h10 v1.6 h-10z M236 41.5 h10 v1.6 h-10z'],
    ['p', 'M146 30 L200 30 L203 33 L203 50 L146 52 Z'],
    ['h', 'M154 36 h8 v4 h-8z M168 36 h8 v4 h-8z M182 36 h8 v4 h-8z M154 44 h8 v3 h-8z M168 44 h8 v3 h-8z M182 44 h8 v3 h-8z'],
    ['t', 'M84 57 Q88 68 104 66 L106 56', 2.6],
    ['m', 'M93 56 Q96 62 92 64 L90 63 Q93 60 91 56 Z'],
    ['d', 'M80 56 L97 56 L91 82 Q89 85 83 84 L74 82 Z'],
    ['l', 'M82 62 L94 62 M80 68 L92 68 M78 74 L90 74'],
    ['p', 'M108 56 L128 56 L132 88 Q122 92 112 90 Z'],
    ['l', 'M111 64 L129 63 M112 72 L130 71 M113 80 L131 79'],
    ['s', 'M70 31.5 L144 31.5 M148 31.5 L200 31.5 M10 41 L46 38.5'],
  ],
  m4s: 'm4', // with a silencer, added below
  awp: [
    ['p', 'M4 46 L26 36 L84 34 L90 38 L90 58 L78 58 L70 50 L50 50 L40 66 L10 70 Q4 68 4 60 Z'],
    ['h', 'M54 40 L74 40 Q78 44 74 47 L56 47 Q52 44 54 40 Z'],
    ['p', 'M70 50 L88 50 L84 74 Q82 78 76 77 L68 74 Z'],
    ['l', 'M10 56 L38 52 M72 58 L84 58 M70 64 L82 64'],
    ['m', 'M202 39 L240 39 L240 44 L202 44 Z M236 35.5 L252 35.5 L252 47.5 L236 47.5 Z'],
    ['h', 'M240 37.5 h2 v8 h-2z M245 37.5 h2 v8 h-2z'],
    ['p', 'M88 34 L162 34 L162 52 L90 52 Z'],
    ['l', 'M94 40 L158 40'],
    ['m', 'M116 51 L123 51 L130 62 Q129 67 124 65 Z'],
    ['d', 'M132 52 L150 52 L150 64 L132 64 Z'],
    ['t', 'M96 53 Q99 64 112 62 L114 52', 2.4],
    ['m', 'M104 27 h8 v7 h-8z M140 27 h8 v7 h-8z'],
    ['p', 'M92 18 L158 18 L158 27 L92 27 Z'],
    ['m', 'M80 15 L94 15 L94 30 L80 30 Z M156 18 L166 11 L180 11 L180 34 L166 34 L156 27 Z M120 13 h10 v5 h-10z'],
    ['h', 'M177 13 h3 v19 h-3z'],
    ['p', 'M162 36 L204 37 L204 48 L162 50 Z'],
    ['s', 'M94 19.5 L156 19.5 M90 35.5 L160 35.5 M164 38 L202 38.5 M28 37.5 L82 35.5'],
  ],
  pistol: [
    ['m', 'M198 27 h7 v9 h-7z M64 17 h8 v5 h-8z M186 17 h6 v5 h-6z'],
    ['p', 'M62 50 L102 52 L94 90 Q92 95 86 95 L62 93 Q55 91 57 84 Z'],
    ['l', 'M66 58 L96 60 M64 66 L94 68 M62 74 L92 76 M60 82 L90 84'],
    ['d', 'M56 90 L94 92 L94 97 L56 95 Z'],
    ['t', 'M102 52 Q106 70 130 68 L134 52', 3],
    ['m', 'M114 52 Q118 60 113 64 L110 63 Q114 59 111 52 Z'],
    ['p', 'M60 42 L198 42 L198 50 L134 52 L128 58 L104 58 L100 52 L60 52 Z'],
    ['p', 'M56 22 L194 22 Q199 22 199 27 L199 42 L56 42 Z'],
    ['l', 'M64 25 v14 M68 25 v14 M72 25 v14 M76 25 v14 M80 25 v14 M56 42 L199 42'],
    ['h', 'M118 26 h30 v8 h-30z'],
    ['s', 'M58 23.5 L194 23.5 M62 43.5 L196 43.5'],
  ],
  deagle: [
    ['m', 'M50 15 L210 15 L210 19 L50 19 Z M54 11 h8 v4 h-8z M200 11 h6 v4 h-6z'],
    ['p', 'M58 50 L102 52 L94 92 Q92 97 86 97 L58 95 Q51 93 53 86 Z'],
    ['l', 'M62 58 L96 60 M60 66 L94 68 M58 74 L92 76 M56 82 L90 84'],
    ['t', 'M102 52 Q106 72 132 70 L136 52', 3.2],
    ['m', 'M114 52 Q118 61 113 65 L110 64 Q114 60 111 52 Z'],
    ['p', 'M52 42 L210 42 L210 50 L136 52 L130 60 L104 60 L100 52 L52 52 Z'],
    ['p', 'M48 19 L212 19 L212 42 L48 42 Z'],
    ['l', 'M56 22 v17 M60 22 v17 M64 22 v17 M68 22 v17 M120 19 L120 42 M48 42 L212 42'],
    ['h', 'M126 24 h34 v9 h-34z M206 26 h6 v8 h-6z'],
    ['s', 'M50 20.5 L210 20.5 M54 43.5 L208 43.5'],
  ],
  usps: 'pistol', // with a silencer, added below
  smg: [
    ['t', 'M20 40 L58 38 M20 40 L20 58 L58 52', 3.5],
    ['d', 'M12 36 h9 v26 h-9z'],
    ['m', 'M64 24 L150 24 L150 30 L64 30 Z M206 38 L226 38 L226 45 L206 45 Z'],
    ['h', 'M68 24 v3 M73 24 v3 M78 24 v3 M83 24 v3 M88 24 v3 M93 24 v3 M98 24 v3 M103 24 v3 M108 24 v3 M113 24 v3 M118 24 v3 M123 24 v3 M128 24 v3 M133 24 v3 M138 24 v3 M143 24 v3'],
    ['p', 'M56 30 L160 30 L166 34 L166 52 L56 52 Z'],
    ['l', 'M60 38 L162 38'],
    ['h', 'M100 32 h26 v5 h-26z'],
    ['p', 'M166 35 L206 35 L206 48 L166 48 Z'],
    ['h', 'M172 38 h4 v7 h-4z M181 38 h4 v7 h-4z M190 38 h4 v7 h-4z M199 38 h4 v7 h-4z'],
    ['t', 'M84 53 Q87 63 100 62 L104 52', 2.4],
    ['d', 'M78 52 L94 52 L90 80 Q88 84 82 84 L72 82 Z'],
    ['p', 'M112 52 L128 52 L130 94 L114 94 Z'],
    ['l', 'M115 62 L128 62 M115 72 L129 72 M116 82 L129 82'],
    ['d', 'M148 52 L162 52 L160 74 Q158 77 152 76 L148 74 Z'],
    ['s', 'M58 31.5 L158 31.5 M168 36.5 L204 36.5'],
  ],
  p90: [
    ['m', 'M206 38 L228 38 L228 45 L206 45 Z'],
    ['p', 'M20 50 Q18 30 46 28 L194 28 Q206 30 206 42 L206 52 L150 54 L140 66 L118 66 L110 56 L92 56 L86 76 Q84 82 76 82 L66 82 Q58 80 58 72 L58 60 L30 62 Q20 60 20 50 Z'],
    ['h', 'M68 46 Q70 38 80 38 L94 38 Q100 40 98 46 L92 52 L76 52 Z'],
    ['l', 'M24 48 L56 48 M150 36 L200 36 M120 54 L140 54'],
    ['d', 'M70 19 L190 19 L192 28 L70 28 Z'],
    ['s', 'M74 21 L188 21'],
    ['l', 'M80 21 v6 M86 21 v6 M92 21 v6 M98 21 v6 M104 21 v6 M110 21 v6 M116 21 v6 M122 21 v6 M128 21 v6 M134 21 v6 M140 21 v6 M146 21 v6 M152 21 v6 M158 21 v6 M164 21 v6 M170 21 v6 M176 21 v6 M182 21 v6'],
    ['s', 'M40 30 L192 30'],
  ],
  shotgun: [
    ['p', 'M5 46 L62 37 L68 39 L68 54 L60 56 L14 70 Q4 70 4 62 Z'],
    ['l', 'M16 52 L62 44 M20 62 L60 52'],
    ['p', 'M66 52 L82 52 L76 68 Q72 71 67 67 L64 55 Z'],
    ['m', 'M132 34 L246 34 L246 41 L132 41 Z M132 42 L214 42 L214 50 L132 50 Z M216 42 h4 v6 h-4z'],
    ['m', 'M244 33 m-2 0 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0'],
    ['p', 'M66 34 L132 34 L132 52 L66 52 Z'],
    ['h', 'M90 38 h26 v6 h-26z'],
    ['t', 'M82 53 Q85 63 98 62 L101 52', 2.4],
    ['p', 'M146 40 L196 40 L196 56 L146 56 Z'],
    ['l', 'M152 43 v10 M158 43 v10 M164 43 v10 M170 43 v10 M176 43 v10 M182 43 v10 M188 43 v10'],
    ['s', 'M68 35.5 L130 35.5 M134 35.5 L244 35.5 M148 41.5 L194 41.5 M8 46.5 L62 38.5'],
  ],
  knife: [
    ['d', 'M14 56 C30 50 70 50 96 52 L96 66 C70 68 30 70 16 66 Q8 62 14 56 Z'],
    ['l', 'M30 54 v13 M40 53 v14 M50 53 v14 M60 53 v14 M70 53 v14 M80 53 v13'],
    ['m', 'M94 44 L102 44 L102 74 L94 74 Z'],
    ['p', 'M102 50 L200 46 C220 46 236 50 252 58 C232 64 200 68 102 68 Z'],
    ['l', 'M110 54 L196 51'],
    ['s', 'M104 66.5 C160 66 210 63 250 58 M200 47.5 C220 47.5 236 51 250 57'],
  ],
  karambit: [
    ['t', 'M34 62 m-12 0 a12 12 0 1 0 24 0 a12 12 0 1 0 -24 0', 6],
    ['d', 'M44 56 C58 50 84 50 104 54 L104 66 C84 70 60 70 46 70 Z'],
    ['l', 'M58 53 v16 M68 52 v17 M78 52 v17 M88 52 v16'],
    ['m', 'M102 49 L110 49 L110 71 L102 71 Z'],
    ['p', 'M108 52 C140 50 176 44 200 26 C214 16 228 14 238 18 C222 26 210 40 196 52 C176 66 140 70 108 68 Z'],
    ['l', 'M114 58 C150 56 180 48 202 32'],
    ['s', 'M110 66.5 C140 68 176 63 195 51 C210 40 222 27 236 19'],
  ],
  butterfly: [
    ['m', 'M14 52 L102 49 L102 56 L14 58 Z'],
    ['d', 'M12 58 L102 56 L102 67 L14 69 Q8 64 12 58 Z'],
    ['h', 'M30 62 m-2.6 0 a2.6 2.6 0 1 0 5.2 0 a2.6 2.6 0 1 0 -5.2 0 M46 62 m-2.6 0 a2.6 2.6 0 1 0 5.2 0 a2.6 2.6 0 1 0 -5.2 0 M62 61.5 m-2.6 0 a2.6 2.6 0 1 0 5.2 0 a2.6 2.6 0 1 0 -5.2 0 M78 61 m-2.6 0 a2.6 2.6 0 1 0 5.2 0 a2.6 2.6 0 1 0 -5.2 0'],
    ['p', 'M104 50 L214 46 C228 46 240 50 248 56 L220 62 L104 66 Z'],
    ['l', 'M108 54 L210 50 M214 46 L220 62'],
    ['s', 'M106 64.5 L220 60.5 L246 55.5'],
  ],
  gloves: [
    ['g', 'translate(36 2)'],
    ['g', 'translate(118 6) rotate(6 60 50)'],
  ],
};
// One glove: back of the hand, fingers up.
const GLOVE = [
  ['p', 'M18 40 C6 36 2 28 4 22 C6 16 12 16 16 22 L26 34 Z'],
  ['p', 'M24 90 L20 58 C18 50 20 42 26 40 L28 18 C28 12 36 12 36 18 L38 36 L40 10 C40 4 48 4 48 10 L49 36 L52 12 C52 6 60 6 60 12 L60 38 L64 22 C66 16 73 18 72 24 L68 52 C66 62 62 70 60 90 Z'],
  ['d', 'M28 38 Q44 34 66 40 L64 48 Q44 42 28 46 Z'],
  ['l', 'M32 18 L33 36 M44 10 L44 34 M56 12 L56 36 M68 24 L65 42'],
  ['p', 'M26 56 Q44 50 64 56 L62 66 Q44 60 26 66 Z'],
  ['d', 'M22 82 L62 82 L61 96 L23 96 Z'],
  ['s', 'M24 84 L60 84'],
];

WEAPON_MODELS.m4s = [...WEAPON_MODELS.m4, ['d', 'M202 33.5 L252 33.5 Q254 33.5 254 36 L254 45 Q254 47.5 252 47.5 L202 47.5 Z'], ['l', 'M212 34 v13 M244 34 v13'], ['s', 'M204 35.5 L251 35.5']];
WEAPON_MODELS.usps = [...WEAPON_MODELS.pistol, ['d', 'M199 23.5 L250 23.5 Q253 23.5 253 26.5 L253 37.5 Q253 40.5 250 40.5 L199 40.5 Z'], ['l', 'M208 24 v16 M242 24 v16'], ['s', 'M201 25.5 L250 25.5']];
const WEAPON_MODEL_OF = {
  'AK-47': 'ak', 'Galil AR': 'ak', M4A4: 'm4', FAMAS: 'm4', AUG: 'm4', 'SG 553': 'm4', 'M4A1-S': 'm4s',
  AWP: 'awp', 'SSG 08': 'awp', 'Desert Eagle': 'deagle', 'USP-S': 'usps', 'Glock-18': 'pistol', P250: 'pistol', 'Five-SeveN': 'pistol',
  P90: 'p90', MP9: 'smg', 'MAC-10': 'smg', 'UMP-45': 'smg', Nova: 'shotgun', XM1014: 'shotgun',
  Karambit: 'karambit', 'Butterfly Knife': 'butterfly', Bayonet: 'knife', 'Flip Knife': 'knife', 'Talon Knife': 'knife',
};
const KIND_MODEL = { rifle: 'ak', sniper: 'awp', pistol: 'pistol', smg: 'smg', shotgun: 'shotgun', knife: 'knife', gloves: 'gloves' };

let artId = 0;
/** The pattern a skin is painted with, for a <defs>. Sizes are in the weapon's 256 by 100 box. */
function skinPaint(skin, id) {
  const [a, b, c] = skin.colors;
  const tile = (w, h, body, extra = '') => `<pattern id="${id}" width="${w}" height="${h}" patternUnits="userSpaceOnUse" ${extra}><rect width="${w}" height="${h}" fill="${a}"/>${body}</pattern>`;
  switch (skin.pattern) {
    case 'fade':
      return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="20" y1="20" x2="240" y2="80"><stop offset="0" stop-color="${a}"/><stop offset=".45" stop-color="${b}"/><stop offset=".8" stop-color="${c}"/><stop offset="1" stop-color="${c}"/></linearGradient>`;
    case 'stripes':
      return tile(22, 22, `<rect width="8" height="22" fill="${b}"/><rect x="12" width="2" height="22" fill="${c}"/><rect x="16" width="1" height="22" fill="${b}" opacity=".6"/>`, 'patternTransform="rotate(-35)"');
    case 'camo':
      return tile(90, 60, `<path d="M-4 14 C8 2 26 4 30 14 C34 24 22 30 12 28 C2 26 -8 22 -4 14Z M44 30 C56 18 76 22 80 32 C84 44 66 50 56 46 C46 42 38 38 44 30Z M60 -6 C70 -8 80 0 74 8 C68 14 58 10 60 -6Z" fill="${b}"/>
        <path d="M18 34 C26 28 38 34 36 44 C34 54 22 56 16 50 C10 44 12 38 18 34Z M70 4 C78 0 88 6 86 14 C84 20 74 20 70 4Z M34 4 C40 0 48 4 46 10 C44 14 36 14 34 4Z" fill="${c}"/>
        <path d="M2 48 C8 44 14 50 10 56 C6 60 0 56 2 48Z M50 14 C54 12 58 16 56 20 C52 22 48 18 50 14Z" fill="${b}" opacity=".7"/>`);
    case 'tiger':
      return tile(48, 100, `<path d="M0 6 C12 10 20 4 30 12 C24 14 14 16 0 14Z M48 30 C36 34 30 28 18 36 C28 38 38 36 48 40Z M0 54 C14 56 22 50 34 58 C26 62 12 62 0 62Z M48 78 C38 80 30 76 20 84 C30 88 40 86 48 88Z" fill="${b}"/>
        <path d="M30 12 C36 10 42 12 48 8 L48 12 C42 14 36 14 30 12Z M0 36 C6 34 12 36 18 36 C12 40 6 40 0 40Z" fill="${c}"/>`, 'patternTransform="rotate(-12)"');
    case 'hex':
      return tile(18, 31, `<path d="M9 0 L18 5 L18 15.5 L9 20.5 L0 15.5 L0 5 Z M9 20.5 L9 31" fill="none" stroke="${b}" stroke-width="1.6"/><circle cx="9" cy="10" r="2.2" fill="${c}"/><circle cx="0" cy="26" r="1.2" fill="${c}" opacity=".6"/><circle cx="18" cy="26" r="1.2" fill="${c}" opacity=".6"/>`);
    case 'flames':
      return `<linearGradient id="${id}-g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${b}"/><stop offset="1" stop-color="${a}"/></linearGradient>` +
        tile(64, 100, `<rect width="64" height="100" fill="url(#${id}-g)" opacity=".55"/>
        <path d="M0 100 C2 80 10 76 8 58 C16 70 18 78 22 66 C24 52 18 44 22 30 C32 46 36 60 34 74 C40 66 44 58 42 46 C52 60 58 74 54 88 C58 84 62 80 64 76 L64 100Z" fill="${b}"/>
        <path d="M6 100 C8 86 14 82 14 72 C20 82 22 88 26 78 C28 70 26 62 28 54 C34 66 38 76 36 88 C42 84 46 78 48 70 C52 80 54 90 52 100Z" fill="${c}"/>
        <path d="M14 100 C16 92 20 90 20 84 C24 90 26 94 30 88 C32 92 34 96 34 100Z" fill="#fff" opacity=".35"/>`);
    case 'marble':
      return tile(80, 60, `<path d="M0 12 C14 4 22 22 38 14 S62 2 80 10 M0 36 C12 28 26 46 42 36 S64 26 80 34 M10 60 C18 50 28 52 34 44" fill="none" stroke="${b}" stroke-width="5" opacity=".8"/>
        <path d="M0 22 C18 18 30 30 46 24 S66 16 80 20 M0 50 C20 46 34 56 52 50 S70 44 80 48" fill="none" stroke="${c}" stroke-width="1.8"/>
        <path d="M22 0 C26 8 20 14 24 22 M58 28 C62 36 56 40 60 50" fill="none" stroke="${c}" stroke-width=".8" opacity=".8"/>`);
    case 'damascus':
      return tile(60, 24, `<path d="M0 4 Q15 -2 30 4 T60 4 M0 10 Q15 4 30 10 T60 10 M0 16 Q15 10 30 16 T60 16 M0 22 Q15 16 30 22 T60 22" fill="none" stroke="${b}" stroke-width="2.4"/>
        <path d="M0 7 Q15 1 30 7 T60 7 M0 19 Q15 13 30 19 T60 19" fill="none" stroke="${c}" stroke-width=".9"/>`, 'patternTransform="rotate(-8)"');
    case 'waves':
      return tile(80, 34, `<path d="M0 10 Q20 0 40 10 T80 10 V18 Q60 28 40 18 T0 18Z" fill="${b}"/><path d="M0 26 Q20 20 40 26 T80 26" fill="none" stroke="${c}" stroke-width="2.4"/><path d="M0 13 Q20 5 40 13 T80 13" fill="none" stroke="#fff" stroke-width=".8" opacity=".35"/>`);
    case 'digital':
      return tile(32, 32, `<path d="M0 0h8v8H0z M16 8h8v8h-8z M8 16h8v8H8z M24 24h8v8h-8z M24 0h4v4h-4z M4 28h4v4H4z" fill="${b}"/><path d="M8 0h8v8H8z M24 8h8v8h-8z M16 24h8v8h-8z M0 16h4v4H0z" fill="${c}"/><path d="M12 12h4v4h-4z M28 20h4v4h-4z" fill="${a}" opacity=".6"/>`);
    case 'splatter':
      return tile(70, 50, `<circle cx="12" cy="10" r="6" fill="${b}"/><circle cx="20" cy="16" r="2" fill="${b}"/><circle cx="6" cy="20" r="1.5" fill="${b}"/>
        <circle cx="48" cy="30" r="8" fill="${c}"/><circle cx="58" cy="22" r="2.5" fill="${c}"/><circle cx="40" cy="42" r="1.8" fill="${c}"/><circle cx="62" cy="40" r="1.2" fill="${c}"/>
        <circle cx="30" cy="36" r="3" fill="${b}"/><circle cx="56" cy="6" r="3.5" fill="${b}"/><circle cx="24" cy="46" r="1.2" fill="#fff" opacity=".7"/><circle cx="38" cy="8" r="1" fill="#fff" opacity=".8"/>`);
    case 'circuit':
      return tile(40, 40, `<path d="M0 10 H14 L20 16 V30 H40 M26 0 V8 L32 14 H40 M6 40 V32 L12 26 H20" fill="none" stroke="${b}" stroke-width="1.6"/>
        <circle cx="14" cy="10" r="2" fill="${c}"/><circle cx="32" cy="14" r="2" fill="${c}"/><circle cx="20" cy="26" r="2" fill="${c}"/><rect x="28" y="22" width="6" height="4" fill="${b}"/>`);
    case 'geo':
      return tile(40, 34, `<path d="M0 0 L20 34 L0 34Z M20 0 L40 0 L30 17Z" fill="${b}"/><path d="M20 34 L30 17 L40 34Z M0 0 L20 0 L10 17Z" fill="${c}" opacity=".85"/><path d="M0 0 L20 34 L40 0" fill="none" stroke="#000" stroke-opacity=".2" stroke-width=".8"/>`);
    case 'carbon':
      return tile(8, 8, `<path d="M0 0h4v4H0z M4 4h4v4H4z" fill="${b}"/><path d="M0 0h4v1H0z M4 4h4v1H4z" fill="${c}" opacity=".6"/>`);
    default:
      return `<linearGradient id="${id}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${a}"/></linearGradient>`;
  }
}

/** A steady random from a string, so a skin's scratches are the same every time it's drawn. */
function seededRandom(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** A skin's picture: its weapon, painted in the skin, metal and grips left bare. A worn one (a high float) has
 * scratches through the paint. */
function skinArt(skin, float = 0.05) {
  const n = ++artId;
  const ids = { paint: `sk${n}p`, shade: `sk${n}s`, metal: `sk${n}m`, poly: `sk${n}d`, clip: `sk${n}c` };
  const name = WEAPON_MODEL_OF[skin.weapon] ?? KIND_MODEL[skin.kind] ?? 'ak';
  // Gloves are one glove drawn twice; everything else is its parts as listed.
  const parts = name === 'gloves'
    ? WEAPON_MODELS.gloves.flatMap(([, transform]) => GLOVE.map((p) => [...p.slice(0, 2), p[2], transform]))
    : WEAPON_MODELS[name];
  const edge = 'stroke="#0c0a09" stroke-opacity=".75" stroke-width="1.1" stroke-linejoin="round"';
  const painted = [];
  const body = parts.map(([type, d, w, transform]) => {
    const at = transform ? ` transform="${transform}"` : '';
    switch (type) {
      case 'p':
        painted.push(`<path d="${d}"${at}/>`);
        return `<path d="${d}"${at} fill="url(#${ids.paint})" ${edge}/><path d="${d}"${at} fill="url(#${ids.shade})"/>`;
      case 'd': return `<path d="${d}"${at} fill="url(#${ids.poly})" ${edge}/>`;
      case 'm': return `<path d="${d}"${at} fill="url(#${ids.metal})" ${edge}/>`;
      case 'h': return `<path d="${d}"${at} fill="#0b0908" stroke="#0b0908" stroke-width=".6" opacity=".85"/>`;
      case 'l': return `<path d="${d}"${at} fill="none" stroke="#000" stroke-opacity=".38" stroke-width=".9" stroke-linecap="round"/>`;
      case 's': return `<path d="${d}"${at} fill="none" stroke="#fff" stroke-opacity=".42" stroke-width="1" stroke-linecap="round"/>`;
      case 't': return `<path d="${d}"${at} fill="none" stroke="#151719" stroke-width="${w + 1.4}" stroke-linecap="round"/><path d="${d}"${at} fill="none" stroke="#6a7077" stroke-width="${w}" stroke-linecap="round"/>`;
      default: return '';
    }
  }).join('');
  // Wear: scratches and chips down to the metal, more of them the higher the float.
  const rand = seededRandom(`${skin.id}:${float.toFixed(4)}`);
  const marks = [];
  for (let i = Math.round(float * float * 160); i > 0; i--) {
    const x = rand() * 256, y = 8 + rand() * 88, len = 1.5 + rand() * 7, ang = (rand() - 0.5) * 1.2;
    marks.push(rand() < 0.35
      ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.5 + rand() * 1.4).toFixed(2)}"/>`
      : `<path d="M${x.toFixed(1)} ${y.toFixed(1)} l${(Math.cos(ang) * len).toFixed(1)} ${(Math.sin(ang) * len).toFixed(1)}" stroke-width="${(0.5 + rand() * 0.8).toFixed(2)}"/>`);
  }
  return `<svg class="skin-art" viewBox="0 0 256 100" aria-hidden="true"><defs>${skinPaint(skin, ids.paint)}
    <linearGradient id="${ids.shade}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset=".35" stop-color="#fff" stop-opacity=".04"/><stop offset=".7" stop-color="#000" stop-opacity=".06"/><stop offset="1" stop-color="#000" stop-opacity=".38"/></linearGradient>
    <linearGradient id="${ids.metal}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9bec4"/><stop offset=".4" stop-color="#6c7279"/><stop offset="1" stop-color="#2a2d31"/></linearGradient>
    <linearGradient id="${ids.poly}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4541"/><stop offset=".5" stop-color="#2a2623"/><stop offset="1" stop-color="#151311"/></linearGradient>
    <clipPath id="${ids.clip}">${painted.join('')}</clipPath></defs>
    ${body}${marks.length ? `<g clip-path="url(#${ids.clip})" fill="#c9ccd0" stroke="#c9ccd0" opacity=".6">${marks.join('')}</g>` : ''}</svg>`;
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
