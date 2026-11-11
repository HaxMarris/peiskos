// The client's scripts share one global scope with the browser's own window properties. Safari (and
// so the iPhone app) refuses a top-level `let`, `const`, `class` or `function` named like one of the
// window's getters (screen, toolbar, ...) and drops the whole file, while Chrome lets it through.
// Fireside Trivia's `let screen` and the drawing games' `function toolbar` did exactly that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const client = fileURLToPath(new URL('../../client/', import.meta.url));
// The window's own getters in Safari and Chrome, plus the few names that are never safe at the top.
const WINDOW = `window self document name location history customElements locationbar menubar personalbar
  scrollbars statusbar toolbar status closed frames length top opener parent frameElement navigator
  clientInformation origin external screen innerWidth innerHeight scrollX pageXOffset scrollY pageYOffset
  visualViewport screenX screenY outerWidth outerHeight devicePixelRatio event defaultStatus
  defaultstatus styleMedia onerror performance crypto indexedDB sessionStorage localStorage caches
  isSecureContext crossOriginIsolated speechSynthesis trustedTypes scheduler cookieStore
  screenLeft screenTop`.split(/\s+/);

function scripts(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'vendor' ? [] : scripts(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}

test('no client script declares a top-level name the window already has', () => {
  const clashes: string[] = [];
  for (const file of [...scripts(join(client, 'js')), ...scripts(join(client, 'games'))]) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/^(?:let|const|var|class|(?:async\s+)?function\*?)\s+([A-Za-z_$][\w$]*)/gm)) {
      if (WINDOW.includes(m[1])) clashes.push(`${relative(client, file)}: ${m[1]}`);
    }
  }
  assert.deepEqual(clashes, []);
});
