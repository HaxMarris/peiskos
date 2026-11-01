// What's in the casino: the cases and the skins in them, and the slot machine's reels.
// All made up for Peiskos; nothing here is worth real money.

export type Rarity = 'milspec' | 'restricted' | 'classified' | 'covert' | 'rare';
export type Pattern =
  | 'fade' | 'stripes' | 'camo' | 'tiger' | 'hex' | 'flames' | 'marble' | 'damascus' | 'waves' | 'digital' | 'splatter' | 'circuit' | 'geo' | 'carbon' | 'solid';
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
  makeCase('kindling', 'Kindling Case', 100, ['#8a6a48', '#f4d9a8'], {
    milspec: [
      ['Glock-18', 'Wool Sock', 'stripes', '#b23a2a', '#f4efe6', '#3a2a22'],
      ['P250', 'Pinecone', 'hex', '#5a3a22', '#8a5a34', '#2a1a10'],
      ['MAC-10', 'Cocoa', 'marble', '#4a2c1c', '#8a5a3c', '#e8d2b8'],
      ['Nova', 'Flannel', 'geo', '#8f2a22', '#2a2420', '#d8b89a'],
      ['SSG 08', 'Sawdust', 'splatter', '#d9b98a', '#a8834f', '#f4e4c4'],
      ['UMP-45', 'Firewood', 'waves', '#6a4426', '#a8723e', '#3a2414'],
    ],
    restricted: [
      ['MP9', 'Marshmallow', 'fade', '#fff8ee', '#f2d2a8', '#b8743a'],
      ['Five-SeveN', 'Teapot', 'solid', '#3f6a6a', '#e8dcc8', '#24403f'],
      ['Galil AR', 'Plaid Blanket', 'geo', '#2f4a3a', '#b8342a', '#e8d8b8'],
      ['FAMAS', 'Candlewax', 'marble', '#fbf3e2', '#e8c88a', '#c4561c'],
    ],
    classified: [
      ['Desert Eagle', 'Toasted', 'fade', '#f4d9a8', '#c47a3a', '#3a1e10'],
      ['AUG', 'Cabin Lights', 'circuit', '#1f1813', '#ffc46b', '#7a4a24'],
      ['P90', 'Matchstick', 'flames', '#e8d2a8', '#c4261c', '#ffb04f'],
    ],
    covert: [
      ['AK-47', 'First Spark', 'flames', '#1f1410', '#ff8a3a', '#fff0b8'],
      ['M4A1-S', 'Cinnamon', 'damascus', '#7a3a1c', '#c4743a', '#3a1a0c'],
    ],
    rare: [
      ['Flip Knife', 'Hearthwood', 'damascus', '#5a3420', '#c48a4a', '#2a160c'],
      ['Bayonet', 'Tinder Fade', 'fade', '#ffe8a8', '#f08a3a', '#7a2a14'],
      ['Karambit', 'Sunrise', 'waves', '#ffd27a', '#f0743a', '#8a3a6a'],
      ['Driver Gloves', 'Mittens', 'stripes', '#b23a2a', '#f4efe6', '#2f4a3a'],
    ],
  }),
  makeCase('ember', 'Ember Case', 250, ['#c4561c', '#ffc46b'], {
    milspec: [
      ['UMP-45', 'Smoulder', 'fade', '#3a1410', '#a8331c', '#f08a4b'],
      ['Glock-18', 'Kindling', 'tiger', '#c4561c', '#2a1a12', '#e0962f'],
      ['P250', 'Oat Field', 'camo', '#ede4d6', '#c9a77c', '#8a6a48'],
      ['MAC-10', 'Charcoal', 'carbon', '#241c17', '#3b2f27', '#5a4638'],
      ['Nova', 'Birch Bark', 'stripes', '#f4efe6', '#2a2420', '#d8cfc2'],
      ['Five-SeveN', 'Hearthstone', 'marble', '#8d847b', '#4f4741', '#c7beb4'],
    ],
    restricted: [
      ['M4A1-S', 'Cloudberry', 'fade', '#e0962f', '#ffd27a', '#c4561c'],
      ['Desert Eagle', 'Copper Kettle', 'marble', '#b8642f', '#e29a5a', '#6a3416'],
      ['MP9', 'Lantern', 'hex', '#2a1a12', '#ffc46b', '#c4561c'],
      ['Galil AR', 'Fox Fur', 'tiger', '#d9682a', '#f6efe6', '#3a2618'],
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
      ['Talon Knife', 'Charcoal Damascus', 'damascus', '#2e241d', '#f08a4b', '#110d0a'],
    ],
  }),
  makeCase('aurora', 'Aurora Case', 500, ['#2f6f73', '#9be7c4'], {
    milspec: [
      ['SSG 08', 'Moss', 'camo', '#4f6b3a', '#7d9a5a', '#2e3d22'],
      ['Glock-18', 'Frostbite', 'fade', '#dff3ff', '#8cc8ea', '#3b6d8f'],
      ['MP9', 'Snowdrift', 'waves', '#f4f8fb', '#c5d7e4', '#8ea8bc'],
      ['Nova', 'Spruce', 'camo', '#1f3b2c', '#3f6a4c', '#122119'],
      ['P250', 'Fjord', 'waves', '#1d3b57', '#3f7aa8', '#9cc6e4'],
      ['MAC-10', 'Ice Shelf', 'geo', '#cfe9f5', '#6fa8c8', '#ffffff'],
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
      ['USP-S', 'Fjordglass', 'circuit', '#0f2a3d', '#4fc3d9', '#d8f6ff'],
    ],
    covert: [
      ['AWP', 'Aurora Borealis', 'waves', '#06121f', '#2ef0a6', '#b06bff'],
      ['AK-47', 'Frozen Lake', 'marble', '#dff6ff', '#4aa3d0', '#0d3550'],
    ],
    rare: [
      ['Bayonet', 'Aurora Fade', 'fade', '#2ef0a6', '#4fa0ff', '#b06bff'],
      ['Karambit', 'Starlight', 'splatter', '#0a0f24', '#f3f6ff', '#6b7cff'],
      ['Flip Knife', 'Glacier Marble', 'marble', '#ffffff', '#8fd3f0', '#2a6f95'],
      ['Driver Gloves', 'Polar', 'stripes', '#f4f8fb', '#3b6d8f', '#c5d7e4'],
    ],
  }),
  makeCase('skog', 'Skog Case', 750, ['#2e4a2a', '#c8d98a'], {
    milspec: [
      ['Nova', 'Lichen', 'splatter', '#7a8a5a', '#c8d0a0', '#3a4a2a'],
      ['P250', 'Fern', 'camo', '#2f5a2a', '#6a9a4a', '#1a2e16'],
      ['Glock-18', 'Toadstool', 'splatter', '#c42a1c', '#fff4e4', '#6a120c'],
      ['MAC-10', 'Bark', 'camo', '#4a3a2c', '#7a6450', '#2a1f16'],
      ['SG 553', 'Bog', 'waves', '#3a4028', '#5a6a3a', '#22261a'],
      ['Five-SeveN', 'Acorn', 'solid', '#8a5a2a', '#c4945a', '#4a2e14'],
    ],
    restricted: [
      ['UMP-45', 'Huldra', 'marble', '#3f6a4c', '#c8e0b8', '#1f3a2a'],
      ['MP9', 'Mossy Stone', 'marble', '#7a7a70', '#5a8a3a', '#3a3a34'],
      ['XM1014', 'Wolf Track', 'tiger', '#8a8a84', '#2a2a28', '#d8d8d0'],
      ['M4A1-S', 'Birchlight', 'stripes', '#f4f0e6', '#2a2420', '#c8d98a'],
    ],
    classified: [
      ['AWP', 'Troll Bridge', 'geo', '#4a5a3a', '#8a7a5a', '#2a2a1f'],
      ['USP-S', "Will-o'-Wisp", 'fade', '#0e1f16', '#7affc4', '#e8fff4'],
      ['Desert Eagle', 'Elk Antler', 'damascus', '#e8dcc4', '#8a6a48', '#3a2a1c'],
    ],
    covert: [
      ['AK-47', 'Forest Spirit', 'waves', '#0f2a1a', '#5affa0', '#c8ffe4'],
      ['M4A4', 'Old Growth', 'marble', '#2a3a1f', '#7a9a4a', '#4a3424'],
    ],
    rare: [
      ['Talon Knife', 'Amber Sap', 'fade', '#ffd06a', '#d8781c', '#5a2a0c'],
      ['Karambit', 'Mushroom Ring', 'splatter', '#1f2e16', '#ff5a4a', '#fff4e4'],
      ['Butterfly Knife', 'Moonlit Fern', 'hex', '#0e1a24', '#8adf9a', '#d8ecff'],
      ['Sport Gloves', 'Lumberjack', 'stripes', '#a82a22', '#1f1a16', '#e8d8b8'],
    ],
  }),
  makeCase('midnight', 'Midnight Case', 1000, ['#2a1f4f', '#ff5fa2'], {
    milspec: [
      ['Galil AR', 'Streetlight', 'stripes', '#1a1a22', '#ffcf4a', '#3a3a48'],
      ['P250', 'Night Owl', 'camo', '#2b2440', '#5a4b7a', '#151022'],
      ['MAC-10', 'Neon Rain', 'splatter', '#120f1f', '#3ef2ff', '#ff4fd8'],
      ['Glock-18', 'Static', 'digital', '#202028', '#8a8aa0', '#d8d8e8'],
      ['SG 553', 'Asphalt', 'carbon', '#1c1c20', '#2c2c33', '#45454f'],
      ['Nova', 'Firefly', 'hex', '#0f1a12', '#c8ff5a', '#2d4a1f'],
    ],
    restricted: [
      ['M4A1-S', 'Moonlit', 'fade', '#d9dcff', '#6b70c8', '#1c1d3f'],
      ['P90', 'Arcade', 'geo', '#1a0f2e', '#ff4fd8', '#3ef2ff'],
      ['MP9', 'Glowworm', 'waves', '#08130c', '#9dff5a', '#2b6b2b'],
      ['Desert Eagle', 'Night Market', 'hex', '#2a0f1f', '#ff7a45', '#ffd36b'],
    ],
    classified: [
      ['AK-47', 'Neon Fox', 'flames', '#170a26', '#ff5fa2', '#ffb04f'],
      ['AWP', 'Lightning Bug', 'circuit', '#06100a', '#d6ff4a', '#3ef2ff'],
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
  makeCase('rune', 'Rune Case', 2500, ['#3b2a1a', '#d9b45a'], {
    milspec: [
      ['Glock-18', 'Longship', 'waves', '#2a3a4a', '#8a6a3a', '#d8c8a8'],
      ['P250', 'Shieldwall', 'geo', '#8a2a1c', '#d8b45a', '#3a2a1a'],
      ['MAC-10', 'Iron Rivet', 'hex', '#3a3a3e', '#6a6a70', '#1f1f22'],
      ['Nova', 'Mead', 'fade', '#f4c45a', '#c4842a', '#5a3410'],
      ['SSG 08', 'Fjord Raider', 'stripes', '#1d3b57', '#d8d0c0', '#8a2a1c'],
      ['Galil AR', 'Chainmail', 'hex', '#8a8a90', '#4a4a50', '#c8c8d0'],
    ],
    restricted: [
      ['Five-SeveN', 'Runestone', 'marble', '#8d847b', '#c42a1c', '#4f4741'],
      ['FAMAS', 'Raven', 'carbon', '#0e0e12', '#2a2a3a', '#5a5a7a'],
      ['MP9', 'Skald', 'circuit', '#2a1a10', '#d9b45a', '#6a4a2a'],
      ['UMP-45', 'Bearskin', 'tiger', '#4a2e1c', '#2a1a10', '#8a5a34'],
    ],
    classified: [
      ['AUG', 'Yggdrasil', 'circuit', '#0f1f14', '#d9b45a', '#5a9a4a'],
      ['Desert Eagle', 'Mjølner', 'damascus', '#4a4a52', '#a8c8ff', '#1f1f26'],
      ['AWP', 'Valkyrie', 'fade', '#f4f0ff', '#c8a8ff', '#3a3a6a'],
    ],
    covert: [
      ['AK-47', 'Ragnarok', 'flames', '#120808', '#ff3a1c', '#ffd36b'],
      ['M4A1-S', 'Bifrost', 'waves', '#ff5a5a', '#5affb0', '#6a7aff'],
    ],
    rare: [
      ['Bayonet', 'Gold Rune', 'damascus', '#ffe08a', '#b8862a', '#4a3410'],
      ['Karambit', 'Bifrost Fade', 'fade', '#ff5a8a', '#ffe05a', '#5ac8ff'],
      ['Butterfly Knife', 'Fenrir', 'tiger', '#c8ccd4', '#1f1f26', '#8a90a0'],
      ['Driver Gloves', 'Berserker', 'stripes', '#2a1a10', '#c42a1c', '#d9b45a'],
    ],
  }),
  makeCase('hoard', "Dragon's Hoard", 5000, ['#1a0a0a', '#ffd36b'], {
    milspec: [
      ['Glock-18', 'Copper Coin', 'hex', '#a8582a', '#e09a5a', '#5a2a10'],
      ['P250', 'Scaled', 'hex', '#2a3a2a', '#5a7a4a', '#121a12'],
      ['MAC-10', 'Cave Smoke', 'splatter', '#2a2626', '#5a5450', '#0e0c0c'],
      ['Nova', 'Treasure Map', 'geo', '#e8d4a8', '#8a5a2a', '#c42a1c'],
      ['SG 553', 'Ash', 'carbon', '#3a3634', '#58524e', '#1e1c1a'],
      ['MP9', 'Rusted Crown', 'marble', '#8a4a1f', '#c4842a', '#3a1f0c'],
    ],
    restricted: [
      ['Five-SeveN', 'Ruby', 'fade', '#ff3a5a', '#8a0a1f', '#2a0008'],
      ['UMP-45', 'Emerald', 'geo', '#0a5a3a', '#2affa0', '#022a1a'],
      ['Galil AR', 'Wyrm Scale', 'hex', '#4a0e0e', '#c42a1c', '#1a0404'],
      ['XM1014', 'Sapphire', 'fade', '#3a6aff', '#0a1a6a', '#000a2a'],
    ],
    classified: [
      ['USP-S', "Dragon's Eye", 'fade', '#ffe05a', '#ff6a1c', '#1a0400'],
      ['AUG', 'Gold Leaf', 'marble', '#fff0b8', '#d8a82a', '#6a4a0a'],
      ['P90', 'Gemstorm', 'splatter', '#1a0a2a', '#ff3a8a', '#3affd8'],
    ],
    covert: [
      ['AWP', 'Dragonfire', 'flames', '#1a0404', '#ff4a1c', '#ffe46b'],
      ['AK-47', 'Hoard Gold', 'damascus', '#ffe08a', '#c4902a', '#5a3a08'],
    ],
    rare: [
      ['Karambit', 'Dragon Glass', 'marble', '#0a0a0e', '#5a2aff', '#ff4ad8'],
      ['Butterfly Knife', 'Gold Fade', 'fade', '#fff4c4', '#ffc42a', '#a8620a'],
      ['Talon Knife', 'Obsidian', 'damascus', '#1a1a1f', '#4a4a5a', '#000000'],
      ['Sport Gloves', 'Dragonhide', 'tiger', '#6a0e0e', '#1a0404', '#ffb04f'],
    ],
  }),
  makeCase('crown', 'Northern Crown', 10_000, ['#1a2a4a', '#e8eef8'], {
    milspec: [
      ['Glock-18', 'Silver Thread', 'stripes', '#c8ccd4', '#1a2a4a', '#8a90a0'],
      ['P250', 'Ermine', 'splatter', '#fbfaf6', '#141414', '#e8e4dc'],
      ['MAC-10', 'Royal Seal', 'hex', '#5a0e1f', '#d9b45a', '#2a0610'],
      ['Nova', 'Velvet', 'fade', '#6a1a3a', '#2a0618', '#a83a6a'],
      ['SSG 08', 'Palace Guard', 'stripes', '#a82a22', '#1a2a4a', '#f4f0e6'],
      ['UMP-45', 'Frost Throne', 'geo', '#dff3ff', '#8cc8ea', '#3b6d8f'],
    ],
    restricted: [
      ['MP9', 'Scepter', 'damascus', '#ffe08a', '#a8862a', '#3a2a0a'],
      ['Five-SeveN', 'Pearl', 'marble', '#fbf8f2', '#e8dcd0', '#c8b8c8'],
      ['FAMAS', 'Ice Palace', 'circuit', '#0f2a3d', '#d8f6ff', '#6fa8c8'],
      ['XM1014', 'Coronation', 'flames', '#1a2a4a', '#d9b45a', '#f4f0e6'],
    ],
    classified: [
      ['M4A1-S', 'Sapphire Crown', 'fade', '#a8c8ff', '#2a4aff', '#0a0a3a'],
      ['Desert Eagle', 'Silver Wolf', 'tiger', '#e8eaf0', '#5a5e6a', '#2a2c34'],
      ['AWP', 'Polar Monarch', 'waves', '#f4fbff', '#5ab8e8', '#1a2a4a'],
    ],
    covert: [
      ['AK-47', 'Winter King', 'marble', '#ffffff', '#8adfff', '#1a3a6a'],
      ['USP-S', 'Starlit Crown', 'splatter', '#0a0f24', '#ffe08a', '#f3f6ff'],
    ],
    rare: [
      ['Butterfly Knife', 'Sapphire', 'fade', '#5aa8ff', '#1a3aff', '#00083a'],
      ['Karambit', 'Crown Jewel', 'marble', '#ff3a5a', '#3a6aff', '#ffe08a'],
      ['Bayonet', 'Silver Damascus', 'damascus', '#e8eaf0', '#8a90a0', '#3a3e48'],
      ['Driver Gloves', 'Royal Ermine', 'stripes', '#fbfaf6', '#6a1a3a', '#141414'],
    ],
  }),
  makeCase('starfall', 'Starfall Case', 25_000, ['#06061a', '#b06bff'], {
    milspec: [
      ['Glock-18', 'Stardust', 'splatter', '#0a0a1f', '#d8d8ff', '#5a5a9a'],
      ['P250', 'Moon Rock', 'marble', '#8a8a90', '#4a4a50', '#c8c8d0'],
      ['MAC-10', 'Comet Tail', 'fade', '#e8f4ff', '#5aa8ff', '#0a1a3a'],
      ['Nova', 'Orbit', 'waves', '#0f0f2a', '#3a3a8a', '#8a8aff'],
      ['SG 553', 'Dark Matter', 'carbon', '#08080e', '#14141f', '#24243a'],
      ['MP9', 'Meteor Shower', 'flames', '#0a0a1f', '#ff8a3a', '#fff0b8'],
    ],
    restricted: [
      ['Five-SeveN', 'Red Giant', 'fade', '#ffb04f', '#e2301d', '#3a0804'],
      ['UMP-45', 'Constellation', 'circuit', '#06061a', '#ffffff', '#3a3a8a'],
      ['Galil AR', 'Asteroid Belt', 'geo', '#3a342e', '#8a7a6a', '#1a1612'],
      ['XM1014', 'Solar Wind', 'waves', '#ffe05a', '#ff8a3a', '#5a1a6a'],
    ],
    classified: [
      ['AUG', 'Event Horizon', 'fade', '#000000', '#ff8a3a', '#ffe8b8'],
      ['Desert Eagle', 'Pulsar', 'circuit', '#04041a', '#5affff', '#b06bff'],
      ['M4A1-S', 'Cosmic Dust', 'splatter', '#1a0a3a', '#ff6ad8', '#6ad8ff'],
    ],
    covert: [
      ['AWP', 'Starfall', 'flames', '#06061a', '#b06bff', '#ffffff'],
      ['AK-47', 'Black Hole', 'fade', '#000000', '#3a1a6a', '#ffb04f'],
    ],
    rare: [
      ['Karambit', 'Galaxy', 'splatter', '#120a2e', '#ff6ad8', '#f3f6ff'],
      ['Butterfly Knife', 'Nebula Fade', 'fade', '#ff5fa2', '#8c5ad8', '#2ef0e0'],
      ['Talon Knife', 'Meteorite', 'damascus', '#3a3a42', '#8a8a96', '#14141a'],
      ['Sport Gloves', 'Supernova', 'stripes', '#06061a', '#ffe05a', '#b06bff'],
    ],
  }),
  makeCase('eternal', 'Eternal Flame', 50_000, ['#1a0400', '#fff4c4'], {
    milspec: [
      ['Glock-18', 'Cinder Gold', 'splatter', '#1a0a04', '#ffc42a', '#5a2a0a'],
      ['P250', 'Ember Scale', 'hex', '#3a0e04', '#ff6a1c', '#120400'],
      ['MAC-10', 'Molten', 'marble', '#ff8a1c', '#ffe05a', '#6a1a04'],
      ['Nova', 'Heat Haze', 'waves', '#ffb04f', '#ff6a3a', '#ffe8c4'],
      ['SG 553', 'Soot', 'carbon', '#1a1412', '#2c2420', '#4a3a30'],
      ['UMP-45', 'Brazier', 'geo', '#3a2a1a', '#d8862a', '#120a04'],
    ],
    restricted: [
      ['MP9', 'White Heat', 'fade', '#ffffff', '#fff0b8', '#ffb04f'],
      ['Five-SeveN', 'Forge', 'damascus', '#2a1a12', '#ff6a1c', '#0e0806'],
      ['FAMAS', 'Firebird', 'flames', '#3a0804', '#ff4a1c', '#ffe05a'],
      ['XM1014', 'Lava Flow', 'marble', '#1a0400', '#ff3a0a', '#ffb04f'],
    ],
    classified: [
      ['AWP', 'Undying', 'flames', '#000000', '#ffb04f', '#ffffff'],
      ['USP-S', 'Blue Flame', 'fade', '#ffffff', '#5ac8ff', '#0a1a6a'],
      ['Desert Eagle', 'Sun Forged', 'damascus', '#fff0b8', '#ffb02a', '#6a3a04'],
    ],
    covert: [
      ['AK-47', 'Eternal Flame', 'flames', '#0e0200', '#ff5a1c', '#fff8d8'],
      ['M4A4', 'Diamond Fire', 'geo', '#ffffff', '#ffd06a', '#a8e8ff'],
    ],
    rare: [
      ['Butterfly Knife', 'Eternal Fade', 'fade', '#fff8d8', '#ff8a1c', '#c4100c'],
      ['Karambit', 'Hearth Diamond', 'geo', '#ffffff', '#ffe08a', '#a8e8ff'],
      ['Talon Knife', 'Molten Damascus', 'damascus', '#ffb04f', '#ff3a0a', '#1a0400'],
      ['Sport Gloves', 'Peiskos', 'stripes', '#2a1a12', '#ff6a1c', '#ffe05a'],
    ],
  }),
];

/** The slot machine: three reels, three rows, five lines (the rows and both diagonals). */
export const SLOT_SYMBOLS = ['cherry', 'lemon', 'bell', 'star', 'diamond', 'seven', 'flame'] as const;
export type SlotSymbol = (typeof SLOT_SYMBOLS)[number];
/** Three on a line pays this many times the whole bet, and every line pays. The flame stands in for anything, and three
 * flames is the jackpot. With the strips below about half of all spins win something and the machine pays back
 * about 99.6% over time (server/test/casino.test.ts checks both). */
export const SLOT_PAYS: Record<SlotSymbol, number> = { cherry: 1, lemon: 2, bell: 3, star: 5, diamond: 10, seven: 20, flame: 100 };
/** Two cherries from the left pay half the bet back. */
export const SLOT_TWO_CHERRIES = 0.5;
export const SLOT_LINES = [
  [1, 1, 1],
  [0, 0, 0],
  [2, 2, 2],
  [0, 1, 2],
  [2, 1, 0],
];
/** Even amounts, so half a bet (two cherries) is always a whole number of chips. */
export const SLOT_BETS = [10, 20, 50, 100, 200, 500, 1000, 2500, 5000, 10_000, 25_000];
/** Each reel's strip, top to bottom, as counts of each symbol (spread out evenly when the strip is built). */
const STRIP_COUNTS: Record<SlotSymbol, number>[] = [
  { cherry: 8, lemon: 8, bell: 4, star: 4, diamond: 2, seven: 2, flame: 1 },
  { cherry: 8, lemon: 8, bell: 4, star: 4, diamond: 2, seven: 2, flame: 1 },
  { cherry: 8, lemon: 8, bell: 4, star: 4, diamond: 2, seven: 2, flame: 1 },
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

/** What a line of three pays, times the bet. */
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

/** Premium pets, bought with a hearth's chips, that sit by your seat at its fires. */
export const PETS = [
  { id: 'blackcat', name: 'A black cat', price: 5_000 },
  { id: 'penguin', name: 'A penguin', price: 10_000 },
  { id: 'redpanda', name: 'A red panda', price: 25_000 },
  { id: 'unicorn', name: 'A unicorn', price: 50_000 },
  { id: 'dragon', name: 'A dragon', price: 100_000 },
  { id: 'phoenix', name: 'A phoenix', price: 250_000 },
  { id: 'goldwolf', name: 'A golden wolf', price: 500_000 },
];
