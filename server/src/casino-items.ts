// What's in the casino: the cases and the skins in them, and the slot machine's reels.
// All made up for Peiskos; nothing here is worth real money.

export type Rarity = 'milspec' | 'restricted' | 'classified' | 'covert' | 'rare';
export type Pattern = 'fade' | 'stripes' | 'camo' | 'hex' | 'flames' | 'marble' | 'waves' | 'digital' | 'carbon' | 'solid';
export type WeaponKind = 'rifle' | 'sniper' | 'pistol' | 'smg' | 'shotgun' | 'knife' | 'gloves';

export type Skin = {
  id: string;
  weapon: string;
  name: string;
  kind: WeaponKind;
  rarity: Rarity;
  pattern: Pattern;
  colors: [string, string, string];
  /** What a Field-Tested one sells back for, in chips. */
  value: number;
};

export type Case = { id: string; name: string; price: number; colors: [string, string]; skins: Skin[] };

/** How likely each rarity is from a case, out of 10,000 (the odds CS cases use). */
export const RARITY_ODDS: Record<Rarity, number> = { milspec: 7992, restricted: 1598, classified: 320, covert: 64, rare: 26 };
export const RARITY_NAMES: Record<Rarity, string> = {
  milspec: 'Mil-Spec', restricted: 'Restricted', classified: 'Classified', covert: 'Covert', rare: 'Rare Special',
};
/** A skin's value as a share of its case's price, before its own place in the list. */
const RARITY_VALUE: Record<Rarity, number> = { milspec: 0.25, restricted: 1, classified: 4, covert: 16, rare: 65 };

/** Wear: how likely each is, the floats it covers, and what it does to the value. */
export const WEARS = [
  { name: 'Factory New', short: 'FN', chance: 12, min: 0, max: 0.07, value: 1.6 },
  { name: 'Minimal Wear', short: 'MW', chance: 25, min: 0.07, max: 0.15, value: 1.2 },
  { name: 'Field-Tested', short: 'FT', chance: 38, min: 0.15, max: 0.38, value: 1 },
  { name: 'Well-Worn', short: 'WW', chance: 10, min: 0.38, max: 0.45, value: 0.85 },
  { name: 'Battle-Scarred', short: 'BS', chance: 15, min: 0.45, max: 1, value: 0.7 },
] as const;
export const STATTRAK_CHANCE = 10; // percent, not on gloves
export const STATTRAK_VALUE = 1.6;

const KINDS: Record<string, WeaponKind> = {
  'AK-47': 'rifle', M4A4: 'rifle', 'M4A1-S': 'rifle', FAMAS: 'rifle', 'Galil AR': 'rifle', AUG: 'rifle', 'SG 553': 'rifle',
  AWP: 'sniper', 'SSG 08': 'sniper',
  'Desert Eagle': 'pistol', 'Glock-18': 'pistol', 'USP-S': 'pistol', P250: 'pistol', 'Five-SeveN': 'pistol',
  P90: 'smg', MP9: 'smg', 'MAC-10': 'smg', 'UMP-45': 'smg',
  Nova: 'shotgun', XM1014: 'shotgun',
  Karambit: 'knife', Bayonet: 'knife', 'Butterfly Knife': 'knife', 'Talon Knife': 'knife', 'Flip Knife': 'knife',
  'Sport Gloves': 'gloves', 'Driver Gloves': 'gloves',
};

type Row = [string, string, Pattern, string, string, string];

function makeCase(id: string, name: string, price: number, colors: [string, string], rows: Record<Rarity, Row[]>): Case {
  const skins: Skin[] = [];
  for (const rarity of Object.keys(rows) as Rarity[]) {
    const list = rows[rarity];
    list.forEach(([weapon, skinName, pattern, a, b, c], k) => {
      // Within a rarity, the first listed is the prized one: from 1.4 times the usual value down to 0.75.
      const spread = list.length > 1 ? 1.4 - (0.65 * k) / (list.length - 1) : 1;
      skins.push({
        id: `${id}-${rarity}-${k}`,
        weapon,
        name: skinName,
        kind: KINDS[weapon],
        rarity,
        pattern,
        colors: [a, b, c],
        value: Math.max(1, Math.round(price * RARITY_VALUE[rarity] * spread)),
      });
    });
  }
  return { id, name, price, colors, skins };
}

export const CASES: Case[] = [
  makeCase('ember', 'Ember Case', 250, ['#c4561c', '#ffc46b'], {
    milspec: [
      ['UMP-45', 'Smoulder', 'fade', '#3a1410', '#a8331c', '#f08a4b'],
      ['Glock-18', 'Kindling', 'stripes', '#c4561c', '#2a1a12', '#e0962f'],
      ['P250', 'Oat Field', 'camo', '#ede4d6', '#c9a77c', '#8a6a48'],
      ['MAC-10', 'Charcoal', 'carbon', '#241c17', '#3b2f27', '#5a4638'],
      ['Nova', 'Birch Bark', 'stripes', '#f4efe6', '#2a2420', '#d8cfc2'],
      ['Five-SeveN', 'Hearthstone', 'marble', '#8d847b', '#4f4741', '#c7beb4'],
    ],
    restricted: [
      ['M4A1-S', 'Cloudberry', 'fade', '#e0962f', '#ffd27a', '#c4561c'],
      ['Desert Eagle', 'Copper Kettle', 'marble', '#b8642f', '#e29a5a', '#6a3416'],
      ['MP9', 'Lantern', 'hex', '#2a1a12', '#ffc46b', '#c4561c'],
      ['Galil AR', 'Fox Fur', 'camo', '#d9682a', '#f6efe6', '#3a2618'],
    ],
    classified: [
      ['USP-S', 'Glød', 'flames', '#1f1813', '#f08a4b', '#ffe29a'],
      ['AWP', 'Sunset Ridge', 'waves', '#4a2a5e', '#e2501d', '#ffc768'],
      ['P90', 'Northern Spark', 'digital', '#1c1612', '#f08a4b', '#7a3b1c'],
    ],
    covert: [
      ['AK-47', 'Wildfire', 'flames', '#2a0e08', '#e2501d', '#ffd36b'],
      ['M4A4', 'Phoenix Feather', 'fade', '#8f1d10', '#f28a35', '#ffe9a8'],
    ],
    rare: [
      ['Karambit', 'Ember Fade', 'fade', '#ffe29a', '#f08a4b', '#b8352b'],
      ['Butterfly Knife', 'Glowing Core', 'flames', '#fff3c4', '#ffb04f', '#c4561c'],
      ['Sport Gloves', 'Campfire', 'stripes', '#c4561c', '#2a1a12', '#ffc46b'],
      ['Talon Knife', 'Charcoal Marble', 'marble', '#2e241d', '#f08a4b', '#110d0a'],
    ],
  }),
  makeCase('aurora', 'Aurora Case', 500, ['#2f6f73', '#9be7c4'], {
    milspec: [
      ['SSG 08', 'Moss', 'camo', '#4f6b3a', '#7d9a5a', '#2e3d22'],
      ['Glock-18', 'Frostbite', 'fade', '#dff3ff', '#8cc8ea', '#3b6d8f'],
      ['MP9', 'Snowdrift', 'waves', '#f4f8fb', '#c5d7e4', '#8ea8bc'],
      ['Nova', 'Spruce', 'camo', '#1f3b2c', '#3f6a4c', '#122119'],
      ['P250', 'Fjord', 'waves', '#1d3b57', '#3f7aa8', '#9cc6e4'],
      ['MAC-10', 'Ice Shelf', 'hex', '#cfe9f5', '#6fa8c8', '#ffffff'],
    ],
    restricted: [
      ['Five-SeveN', 'Glacier', 'marble', '#e8f6fb', '#7fc0dc', '#3d7f9e'],
      ['FAMAS', 'Polar Night', 'digital', '#0e1726', '#2b4a6b', '#7fd6c9'],
      ['UMP-45', 'Reindeer', 'stripes', '#7a2b22', '#f2ece2', '#2f2622'],
      ['XM1014', 'Blizzard', 'camo', '#f2f6f8', '#9fb3c1', '#5b6f7c'],
    ],
    classified: [
      ['AUG', 'Northern Lights', 'waves', '#0b1b2b', '#3fe0a0', '#8c5ad8'],
      ['Desert Eagle', 'Midnight Sun', 'fade', '#ffd36b', '#f08a4b', '#3a2a6b'],
      ['USP-S', 'Fjordglass', 'hex', '#0f2a3d', '#4fc3d9', '#d8f6ff'],
    ],
    covert: [
      ['AWP', 'Aurora Borealis', 'waves', '#06121f', '#2ef0a6', '#b06bff'],
      ['AK-47', 'Frozen Lake', 'marble', '#dff6ff', '#4aa3d0', '#0d3550'],
    ],
    rare: [
      ['Bayonet', 'Aurora Fade', 'fade', '#2ef0a6', '#4fa0ff', '#b06bff'],
      ['Karambit', 'Starlight', 'digital', '#0a0f24', '#f3f6ff', '#6b7cff'],
      ['Flip Knife', 'Glacier Marble', 'marble', '#ffffff', '#8fd3f0', '#2a6f95'],
      ['Driver Gloves', 'Polar', 'stripes', '#f4f8fb', '#3b6d8f', '#c5d7e4'],
    ],
  }),
  makeCase('midnight', 'Midnight Case', 1000, ['#2a1f4f', '#ff5fa2'], {
    milspec: [
      ['Galil AR', 'Streetlight', 'stripes', '#1a1a22', '#ffcf4a', '#3a3a48'],
      ['P250', 'Night Owl', 'camo', '#2b2440', '#5a4b7a', '#151022'],
      ['MAC-10', 'Neon Rain', 'stripes', '#120f1f', '#3ef2ff', '#ff4fd8'],
      ['Glock-18', 'Static', 'digital', '#202028', '#8a8aa0', '#d8d8e8'],
      ['SG 553', 'Asphalt', 'carbon', '#1c1c20', '#2c2c33', '#45454f'],
      ['Nova', 'Firefly', 'hex', '#0f1a12', '#c8ff5a', '#2d4a1f'],
    ],
    restricted: [
      ['M4A1-S', 'Moonlit', 'fade', '#d9dcff', '#6b70c8', '#1c1d3f'],
      ['P90', 'Arcade', 'digital', '#1a0f2e', '#ff4fd8', '#3ef2ff'],
      ['MP9', 'Glowworm', 'waves', '#08130c', '#9dff5a', '#2b6b2b'],
      ['Desert Eagle', 'Night Market', 'hex', '#2a0f1f', '#ff7a45', '#ffd36b'],
    ],
    classified: [
      ['AK-47', 'Neon Fox', 'flames', '#170a26', '#ff5fa2', '#ffb04f'],
      ['AWP', 'Lightning Bug', 'digital', '#06100a', '#d6ff4a', '#3ef2ff'],
      ['Five-SeveN', 'Afterglow', 'fade', '#ff5fa2', '#8c5ad8', '#1a1440'],
    ],
    covert: [
      ['M4A4', 'Supernova', 'flames', '#0b0820', '#9b6bff', '#fff3c4'],
      ['USP-S', 'Eclipse', 'fade', '#000000', '#3a2a6b', '#ffd36b'],
    ],
    rare: [
      ['Butterfly Knife', 'Night Doppler', 'marble', '#ff4fd8', '#3a2a9b', '#3ef2ff'],
      ['Talon Knife', 'Nebula', 'waves', '#120a2e', '#ff5fa2', '#6b7cff'],
      ['Karambit', 'Gamma Glow', 'fade', '#c8ff5a', '#2ef0a6', '#0b3b2b'],
      ['Sport Gloves', 'Neon', 'stripes', '#120f1f', '#ff4fd8', '#3ef2ff'],
    ],
  }),
];

/** The slot machine: three reels, three rows, five lines (the rows and both diagonals). */
export const SLOT_SYMBOLS = ['cherry', 'lemon', 'bell', 'star', 'diamond', 'seven', 'flame'] as const;
export type SlotSymbol = (typeof SLOT_SYMBOLS)[number];
/** Three on a line pays this many times the line's bet. The flame stands in for anything, and three flames is the jackpot. */
export const SLOT_PAYS: Record<SlotSymbol, number> = { cherry: 6, lemon: 10, bell: 15, star: 25, diamond: 50, seven: 150, flame: 500 };
/** Two cherries from the left pay a little too. */
export const SLOT_TWO_CHERRIES = 1;
export const SLOT_LINES = [
  [1, 1, 1],
  [0, 0, 0],
  [2, 2, 2],
  [0, 1, 2],
  [2, 1, 0],
];
export const SLOT_BETS = [5, 25, 50, 100, 250, 500, 1000];
/** Each reel's strip, top to bottom, as counts of each symbol (spread out evenly when the strip is built). */
const STRIP_COUNTS: Record<SlotSymbol, number>[] = [
  { cherry: 6, lemon: 8, bell: 7, star: 5, diamond: 3, seven: 2, flame: 1 },
  { cherry: 6, lemon: 8, bell: 7, star: 5, diamond: 3, seven: 2, flame: 1 },
  { cherry: 6, lemon: 8, bell: 7, star: 5, diamond: 3, seven: 2, flame: 1 },
];
export const SLOT_STRIPS: SlotSymbol[][] = STRIP_COUNTS.map((counts, r) => {
  // Deal the symbols round-robin so the same ones don't bunch up; each reel starts at a different symbol.
  const left = { ...counts };
  const strip: SlotSymbol[] = [];
  let k = r * 2;
  while (strip.length < Object.values(counts).reduce((a, b) => a + b, 0)) {
    const sym = SLOT_SYMBOLS[k++ % SLOT_SYMBOLS.length];
    if (left[sym] > 0) {
      left[sym]--;
      strip.push(sym);
    }
  }
  return strip;
});

/** What a line of three pays, per chip bet on it. */
export function linePays(line: SlotSymbol[]): number {
  const [a, b] = line;
  const wild = (s: SlotSymbol) => s === 'flame';
  if (line.every(wild)) return SLOT_PAYS.flame;
  // Three of a kind, with flames standing in for whatever the others are.
  const real = line.filter((s) => !wild(s));
  if (real.every((s) => s === real[0])) return SLOT_PAYS[real[0]];
  if ((a === 'cherry' || wild(a)) && (b === 'cherry' || wild(b)) && (a === 'cherry' || b === 'cherry')) return SLOT_TWO_CHERRIES;
  return 0;
}
