// Daylight: where the sun and moon are for the viewer right now, from their own clock, and the moon's real phase.
// Backdrops use it to light a scene for the time of day. There is no location, so the sun follows a
// mid-latitude day: longer in summer, shorter in winter, flipped for time zones south of the equator.
// Part of Peiskos's client: plain scripts that index.html loads in order, sharing one global scope.
'use strict';

const DL_SYNODIC = 29.530588853; // days from one new moon to the next
const DL_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // a known new moon
// Time zones south of the equator, where summer is in December and the moon is seen the other way up.
const DL_SOUTH = /^(Australia|Antarctica)\/|^Pacific\/(Auckland|Chatham|Fiji|Tongatapu|Apia|Noumea|Efate|Port_Moresby|Tahiti)|^America\/(Argentina|Santiago|Sao_Paulo|Montevideo|Asuncion|La_Paz|Lima|Punta_Arenas)|^Africa\/(Johannesburg|Maputo|Harare|Lusaka|Windhoek|Gaborone|Maseru|Mbabane|Luanda|Lubumbashi|Blantyre|Dar_es_Salaam)|^Indian\/(Mauritius|Reunion|Antananarivo)|^Atlantic\/Stanley/;

const dlClamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const dlSmooth = (a, b, x) => { const t = dlClamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** How far through its cycle the moon is at this moment: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
function moonPhase(date = new Date()) {
  const days = (date.getTime() - DL_NEW_MOON) / 86400000;
  return (((days / DL_SYNODIC) % 1) + 1) % 1;
}

let dlSouthern = null;
function dlIsSouthern() {
  if (dlSouthern === null) {
    try { dlSouthern = DL_SOUTH.test(Intl.DateTimeFormat().resolvedOptions().timeZone || ''); } catch { dlSouthern = false; }
  }
  return dlSouthern;
}

/**
 * The sky at a moment, for drawing. Everything is 0..1 unless it says otherwise.
 * light: how much daylight (0 night, 1 full day). warm: the dawn and dusk glow, highest at sunrise and sunset.
 * sun.x / moon.x: across the sky from left (rising) to right (setting). sun.alt / moon.alt: height, 0 at the horizon.
 * moon.phase: as moonPhase(). moon.lit: the share of its face in sunlight.
 */
function daylight(date = new Date()) {
  const h = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  const south = dlIsSouthern();
  const start = new Date(date.getFullYear(), 0, 1);
  const doy = (date - start) / 86400000;
  // Summer clocks run an hour ahead of the sun.
  const jan = start.getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  const noon = 12 + (date.getTimezoneOffset() < Math.max(jan, jul) ? 1 : 0);
  const season = Math.cos((2 * Math.PI * (doy - 172)) / 365.25) * (south ? -1 : 1); // 1 midsummer, -1 midwinter
  const dayLen = 12 + 3.2 * season;
  const rise = noon - dayLen / 2;
  const since = (((h - rise) % 24) + 24) % 24; // hours since sunrise
  // Height of the sun: a half sine over the day, and below the horizon through the night.
  const e = since < dayLen ? Math.sin((Math.PI * since) / dayLen) : -Math.sin((Math.PI * (since - dayLen)) / (24 - dayLen));
  const light = dlSmooth(-0.14, 0.32, e);
  const warm = dlClamp(1 - Math.abs(e - 0.02) / 0.24);
  const phase = moonPhase(date);
  // The moon crosses the sky about 50 minutes later each day: with the sun at new moon, opposite it at full.
  const ha = ((((h - noon - phase * 24) % 24) + 36) % 24) - 12; // hours from the moon's highest point
  const moonUp = Math.abs(ha) < 6.2;
  return {
    hour: h, light, warm, night: 1 - light, south,
    sun: { up: since < dayLen, x: dlClamp(since / dayLen), alt: Math.max(0, e) },
    moon: { up: moonUp, x: dlClamp((ha + 6.2) / 12.4), alt: moonUp ? Math.cos((Math.PI * ha) / 12.4) : 0, phase, lit: (1 - Math.cos(2 * Math.PI * phase)) / 2 },
  };
}

/** Mixes two #rrggbb colors, t of the way from a to b. */
function dlMix(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  t = dlClamp(t);
  const ch = (s) => Math.round(((pa >> s) & 255) + (((pb >> s) & 255) - ((pa >> s) & 255)) * t);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}
/** A color for this time of day: the night one, the day one, and the dusk one blended in at sunrise and sunset. */
const dlTone = (sky, night, day, dusk = null, duskAmount = 0.65) => (dusk ? dlMix(dlMix(night, day, sky.light), dusk, sky.warm * duskAmount) : dlMix(night, day, sky.light));

/** The sunlit part of a round body (a moon, a planet) in a phase, as an SVG path; '' when none of it is lit. */
function dlLitPath(cx, cy, r, phase) {
  phase = ((phase % 1) + 1) % 1;
  const k = Math.cos(2 * Math.PI * phase); // 1 at new, -1 at full
  const rx = Math.abs(k) * r;
  const waxing = phase < 0.5;
  if (Math.abs(phase - 0.5) < 0.004) return `M${cx} ${cy - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}Z`;
  if (phase < 0.004 || phase > 0.996) return '';
  // Half the disc on the lit side, then back along the line between day and night.
  const outer = waxing ? 1 : 0;
  const back = waxing ? (k > 0 ? 0 : 1) : (k > 0 ? 1 : 0);
  return `M${cx} ${cy - r}A${r} ${r} 0 0 ${outer} ${cx} ${cy + r}A${rx.toFixed(2)} ${r} 0 0 ${back} ${cx} ${cy - r}Z`;
}
/**
 * The moon as SVG at cx,cy with radius r, in its phase: the dark part faint, the lit part `color`.
 * Waxing is lit on the right in the north and on the left in the south.
 */
function dlMoonSvg(cx, cy, r, phase, { color = '#f4eedc', dark = '#f4eedc', darkOpacity = 0.12, south = false, craters = true } = {}) {
  const d = dlLitPath(cx, cy, r, phase);
  const flip = south ? ` transform="translate(${2 * cx} 0) scale(-1 1)"` : '';
  const spots = craters ? [[-0.32, -0.22, 0.2], [0.18, 0.28, 0.24], [0.3, -0.36, 0.12], [-0.12, 0.42, 0.1], [-0.45, 0.18, 0.13]]
    .map(([x, y, s]) => `<circle cx="${(cx + x * r).toFixed(1)}" cy="${(cy + y * r).toFixed(1)}" r="${(s * r).toFixed(1)}" fill="#000" opacity=".09"/>`).join('') : '';
  const id = `dlm${Math.round(cx)}x${Math.round(cy)}`;
  return `<g${flip}><circle cx="${cx}" cy="${cy}" r="${r}" fill="${dark}" opacity="${darkOpacity}"/>${d ? `<clipPath id="${id}"><path d="${d}"/></clipPath><path d="${d}" fill="${color}"/><g clip-path="url(#${id})">${spots}</g>` : ''}</g>`;
}
