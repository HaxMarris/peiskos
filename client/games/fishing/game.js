// Fireside Angler: fish by hand at five waters, collect 115 species and 21 hats, and leave idle
// rods fishing while you're away. Peiskos frames this page and keeps the save (see client/js/fishing.js).
(() => {
'use strict';
// ---------- data ----------
const L = (body, belly, fin, h, x) => Object.assign({ body, belly, fin, h }, x || {});
const F = (id, name, min, max, base, r, tags, rod, look) => ({ id, name, min, max, base, r, tags, rod, look });
const RARITY = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
const RARITY_W = [30, 16, 7, 2.5, .6];
const STAR_MUL = [.6, 1, 1.5, 2.5, 5];
const PONDS = [
  { id: 'mill', name: 'Millpond', cost: 0, idle: 1, blurb: 'Reeds, a leaky dock, and fish that are happy to see you.',
    sky: ['#f2b98a', '#f7dcb8'], water: ['#6f8f86', '#3e5a55'], far: '#8a9a6e', near: '#4b5a37', feature: 'reeds',
    fish: [
      F('minnow', 'Minnow', 3, 9, 2, 1, ['small'], 1, L('#9aa89a', '#e9e4d2', '#7d8a7b', .28)),
      F('bleak', 'Bleak', 8, 20, 3, 1, ['small'], 1, L('#b9c4c8', '#f4f2ea', '#98a3a6', .25)),
      F('gudgeon', 'Gudgeon', 8, 18, 3, 1, ['bottom'], 1, L('#9c8c6a', '#e8dfc8', '#7a6c50', .26, { spots: '#5d5038', whiskers: 1 })),
      F('roach', 'Roach', 10, 35, 4, 1, ['grazer'], 1, L('#a9b4b8', '#f0ebe0', '#c8553a', .34)),
      F('rudd', 'Rudd', 12, 38, 5, 2, ['grazer'], 1, L('#b5a660', '#f2e6b8', '#d2452a', .38)),
      F('perch', 'Perch', 12, 45, 7, 2, ['predator'], 1, L('#8f9a45', '#e9e0b4', '#d9632b', .36, { stripes: '#4b5124' })),
      F('ruffe', 'Ruffe', 8, 25, 6, 2, ['bottom'], 1, L('#8c8a5c', '#e2dcb8', '#6c6a44', .32, { spots: '#4e4c30', sail: 1 })),
      F('crucian', 'Crucian Carp', 10, 40, 9, 2, ['grazer'], 1, L('#c39a3e', '#f1dfa4', '#9c6a2c', .48)),
      F('chub', 'Chub', 20, 60, 13, 3, ['predator'], 1, L('#7d8079', '#e6e2d4', '#a7552f', .3)),
      F('tench', 'Tench', 20, 60, 17, 3, ['grazer', 'bottom'], 1, L('#5e6b2f', '#b6a95a', '#3d4520', .34)),
      F('carp', 'Common Carp', 30, 100, 28, 3, ['grazer', 'bottom'], 1, L('#a5823e', '#ecd9a0', '#7c5c28', .4, { whiskers: 1 })),
      F('eel', 'Eel', 40, 120, 38, 4, ['bottom', 'predator'], 1, L('#4a4630', '#b9ab73', '#3a3624', .1, { shape: 'eel' })),
      F('mirrorcarp', 'Mirror Carp', 40, 110, 57, 4, ['grazer', 'bottom'], 2, L('#b08a48', '#f0dca8', '#7f602e', .42, { spots: '#e8c97a', whiskers: 1 })),
      F('goldtench', 'Golden Tench', 25, 55, 150, 5, ['grazer', 'rare'], 2, L('#e3a535', '#ffe39a', '#c4561c', .34)),
      F('stickleback', 'Stickleback', 3, 8, 2, 1, ['small'], 1, L('#7a8a5a', '#e8e0c0', '#5a6a3a', .3, { sail: 1 })),
      F('loach', 'Stone Loach', 6, 14, 3, 1, ['bottom', 'small'], 1, L('#9a8a60', '#ece2c4', '#7a6a40', .18, { spots: '#5a4a2a', whiskers: 1 })),
      F('bitterling', 'Bitterling', 4, 9, 6, 2, ['small'], 1, L('#a8b8c0', '#f0e8f0', '#d06a8a', .42)),
      F('pumpkinseed', 'Pumpkinseed', 8, 25, 8, 2, ['predator'], 1, L('#8a9a5a', '#f2b45a', '#3a7a9a', .5, { spots: '#d8603a' })),
      F('grasscarp', 'Grass Carp', 40, 120, 21, 3, ['grazer'], 1, L('#8a9a6a', '#e0e0c8', '#6a7a4a', .3)),
      F('bullhead', 'Bullhead', 10, 30, 19, 3, ['bottom'], 1, L('#5a4a3a', '#c8b090', '#3a2a1a', .3, { whiskers: 1 })),
      F('leathercarp', 'Leather Carp', 40, 110, 52, 4, ['grazer', 'bottom'], 2, L('#7a6a48', '#d8c8a0', '#5a4a30', .42, { whiskers: 1 })),
      F('ghostcarp', 'Ghost Carp', 40, 100, 47, 4, ['grazer', 'bottom'], 2, L('#e8e4d8', '#ffffff', '#c8b8a0', .4, { whiskers: 1, spots: '#e0a050' })),
      F('orfe', 'Golden Orfe', 25, 60, 130, 5, ['rare'], 2, L('#f0a040', '#ffe8c0', '#e07030', .3)),
    ] },
  { id: 'birch', name: 'Birch Lake', cost: 1200, idle: .92, blurb: 'Pale trunks, cold clear water, and the first real predators.',
    sky: ['#e9a77f', '#f4d4b3'], water: ['#5f8494', '#2d4b59'], far: '#d9cfc0', near: '#3b4a3b', feature: 'birches',
    fish: [
      F('dace', 'Dace', 12, 30, 13, 1, ['small'], 1, L('#a7b3b6', '#f1efe6', '#8c979a', .26)),
      F('bream', 'Bream', 25, 70, 17, 1, ['grazer', 'bottom'], 1, L('#a58e5e', '#e8dcb6', '#5d4c33', .52)),
      F('silverbream', 'Silver Bream', 15, 35, 14, 1, ['grazer'], 1, L('#c2c6c0', '#f5f4ee', '#b26a4e', .5)),
      F('ide', 'Ide', 25, 70, 22, 2, ['grazer'], 1, L('#9a9a8a', '#ece6d6', '#d0603a', .32)),
      F('trout', 'Brown Trout', 25, 80, 26, 2, ['predator'], 1, L('#9c7a45', '#efdcae', '#7a5a30', .3, { spots: '#5b2a17' })),
      F('rainbow', 'Rainbow Trout', 25, 75, 33, 2, ['predator'], 1, L('#7f9a8a', '#f2e6e0', '#6f8579', .3, { stripes: '#d9708a', spots: '#3e4a40' })),
      F('vendace', 'Vendace', 10, 25, 59, 3, ['cold'], 1, L('#b0bcc6', '#f2f6f8', '#8f9ca8', .26)),
      F('asp', 'Asp', 40, 90, 39, 3, ['predator'], 1, L('#8a96a0', '#eef0ee', '#6c7680', .27)),
      F('zander', 'Zander', 35, 100, 46, 3, ['predator'], 1, L('#8c9a92', '#e6e6da', '#606b62', .27, { stripes: '#5a645c' })),
      F('pike', 'Pike', 40, 140, 72, 3, ['predator'], 1, L('#6c7d3a', '#e1dcaa', '#a65a2a', .22, { spots: '#d8d39a' })),
      F('burbot', 'Burbot', 30, 90, 100, 4, ['bottom'], 1, L('#6b5b3a', '#c7b789', '#4c4029', .18, { shape: 'eel', spots: '#3f3320' })),
      F('barbel', 'Barbel', 30, 90, 79, 4, ['bottom'], 2, L('#8c7a52', '#e6d8b0', '#b0603a', .27, { whiskers: 1 })),
      F('wels', 'Wels Catfish', 80, 260, 300, 5, ['bottom', 'predator', 'rare'], 3, L('#3f3a33', '#a99f8a', '#2b2722', .24, { whiskers: 1 })),
      F('palepike', 'Pale Pike', 60, 130, 390, 5, ['predator', 'rare'], 3, L('#d8dccb', '#ffffff', '#b5b9a6', .22, { spots: '#f6f2dc' })),
      F('yellowperch', 'Yellow Perch', 15, 35, 17, 1, ['predator'], 1, L('#c8b040', '#f4ecc0', '#d88a30', .34, { stripes: '#6a6020' })),
      F('lakechub', 'Lake Chub', 10, 25, 15, 1, ['small'], 1, L('#8a908a', '#ece8e0', '#6a706a', .28)),
      F('sucker', 'White Sucker', 25, 50, 21, 1, ['bottom', 'grazer'], 1, L('#8a7a6a', '#e8e0d4', '#6a5a4a', .28)),
      F('brooktrout', 'Brook Trout', 20, 60, 42, 2, ['predator'], 1, L('#4a6a4a', '#f08a5a', '#d8603a', .3, { spots: '#e8d070' })),
      F('shiner', 'Golden Shiner', 10, 25, 33, 2, ['grazer'], 1, L('#d8c070', '#fff0c0', '#c8a040', .34)),
      F('crappie', 'Black Crappie', 15, 35, 37, 2, ['predator'], 1, L('#7a8070', '#e8e8dc', '#4a5040', .46, { spots: '#2a3020' })),
      F('lakewhitefish', 'Lake Whitefish', 30, 70, 84, 3, ['cold'], 1, L('#c0c8cc', '#f6f8f8', '#98a4a8', .3)),
      F('muskie', 'Muskellunge', 80, 150, 160, 4, ['predator'], 2, L('#7a8a5a', '#e8e4c0', '#5a6a3a', .2, { stripes: '#4a5a30' })),
      F('bowfin', 'Bowfin', 40, 90, 130, 4, ['predator', 'bottom'], 1, L('#5a6a4a', '#c8c8a0', '#3a4a2a', .24, { sail: 1 })),
    ] },
  { id: 'fjord', name: 'Grey Fjord', cost: 6000, idle: .85, blurb: 'Salt water under steep cliffs. Bring shrimp.',
    sky: ['#b9a6a8', '#e8d2c0'], water: ['#486b7c', '#1d3442'], far: '#6e7477', near: '#3a3f42', feature: 'cliffs',
    fish: [
      F('herring', 'Herring', 20, 40, 45, 1, ['sea'], 1, L('#5c8ba0', '#eef2f4', '#3f6476', .26)),
      F('mackerel', 'Mackerel', 20, 50, 59, 1, ['sea'], 1, L('#3d7a8c', '#e9eef0', '#2c5662', .25, { stripes: '#1d3c48' })),
      F('whiting', 'Whiting', 20, 50, 65, 1, ['sea'], 1, L('#b9b49a', '#f3f1e8', '#99947c', .26)),
      F('pollock', 'Pollock', 35, 110, 91, 2, ['sea', 'predator'], 1, L('#5d6a52', '#e0e2d4', '#3f4838', .27)),
      F('haddock', 'Haddock', 30, 80, 100, 2, ['sea', 'bottom'], 1, L('#7f7d78', '#ecebe6', '#5a5854', .28, { spots: '#2f2e2b' })),
      F('cod', 'Cod', 40, 150, 120, 2, ['sea', 'bottom'], 1, L('#a09468', '#ece6cf', '#776d4c', .3, { spots: '#6d6444', whiskers: 1 })),
      F('gurnard', 'Red Gurnard', 20, 50, 150, 3, ['sea', 'bottom'], 1, L('#c8553a', '#f6d6c4', '#e0864a', .3, { sail: 1 })),
      F('ling', 'Ling', 60, 180, 170, 3, ['sea', 'bottom'], 1, L('#6f6a4e', '#d8d2b4', '#504c38', .16, { shape: 'eel' })),
      F('seabass', 'Sea Bass', 30, 90, 200, 3, ['sea', 'predator'], 1, L('#8e9ca4', '#f2f4f4', '#6c7a82', .3)),
      F('wolffish', 'Wolffish', 50, 150, 270, 4, ['sea', 'bottom'], 1, L('#6f7883', '#b9c0c5', '#4c5259', .24, { stripes: '#3d434a' })),
      F('monkfish', 'Monkfish', 40, 200, 430, 4, ['sea', 'deep'], 2, L('#6b5843', '#b9a68a', '#4d3f2f', .55, { spots: '#4a3c2c' })),
      F('conger', 'Conger Eel', 80, 250, 450, 4, ['sea', 'predator'], 2, L('#4f5a60', '#c8ccc8', '#353d42', .1, { shape: 'eel' })),
      F('halibut', 'Halibut', 60, 260, 590, 5, ['sea', 'bottom', 'rare'], 3, L('#5d5444', '#efe9dc', '#463f33', .5, { spots: '#3e372c' })),
      F('spurdog', 'Spurdog', 60, 120, 530, 5, ['sea', 'predator', 'rare'], 3, L('#6f7276', '#d6d8d8', '#55585c', .2, { spots: '#e6e6e6' })),
      F('sprat', 'Sprat', 8, 16, 54, 1, ['sea', 'small'], 1, L('#7aa0b0', '#f2f6f8', '#5a8090', .24)),
      F('garfish', 'Garfish', 40, 90, 73, 1, ['sea', 'predator'], 1, L('#3f7a6a', '#e8f2ec', '#2f5a4e', .09, { shape: 'eel' })),
      F('plaice', 'Plaice', 20, 60, 140, 2, ['sea', 'bottom'], 1, L('#8a7a60', '#f0ece0', '#6a5a40', .5, { spots: '#e0803a' })),
      F('wrasse', 'Ballan Wrasse', 20, 50, 150, 2, ['sea'], 1, L('#6a8a4a', '#e0d8a0', '#4a6a3a', .38, { spots: '#e0c060' })),
      F('sole', 'Lemon Sole', 20, 45, 130, 2, ['sea', 'bottom'], 1, L('#c8a860', '#f6eedc', '#a88a40', .48)),
      F('turbot', 'Turbot', 40, 100, 250, 3, ['sea', 'bottom'], 1, L('#6a5a48', '#e8e0d0', '#4a3a28', .6, { spots: '#3a2a18' })),
      F('johndory', 'John Dory', 25, 60, 240, 3, ['sea'], 1, L('#a89a70', '#ece0c0', '#6a5a40', .6, { spots: '#2a1a10' })),
      F('salmon', 'Atlantic Salmon', 50, 120, 450, 4, ['sea', 'predator'], 2, L('#7a8a98', '#f2f0ec', '#5a6a78', .27, { spots: '#2a3440' })),
      F('tuna', 'Bluefin Tuna', 150, 300, 820, 5, ['sea', 'predator', 'rare'], 4, L('#1f3a5a', '#d8e0e8', '#e0c040', .3)),
    ] },
  { id: 'frozen', name: 'Frozen Lake', cost: 30000, idle: .78, blurb: 'Drill a hole, sit on a bucket, wait for something pale and silver.',
    sky: ['#9fb4cc', '#e2e8ee'], water: ['#9fc2d4', '#4e7d97'], far: '#cfd9e2', near: '#8aa1b3', feature: 'ice',
    fish: [
      F('smelt', 'Smelt', 10, 25, 210, 1, ['cold', 'small'], 1, L('#b6c8cc', '#f6fafa', '#9bb0b4', .22)),
      F('whitefish', 'Whitefish', 25, 60, 260, 1, ['cold'], 1, L('#b8c3cc', '#f4f7f9', '#8b98a3', .3)),
      F('cisco', 'Cisco', 15, 35, 290, 1, ['cold'], 1, L('#a8b8c8', '#eef4f8', '#7e8e9e', .27)),
      F('grayling', 'Grayling', 25, 60, 340, 2, ['cold'], 1, L('#8f95a8', '#e8e6ee', '#9a5a7a', .28, { sail: 1 })),
      F('char', 'Arctic Char', 30, 90, 470, 2, ['cold', 'predator'], 1, L('#5f6f7a', '#e6703a', '#d2552e', .29, { spots: '#f0d8b8' })),
      F('iceperch', 'Ice Perch', 15, 40, 420, 2, ['cold', 'predator'], 1, L('#a7b8a0', '#f0f4ea', '#e08a5a', .36, { stripes: '#6f8070' })),
      F('laketrout', 'Lake Trout', 40, 130, 790, 3, ['cold', 'predator'], 1, L('#4d5d4c', '#dfe2d0', '#3a4739', .28, { spots: '#d8dcc4' })),
      F('polarcod', 'Polar Cod', 15, 35, 940, 3, ['cold', 'deep'], 1, L('#9aa6ae', '#f2f4f6', '#788690', .28, { whiskers: 1 })),
      F('taimen', 'Taimen', 60, 150, 1200, 3, ['cold', 'predator'], 3, L('#7a5a48', '#e8c8b0', '#b0482a', .24, { spots: '#3a2a20' })),
      F('sculpin', 'Fourhorn Sculpin', 10, 30, 1000, 4, ['cold', 'bottom'], 1, L('#7a7060', '#d8ccb4', '#5a5040', .4, { spots: '#4a4030', sail: 1 })),
      F('icepike', 'Ice Pike', 60, 150, 1600, 4, ['cold', 'predator', 'rare'], 4, L('#a9c6d8', '#f3fbff', '#6f97b0', .22, { spots: '#ffffff' })),
      F('frosteel', 'Frost Eel', 60, 180, 2600, 5, ['cold', 'deep', 'rare'], 4, L('#7fb0c8', '#e6f6ff', '#4f87a3', .1, { shape: 'eel' })),
      F('crystalchar', 'Crystal Char', 40, 90, 3700, 5, ['cold', 'rare'], 4, L('rgba(190,230,255,.8)', '#ffffff', '#9fd0f0', .29, { glow: '#d8f4ff', spots: '#ffffff' })),
      F('ninespine', 'Ninespine Stickleback', 4, 9, 190, 1, ['cold', 'small'], 1, L('#8a9a8a', '#eef2ec', '#6a7a6a', .28, { sail: 1 })),
      F('pondsmelt', 'Pond Smelt', 8, 18, 220, 1, ['cold', 'small'], 1, L('#b0c4cc', '#f4fafc', '#90a4ac', .22)),
      F('peled', 'Peled', 25, 50, 270, 1, ['cold'], 1, L('#b8c0c8', '#f6f8fa', '#90989f', .3)),
      F('inconnu', 'Inconnu', 40, 110, 440, 2, ['cold', 'predator'], 1, L('#a8b0b0', '#f4f4f2', '#7a8484', .26)),
      F('beringcisco', 'Bering Cisco', 20, 45, 380, 2, ['cold'], 1, L('#a0b4c4', '#eef4f8', '#7890a0', .27)),
      F('snowtrout', 'Snow Trout', 25, 60, 420, 2, ['cold', 'predator'], 1, L('#c8d0d8', '#ffffff', '#a0acb8', .29, { spots: '#7a8a9a' })),
      F('lenok', 'Lenok', 30, 70, 940, 3, ['cold', 'predator'], 1, L('#6a6050', '#e8d8c0', '#9a5a3a', .28, { spots: '#3a2a20' })),
      F('lamprey', 'Arctic Lamprey', 20, 45, 1000, 3, ['cold', 'deep'], 1, L('#6a7480', '#c8d0d8', '#4a545e', .09, { shape: 'eel' })),
      F('glacierpike', 'Glacier Pike', 70, 140, 1600, 4, ['cold', 'predator'], 3, L('#8ab0c8', '#eef8ff', '#5a88a8', .22, { spots: '#d8f0ff' })),
      F('icesturgeon', 'Ice Sturgeon', 120, 300, 3700, 5, ['cold', 'deep', 'rare'], 4, L('#9ab4c4', '#eef6fa', '#6a8a9e', .2, { whiskers: 1, stripes: '#cfe6f2' })),
    ] },
  { id: 'aurora', name: 'Aurora Deep', cost: 120000, idle: .7, blurb: 'A black lake under green skies. The fish here glow back at you.',
    sky: ['#0d1626', '#1d3040'], water: ['#163844', '#081a22'], far: '#152530', near: '#0b141a', feature: 'aurora',
    fish: [
      F('lantern', 'Lanternfish', 5, 15, 760, 1, ['deep'], 1, L('#2f4c63', '#9fd8e6', '#22394b', .32, { glow: '#9ff0ff' })),
      F('hatchet', 'Hatchetfish', 4, 12, 850, 1, ['deep'], 1, L('#9aa8b8', '#e8f0f8', '#6a7888', .62, { glow: '#c8e8ff' })),
      F('glasseel', 'Glass Eel', 20, 60, 1400, 2, ['deep'], 1, L('rgba(200,240,255,.55)', 'rgba(240,255,255,.7)', 'rgba(160,220,240,.5)', .1, { shape: 'eel', glow: '#c8f6ff' })),
      F('viper', 'Viperfish', 15, 35, 1600, 2, ['deep', 'predator'], 1, L('#2a3a4a', '#6a8aa0', '#1a2632', .2, { glow: '#7fd8ff', spots: '#9ff0ff' })),
      F('starfin', 'Starfin', 10, 30, 1900, 2, ['deep'], 1, L('#3a3466', '#b8b0f0', '#6a5ab0', .34, { spots: '#ffffff', glow: '#d0c8ff' })),
      F('koi', 'Ember Koi', 30, 90, 2700, 3, ['ember'], 1, L('#f08a4b', '#fff1dc', '#c4561c', .34, { spots: '#fffaf3', glow: '#ffc46b' })),
      F('oarfish', 'Oarfish', 200, 800, 3700, 3, ['deep'], 4, L('#c8ccd8', '#f4f6fa', '#d2452a', .08, { shape: 'eel', glow: '#ffd0c0' })),
      F('deepangler', 'Lantern Angler', 20, 60, 4300, 3, ['deep', 'predator'], 4, L('#3a2a2a', '#7a5a50', '#2a1a1a', .5, { glow: '#ffe08a', whiskers: 1 })),
      F('moonray', 'Moon Ray', 80, 220, 5500, 4, ['deep', 'rare'], 5, L('#c9d3e6', '#f6f8ff', '#8f9cb8', .3, { shape: 'ray', glow: '#e9efff' })),
      F('ghostshark', 'Ghost Shark', 60, 150, 6800, 4, ['deep', 'rare'], 5, L('#b8b4c8', '#eeeaf6', '#8a86a0', .22, { glow: '#e0dcff' })),
      F('comet', 'Comet Trout', 40, 100, 8000, 4, ['ember', 'rare'], 5, L('#2a5a7a', '#c8f0ff', '#7ff0c8', .28, { stripes: '#7ff0c8', glow: '#9ff0e0' })),
      F('sturgeon', 'Aurora Sturgeon', 120, 400, 12000, 5, ['ember', 'rare'], 5, L('#3d6f62', '#bfeadb', '#2a4f45', .2, { stripes: '#7ff0c8', glow: '#7ff0c8', whiskers: 1 })),
      F('leviathan', 'Ember Leviathan', 300, 900, 46000, 5, ['ember', 'rare'], 5, L('#7a2a12', '#ffb35c', '#f08a4b', .26, { stripes: '#ffc46b', glow: '#ffb35c' })),
      F('bristlemouth', 'Bristlemouth', 3, 8, 760, 1, ['deep', 'small'], 1, L('#3a4a5a', '#8aa0b4', '#2a3644', .2, { glow: '#9fd0ff' })),
      F('emberminnow', 'Ember Minnow', 4, 10, 820, 1, ['ember', 'small'], 1, L('#e0703a', '#ffe0c0', '#c4561c', .28, { glow: '#ffb35c' })),
      F('sparkguppy', 'Spark Guppy', 3, 6, 870, 1, ['ember', 'small'], 1, L('#f2c230', '#fff4c8', '#f08a4b', .32, { glow: '#ffe08a', spots: '#fffaf3' })),
      F('gulper', 'Gulper Eel', 40, 120, 1600, 2, ['deep'], 1, L('#2a2a3a', '#6a6a8a', '#1a1a2a', .12, { shape: 'eel', glow: '#b8a0ff' })),
      F('nebulatetra', 'Nebula Tetra', 4, 9, 1700, 2, ['deep'], 1, L('#5a3a8a', '#e0c8ff', '#8a5ad0', .36, { glow: '#d8b8ff', stripes: '#7ff0c8' })),
      F('ghostpike', 'Ghost Pike', 50, 110, 1900, 2, ['deep', 'predator'], 1, L('rgba(220,230,255,.6)', 'rgba(255,255,255,.8)', 'rgba(180,200,240,.5)', .2, { glow: '#e0e8ff' })),
      F('starcarp', 'Starlight Carp', 40, 100, 3500, 3, ['ember'], 1, L('#2a3a6a', '#c8d8ff', '#4a5aa0', .4, { spots: '#ffffff', glow: '#c8d8ff', whiskers: 1 })),
      F('abysssnapper', 'Abyss Snapper', 30, 80, 3900, 3, ['deep', 'predator'], 4, L('#8a2a3a', '#ffb0b8', '#5a1a24', .36, { glow: '#ff9aa8' })),
      F('coelacanth', 'Coelacanth', 120, 200, 7100, 4, ['deep', 'rare'], 5, L('#2f4a6a', '#a8c0d8', '#1f3450', .3, { spots: '#e8f0ff', glow: '#a8d0ff' })),
      F('auroraserpent', 'Aurora Serpent', 400, 1200, 33000, 5, ['ember', 'deep', 'rare'], 5, L('#2a6a5a', '#bff0e0', '#7ff0c8', .08, { shape: 'eel', glow: '#7ff0c8' })),
    ] },
];
// Keep each water's list in rarity order, then by value, so the collection reads common to legendary.
PONDS.forEach(p => p.fish.sort((a, b) => a.r - b.r || a.base - b.base));
const FISH = {};
PONDS.forEach(p => p.fish.forEach(f => { f.pond = p.id; f.w = RARITY_W[f.r - 1]; f.rf = (f.r - 1) / 4; FISH[f.id] = f; }));

// The map. Real waters plus spots for future ones; the angler walks the path in this order.
const MAP = [
  { id: 'mill', x: 12, y: 80 },
  { id: 'birch', x: 32, y: 74 },
  { id: 'river', x: 52, y: 82, soon: 'Misty River' },
  { id: 'fjord', x: 76, y: 76 },
  { id: 'frozen', x: 86, y: 47 },
  { id: 'marsh', x: 64, y: 50, soon: 'Mangrove Marsh' },
  { id: 'aurora', x: 40, y: 46 },
  { id: 'lagoon', x: 15, y: 40, soon: 'Coral Lagoon' },
  { id: 'springs', x: 26, y: 14, soon: 'Ember Springs' },
  { id: 'harbor', x: 55, y: 15, soon: 'Sunken Harbor' },
  { id: 'tarn', x: 82, y: 16, soon: 'Glacier Tarn' },
];

const RODS = [
  { id: 'willow', name: 'Willow Stick', tier: 1, cost: 0, luck: 0, size: 0, zone: 0, speed: 1, color: '#6b4a2a', desc: 'A branch, some string, and optimism.' },
  { id: 'glass', name: 'Fiberglass Rod', tier: 2, cost: 750, luck: .3, size: .15, zone: .03, speed: .92, color: '#c8b48a', desc: 'Bends instead of breaks. Lands Mirror Carp, Barbel, Monkfish and more.' },
  { id: 'carbon', name: 'Carbon Rod', tier: 3, cost: 12000, luck: .7, size: .3, zone: .05, speed: .85, color: '#2a2a2a', desc: 'Light and stiff. Strong enough for catfish, halibut and taimen.' },
  { id: 'ember', name: 'Ember Rod', tier: 4, cost: 150000, luck: 1.2, size: .5, zone: .07, speed: .78, color: '#c4561c', desc: 'Warm to the touch. Ice Pike, Frost Eels and Oarfish will bite.' },
  { id: 'auroraRod', name: 'Aurora Rod', tier: 5, cost: 750000, luck: 2, size: .8, zone: .09, speed: .7, color: '#7ff0c8', desc: 'Hums faintly at night. Needed for the giants of Aurora Deep.' },
];
const ROD = Object.fromEntries(RODS.map(r => [r.id, r]));

const UPGRADES = [
  { id: 'line', name: 'Braided line', desc: 'Slightly bigger fish on every rod, idle ones too.', base: 80, grow: 1.7, max: 20 },
  { id: 'reel', name: 'Quick reel', desc: 'Bites come 3% faster per level. Idle rods tick faster too, down to each water\'s fastest pace.', base: 120, grow: 1.75, max: 20 },
  { id: 'luck', name: 'Lucky hooks', desc: 'Rarer fish and more stars.', base: 150, grow: 1.8, max: 20 },
  { id: 'hook', name: 'Wide hook gap', desc: 'A slightly bigger green zone when you hook by hand.', base: 100, grow: 2.0, max: 10 },
  { id: 'market', name: 'Fishmonger friend', desc: 'Every fish sells for 4% more per level.', base: 200, grow: 1.75, max: 20 },
  { id: 'nets', name: 'Bigger keep nets', desc: 'Each idle rod holds 1 more fish, up to 20.', base: 600, grow: 2.6, max: 10 },
];

const BAITS = [
  { id: 'worms', name: 'Garden worms', cost: 0, pack: 0, desc: 'Free and endless. Fish anything.', luck: 0, size: 0, likes: [] },
  { id: 'bread', name: 'Bread paste', cost: 25, pack: 20, desc: 'Grazers love it: roach, carp, bream, tench.', luck: 0, size: .05, likes: ['grazer'] },
  { id: 'minnows', name: 'Live minnows', cost: 150, pack: 20, desc: 'Triples the odds of predators. No extra luck or size.', luck: 0, size: 0, likes: ['predator'] },
  { id: 'shrimp', name: 'Shrimp', cost: 500, pack: 20, desc: 'For salt water and bottom feeders. A bit luckier.', luck: .3, size: .1, likes: ['sea', 'bottom'] },
  { id: 'glow', name: 'Glow grubs', cost: 2500, pack: 20, desc: 'Draws up deep and cold-water fish. Much luckier.', luck: .6, size: .15, likes: ['deep', 'cold'] },
  { id: 'emberfly', name: 'Ember fly', cost: 30000, pack: 20, desc: 'Ember fish rise to it. Luckiest and biggest bait.', luck: 1, size: .3, likes: ['ember', 'rare'] },
];
const BAIT = Object.fromEntries(BAITS.map(b => [b.id, b]));

const HATS = [
  { id: 'bucket', name: 'Bucket Hat', r: 1 },
  { id: 'beanie', name: 'Red Beanie', r: 1 },
  { id: 'straw', name: 'Straw Hat', r: 1 },
  { id: 'cap', name: 'Ember Cap', r: 2 },
  { id: 'souwester', name: "Sou'wester", r: 2 },
  { id: 'flatcap', name: 'Flat Cap', r: 2 },
  { id: 'captain', name: "Captain's Cap", r: 3 },
  { id: 'tricorn', name: 'Pirate Tricorn', r: 3 },
  { id: 'viking', name: 'Viking Helmet', r: 3 },
  { id: 'froggy', name: 'Frog Hat', r: 3 },
  { id: 'wizard', name: 'Wizard Hat', r: 4 },
  { id: 'tophat', name: 'Top Hat', r: 4 },
  { id: 'propeller', name: 'Propeller Cap', r: 4 },
  { id: 'fishhat', name: 'Fish Hat', r: 4 },
  { id: 'crown', name: 'Gold Crown', r: 5 },
  { id: 'flamecrown', name: 'Flame Crown', r: 5 },
  { id: 'lilyhat', name: 'Lily Pad Hat', r: 5, area: 'mill' },
  { id: 'birchcrown', name: 'Birch Crown', r: 5, area: 'birch' },
  { id: 'anchorcap', name: 'Fjord Anchor Beanie', r: 5, area: 'fjord' },
  { id: 'ushanka', name: 'Frost Ushanka', r: 5, area: 'frozen' },
  { id: 'aurorahalo', name: 'Aurora Halo', r: 5, area: 'aurora' },
];
const HAT = Object.fromEntries(HATS.map(h => [h.id, h]));
const SLOT_COSTS = [150, 1200, 8000, 50000, 250000, 1200000];
const IDLE_FLOOR = 180000;

// ---------- state ----------
function fresh() {
  return { v: 2, coins: 0, pond: 'mill', ponds: ['mill'], rod: 'willow', rods: ['willow'],
    up: { line: 0, reel: 0, luck: 0, hook: 0, market: 0, nets: 0 }, bait: {}, baitOn: 'worms',
    hat: 'bucket', hats: ['bucket'],
    slots: [], coll: {}, recent: [], hatsNew: false, stats: { caught: 0, earned: 0, giants: 0, fives: 0, chests: 0 }, saved: Date.now(), tab: 'shop', shopTab: 'rods' };
}
let S = fresh();
function migrate(d) {
  // v1 saves: keep money and gear, cash out old nets, give old records 2 stars.
  if (d.v === 1) {
    const cash = (d.slots || []).reduce((a, s) => a + (s.net || []).reduce((b, c) => b + (c.v || 0), 0), 0);
    d.coins = (d.coins || 0) + cash;
    d.slots = (d.slots || []).map(s => ({ pond: s.pond, lvl: s.lvl, net: [], last: Date.now(), missed: 0 }));
    const coll = {};
    Object.entries(d.coll || {}).forEach(([k, e]) => { if (FISH[k]) coll[k] = { n: e.n, best: e.best, bestT: Math.round((e.best - FISH[k].min) / (FISH[k].max - FISH[k].min) * 100), bestQ: 2, bestV: e.bestV }; });
    d.coll = coll; d.v = 2;
  }
  return d;
}
function load(d) {
  S = fresh();
  if (d && (d.v === 1 || d.v === 2)) {
    d = migrate(d);
    const f = fresh();
    S = Object.assign(f, d, { up: Object.assign(f.up, d.up || {}), stats: Object.assign(f.stats, d.stats || {}) });
    S.slots.forEach(s => { s.missed = s.missed || 0; });
    if (!S.hats || !S.hats.length) { S.hats = ['bucket']; S.hat = 'bucket'; }
  }
}
// ---------- talking to Peiskos ----------
// Peiskos keeps the save on its server (one per person in each hearth) and posts brags in the
// fireside chat. This page only talks to it through messages, so it works the same in the desktop app.
const toPeiskos = msg => window.parent.postMessage(msg, '*');
let ready = false, saveTimer = 0, lastSent = '';
/** Saves soon; a burst of changes becomes one save. */
function save() {
  if (!ready) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 1500);
}
function flushSave() {
  clearTimeout(saveTimer);
  if (!ready) return;
  const { saved, ...rest } = S;
  const json = JSON.stringify(rest);
  if (json === lastSent) return;
  lastSent = json;
  S.saved = Date.now();
  toPeiskos({ kind: 'save', data: S });
}

// ---------- helpers ----------
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fmt(n) {
  n = Math.floor(n);
  if (n < 10000) return n.toLocaleString('en-US');
  for (const [v, s] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']]) if (n >= v) return (n / v).toFixed(n / v < 100 ? 1 : 0).replace(/\.0$/, '') + s;
  return String(n);
}
const cm = s => (s < 20 ? s.toFixed(1) : Math.round(s)) + ' cm';
function dur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60); if (m < 60) return m + 'm' + (s % 60 ? ' ' + (s % 60) + 's' : '');
  const h = Math.floor(m / 60); if (h < 48) return h + 'h ' + (m % 60) + 'm';
  return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
}
const starsHtml = q => `<span class="stars" aria-label="${q} of 5 stars">${'★'.repeat(q)}<span class="off">${'★'.repeat(5 - q)}</span></span>`;
const rarHtml = r => `<span class="rar r${r}">${RARITY[r - 1]}</span>`;
const sizeHtml = t => `<div class="sizebar"><span>Size</span><span class="track"><i style="width:${t}%"></i></span><b>${t}</b></div>`;
const pondOf = id => PONDS.find(p => p.id === id);
const pondIdx = id => PONDS.findIndex(p => p.id === id);
const rod = () => ROD[S.rod];
const upCost = u => Math.round(u.base * Math.pow(u.grow, S.up[u.id]));
const reelF = () => Math.pow(.97, S.up.reel);
const netCap = () => 10 + S.up.nets;
// Each water has its own pace: the fastest bite is 3 min at Millpond and 1.5 min slower per water after it.
// A new holder starts at 10/3 of that floor (10 min at Millpond, 30 min at Aurora Deep).
const idleFloor = pid => IDLE_FLOOR + pondIdx(pid) * 90000;
const slotInterval = sl => { const fl = idleFloor(sl.pond); return Math.max(fl, fl * 10 / 3 * Math.pow(.85, sl.lvl - 1) * reelF()); };
const slotLvlCost = (sl, i) => Math.round(120 * Math.pow(2, sl.lvl - 1) * (1 + i * .8));
const pondDone = pid => pondOf(pid).fish.every(f => S.coll[f.id]);
const pondBonus = pid => pondDone(pid) ? 1.05 : 1;
const pondStarsDone = pid => pondOf(pid).fish.filter(f => (S.coll[f.id] || {}).bestQ === 5).length;
const hatsUnlocked = () => S.stats.chests > 0 || S.hats.length > 1;
// Idle rods: harder fish and harder waters get away more often.
const LAND_BY_RARITY = [.9, .8, .65, .5, .35];
const landChance = (sl, f) => Math.min(.95, LAND_BY_RARITY[f.r - 1] * pondOf(sl.pond).idle + .02 * (sl.lvl - 1));

// ---------- rolling a fish ----------
function pool(pid) { const tier = rod().tier; return pondOf(pid).fish.filter(f => (f.rod || 1) <= tier); }
function fishWeights(list, opts) {
  return list.map(f => {
    let w = f.w * Math.exp(opts.luck * f.rf * .8);
    if (opts.likes && f.tags.some(t => opts.likes.includes(t))) w *= 3;
    return w;
  });
}
function pick(list, ws) {
  let r = Math.random() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) { r -= ws[i]; if (r <= 0) return list[i]; }
  return list[list.length - 1];
}
const rollFish = (pid, opts) => { const l = pool(pid); return pick(l, fishWeights(l, opts)); };
function rollStars(luck, perfect) {
  const ws = [50, 28, 14, 6, 2].map((x, i) => x * Math.exp(luck * .3 * i));
  let q = pick([1, 2, 3, 4, 5], ws);
  if (perfect && Math.random() < .5) q = Math.min(5, q + 1);
  return q;
}
function rollCatch(f, opts, perfect) {
  let t = Math.pow(Math.random(), 1 / (1 + opts.size));
  if (perfect) t = Math.min(1, t + .08);
  const q = rollStars(opts.luck, perfect);
  const giant = t >= .98;
  const size = f.min + t * (f.max - f.min);
  const v = f.base * (.5 + t) * STAR_MUL[q - 1] * (giant ? 3 : 1) * (1 + .04 * S.up.market) * pondBonus(f.pond);
  return { f: f.id, s: Math.round(size * 10) / 10, t: Math.round(t * 100), q, v: Math.max(1, Math.round(v)), g: giant, p: !!perfect };
}
function handOpts(baitId) {
  const b = BAIT[baitId] || BAIT.worms, r = rod();
  return { luck: r.luck + .05 * S.up.luck + b.luck, size: r.size + .03 * S.up.line + b.size, likes: b.likes };
}
function idleOpts(sl) {
  const r = rod();
  return { luck: .5 * r.luck + .05 * S.up.luck + .05 * sl.lvl, size: .5 * r.size + .03 * S.up.line + .04 * sl.lvl, likes: [] };
}
function expectedLand(sl) {
  const l = pool(sl.pond), ws = fishWeights(l, idleOpts(sl)), tot = ws.reduce((a, b) => a + b, 0);
  return l.reduce((a, f, i) => a + ws[i] / tot * landChance(sl, f), 0);
}

// ---------- recording catches ----------
// Big moments go to the fireside chat as your own message. Idle nets can land a lot at once,
// so ordinary brags wait 10 seconds between them; hats and finished collections always go.
let lastBrag = 0;
function post(text, always) {
  const now = Date.now();
  if (!always && now - lastBrag < 10000) return;
  lastBrag = now;
  toPeiskos({ kind: 'brag', text: '🎣 ' + text });
}
function addRecent(item) { S.recent.unshift(Object.assign({ at: Date.now() }, item)); S.recent.length = Math.min(S.recent.length, 12); }
function record(c, source) {
  addRecent({ c, src: source });
  const f = FISH[c.f], prev = S.coll[c.f];
  const notes = [];
  if (!prev) { S.coll[c.f] = { n: 0, best: c.s, bestT: c.t, bestQ: c.q, bestV: c.v }; notes.push('new'); }
  const e = S.coll[c.f];
  if (prev && c.s > e.best) notes.push('record');
  if (prev && c.q > e.bestQ) notes.push('stars');
  e.n++; e.best = Math.max(e.best, c.s); e.bestT = Math.max(e.bestT || 0, c.t); e.bestQ = Math.max(e.bestQ || 1, c.q); e.bestV = Math.max(e.bestV, c.v);
  S.coins += c.v; S.stats.caught++; S.stats.earned += c.v;
  const how = source === 'idle' ? ' on an idle rod' : '';
  if (c.g) { S.stats.giants++; post(`Landed a giant ${f.name}${how}: ${cm(c.s)}, size ${c.t}/100, worth ${fmt(c.v)} coins.`); }
  else if (c.q === 5) { S.stats.fives++; post(`Caught a 5-star ${f.name}${how} (${cm(c.s)}), worth ${fmt(c.v)} coins.`); }
  else if (notes.includes('new') && f.r >= 4) post(`Caught my first ${f.name}${how}, a ${RARITY[f.r - 1].toLowerCase()} fish.`);
  if (notes.includes('new') && pondDone(f.pond)) post(`Caught every species in ${pondOf(f.pond).name}. Fish from there now sell for 5% more.`, true);
  if (c.q === 5) checkAreaHat(f.pond);
  reportBest(c, source);
  return notes;
}

// ---------- today's biggest (the hearth's leaderboard) ----------
// Your best catch of the day goes on the hearth's board, ranked by size for its species (then stars).
// Only a catch that beats your own best today is sent. The day runs midnight to midnight Eastern.
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(Date.now());
function reportBest(c, source) {
  const day = today(), b = S.best && S.best.day === day ? S.best : null;
  if (b && (c.t < b.t || (c.t === b.t && c.q <= b.q))) return;
  S.best = { day, t: c.t, q: c.q };
  toPeiskos({ kind: 'catch', c: { f: c.f, s: c.s, t: c.t, q: c.q, g: c.g, idle: source === 'idle' } });
  if (S.tab === 'board') setTimeout(askBoard, 800);
}
let board = null, boardAsked = 0;
function askBoard() { boardAsked = Date.now(); toPeiskos({ kind: 'board' }); }
function boardHtml() {
  let h = `<h2>Today's biggest <small>resets at midnight Eastern</small></h2><p class="note" style="margin:0">Everyone's best catch today in this hearth, by hand or idle rod. Ranked by how big it is for its species, then stars.</p>`;
  if (!board) return h + `<div class="empty-state">Loading the board…</div>`;
  if (board.error) return h + `<div class="empty-state">Couldn't load the board. ${esc(board.error)}</div>`;
  if (!board.rows.length) return h + `<div class="empty-state">Nobody has caught anything yet today. Be first.</div>`;
  h += `<ol class="board">`;
  board.rows.forEach((r, i) => {
    const f = FISH[r.fish]; if (!f) return;
    h += `<li${r.me ? ' class="me"' : ''}><span class="rank">${i + 1}</span><canvas data-bfish="${r.fish}" data-t="${r.score}"></canvas><div class="who"><b>${esc(r.name)}</b><span>${f.name} · ${cm(r.size)}${r.giant ? ' · <span class="tag gold">Giant</span>' : ''}${r.idle ? ' · idle rod' : ''}</span></div><div class="score">${starsHtml(r.stars)}<b>${r.score}<small>/100</small></b></div></li>`;
  });
  return h + `</ol>`;
}

// ---------- treasure chests (hand casts only) ----------
// 1% base; Lucky hooks can push it to 1.2% at most.
const chestChance = () => Math.min(.012, .01 + .0001 * S.up.luck);
function checkAreaHat(pid) {
  const h = HATS.find(x => x.area === pid);
  if (!h || S.hats.includes(h.id) || pondStarsDone(pid) < pondOf(pid).fish.length) return;
  S.hats.push(h.id); S.hatsNew = true;
  addRecent({ chest: true, hat: h.id, area: true });
  post(`Caught every ${pondOf(pid).name} fish at 5 stars and earned the ${h.name}.`, true);
}
function openChest() {
  S.stats.chests++;
  if (S.stats.chests === 1) S.hatsNew = true;
  const pi = pondIdx(S.pond);
  const left = HATS.filter(h => !h.area && !S.hats.includes(h.id));
  if (!left.length) {
    const coins = Math.round(300 * Math.pow(6, pi));
    S.coins += coins; S.stats.earned += coins;
    addRecent({ chest: true, coins });
    post(`Pulled up a treasure chest full of coins: ${fmt(coins)}.`, true);
    return { coins };
  }
  const ws = left.map(h => [40, 30, 18, 9, 3][h.r - 1] * (1 + pi * (h.r - 1) * .4));
  const h = pick(left, ws);
  S.hats.push(h.id);
  addRecent({ chest: true, hat: h.id });
  post(`Pulled up a treasure chest at ${pondOf(S.pond).name}. Inside: the ${h.name} (${RARITY[h.r - 1].toLowerCase()} hat).`, true);
  return { hat: h.id };
}

// ---------- idle rods ----------
function tickIdle(now) {
  let added = 0, missed = 0;
  const cap = netCap();
  S.slots.forEach(sl => {
    if (sl.net.length >= cap) { sl.last = now; return; }
    const iv = slotInterval(sl);
    let n = Math.floor((now - sl.last) / iv);
    if (n <= 0) return;
    let used = 0;
    while (used < n && sl.net.length < cap) {
      used++;
      const o = idleOpts(sl), f = rollFish(sl.pond, o);
      if (Math.random() < landChance(sl, f)) { sl.net.push(rollCatch(f, o, false)); added++; }
      else { sl.missed++; missed++; }
    }
    sl.last = sl.net.length >= cap ? now : sl.last + used * iv;
  });
  return { added, missed };
}
function collect(idx) {
  const list = idx == null ? S.slots : [S.slots[idx]];
  let n = 0, v = 0;
  list.forEach(sl => { sl.net.forEach(c => { record(c, 'idle'); n++; v += c.v; }); sl.net = []; sl.missed = 0; });
  if (n) toastCatchSummary(n, v);
  save(); renderAll();
}

// ---------- angler + hats ----------
function blob(c, fill, fn) { c.fillStyle = fill; c.beginPath(); fn(); c.fill(); }
// Draws a hat on a head centred at (x, y) with radius r, facing right.
function drawHat(c, id, x, y, r, T) {
  c.save(); c.lineJoin = 'round';
  const top = y - r * .55;
  switch (id) {
    case 'bucket':
      blob(c, '#6d7a3e', () => { c.moveTo(x - r * .75, top); c.lineTo(x - r * .6, y - r * 1.45); c.quadraticCurveTo(x, y - r * 1.65, x + r * .6, y - r * 1.45); c.lineTo(x + r * .75, top); });
      blob(c, '#5a6633', () => c.ellipse(x, top, r * 1.3, r * .3, 0, 0, 7));
      blob(c, '#c4561c', () => c.rect(x - r * .72, top - r * .3, r * 1.44, r * .18));
      break;
    case 'beanie':
      blob(c, '#b8352b', () => { c.arc(x, y - r * .2, r * 1.02, Math.PI, 0); });
      blob(c, '#8e2620', () => c.rect(x - r * 1.05, y - r * .45, r * 2.1, r * .35));
      blob(c, '#fffaf3', () => c.arc(x, y - r * 1.35, r * .3, 0, 7));
      break;
    case 'straw':
      blob(c, '#e2c27a', () => c.ellipse(x, top, r * 1.9, r * .38, 0, 0, 7));
      blob(c, '#e9cc88', () => { c.moveTo(x - r * .75, top); c.quadraticCurveTo(x - r * .7, y - r * 1.5, x, y - r * 1.5); c.quadraticCurveTo(x + r * .7, y - r * 1.5, x + r * .75, top); });
      blob(c, '#c4561c', () => c.rect(x - r * .74, top - r * .35, r * 1.48, r * .2));
      break;
    case 'cap':
      blob(c, '#c4561c', () => c.arc(x, y - r * .3, r * .98, Math.PI, 0));
      blob(c, '#a84715', () => c.ellipse(x + r * 1.1, y - r * .32, r * .75, r * .16, 0, 0, 7));
      blob(c, '#ffc46b', () => c.arc(x, y - r * 1.25, r * .13, 0, 7));
      break;
    case 'souwester':
      blob(c, '#f2c230', () => { c.moveTo(x - r * 1.5, y + r * .1); c.quadraticCurveTo(x - r * 1.1, y - r * .4, x - r * .8, top); c.quadraticCurveTo(x, y - r * 1.9, x + r * .8, top); c.quadraticCurveTo(x + r * 1.2, y - r * .5, x + r * 1.3, y - r * .3); c.lineTo(x + r * .8, y - r * .4); c.lineTo(x - r * .9, y - r * .2); c.closePath(); });
      break;
    case 'flatcap':
      blob(c, '#8a6f52', () => { c.moveTo(x - r * 1, y - r * .3); c.quadraticCurveTo(x - r * .6, y - r * 1.4, x + r * .8, y - r * .9); c.quadraticCurveTo(x + r * 1.5, y - r * .5, x + r * 1.4, y - r * .3); c.closePath(); });
      c.strokeStyle = '#6a5440'; c.lineWidth = r * .08; c.beginPath(); c.moveTo(x - r * .5, y - r * .9); c.lineTo(x + r * .6, y - r * .7); c.stroke();
      break;
    case 'captain':
      blob(c, '#1f2a3a', () => c.ellipse(x + r * .9, y - r * .4, r * .6, r * .15, 0, 0, 7));
      blob(c, '#1f2a3a', () => c.rect(x - r * .9, y - r * .8, r * 1.8, r * .45));
      blob(c, '#fbf8f0', () => c.ellipse(x, y - r * .95, r * 1.15, r * .45, 0, 0, 7));
      blob(c, '#e0a830', () => c.arc(x + r * .3, y - r * .6, r * .16, 0, 7));
      break;
    case 'tricorn':
      blob(c, '#231b16', () => { c.moveTo(x - r * 1.6, y - r * .5); c.quadraticCurveTo(x - r * .4, y - r * .2, x, y - r * 1.6); c.quadraticCurveTo(x + r * .4, y - r * .2, x + r * 1.6, y - r * .5); c.quadraticCurveTo(x, y - r * .1, x - r * 1.6, y - r * .5); });
      c.strokeStyle = '#e0a830'; c.lineWidth = r * .1; c.stroke();
      blob(c, '#fffaf3', () => c.arc(x, y - r * .75, r * .17, 0, 7));
      break;
    case 'viking':
      c.strokeStyle = '#efe6d2'; c.lineWidth = r * .28; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x - r * .8, y - r * .6); c.quadraticCurveTo(x - r * 1.5, y - r * .9, x - r * 1.3, y - r * 1.7); c.stroke();
      c.beginPath(); c.moveTo(x + r * .8, y - r * .6); c.quadraticCurveTo(x + r * 1.5, y - r * .9, x + r * 1.3, y - r * 1.7); c.stroke();
      blob(c, '#8a8f96', () => c.arc(x, y - r * .25, r * 1.02, Math.PI, 0));
      blob(c, '#6a6e74', () => c.rect(x - r * 1.05, y - r * .4, r * 2.1, r * .25));
      break;
    case 'froggy':
      blob(c, '#5c9a3e', () => c.arc(x, y - r * .25, r * 1.05, Math.PI, 0));
      [-.5, .5].forEach(d => { blob(c, '#5c9a3e', () => c.arc(x + r * d, y - r * 1.2, r * .38, 0, 7)); blob(c, '#fffaf3', () => c.arc(x + r * d, y - r * 1.25, r * .25, 0, 7)); blob(c, '#111', () => c.arc(x + r * d + r * .05, y - r * 1.25, r * .12, 0, 7)); });
      break;
    case 'wizard':
      blob(c, '#2e3f8f', () => c.ellipse(x, top, r * 1.5, r * .3, 0, 0, 7));
      blob(c, '#3a4fae', () => { c.moveTo(x - r * .85, top); c.quadraticCurveTo(x - r * .1, y - r * 2, x + r * .7, y - r * 2.9); c.quadraticCurveTo(x + r * .4, y - r * 1.6, x + r * .85, top); });
      blob(c, '#ffc46b', () => c.arc(x + r * .1, y - r * 1.3, r * .14, 0, 7));
      blob(c, '#ffc46b', () => c.arc(x - r * .3, y - r * .9, r * .1, 0, 7));
      break;
    case 'tophat':
      blob(c, '#1b1512', () => c.ellipse(x, top, r * 1.35, r * .25, 0, 0, 7));
      blob(c, '#231b16', () => c.rect(x - r * .75, y - r * 2.1, r * 1.5, r * 1.6));
      blob(c, '#c4561c', () => c.rect(x - r * .75, top - r * .45, r * 1.5, r * .25));
      break;
    case 'propeller':
      ['#c4561c', '#f2c230', '#3a7fb0', '#5c9a3e'].forEach((col, i) => blob(c, col, () => { c.moveTo(x, y - r * .25); c.arc(x, y - r * .25, r * 1.02, Math.PI + i * Math.PI / 4, Math.PI + (i + 1) * Math.PI / 4); }));
      blob(c, '#333', () => c.rect(x - r * .05, y - r * 1.55, r * .1, r * .35));
      { const sp = Math.cos((T || 0) * 12); blob(c, '#b8352b', () => c.ellipse(x, y - r * 1.55, r * .9 * Math.abs(sp) + r * .05, r * .12, 0, 0, 7)); }
      break;
    case 'fishhat':
      c.translate(x, y - r * 1.05); c.rotate(-.05); drawFish(c, r * 2.6, FISH.perch, null);
      break;
    case 'crown':
      blob(c, '#e0a830', () => { c.moveTo(x - r * .9, y - r * .4); c.lineTo(x - r * .95, y - r * 1.5); c.lineTo(x - r * .45, y - r * 1); c.lineTo(x, y - r * 1.7); c.lineTo(x + r * .45, y - r * 1); c.lineTo(x + r * .95, y - r * 1.5); c.lineTo(x + r * .9, y - r * .4); });
      blob(c, '#b8352b', () => c.arc(x, y - r * .75, r * .16, 0, 7));
      blob(c, '#3a7fb0', () => c.arc(x - r * .5, y - r * .65, r * .11, 0, 7));
      blob(c, '#5c9a3e', () => c.arc(x + r * .5, y - r * .65, r * .11, 0, 7));
      break;
    case 'lilyhat':
      blob(c, '#4f8a3a', () => { c.moveTo(x, top); c.ellipse(x, top, r * 1.45, r * .32, 0, .25, Math.PI * 2 - .05); c.closePath(); });
      blob(c, '#6ea84e', () => c.ellipse(x, top - r * .06, r * 1.2, r * .22, 0, 0, 7));
      ['#f6b6c8', '#fbd3df'].forEach((col, i) => blob(c, col, () => { for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2 + i * .6; c.moveTo(x, top - r * .5); c.ellipse(x + Math.cos(a) * r * .3, top - r * .5 + Math.sin(a) * r * .15, r * .28 - i * .08 * r, r * .12, a, 0, 7); } }));
      blob(c, '#f2c230', () => c.arc(x, top - r * .52, r * .12, 0, 7));
      break;
    case 'birchcrown':
      blob(c, '#f3efe4', () => c.rect(x - r * .95, y - r * .85, r * 1.9, r * .4));
      c.fillStyle = '#2a1a12'; [-.7, -.3, .15, .55].forEach(d => c.fillRect(x + r * d, y - r * .75, r * .18, r * .06));
      [-.75, -.25, .25, .75].forEach((d, i) => blob(c, i % 2 ? '#8fb04a' : '#e0a830', () => { c.ellipse(x + r * d, y - r * 1.05, r * .2, r * .38, d * .6, 0, 7); }));
      break;
    case 'anchorcap':
      blob(c, '#2f5b6e', () => c.arc(x, y - r * .25, r * 1.03, Math.PI, 0));
      blob(c, '#22465a', () => c.rect(x - r * 1.06, y - r * .5, r * 2.12, r * .38));
      c.strokeStyle = '#f3efe4'; c.lineWidth = r * .1; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x, y - r * .95); c.lineTo(x, y - r * .45); c.moveTo(x - r * .2, y - r * .8); c.lineTo(x + r * .2, y - r * .8); c.stroke();
      c.beginPath(); c.arc(x, y - r * .6, r * .22, .3, Math.PI - .3); c.stroke();
      break;
    case 'ushanka':
      // side view, facing right: one ear flap hangs over the ear, the front flap is folded up
      blob(c, '#e9e4dc', () => { c.moveTo(x - r * .95, y - r * .35); c.quadraticCurveTo(x - r * 1.05, y + r * .35, x - r * .55, y + r * .55); c.quadraticCurveTo(x - r * .2, y + r * .2, x - r * .2, y - r * .35); c.closePath(); });
      blob(c, '#8e9ca8', () => { c.moveTo(x - r * 1, y - r * .45); c.quadraticCurveTo(x - r * .9, y - r * 1.55, x + r * .1, y - r * 1.5); c.quadraticCurveTo(x + r * .95, y - r * 1.4, x + r * .9, y - r * .5); c.closePath(); });
      blob(c, '#f6f3ee', () => { c.moveTo(x - r * 1.08, y - r * .3); c.lineTo(x - r * 1.05, y - r * .7); c.quadraticCurveTo(x, y - r * .85, x + r * 1.05, y - r * .72); c.quadraticCurveTo(x + r * 1.15, y - r * 1.15, x + r * .9, y - r * 1.25); c.lineTo(x + r * 1.15, y - r * .4); c.quadraticCurveTo(x, y - r * .45, x - r * 1.08, y - r * .3); });
      blob(c, '#7fb0c8', () => c.arc(x + r * .15, y - r * 1.1, r * .14, 0, 7));
      break;
    case 'aurorahalo': {
      const g = (Math.sin((T || 0) * 3) + 1) / 2;
      c.shadowColor = '#7ff0c8'; c.shadowBlur = r * .9;
      c.strokeStyle = `rgba(127,240,200,${.75 + .25 * g})`; c.lineWidth = r * .22;
      c.beginPath(); c.ellipse(x, y - r * 1.45, r * .95, r * .28, 0, 0, 7); c.stroke();
      c.strokeStyle = 'rgba(255,196,107,.8)'; c.lineWidth = r * .08; c.stroke();
      break; }
    case 'flamecrown': {
      const fl = Math.sin((T || 0) * 9) * r * .12;
      c.shadowColor = '#ffb35c'; c.shadowBlur = r * .8;
      [[-.7, 1.4], [0, 2], [.7, 1.4]].forEach(([dx, h], i) => {
        blob(c, '#f08a4b', () => { c.moveTo(x + r * (dx - .4), y - r * .5); c.quadraticCurveTo(x + r * (dx - .3), y - r * (h * .7), x + r * dx + (i % 2 ? -fl : fl), y - r * h); c.quadraticCurveTo(x + r * (dx + .3), y - r * (h * .7), x + r * (dx + .4), y - r * .5); });
        blob(c, '#ffc46b', () => { c.moveTo(x + r * (dx - .2), y - r * .5); c.quadraticCurveTo(x + r * dx, y - r * (h * .65), x + r * (dx + .2), y - r * .5); });
      });
      c.shadowBlur = 0;
      blob(c, '#c4561c', () => c.rect(x - r * 1, y - r * .6, r * 2, r * .25));
      break; }
  }
  c.restore();
}
// Feet at (x, y). s is pixels per unit (the angler is ~60 units tall). Returns the hand position.
function drawAngler(c, x, y, s, hat, o) {
  const T = o.T || 0, walk = o.walk ? Math.sin(T * 14) : 0, sit = o.sit;
  c.save(); c.lineCap = 'round';
  // legs
  c.strokeStyle = '#3a4a5a'; c.lineWidth = 5 * s;
  if (sit) {
    c.beginPath(); c.moveTo(x - 3 * s, y - 14 * s); c.lineTo(x + 8 * s, y - 14 * s); c.lineTo(x + 9 * s, y); c.stroke();
    c.beginPath(); c.moveTo(x + 1 * s, y - 14 * s); c.lineTo(x + 12 * s, y - 13 * s); c.lineTo(x + 14 * s, y - 1 * s); c.stroke();
  } else {
    c.beginPath(); c.moveTo(x, y - 18 * s); c.lineTo(x - 4 * s + walk * 5 * s, y); c.stroke();
    c.beginPath(); c.moveTo(x, y - 18 * s); c.lineTo(x + 4 * s - walk * 5 * s, y); c.stroke();
  }
  const by = sit ? y - 12 * s : y - 16 * s;
  // boots
  c.fillStyle = '#2a1a12';
  if (!sit) { c.beginPath(); c.ellipse(x - 4 * s + walk * 5 * s + 1.5 * s, y, 3.5 * s, 2 * s, 0, 0, 7); c.ellipse(x + 4 * s - walk * 5 * s + 1.5 * s, y, 3.5 * s, 2 * s, 0, 0, 7); c.fill(); }
  // body (ember jacket)
  c.fillStyle = o.coat || '#c4561c';
  c.beginPath(); c.moveTo(x - 8 * s, by); c.lineTo(x - 7 * s, by - 20 * s); c.quadraticCurveTo(x, by - 24 * s, x + 7 * s, by - 20 * s); c.lineTo(x + 8 * s, by); c.closePath(); c.fill();
  c.fillStyle = o.trim || '#a84715'; c.fillRect(x - 8 * s, by - 3 * s, 16 * s, 3 * s);
  // head
  const hx = x + 1 * s, hy = by - 30 * s, r = 8 * s;
  c.fillStyle = '#f1c9a0'; c.beginPath(); c.arc(hx, hy, r, 0, 7); c.fill();
  c.fillStyle = '#2a1a12'; c.beginPath(); c.arc(hx + 4 * s, hy - 1 * s, 1.2 * s, 0, 7); c.fill();
  c.fillStyle = 'rgba(220,110,80,.45)'; c.beginPath(); c.arc(hx + 3 * s, hy + 3 * s, 1.8 * s, 0, 7); c.fill();
  drawHat(c, hat, hx, hy, r, T);
  // arm
  const hand = { x: x + 13 * s, y: by - 14 * s };
  c.strokeStyle = o.coat || '#c4561c'; c.lineWidth = 4.5 * s;
  c.beginPath(); c.moveTo(x + 3 * s, by - 18 * s); c.lineTo(hand.x, hand.y); c.stroke();
  c.fillStyle = '#f1c9a0'; c.beginPath(); c.arc(hand.x, hand.y, 2.4 * s, 0, 7); c.fill();
  if (o.rodUp) { c.strokeStyle = ROD[S.rod].color; c.lineWidth = 2 * s; c.beginPath(); c.moveTo(hand.x - 3 * s, hand.y + 4 * s); c.lineTo(hand.x + 10 * s, hand.y - 34 * s); c.stroke(); }
  c.restore();
  return hand;
}
function drawChest(c, x, y, w, open) {
  const h = w * .62;
  c.save();
  c.fillStyle = '#7a4a2a'; c.fillRect(x - w / 2, y - h / 2, w, h);
  c.fillStyle = '#e0a830'; c.fillRect(x - w / 2, y - h * .08, w, h * .1); c.fillRect(x - w * .07, y - h * .2, w * .14, h * .3);
  c.fillStyle = '#5b3520';
  c.beginPath();
  if (open) { c.moveTo(x - w / 2, y - h / 2); c.lineTo(x - w * .44, y - h * 1.15); c.lineTo(x + w * .56, y - h * 1.15); c.lineTo(x + w / 2, y - h / 2); }
  else { c.moveTo(x - w / 2, y - h / 2); c.quadraticCurveTo(x, y - h * 1.1, x + w / 2, y - h / 2); }
  c.fill();
  if (open) { c.fillStyle = 'rgba(255,196,107,.55)'; c.beginPath(); c.ellipse(x, y - h / 2, w * .45, h * .2, 0, 0, 7); c.fill(); }
  c.restore();
}
function sizeCanvas(cv) {
  const r = cv.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.max(1, r.width * d); cv.height = Math.max(1, r.height * d);
  const c = cv.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0); return [c, r.width, r.height];
}
function paintHatCanvas(cv, id, locked) {
  const [c, w, h] = sizeCanvas(cv);
  const r = h * .2, x = w / 2, y = h * .72;
  if (locked) {
    c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--line').trim() || '#ccc';
    c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    c.font = `700 ${r * 1.4}px Fraunces, Georgia, serif`; c.textAlign = 'center'; c.fillText('?', x, y - r * 1.3);
    return;
  }
  c.fillStyle = '#f1c9a0'; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
  c.fillStyle = '#2a1a12'; c.beginPath(); c.arc(x + r * .5, y - r * .1, r * .14, 0, 7); c.fill();
  drawHat(c, id, x, y, r, performance.now() / 1000);
}
// ---------- fish art ----------
function drawFish(ctx, L, f, sil) {
  const k = f.look, H = L * (k.h || .32);
  const body = sil || k.body, belly = sil || k.belly, fin = sil || k.fin;
  ctx.save();
  if (k.glow && !sil) { ctx.shadowColor = k.glow; ctx.shadowBlur = L * .18; }
  if (k.shape === 'eel') {
    const h = L * (k.h || .1);
    ctx.fillStyle = fin; ctx.beginPath();
    ctx.moveTo(-L * .5, 0); ctx.quadraticCurveTo(-L * .1, -h * 1.1, L * .3, -h * .75); ctx.lineTo(L * .3, h * .75); ctx.quadraticCurveTo(-L * .1, h * 1.1, -L * .5, 0); ctx.fill();
    ctx.shadowBlur = 0;
    const g = ctx.createLinearGradient(0, -h, 0, h); g.addColorStop(0, body); g.addColorStop(1, belly);
    ctx.fillStyle = g; ctx.beginPath();
    ctx.moveTo(L * .5, 0); ctx.quadraticCurveTo(L * .45, -h * .7, L * .3, -h * .6); ctx.quadraticCurveTo(-L * .1, -h * .7, -L * .48, 0); ctx.quadraticCurveTo(-L * .1, h * .7, L * .3, h * .6); ctx.quadraticCurveTo(L * .45, h * .7, L * .5, 0); ctx.fill();
    if (k.spots && !sil) { ctx.fillStyle = k.spots; for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.arc(L * (.3 - i * .1), (i % 2 ? -1 : 1) * h * .2, h * .12, 0, 7); ctx.fill(); } }
    if (!sil) { ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(L * .4, -h * .15, h * .14, 0, 7); ctx.fill(); }
    ctx.restore(); return;
  }
  if (k.shape === 'ray') {
    ctx.fillStyle = fin; ctx.fillRect(-L * .55, -L * .012, L * .4, L * .024);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, L * .35); g.addColorStop(0, belly); g.addColorStop(1, body);
    ctx.fillStyle = g; ctx.beginPath();
    ctx.moveTo(L * .32, 0); ctx.quadraticCurveTo(L * .05, -L * .34, -L * .02, -L * .32); ctx.quadraticCurveTo(-L * .12, -L * .05, -L * .2, 0); ctx.quadraticCurveTo(-L * .12, L * .05, -L * .02, L * .32); ctx.quadraticCurveTo(L * .05, L * .34, L * .32, 0); ctx.fill();
    if (!sil) { ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(L * .2, -L * .04, L * .018, 0, 7); ctx.arc(L * .2, L * .04, L * .018, 0, 7); ctx.fill(); }
    ctx.restore(); return;
  }
  ctx.fillStyle = fin;
  ctx.beginPath(); ctx.moveTo(-L * .4, 0); ctx.lineTo(-L * .58, -H * .62); ctx.quadraticCurveTo(-L * .5, 0, -L * .58, H * .62); ctx.closePath(); ctx.fill();
  ctx.beginPath();
  if (k.sail) { ctx.moveTo(-L * .2, -H * .4); ctx.quadraticCurveTo(-L * .05, -H * 1.25, L * .16, -H * .42); }
  else { ctx.moveTo(-L * .14, -H * .42); ctx.quadraticCurveTo(L * .0, -H * .9, L * .1, -H * .44); }
  ctx.fill();
  ctx.beginPath(); ctx.moveTo(-L * .08, H * .42); ctx.quadraticCurveTo(-L * .02, H * .78, L * .06, H * .42); ctx.fill();
  ctx.shadowBlur = 0;
  const g = ctx.createLinearGradient(0, -H / 2, 0, H / 2); g.addColorStop(0, body); g.addColorStop(.55, body); g.addColorStop(1, belly);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(L * .5, 0);
  ctx.bezierCurveTo(L * .38, -H * .66, -L * .26, -H * .6, -L * .42, 0);
  ctx.bezierCurveTo(-L * .26, H * .6, L * .38, H * .66, L * .5, 0); ctx.fill();
  if (!sil) {
    ctx.save(); ctx.clip();
    if (k.stripes) { ctx.fillStyle = k.stripes; ctx.globalAlpha = .7; for (let i = 0; i < 6; i++) ctx.fillRect(L * (.22 - i * .11), -H, L * .035, H * 1.1); }
    if (k.spots) { ctx.fillStyle = k.spots; ctx.globalAlpha = .85; for (let i = 0; i < 14; i++) { ctx.beginPath(); ctx.arc(L * (.3 - (i % 7) * .09), -H * (.05 + (i > 6 ? .22 : 0)) + ((i * 37) % 9) * H * .015, H * .055, 0, 7); ctx.fill(); } }
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = Math.max(1, L * .01);
    ctx.beginPath(); ctx.moveTo(L * .3, -H * .32); ctx.quadraticCurveTo(L * .24, 0, L * .3, H * .32); ctx.stroke();
    ctx.fillStyle = '#fffaf3'; ctx.beginPath(); ctx.arc(L * .38, -H * .1, H * .11, 0, 7); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(L * .39, -H * .1, H * .065, 0, 7); ctx.fill();
    if (k.whiskers) { ctx.strokeStyle = fin; ctx.lineWidth = Math.max(1, L * .012); ctx.beginPath(); ctx.moveTo(L * .48, H * .05); ctx.quadraticCurveTo(L * .56, H * .4, L * .5, H * .7); ctx.moveTo(L * .47, H * .02); ctx.quadraticCurveTo(L * .6, H * .1, L * .62, H * .35); ctx.stroke(); }
  }
  ctx.restore();
}
function paintFishCanvas(cv, f, sil, t) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.max(1, r.width * dpr); cv.height = Math.max(1, r.height * dpr);
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const L = Math.min(r.width * .78, r.height * (f.look.shape === 'ray' ? 1.4 : f.look.shape === 'eel' ? 4 : 1.9 / (f.look.h || .32) * .45)) * (t == null ? 1 : .8 + .2 * t);
  ctx.translate(r.width / 2, r.height / 2);
  drawFish(ctx, L, f, sil ? getComputedStyle(document.documentElement).getPropertyValue('--line').trim() || '#999' : null);
}


// ---------- manual fishing ----------
const G = { mode: 'fish', phase: 'idle', t0: 0, wait: 0, fish: null, zone: [0, 0], speed: 1, resultAt: 0, bob: { x: .62, y: .62 }, walk: null };
function primary() {
  if (G.mode === 'map') { if (!G.walk) setMode('fish'); return; }
  if (G.phase === 'idle' || G.phase === 'done') return cast();
  if (G.phase === 'wait' || G.phase === 'cast') { G.phase = 'idle'; setHint('Too early. The bobber was still.'); updateCastBtn(); return; }
  if (G.phase === 'bite') return hook();
}
function cast() {
  G.bait = S.baitOn;
  if (S.baitOn !== 'worms') {
    S.bait[S.baitOn] = (S.bait[S.baitOn] || 0) - 1;
    if (S.bait[S.baitOn] <= 0) { delete S.bait[S.baitOn]; S.baitOn = 'worms'; }
  }
  G.phase = 'cast'; G.t0 = performance.now();
  G.bob = pondOf(S.pond).feature === 'ice' ? { x: .5, y: .775 } : { x: .5 + Math.random() * .3, y: .58 + Math.random() * .14 };
  G.wait = (2500 + Math.random() * 4000) * rod().speed * reelF();
  $('catchbox').innerHTML = ''; G.resultAt = 0;
  setHint('');
  updateCastBtn(); renderTop();
}
function startBite() {
  G.opts = handOpts(G.bait);
  G.fish = rollFish(S.pond, G.opts);
  const r = rod();
  const w = Math.max(.08, .2 + r.zone + .0125 * S.up.hook - G.fish.rf * .1);
  const c = w / 2 + Math.random() * (1 - w);
  G.zone = [c - w / 2, c + w / 2];
  G.speed = .7 + G.fish.rf * .9;
  G.phase = 'bite'; G.t0 = performance.now();
  setHint(G.fish.r >= 4 ? 'Something heavy!' : 'Bite!', true);
  $('meter').hidden = false;
  $('zone').style.left = (G.zone[0] * 100) + '%';
  $('zone').style.width = (w * 100) + '%';
  updateCastBtn();
}
function markerPos(now) { const x = (((now - G.t0) / 1000) * G.speed) % 2; return x < 1 ? x : 2 - x; }
function hook() {
  const m = markerPos(performance.now());
  $('meter').hidden = true;
  const [a, b] = G.zone, w = b - a;
  if (m >= a && m <= b) {
    if (Math.random() < chestChance()) showChest(openChest());
    else {
      const perfect = m >= a + w * .35 && m <= b - w * .35;
      const c = rollCatch(G.fish, G.opts, perfect);
      showCatch(c, record(c, 'hand'));
      dock.caught = { f: c.f, s: c.s, q: c.q };
    }
    setHint('');
  } else { showMiss('It slipped the hook.'); setHint(''); }
  G.phase = 'done'; updateCastBtn(); save(); renderAll();
}
function escapeFish() { $('meter').hidden = true; setHint(''); showMiss('It got away.'); G.phase = 'done'; updateCastBtn(); }
function setHint(t, bite) { const h = $('hint'); h.textContent = t; h.className = 'hint' + (bite ? ' bite' : ''); }
function updateCastBtn() {
  const b = $('castBtn');
  if (G.mode === 'map') { b.textContent = G.walk ? 'Walking…' : 'Back to fishing'; b.className = 'cast'; return; }
  b.textContent = { idle: 'Cast', done: 'Cast again', cast: 'Waiting…', wait: 'Waiting…', bite: 'Hook it!' }[G.phase];
  b.className = 'cast' + (G.phase === 'bite' ? ' bite' : '');
}
function showCatch(c, notes) {
  const f = FISH[c.f], tags = [];
  if (c.g) tags.push('<span class="tag gold">Giant ×3</span>');
  if (c.p) tags.push('<span class="tag green">Perfect hook</span>');
  if (notes.includes('new')) tags.push('<span class="tag">New species</span>');
  if (notes.includes('record')) tags.push('<span class="tag">Size record</span>');
  $('catchbox').innerHTML = `<div class="catch"><canvas id="catchCv"></canvas><div class="row"><h3>${f.name}</h3></div><div class="row">${rarHtml(f.r)}${starsHtml(c.q)}</div><div class="row"><span>${cm(c.s)} <small style="color:var(--muted)">(${f.min}–${f.max})</small></span><span class="val">+${fmt(c.v)}</span></div>${sizeHtml(c.t)}${tags.length ? '<div class="tags">' + tags.join('') + '</div>' : ''}</div>`;
  paintFishCanvas($('catchCv'), f, false, c.t / 100);
  G.resultAt = performance.now();
}
function showChest(res) {
  const h = res.hat && HAT[res.hat];
  $('catchbox').innerHTML = `<div class="catch"><canvas id="catchCv" style="height:84px"></canvas><h3>Treasure chest!</h3>${h ? `<div class="row"><span>${h.name}</span>${rarHtml(h.r)}</div><div class="tags"><span class="tag gold">New hat</span></div>` : `<div class="row"><span>Full of coins</span><span class="val">+${fmt(res.coins)}</span></div>`}</div>`;
  const [c, w, ht] = sizeCanvas($('catchCv'));
  drawChest(c, w * .32, ht * .78, ht * .7, true);
  if (h) { c.fillStyle = '#f1c9a0'; c.beginPath(); c.arc(w * .68, ht * .78, ht * .17, 0, 7); c.fill(); drawHat(c, h.id, w * .68, ht * .78, ht * .17, 0); }
  G.resultAt = performance.now() + 2500;
}
function showMiss(t) { $('catchbox').innerHTML = `<div class="catch miss"><h3>${t}</h3><div class="row" style="color:var(--muted)"><span>Tap while the marker crosses the green zone.</span></div></div>`; G.resultAt = performance.now(); }
function toastCatchSummary(n, v) { $('catchbox').innerHTML = `<div class="catch"><h3>Emptied the nets</h3><div class="row"><span>${n} fish</span><span class="val">+${fmt(v)}</span></div></div>`; G.resultAt = performance.now(); }

// ---------- map ----------
function setMode(m) {
  G.mode = m;
  if (m === 'map') { G.phase = 'idle'; $('meter').hidden = true; setHint(''); $('catchbox').innerHTML = ''; }
  $('mapNodes').hidden = m !== 'map'; $('mapTitle').hidden = m !== 'map';
  $('pondtag').hidden = m === 'map';
  $('scene').setAttribute('aria-label', m === 'map' ? 'Map of waters' : 'Fishing spot. Tap or press Space to cast and hook.');
  renderMapNodes(); updateCastBtn();
}
const mapIdx = id => MAP.findIndex(n => n.id === id);
function walkTo(id) {
  const a = mapIdx(S.pond), b = mapIdx(id);
  if (a === b) { setMode('fish'); return; }
  const step = b > a ? 1 : -1, pts = [];
  for (let i = a; i !== b + step; i += step) pts.push(MAP[i]);
  G.walk = { pts, t0: performance.now(), dur: 520 * (pts.length - 1), to: id };
  updateCastBtn();
}
function walkPos(now) {
  const w = G.walk, k = Math.min(1, (now - w.t0) / w.dur), seg = k * (w.pts.length - 1), i = Math.min(w.pts.length - 2, Math.floor(seg)), f = seg - i;
  const p = w.pts[i], q = w.pts[i + 1];
  return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, done: k >= 1, dir: q.x >= p.x ? 1 : -1 };
}
function renderMapNodes() {
  const el = $('mapNodes'); if (G.mode !== 'map') { el.innerHTML = ''; return; }
  el.innerHTML = MAP.map(n => {
    if (n.soon) return `<button class="node soon" type="button" data-node="${n.id}" style="left:${n.x}%;top:${n.y}%"><span class="hit"></span><span class="lbl">${n.soon}<small>Coming soon</small></span></button>`;
    const p = pondOf(n.id), own = S.ponds.includes(n.id), here = S.pond === n.id;
    const sub = here ? 'You are here' : own ? `${p.fish.filter(f => S.coll[f.id]).length}/${p.fish.length} found` : `Unlock · ${fmt(p.cost)}`;
    return `<button class="node${here ? ' here' : ''}" type="button" data-node="${n.id}" style="left:${n.x}%;top:${n.y}%" aria-label="${p.name}, ${sub}"><span class="hit"></span><span class="lbl">${p.name}<small>${sub}</small></span></button>`;
  }).join('');
}
const trees = Array.from({ length: 70 }, (_, i) => [((i * 37) % 97) / 97, ((i * 53) % 89) / 89, (i * 7) % 3]);
function drawMap(now) {
  const T = now / 1000, c = ctx;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#c9d0a0'); g.addColorStop(1, '#b7c288'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  // biomes: snowy north-east, sea in the south-east, dark crater in the middle
  c.fillStyle = 'rgba(255,255,255,.55)'; c.beginPath(); c.ellipse(W * .9, H * .2, W * .22, H * .35, 0, 0, 7); c.fill();
  c.fillStyle = '#5f8494'; c.beginPath(); c.moveTo(W, H * .6); c.quadraticCurveTo(W * .82, H * .72, W * .88, H); c.lineTo(W, H); c.fill();
  c.fillStyle = 'rgba(30,40,60,.25)'; c.beginPath(); c.ellipse(W * .4, H * .44, W * .12, H * .14, 0, 0, 7); c.fill();
  c.fillStyle = 'rgba(240,138,75,.18)'; c.beginPath(); c.ellipse(W * .27, H * .12, W * .12, H * .12, 0, 0, 7); c.fill();
  // mountains near the frozen lake and fjord
  [[.7, .36], [.77, .3], [.94, .3], [.96, .56]].forEach(([mx, my]) => {
    c.fillStyle = '#8a8f8a'; c.beginPath(); c.moveTo(W * mx - H * .07, H * my); c.lineTo(W * mx, H * my - H * .1); c.lineTo(W * mx + H * .07, H * my); c.fill();
    c.fillStyle = '#fbf8f0'; c.beginPath(); c.moveTo(W * mx - H * .025, H * my - H * .064); c.lineTo(W * mx, H * my - H * .1); c.lineTo(W * mx + H * .025, H * my - H * .064); c.fill();
  });
  // trees
  trees.forEach(([tx, ty, k]) => {
    const x = tx * W, y = ty * H;
    if (MAP.some(n => Math.hypot(n.x / 100 * W - x, n.y / 100 * H - y) < H * .13)) return;
    if (x > W * .82 && y > H * .6) return;
    c.fillStyle = ['#5d7a3e', '#4b6a33', '#6e8a48'][k]; c.beginPath(); c.moveTo(x, y - H * .035); c.lineTo(x - H * .018, y); c.lineTo(x + H * .018, y); c.fill();
  });
  // path
  c.strokeStyle = 'rgba(122,74,42,.75)'; c.lineWidth = Math.max(2, H * .008); c.setLineDash([H * .018, H * .014]); c.lineCap = 'round';
  c.beginPath(); MAP.forEach((n, i) => { const x = n.x / 100 * W, y = n.y / 100 * H; i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke(); c.setLineDash([]);
  // waters
  const R = Math.min(W, H) * .075;
  MAP.forEach(n => {
    const x = n.x / 100 * W, y = n.y / 100 * H, p = !n.soon && pondOf(n.id);
    c.save();
    if (p) {
      const own = S.ponds.includes(n.id);
      const wg = c.createRadialGradient(x, y - R * .2, R * .1, x, y, R * 1.2); wg.addColorStop(0, p.feature === 'ice' ? '#e9f1f6' : p.water[0]); wg.addColorStop(1, p.feature === 'ice' ? '#b5cfdd' : p.water[1]);
      c.globalAlpha = own ? 1 : .55;
      c.fillStyle = '#e9dcc0'; c.beginPath(); c.ellipse(x, y, R * 1.35, R * .82, 0, 0, 7); c.fill();
      c.fillStyle = wg; c.beginPath(); c.ellipse(x, y, R * 1.2, R * .7, 0, 0, 7); c.fill();
      if (p.feature === 'aurora') { c.strokeStyle = `rgba(127,240,200,${.4 + .3 * Math.sin(T * 2)})`; c.lineWidth = 3; c.stroke(); }
      if (!own) { c.globalAlpha = 1; c.fillStyle = '#2a1a12'; c.fillRect(x - R * .18, y - R * .1, R * .36, R * .3); c.strokeStyle = '#2a1a12'; c.lineWidth = R * .07; c.beginPath(); c.arc(x, y - R * .12, R * .12, Math.PI, 0); c.stroke(); }
    } else {
      c.setLineDash([4, 4]); c.strokeStyle = 'rgba(42,26,18,.4)'; c.lineWidth = 2; c.fillStyle = 'rgba(255,250,243,.35)';
      c.beginPath(); c.ellipse(x, y, R * 1.1, R * .62, 0, 0, 7); c.fill(); c.stroke();
      c.fillStyle = 'rgba(42,26,18,.45)'; c.font = `700 ${R * .7}px Fraunces, Georgia, serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', x, y + R * .05);
    }
    c.restore();
  });
  // angler
  let pos, walking = false, dir = 1;
  if (G.walk) { const w = walkPos(now); pos = w; walking = true; dir = w.dir; if (w.done) { const to = G.walk.to; G.walk = null; S.pond = to; save(); renderAll(); setTimeout(() => { if (G.mode === 'map') setMode('fish'); }, 350); } }
  else pos = MAP[mapIdx(S.pond)];
  const s = H / 260;
  c.save(); c.translate(pos.x / 100 * W - R * 1.2, pos.y / 100 * H + R * .45); if (dir < 0) c.scale(-1, 1);
  c.fillStyle = 'rgba(0,0,0,.18)'; c.beginPath(); c.ellipse(0, 0, 10 * s, 3 * s, 0, 0, 7); c.fill();
  drawAngler(c, 0, 0, s, S.hat, { T, walk: walking, rodUp: true });
  c.restore();
}
// ---------- scene ----------
const cv = $('cv'), ctx = cv.getContext('2d');
let W = 0, H = 0, dpr = 1;
function resize() { const r = cv.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1); W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; }
new ResizeObserver(resize).observe(cv);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const stars = Array.from({ length: 70 }, () => [Math.random(), Math.random() * .5, Math.random()]);
function hills(y, amp, col, seed, n) {
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, H);
  for (let i = 0; i <= 40; i++) { const x = i / 40; ctx.lineTo(x * W, y * H - amp * H * (Math.sin(x * n + seed) * .5 + Math.sin(x * n * 2.3 + seed * 2) * .3 + .5)); }
  ctx.lineTo(W, H); ctx.fill();
}
function drawScene(now) {
  const p = pondOf(S.pond), T = now / 1000, horizon = .46;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  let g = ctx.createLinearGradient(0, 0, 0, H * horizon); g.addColorStop(0, p.sky[0]); g.addColorStop(1, p.sky[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * horizon + 2);
  if (p.feature === 'aurora') {
    stars.forEach(s => { ctx.fillStyle = `rgba(255,255,240,${.4 + .5 * Math.sin(T * 2 + s[2] * 9) ** 2})`; ctx.fillRect(s[0] * W, s[1] * H * .8, 1.5, 1.5); });
    for (let b = 0; b < 3; b++) {
      ctx.beginPath();
      for (let i = 0; i <= 30; i++) { const x = i / 30; const y = (.12 + b * .06) * H + Math.sin(x * 5 + T * .4 + b) * H * .04; i ? ctx.lineTo(x * W, y) : ctx.moveTo(x * W, y); }
      ctx.strokeStyle = b === 1 ? 'rgba(255,170,100,.25)' : 'rgba(110,240,190,.28)'; ctx.lineWidth = H * .05; ctx.stroke();
    }
    ctx.fillStyle = '#f3ead6'; ctx.beginPath(); ctx.arc(W * .8, H * .13, H * .04, 0, 7); ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(255,240,200,.85)'; ctx.beginPath(); ctx.arc(W * .74, H * (horizon - .05), H * .07, 0, 7); ctx.fill();
  }
  if (p.feature === 'cliffs') { hills(horizon + .01, .32, p.far, 1, 4); }
  else if (p.feature === 'ice') { hills(horizon + .01, .1, p.far, 2, 3); }
  else hills(horizon + .01, .1, p.far, 3, 6);
  if (p.feature === 'birches') {
    for (let i = 0; i < 16; i++) { const x = (i * 71 % 100) / 100 * W, h = H * (.12 + (i * 13 % 7) / 60); ctx.fillStyle = '#efe9dc'; ctx.fillRect(x, H * horizon - h, 3, h); ctx.fillStyle = '#7f8f5a'; ctx.beginPath(); ctx.ellipse(x + 1.5, H * horizon - h, 8, 12, 0, 0, 7); ctx.fill(); }
  }
  // water
  const wy = H * horizon;
  g = ctx.createLinearGradient(0, wy, 0, H); g.addColorStop(0, p.water[0]); g.addColorStop(1, p.water[1]);
  ctx.fillStyle = g; ctx.fillRect(0, wy, W, H - wy);
  if (p.feature === 'ice') {
    ctx.fillStyle = '#e9f1f6'; ctx.fillRect(0, wy, W, H - wy);
    ctx.fillStyle = 'rgba(160,190,210,.35)'; for (let i = 0; i < 8; i++) ctx.fillRect(0, wy + (H - wy) * i / 8, W, 1);
  }
  ctx.strokeStyle = p.feature === 'ice' ? 'rgba(120,150,170,.25)' : 'rgba(255,250,240,.16)'; ctx.lineWidth = 1;
  for (let i = 0; i < 14; i++) { const y = wy + (H - wy) * (i + .5) / 14, off = reduce ? 0 : Math.sin(T * .6 + i) * 20; ctx.beginPath(); ctx.moveTo(((i * 53) % 100) / 100 * W + off, y); ctx.lineTo(((i * 53) % 100) / 100 * W + off + 30 + i * 4, y); ctx.stroke(); }
  // idle rods planted along the shore for this pond
  const here = S.slots.filter(sl => sl.pond === S.pond);
  here.forEach((sl, i) => {
    const bx = W * (.28 + i * .11), by = H * .97;
    ctx.strokeStyle = '#3a2516'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + W * .05, H * .7); ctx.stroke();
    const full = sl.net.length >= netCap();
    ctx.fillStyle = full ? '#ffc46b' : '#f08a4b'; ctx.beginPath(); ctx.arc(bx + W * .05, H * .7, 3, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,250,240,.4)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx + W * .05, H * .7); ctx.lineTo(bx + W * .08, H * (.62 + i * .015)); ctx.stroke();
  });
  // near shore / reeds / dock
  if (p.feature === 'ice') { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(W * .1, H * 1.02, W * .25, H * .14, 0, 0, 7); ctx.fill(); }
  else {
    ctx.fillStyle = p.near; ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(0, H * .78); ctx.quadraticCurveTo(W * .12, H * .8, W * .22, H); ctx.fill();
    if (p.feature === 'reeds' || p.feature === 'birches') {
      for (let i = 0; i < 18; i++) { const x = W * (.82 + i * .012), sway = reduce ? 0 : Math.sin(T * 1.2 + i) * 3; ctx.strokeStyle = i % 3 ? '#556b35' : '#6e8442'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, H); ctx.quadraticCurveTo(x, H * .82, x + sway, H * (.66 + (i % 4) * .03)); ctx.stroke(); if (i % 4 === 0) { ctx.fillStyle = '#5b3a20'; ctx.fillRect(x + sway - 2, H * (.66 + (i % 4) * .03), 4, 12); } }
    }
  }
  // dock
  if (p.feature !== 'ice') {
  const len = .2 + .13 * friendsHere().length;
  ctx.fillStyle = '#7a4a2a'; ctx.fillRect(0, H * .86, W * len, H * .03);
  ctx.fillStyle = '#5b3520'; ctx.fillRect(W * .06, H * .86, 6, H * .14); for (let k = .18; k < len; k += .13) ctx.fillRect(W * k, H * .86, 6, H * .14); }
  // the angler on the dock (or the ice), holding the rod
  const tipX = W * .3, tipY = H * .5;
  const bend = G.phase === 'bite' ? 12 * Math.sin(T * 20) : 0;
  const sc = H / 210, feetY = p.feature === 'ice' ? H * .95 : H * .917;
  drawFriends(T, sc, feetY);
  const hand = drawAngler(ctx, W * .09, feetY, sc, S.hat, { T, sit: true });
  ctx.strokeStyle = ROD[S.rod].color; ctx.lineWidth = Math.max(3, sc * 2.4); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(hand.x - 8 * sc, hand.y + 8 * sc); ctx.quadraticCurveTo(W * .2, H * .6 + bend, tipX, tipY + bend); ctx.stroke();
  if (p.feature === 'ice') { ctx.fillStyle = '#3e5a6c'; ctx.beginPath(); ctx.ellipse(W * .5, H * .78, W * .07, H * .025, 0, 0, 7); ctx.fill(); }
  // line + bobber
  if (G.phase !== 'idle' && G.phase !== 'done') {
    let bx = G.bob.x * W, by = G.bob.y * H;
    const el = now - G.t0;
    if (G.phase === 'cast') { const k = Math.min(1, el / 600); bx = tipX + (bx - tipX) * k; by = tipY + (by - tipY) * k - Math.sin(k * Math.PI) * H * .2; if (k >= 1) { G.phase = 'wait'; G.t0 = now; } }
    else if (G.phase === 'wait') { by += Math.sin(T * 2.4) * 1.5; if (el > G.wait) startBite(); }
    else if (G.phase === 'bite') {
      by += (Math.sin(T * 14) > .2 ? 5 : 0);
      const ph = markerPos(now); $('mark').style.left = (ph * 100) + '%';
      if (el > 3200) escapeFish();
      ctx.strokeStyle = 'rgba(255,250,240,.6)'; ctx.lineWidth = 1.5;
      for (let r = 0; r < 3; r++) { const rr = ((T * 30 + r * 12) % 36); ctx.globalAlpha = 1 - rr / 36; ctx.beginPath(); ctx.ellipse(bx, by + 4, rr, rr * .3, 0, 0, 7); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = 'rgba(255,250,240,.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(tipX, tipY + bend); ctx.quadraticCurveTo((tipX + bx) / 2, Math.max(tipY, by) + 10, bx, by); ctx.stroke();
    if (G.phase !== 'cast') { ctx.strokeStyle = 'rgba(255,250,240,.3)'; ctx.beginPath(); ctx.ellipse(bx, by + 4, 10, 3, 0, 0, 7); ctx.stroke(); }
    ctx.fillStyle = '#fffaf3'; ctx.beginPath(); ctx.arc(bx, by, 5, 0, Math.PI); ctx.fill();
    ctx.fillStyle = '#e1452b'; ctx.beginPath(); ctx.arc(bx, by, 5, Math.PI, 0); ctx.fill();
  }
  drawDockTags(sc, feetY);
  if (G.resultAt && now - G.resultAt > 3200 && G.phase !== 'bite') { $('catchbox').innerHTML = ''; G.resultAt = 0; }
}

// ---------- friends on the dock ----------
// Others at the fire with the game open. Peiskos passes on what each one is doing; whoever's at
// the same water sits on the dock with you (three fit beside you), the rest get a note in the corner.
const dock = { others: new Map(), sent: '', sentAt: 0, caught: null };
const COATS = [['#3d6f9a', '#2c5478'], ['#4f7a3a', '#3a5c2a'], ['#7a4a8a', '#5c3468'], ['#b08a2a', '#8a6a1a'], ['#3a8a80', '#2a6a62'], ['#a8445a', '#863244']];
const coatOf = id => COATS[Math.abs(id) % COATS.length];
function friendsHere() { return [...dock.others.values()].filter(o => o.status.pond === S.pond && !G.walk).slice(0, 3); }
function dockStatus() {
  const phase = G.mode === 'map' || G.walk ? 'idle' : G.phase === 'cast' || G.phase === 'wait' ? 'wait' : G.phase === 'bite' ? 'bite' : 'idle';
  return { pond: S.pond, hat: S.hat, rod: S.rod, phase, bob: phase === 'idle' ? null : [Math.round(G.bob.x * 100) / 100, Math.round(G.bob.y * 100) / 100] };
}
/** Tells the fire when anything the others would see has changed (a catch right away). */
function dockTick(now) {
  if (!ready) return;
  const st = dockStatus(), key = JSON.stringify(st);
  if (!dock.caught && (key === dock.sent || now - dock.sentAt < 300)) return;
  dock.sent = key; dock.sentAt = now;
  toPeiskos({ kind: 'status', status: Object.assign(st, { caught: dock.caught }) });
  dock.caught = null;
}
function drawFriends(T, sc, feetY) {
  friendsHere().forEach((o, i) => {
    const st = o.status, fx = .22 + i * .13, [coat, trim] = coatOf(o.userId);
    const hd = drawAngler(ctx, W * fx, feetY, sc, HAT[st.hat] ? st.hat : 'bucket', { T: T + i, sit: true, coat, trim });
    const tx = W * (fx + .21), ty = H * (.5 + i * .01), bend = st.phase === 'bite' ? 10 * Math.sin(T * 20) : 0;
    ctx.strokeStyle = (ROD[st.rod] || ROD.willow).color; ctx.lineWidth = Math.max(3, sc * 2.4); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hd.x - 8 * sc, hd.y + 8 * sc); ctx.quadraticCurveTo(W * (fx + .11), H * .6 + bend, tx, ty + bend); ctx.stroke();
    if (!st.bob) return;
    // Their bobber sits where it would in front of them.
    const bx = W * Math.min(.95, st.bob[0] + fx - .09), by = H * st.bob[1] + (st.phase === 'bite' && Math.sin(T * 14) > .2 ? 5 : 0);
    ctx.strokeStyle = 'rgba(255,250,240,.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(tx, ty + bend); ctx.quadraticCurveTo((tx + bx) / 2, Math.max(ty, by) + 10, bx, by); ctx.stroke();
    if (st.phase === 'bite') {
      ctx.strokeStyle = 'rgba(255,250,240,.6)'; ctx.lineWidth = 1.5;
      for (let r = 0; r < 3; r++) { const rr = ((T * 30 + r * 12) % 36); ctx.globalAlpha = 1 - rr / 36; ctx.beginPath(); ctx.ellipse(bx, by + 4, rr, rr * .3, 0, 0, 7); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#fffaf3'; ctx.beginPath(); ctx.arc(bx, by, 4.5, 0, Math.PI); ctx.fill();
    ctx.fillStyle = coat; ctx.beginPath(); ctx.arc(bx, by, 4.5, Math.PI, 0); ctx.fill();
  });
}
function pill(text, x, y, h, bg, fg, align) {
  const w = ctx.measureText(text).width + 16, left = align === 'right' ? x - w : align === 'left' ? x : x - w / 2;
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(left, y - h / 2, w, h, h / 2); ctx.fill();
  ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.fillText(text, left + 8, y);
}
/** Names under each seat, what a friend just landed, and who's fishing somewhere else. */
function drawDockTags(sc, feetY) {
  const here = friendsHere();
  if (!dock.others.size) return;
  const th = Math.max(18, sc * 10), small = `700 ${Math.round(Math.max(11, sc * 6.5))}px 'Nunito Sans', sans-serif`;
  ctx.save(); ctx.textBaseline = 'middle'; ctx.font = small;
  const tagY = Math.min(H - th / 2 - 4, feetY + H * .04);
  if (here.length) pill('you', W * .09 + 4 * sc, tagY, th, 'rgba(196,86,28,.92)', '#fffaf3');
  here.forEach((o, i) => {
    const fx = W * (.22 + i * .13) + 4 * sc;
    pill(o.name, fx, tagY, th, 'rgba(31,24,19,.72)', '#fffaf3');
    const c = o.caught, f = c && FISH[c.f];
    if (f && performance.now() - o.caughtSeen < 5000) { ctx.font = `800 ${Math.round(Math.max(11, sc * 6))}px 'Nunito Sans', sans-serif`; pill(`${f.name} · ${cm(c.s)} ${'★'.repeat(c.q)}`, fx, feetY - 62 * sc, th, '#ffc46b', '#1f1813'); ctx.font = small; }
  });
  // Everyone else, in the top corner.
  const away = [...dock.others.values()].filter(o => !here.includes(o)), lines = away.slice(0, 2).map(o => o.status.pond === S.pond ? `🎣 ${o.name} is here too` : `🎣 ${o.name} is at ${pondOf(o.status.pond)?.name || 'another water'}`);
  if (away.length > 2) lines.push(`+${away.length - 2} more fishing`);
  ctx.font = `700 12px 'Nunito Sans', sans-serif`;
  lines.forEach((t, i) => pill(t, W - 12, 27 + i * 30, 26, 'rgba(31,24,19,.6)', '#fffaf3', 'right'));
  ctx.restore();
}
function onDock(m) {
  if (!m.status) { dock.others.delete(m.userId); return; }
  const was = dock.others.get(m.userId), c = m.status.caught;
  // A catch shows for a few seconds after it comes in, once.
  const fresh = c && (!was || !was.caught || was.caught.at !== c.at);
  dock.others.set(m.userId, { userId: m.userId, name: String(m.name || 'Someone').slice(0, 24), status: m.status,
    caught: fresh ? c : was ? was.caught : null, caughtSeen: fresh ? performance.now() : was ? was.caughtSeen : 0 });
}
let lastIdleTick = 0;
function frame(now) {
  if (W && H) { if (G.mode === 'map') drawMap(now); else drawScene(now); }
  dockTick(now);
  if (now - lastIdleTick > 1000) { lastIdleTick = now; const r = tickIdle(Date.now()); if (r.added || r.missed) { renderNets(); if (S.tab === 'idle') renderPane(); save(); } else renderNetsLight(); }
  requestAnimationFrame(frame);
}


// ---------- UI ----------
function renderTop() {
  const total = Object.keys(FISH).length, got = Object.keys(S.coll).length;
  $('stats').innerHTML = `<div class="stat coins"><b>${fmt(S.coins)}</b><span>coins</span></div><div class="stat"><b>${fmt(S.stats.caught)}</b><span>caught</span></div><div class="stat"><b>${got}/${total}</b><span>species</span></div>${hatsUnlocked() ? `<div class="stat"><b>${S.hats.length}/${HATS.length}</b><span>hats</span></div>` : ''}`;
  if (!hatsUnlocked() && S.tab === 'hats') S.tab = 'shop';
  $('rodChip').textContent = rod().name;
  const b = BAIT[S.baitOn];
  $('baitChip').textContent = b.id === 'worms' ? b.name : `${b.name} ×${S.bait[b.id] || 0}`;
  const p = pondOf(S.pond);
  $('pondtag').innerHTML = `<b>${p.name}</b>${pondDone(p.id) ? '<span>+5%</span>' : ''}<span class="mapword">Map</span>`;
  $('pondtag').setAttribute('aria-label', `${p.name}. Open the map`);
  document.querySelectorAll('#tabs button').forEach(bt => {
    bt.setAttribute('aria-selected', bt.dataset.tab === S.tab);
    if (bt.dataset.tab === 'hats') { bt.hidden = !hatsUnlocked(); bt.innerHTML = 'Hats' + (S.hatsNew ? '<span class="dot"></span>' : ''); }
  });
}
function renderNets() {
  const el = $('nets');
  if (!S.slots.length) { el.innerHTML = `<div><div class="title">Idle rods</div><div class="sub">Buy a rod holder in the Idle rods tab. It keeps fishing while you're away.</div></div>`; return; }
  const cap = netCap(), total = S.slots.reduce((a, s) => a + s.net.length, 0), val = S.slots.reduce((a, s) => a + s.net.reduce((b, c) => b + c.v, 0), 0);
  el.innerHTML = `<div style="min-width:0"><div class="title">Keep nets</div><div class="sub">${total} fish waiting · about ${fmt(val)} coins</div></div>
    <div class="netbars">${S.slots.map(s => `<div class="netbar${s.net.length >= cap ? ' full' : ''}" title="${pondOf(s.pond).name}: ${s.net.length}/${cap}"><i style="height:${s.net.length / cap * 100}%"></i></div>`).join('')}</div>
    <button class="buy" type="button" data-act="collect" ${total ? '' : 'disabled'} style="grid-row:auto">Collect all</button>`;
}
function renderNetsLight() {
  if (S.tab !== 'idle') return;
  document.querySelectorAll('[data-eta]').forEach(e => {
    const sl = S.slots[+e.dataset.eta]; if (!sl) return;
    const iv = slotInterval(sl), full = sl.net.length >= netCap();
    e.textContent = full ? 'Net full, collect to keep fishing' : 'Next bite in ' + dur(iv - (Date.now() - sl.last));
    const bar = e.closest('.slot').querySelector('.bar i'); if (bar) bar.style.width = (full ? 100 : Math.min(100, (Date.now() - sl.last) / iv * 100)) + '%';
  });
}
function pips(n, max) { let s = '<div class="pips">'; for (let i = 0; i < max; i++) s += `<i class="${i < n ? 'on' : ''}"></i>`; return s + '</div>'; }
function renderPane() {
  const el = $('pane'); let h = '';
  if (S.tab === 'shop') {
    h += `<div class="sub-tabs">${[['rods', 'Rods'], ['up', 'Upgrades'], ['bait', 'Bait']].map(([k, l]) => `<button type="button" data-sub="${k}" aria-pressed="${S.shopTab === k}">${l}</button>`).join('')}</div>`;
    if (S.shopTab === 'rods') {
      h += `<h2>Rods</h2><p class="note">Better rods hook rarer and bigger fish with more stars, and some fish won't bite at all until you have one.</p><div class="list">`;
      RODS.forEach(r => {
        const own = S.rods.includes(r.id), cur = S.rod === r.id;
        const btn = cur ? `<button class="buy ghost" disabled>In hand</button>` : own ? `<button class="buy ghost" data-act="rod" data-id="${r.id}">Use</button>` : `<button class="buy" data-act="rod" data-id="${r.id}" ${S.coins < r.cost ? 'disabled' : ''}>${fmt(r.cost)}</button>`;
        h += `<div class="item${cur ? ' current' : ''}"><div class="name">${r.name} <span class="tag" style="vertical-align:middle">Tier ${r.tier}</span></div>${btn}<div class="desc">${r.desc}</div></div>`;
      });
      h += `</div>`;
    } else if (S.shopTab === 'up') {
      h += `<h2>Upgrades <small>for every rod</small></h2><div class="list">`;
      UPGRADES.forEach(u => {
        const lv = S.up[u.id], maxed = lv >= u.max, c = upCost(u);
        h += `<div class="item"><div class="name">${u.name} <small style="color:var(--muted);font-weight:600">Lv ${lv}/${u.max}</small></div><button class="buy" data-act="up" data-id="${u.id}" ${maxed || S.coins < c ? 'disabled' : ''}>${maxed ? 'Maxed' : fmt(c)}</button><div class="desc">${u.desc}</div>${pips(lv, u.max)}</div>`;
      });
      h += `</div>`;
    } else {
      h += `<h2>Bait</h2><p class="note">One bait is used per hand cast. Fish that like it bite three times as often.</p><div class="list">`;
      BAITS.forEach(b => {
        const have = b.id === 'worms' ? '∞' : (S.bait[b.id] || 0), on = S.baitOn === b.id;
        const use = (b.id === 'worms' || have > 0) ? `<button class="buy ghost" style="grid-row:auto" data-act="bait-on" data-id="${b.id}" ${on ? 'disabled' : ''}>${on ? 'On the hook' : 'Use'}</button>` : '';
        const buy = b.cost ? `<button class="buy" style="grid-row:auto" data-act="bait-buy" data-id="${b.id}" ${S.coins < b.cost ? 'disabled' : ''}>${b.pack} for ${fmt(b.cost)}</button>` : '';
        h += `<div class="item${on ? ' current' : ''}"><div class="name">${b.name} <small style="color:var(--muted);font-weight:600">${have === '∞' ? '' : 'have ' + have}</small></div><div style="grid-row:1/span 2;grid-column:2;display:flex;flex-direction:column;gap:6px">${buy}${use}</div><div class="desc">${b.desc}</div></div>`;
      });
      h += `</div>`;
    }
  } else if (S.tab === 'idle') {
    const cap = netCap();
    h += `<h2>Idle rods <small>${S.slots.length}/${SLOT_COSTS.length} holders</small></h2><p class="note">Each holder gets one bite every few minutes. The fastest is 3 minutes at Millpond, and each water after it is 1.5 minutes slower (9 minutes at Aurora Deep). Rare fish and harder waters often get away. A holder stops when its keep net is full (${cap} fish).${S.stats.chests ? ' Idle rods never find treasure chests.' : ''}</p><div class="list">`;
    S.slots.forEach((sl, i) => {
      const iv = slotInterval(sl), lc = slotLvlCost(sl, i), full = sl.net.length >= cap, val = sl.net.reduce((a, c) => a + c.v, 0);
      h += `<div class="slot"><div class="head"><span class="name">Rod holder ${i + 1}</span><select data-act="slot-pond" data-i="${i}" aria-label="Water for rod holder ${i + 1}">${S.ponds.map(pid => `<option value="${pid}" ${pid === sl.pond ? 'selected' : ''}>${pondOf(pid).name}</option>`).join('')}</select></div>
        <div class="bar"><i style="width:${full ? 100 : Math.min(100, (Date.now() - sl.last) / iv * 100)}%"></i></div>
        <div class="meta"><span data-eta="${i}">${full ? 'Net full, collect to keep fishing' : 'Next bite in ' + dur(iv - (Date.now() - sl.last))}</span><span>Lv ${sl.lvl} · a bite every ${dur(iv)}${iv <= idleFloor(sl.pond) ? ' (fastest here)' : ''}</span></div>
        <div class="meta"><span>Lands about ${Math.round(expectedLand(sl) * 100)}% of bites here</span><span>${sl.missed ? sl.missed + ' got away' : ''}</span></div>
        <div class="meta"><span>Net ${sl.net.length}/${cap}</span><span>${sl.net.length ? 'about ' + fmt(val) + ' coins' : ''}</span></div>
        <div class="acts"><button class="buy ghost" data-act="collect-one" data-i="${i}" ${sl.net.length ? '' : 'disabled'}>Collect ${sl.net.length || ''}</button><button class="buy" data-act="slot-up" data-i="${i}" ${sl.lvl >= 10 || S.coins < lc ? 'disabled' : ''}>${sl.lvl >= 10 ? 'Maxed' : 'Level up · ' + fmt(lc)}</button></div></div>`;
    });
    if (S.slots.length < SLOT_COSTS.length) { const c = SLOT_COSTS[S.slots.length]; h += `<div class="slot empty"><div>A new holder fishes the water you're at. Level it up for faster bites and a better catch rate.</div><button class="buy" style="grid-row:auto" data-act="slot-buy" ${S.coins < c ? 'disabled' : ''}>Buy holder · ${fmt(c)}</button></div>`; }
    h += `</div>`;
  } else if (S.tab === 'hats') {
    h += `<h2>Hats <small>${S.hats.length}/${HATS.length}</small></h2><p class="note">Hats come from treasure chests. When you hook a fish by hand there's a ${parseFloat((chestChance() * 100).toFixed(2))}% chance it's a chest instead. Later waters hold rarer hats. Each water also has its own hat for catching every fish there at 5 stars.</p><div class="hat-grid">`;
    HATS.forEach((ht, i) => {
      const own = S.hats.includes(ht.id), worn = S.hat === ht.id;
      if (ht.area && !HATS[i - 1].area) h += `</div><h2>Area hats</h2><p class="note">Catch every fish in a water at 5 stars.</p><div class="hat-grid">`;
      h += `<div class="hatcard${worn ? ' worn' : ''}${own ? '' : ' locked'}"><canvas data-hat="${ht.id}"${own ? '' : ' data-locked="1"'}></canvas><div class="name">${own ? ht.name : 'Not found'}</div>${ht.area ? `<span class="rar r5">${pondOf(ht.area).name}</span>${own ? '' : `<span class="rar r1" style="text-transform:none;letter-spacing:0">All ${pondStarsDone(ht.area)}/${pondOf(ht.area).fish.length} at 5★</span>`}` : rarHtml(ht.r)}${own ? `<button class="buy ${worn ? 'ghost' : ''}" type="button" data-act="hat" data-id="${ht.id}" ${worn ? 'disabled' : ''}>${worn ? 'Wearing' : 'Wear'}</button>` : ''}</div>`;
    });
    h += `</div>`;
  } else if (S.tab === 'board') {
    h += boardHtml();
  } else if (S.tab === 'coll') {
    h += `<p class="note" style="margin:0">Every catch gets 1 to 5 stars for quality and a size score out of 100. Bigger is always better, and the top 2% of a size range is a Giant worth ×3. Catch every species in a water and its fish sell for 5% more.</p>`;
    PONDS.forEach(p => {
      const got = p.fish.filter(f => S.coll[f.id]).length;
      h += `<div style="display:flex;flex-direction:column;gap:8px"><h2>${p.name} <small>${got}/${p.fish.length}${got === p.fish.length ? ' · +5% coins' : ''} · ${pondStarsDone(p.id)}/${p.fish.length} at 5★</small></h2><div class="coll-grid">`;
      p.fish.forEach(f => {
        const e = S.coll[f.id];
        if (e) h += `<div class="fishcard"><canvas data-fish="${f.id}"></canvas><div class="name">${f.name}</div>${rarHtml(f.r)}<div class="meta">${f.min}–${f.max} cm · caught ${e.n}<br>Biggest ${cm(e.best)}<br>Best ${starsHtml(e.bestQ || 1)}</div></div>`;
        else h += `<div class="fishcard unknown"><canvas data-fish="${f.id}" data-sil="1"></canvas><div class="name">Not caught yet</div>${rarHtml(f.r)}<div class="meta">${(f.rod || 1) > 1 ? 'Needs a tier ' + f.rod + ' rod' : '&nbsp;'}<br>&nbsp;<br>&nbsp;</div></div>`;
      });
      h += `</div></div>`;
    });
  }
  el.innerHTML = h;
  el.querySelectorAll('canvas[data-fish]').forEach(c => paintFishCanvas(c, FISH[c.dataset.fish], !!c.dataset.sil));
  el.querySelectorAll('canvas[data-bfish]').forEach(c => paintFishCanvas(c, FISH[c.dataset.bfish], false, +c.dataset.t / 100));
  el.querySelectorAll('canvas[data-hat]').forEach(c => paintHatCanvas(c, c.dataset.hat, !!c.dataset.locked));
}
function ago(t) { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'; }
function renderRecent() {
  const el = $('recent'), list = S.recent.slice(0, 6);
  if (!list.length) { el.innerHTML = `<h2>Recent catches</h2><div class="empty-state">Your last six catches show up here.</div>`; return; }
  el.innerHTML = `<h2>Recent catches <small>last ${list.length}</small></h2><div class="rc-grid">${list.map((r, i) => {
    if (r.chest) { const h = r.hat && HAT[r.hat]; return `<div class="rc chest"><canvas data-rc="${i}"></canvas><h3>${r.area ? 'Area hat' : 'Treasure chest'}</h3><div class="row">${h ? `<span>${h.name}</span>${h.area ? `<span class="rar r5">${pondOf(h.area).name}</span>` : rarHtml(h.r)}` : `<span>Coins</span><span class="val">+${fmt(r.coins)}</span>`}</div><div class="row"><span class="src">${ago(r.at)}</span></div></div>`; }
    const c = r.c, f = FISH[c.f], tags = [];
    if (c.g) tags.push('<span class="tag gold">Giant ×3</span>');
    if (c.p) tags.push('<span class="tag green">Perfect</span>');
    return `<div class="rc"><canvas data-rc="${i}"></canvas><h3>${f.name}</h3><div class="row">${rarHtml(f.r)}${starsHtml(c.q)}</div><div class="row"><span>${cm(c.s)}</span><span class="val">+${fmt(c.v)}</span></div>${sizeHtml(c.t)}<div class="row"><span class="src">${r.src === 'idle' ? 'Idle rod' : 'By hand'} · ${pondOf(f.pond).name}</span><span class="src">${ago(r.at)}</span></div>${tags.length ? '<div class="tags">' + tags.join('') + '</div>' : ''}</div>`;
  }).join('')}</div>`;
  el.querySelectorAll('canvas[data-rc]').forEach(cv => {
    const r = list[+cv.dataset.rc];
    if (r.chest) { const [c, w, h] = sizeCanvas(cv); const hx = r.area ? w / 2 : w * .66; if (!r.area) drawChest(c, r.hat ? w * .35 : w / 2, h * .82, h * .6, true); if (r.hat) { c.fillStyle = '#f1c9a0'; c.beginPath(); c.arc(hx, h * .78, h * .16, 0, 7); c.fill(); drawHat(c, r.hat, hx, h * .78, h * .16, 0); } }
    else paintFishCanvas(cv, FISH[r.c.f], false, r.c.t / 100);
  });
}
function renderAll() { renderTop(); renderNets(); renderRecent(); renderPane(); renderMapNodes(); }

function modal(title, bodyHtml, actions) {
  $('modalRoot').innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="card"><h2>${title}</h2>${bodyHtml}<div class="actions">${actions}</div></div></div>`;
  const first = $('modalRoot').querySelector('.actions button'); if (first) first.focus();
}
function closeModal() { $('modalRoot').innerHTML = ''; }
function awaySummary(ms, r) {
  const cap = netCap(), full = S.slots.filter(s => s.net.length >= cap).length;
  const by = {}; S.slots.forEach(s => s.net.forEach(c => { by[c.f] = (by[c.f] || 0) + 1; }));
  const val = S.slots.reduce((a, s) => a + s.net.reduce((b, c) => b + c.v, 0), 0);
  const lines = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([f, k]) => `<div><span>${FISH[f].name}</span><b>×${k}</b></div>`).join('');
  modal(`While you were away (${dur(ms)})`, `<p style="margin:0">Your idle rods landed <b>${r.added}</b> fish worth about <b>${fmt(val)}</b> coins${r.missed ? `, and <b>${r.missed}</b> got away` : ''}.${full ? ` ${full === S.slots.length ? 'Every net' : full + ' of your nets'} filled up, so those rods stopped early.` : ''}</p><div class="lines">${lines}</div>`, `<button class="buy ghost" data-act="close">Later</button><button class="buy" data-act="collect-close">Collect all</button>`);
}
function unlockModal(id) {
  const p = pondOf(id);
  modal(`Unlock ${p.name}?`, `<p style="margin:0">${p.blurb} ${p.fish.length} species live here.</p><div class="lines"><div><span>Cost</span><b>${fmt(p.cost)} coins</b></div><div><span>You have</span><b>${fmt(S.coins)}</b></div></div>`,
    `<button class="buy ghost" data-act="close">Not yet</button><button class="buy" data-act="unlock" data-id="${id}" ${S.coins < p.cost ? 'disabled' : ''}>${S.coins < p.cost ? 'Not enough coins' : 'Unlock and walk there'}</button>`);
}

// ---------- events ----------
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act],[data-tab],[data-sub],[data-go],[data-node],#pondtag'); if (!t) return;
  if (t.id === 'pondtag') { setMode('map'); return; }
  if (t.dataset.node) {
    const n = MAP[mapIdx(t.dataset.node)];
    if (n.soon || G.walk) return;
    if (!S.ponds.includes(n.id)) return unlockModal(n.id);
    return walkTo(n.id);
  }
  if (t.dataset.tab) { S.tab = t.dataset.tab; if (S.tab === 'hats') S.hatsNew = false; if (S.tab === 'board') askBoard(); renderTop(); renderPane(); save(); return; }
  if (t.dataset.sub) { S.shopTab = t.dataset.sub; renderPane(); return; }
  if (t.dataset.go) { const [a, b] = t.dataset.go.split(':'); S.tab = a; S.shopTab = b; renderTop(); renderPane(); return; }
  const a = t.dataset.act, id = t.dataset.id, i = +t.dataset.i;
  if (a === 'rod') { const r = ROD[id]; if (!S.rods.includes(id)) { if (S.coins < r.cost) return; S.coins -= r.cost; S.rods.push(id); } S.rod = id; }
  else if (a === 'up') { const u = UPGRADES.find(x => x.id === id), c = upCost(u); if (S.coins < c || S.up[id] >= u.max) return; S.coins -= c; S.up[id]++; }
  else if (a === 'bait-buy') { const b = BAIT[id]; if (S.coins < b.cost) return; S.coins -= b.cost; S.bait[id] = (S.bait[id] || 0) + b.pack; if (S.baitOn === 'worms') S.baitOn = id; }
  else if (a === 'bait-on') S.baitOn = id;
  else if (a === 'hat') { if (S.hats.includes(id)) S.hat = id; }
  else if (a === 'unlock') { const p = pondOf(id); if (S.coins < p.cost) return; S.coins -= p.cost; S.ponds.push(id); closeModal(); save(); renderAll(); return walkTo(id); }
  else if (a === 'slot-buy') { const c = SLOT_COSTS[S.slots.length]; if (S.coins < c) return; S.coins -= c; S.slots.push({ pond: S.pond, lvl: 1, net: [], last: Date.now(), missed: 0 }); }
  else if (a === 'slot-up') { const sl = S.slots[i], c = slotLvlCost(sl, i); if (S.coins < c || sl.lvl >= 10) return; S.coins -= c; sl.lvl++; }
  else if (a === 'collect') return collect(null);
  else if (a === 'collect-one') return collect(i);
  else if (a === 'collect-close') { closeModal(); return collect(null); }
  else if (a === 'close') return closeModal();
  save(); renderAll();
});
document.addEventListener('change', e => {
  if (e.target.dataset.act === 'slot-pond') { const sl = S.slots[+e.target.dataset.i]; sl.pond = e.target.value; save(); renderAll(); }
});
$('castBtn').addEventListener('click', primary);
$('scene').addEventListener('pointerdown', e => {
  if (e.button !== 0 || G.mode === 'map' || e.target.closest('button')) return;
  e.preventDefault(); primary();
});
document.addEventListener('keydown', e => {
  if ($('modalRoot').innerHTML) { if (e.key === 'Escape') closeModal(); return; }
  if (e.key === 'Escape' && G.mode === 'map') { setMode('fish'); return; }
  if ((e.code === 'Space' || e.key === 'Enter') && !['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA'].includes(document.activeElement.tagName)) { e.preventDefault(); primary(); }
  else if (e.key === 'm' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) setMode(G.mode === 'map' ? 'fish' : 'map');
});
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
window.addEventListener('pagehide', flushSave);
setInterval(flushSave, 30000);
setInterval(() => { if (ready && S.tab === 'board' && !document.hidden && Date.now() - boardAsked > 55000) askBoard(); }, 5000);

// ---------- boot ----------
// Peiskos answers "ready" with the save (or nothing, for someone new), and sends it again if
// another device saved in between ("reload"). "flush" asks for any unsaved progress right now.
let running = false;
function start(data, theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  $('loading').hidden = true; $('app').hidden = false;
  load(data);
  const { saved, ...rest } = S; lastSent = JSON.stringify(rest);
  ready = true;
  const now = Date.now(), away = now - (S.saved || now);
  const r = tickIdle(now);
  closeModal(); $('catchbox').innerHTML = ''; G.phase = 'idle'; G.walk = null; setMode('fish');
  renderAll(); updateCastBtn();
  if ((r.added || r.missed) && away > 60000) awaySummary(away, r);
  if (r.added || r.missed) save();
  if (S.tab === 'board') askBoard();
  if (!running) { running = true; requestAnimationFrame(frame); }
}
window.addEventListener('message', e => {
  if (e.source !== window.parent) return;
  const m = e.data;
  if (!m || typeof m !== 'object') return;
  if (m.kind === 'init') start(m.save, m.theme);
  else if (m.kind === 'reload') { start(m.save); $('catchbox').innerHTML = '<div class="catch"><h3>Picked up your other device</h3><div class="row" style="color:var(--muted)"><span>You saved there more recently, so this is where you left off.</span></div></div>'; G.resultAt = performance.now(); }
  else if (m.kind === 'theme') document.documentElement.dataset.theme = m.theme;
  else if (m.kind === 'flush') flushSave();
  else if (m.kind === 'dock') onDock(m);
  else if (m.kind === 'board') { board = m.board; if (S.tab === 'board') renderPane(); }
});
toPeiskos({ kind: 'ready' });
})();
