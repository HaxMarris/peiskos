// The client's state machines (client/js/phases.js): the tables hang together, and every phase the
// client code moves to or asks about is one its machine has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const clientDir = join(import.meta.dirname, '../../client/js');
type Table = Record<string, string[]>;

function loadPhases() {
  const warnings: string[] = [];
  const sandbox: Record<string, any> = { window: {}, console: { warn: (m: string) => warnings.push(m) } };
  runInNewContext(readFileSync(join(clientDir, 'phases.js'), 'utf8') + '\n;globalThis.PHASES = PHASES; globalThis.phaseMachine = phaseMachine;', sandbox);
  return { PHASES: sandbox.PHASES as Record<string, Table>, phaseMachine: sandbox.phaseMachine, peiskosPhases: sandbox.window.peiskosPhases, warnings };
}

// Each machine's variable in the client code, and where it starts.
const MACHINES: Record<string, { pattern: RegExp; initial: string[] }> = {
  voice: { pattern: /\bvoicePhase\.(?:to|is)\(([^)]*)\)/g, initial: ['idle'] },
  fireGame: { pattern: /\bgamePhase\.(?:to|is)\(([^)]*)\)/g, initial: ['none'] },
  connection: { pattern: /\bconnPhase\.(?:to|is)\(([^)]*)\)/g, initial: ['offline'] },
  upload: { pattern: /\.upload\??\.(?:to|is)\(([^)]*)\)/g, initial: ['preparing'] },
  auth: { pattern: /\bauthPhase\.(?:to|is)\(([^)]*)\)/g, initial: ['login', 'register'] },
};

test('phases: every move goes to a phase the machine has, and every phase can be reached', () => {
  const { PHASES } = loadPhases();
  assert.deepEqual(Object.keys(PHASES).sort(), Object.keys(MACHINES).sort());
  for (const [name, table] of Object.entries(PHASES)) {
    for (const [from, next] of Object.entries(table))
      for (const to of next) {
        assert.ok(table[to], `${name}: ${from} → ${to}, which isn't a phase`);
        assert.notEqual(to, from, `${name}: ${from} lists itself`);
      }
    const seen = new Set(MACHINES[name].initial);
    for (let grew = true; grew;) {
      grew = false;
      for (const p of [...seen]) for (const to of table[p]) if (!seen.has(to)) { seen.add(to); grew = true; }
    }
    assert.deepEqual([...seen].sort(), Object.keys(table).sort(), `${name}: some phases can't be reached`);
  }
});

test('phases: the client only names phases its machines have', () => {
  const { PHASES } = loadPhases();
  const code = readdirSync(clientDir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(clientDir, f), 'utf8')).join('\n');
  for (const [name, { pattern }] of Object.entries(MACHINES)) {
    let calls = 0;
    for (const [, args] of code.matchAll(pattern)) {
      calls++;
      for (const [, phase] of args.matchAll(/'([^']+)'/g)) assert.ok(PHASES[name][phase], `${name} has no phase "${phase}"`);
    }
    assert.ok(calls > 0, `nothing uses the ${name} machine`);
  }
  // The login screen shows one card for each of its phases.
  const cards = /const AUTH_CARDS = \{([^}]*)\}/.exec(code)?.[1] ?? '';
  assert.deepEqual([...cards.matchAll(/(\w+):/g)].map((m) => m[1]).sort(), Object.keys(PHASES.auth).sort());
});

test('phases: a machine moves, warns about a move its table lacks, and marks its element', () => {
  const { phaseMachine, peiskosPhases, warnings } = loadPhases();
  const el = { dataset: {} as Record<string, string> };
  const changes: string[] = [];
  const m = phaseMachine('fireGame', 'none', { el, onChange: (to: string, from: string) => changes.push(`${from}>${to}`) });
  assert.equal(el.dataset.phase, 'none');
  assert.equal(m.to('asking'), true);
  assert.equal(m.to('asking'), false); // already there
  assert.equal(m.to('playing'), true); // not a move it has, but it still goes there
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /asking → playing/);
  assert.equal(el.dataset.phase, 'playing');
  assert.ok(m.is('loading', 'playing'));
  assert.deepEqual(changes, ['none>asking', 'asking>playing']);
  assert.deepEqual({ ...peiskosPhases() }, { fireGame: 'playing' });
  assert.throws(() => m.to('nowhere'), /No phase "nowhere"/);
  phaseMachine('upload', 'preparing', { track: false });
  assert.deepEqual(Object.keys(peiskosPhases()), ['fireGame']);
});
