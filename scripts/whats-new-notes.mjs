// Prints the start of a release's notes: the "What's new" lines this release adds, from
// client/whats-new.json, compared with that file as it was in the last release.
// Run: node scripts/whats-new-notes.mjs <the last release's whats-new.json, or nothing>
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => {
  try { return JSON.parse(readFileSync(path, 'utf8')).entries ?? []; } catch { return []; }
};
const now = read(new URL('../client/whats-new.json', import.meta.url));
const before = process.argv[2] && existsSync(process.argv[2]) ? read(process.argv[2]) : [];
const seen = new Map(before.map((e) => [e.id, new Set(e.items)]));
// New entries, and lines added to an entry the last release already had.
const lines = now.flatMap((e) => e.items.filter((item) => !seen.get(e.id)?.has(item)));
if (lines.length) console.log(`## What's new\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
