// The app's state machines, written down: each one's phases and which phase may follow which.
// Part of Burrow's client: plain scripts that index.html loads in order, sharing one global scope.
// This file loads first, so the others can make their machines with phaseMachine().
//
// A machine holds one phase. Moving to a phase the table doesn't allow still happens (so a
// missed case never leaves anyone stuck), but it's logged as a warning, which is how a wrong
// move gets noticed. Each machine with an element also writes its phase to that element's
// data-phase attribute, so tests and tools can read where things are instead of guessing from
// the text on screen. window.peiskosPhases() lists every machine's phase at once.
'use strict';

/** Every machine: name -> { phase -> the phases that may come next }. Read by the tests too. */
const PHASES = {
  // Being in voice (voice.js, people.js). rejoining: the connection dropped, and Peiskos is
  // waiting to try again or trying. reconnecting: the voice server is getting the call back by
  // itself. securing: in the room, waiting for the room's encryption key.
  voice: {
    idle: ['connecting', 'rejoining'],
    connecting: ['securing', 'connected', 'idle'],
    rejoining: ['securing', 'connected', 'idle'],
    securing: ['connected', 'reconnecting', 'idle'],
    connected: ['reconnecting', 'idle'],
    reconnecting: ['securing', 'connected', 'idle'],
  },
  // Playing a game at the fire on this device (games.js). asking: start or join was sent, and
  // the server hasn't said you're in yet. loading: the game's page is loading (again, when it
  // pops out into its own window).
  fireGame: {
    none: ['asking', 'loading'],
    asking: ['none', 'loading'],
    loading: ['playing', 'none'],
    playing: ['loading', 'none'],
  },
  // The live connection to the server (core.js). checking: a ping went out to see that a quiet
  // connection is still there. waiting: dropped, and waiting out the backoff before trying again.
  connection: {
    offline: ['connecting'],
    connecting: ['open', 'waiting', 'offline'],
    open: ['checking', 'waiting', 'offline', 'connecting'],
    checking: ['open', 'waiting', 'offline', 'connecting'],
    waiting: ['connecting', 'offline'],
  },
  // One file attached to the composer (files.js). preparing: shrinking a photo, or reading a
  // video's size and first frame. shrinking: a video being made smaller by hand.
  upload: {
    preparing: ['shrinking', 'uploading', 'tooBig', 'failed', 'cancelled'],
    shrinking: ['preparing', 'failed', 'cancelled'],
    uploading: ['uploaded', 'failed', 'cancelled', 'preparing'],
    uploaded: ['preparing', 'cancelled'],
    tooBig: ['preparing', 'cancelled'],
    failed: ['preparing', 'cancelled'],
    cancelled: [],
  },
  // The login screen (core.js). reset and resetCode: "Forgot your password?" before and after
  // the code was emailed. resetLink: a reset link from whoever runs the server. in: logged in.
  auth: {
    login: ['register', 'reset', 'twoStep', 'resetLink', 'in'],
    register: ['login', 'resetLink', 'in'],
    reset: ['resetCode', 'login'],
    resetCode: ['login', 'twoStep', 'in'],
    twoStep: ['login', 'in'],
    resetLink: ['login', 'register', 'twoStep', 'in'],
    in: ['login', 'register'],
  },
};

const phaseMachines = new Map();

/**
 * A machine from PHASES. `el` (an element, or a function that finds it) gets the phase as
 * data-phase; `onChange(phase, from)` runs after each move. `track: false` leaves it out of
 * peiskosPhases(), for machines there are many of (one per attached file).
 */
function phaseMachine(name, initial, { el = null, onChange = null, track = true } = {}) {
  const table = PHASES[name];
  if (!table?.[initial]) throw new Error(`No phase "${initial}" in ${name}`);
  let phase = initial;
  const mark = () => {
    const node = typeof el === 'function' ? el() : el;
    if (node) node.dataset.phase = phase;
  };
  const m = {
    name,
    get phase() { return phase; },
    is: (...phases) => phases.includes(phase),
    /** Moves to `next`. Returns false (and changes nothing) when it's already there. */
    to(next) {
      if (next === phase) return false;
      if (!table[next]) throw new Error(`No phase "${next}" in ${name}`);
      if (!table[phase].includes(next)) console.warn(`Peiskos ${name}: ${phase} → ${next} isn't one of its moves`);
      const from = phase;
      phase = next;
      mark();
      onChange?.(phase, from);
      return true;
    },
    mark,
  };
  if (track) phaseMachines.set(name, m);
  mark();
  return m;
}

/** Where every machine is right now, for tests, tools and anyone debugging from the console. */
window.peiskosPhases = () => Object.fromEntries([...phaseMachines].map(([name, m]) => [name, m.phase]));
