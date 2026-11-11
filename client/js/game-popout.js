// Pop out the game you're playing: a game at the fire, the casino or Fireside Angler gets a window
// of its own, like a popped-out stream (campfire.js), so you can play it beside the chat. In the
// desktop app it's an ordinary window with a pin to keep it on top; a browser opens a pop-up.
//
// The game's part of the stage moves into that window and is still run from here. A game in a
// frame loads again when it moves, so the games hand over what they need first (games.js,
// fishing.js) and Melon Bomber only moves between rounds. Closing the window puts it back.

const GAME_POPS = {
  game: { view: '.game-view', title: () => FIRE_GAMES[gamePlay?.name]?.title ?? 'Game', live: () => !!gamePlay, show: () => showGame() },
  casino: { view: '.casino-view', title: () => 'Casino', live: () => casino.channelId !== null, show: () => openCasino() },
  fishing: { view: '.fishing-view', title: () => 'Fireside Angler', live: () => !!fishing.play, show: () => openFishing() },
};
const gamePopSupported = !!window.burrowDesktop?.popout || (!isApp && matchMedia('(hover: hover) and (pointer: fine)').matches);
const gamePopBusy = (kind) => kind === 'game' && !!gamePlay?.busy;

function popOutGame(kind) {
  const spec = GAME_POPS[kind];
  if (!spec?.live()) return;
  if (gamePop?.kind === kind) return focusGamePop();
  if (gamePopBusy(kind)) return toast('You can pop it out between rounds.');
  if (gamePop) closeGamePop(gamePop.kind);
  const view = document.querySelector(spec.view);
  if (!view) return;
  const stage = $('#stage').getBoundingClientRect();
  const width = Math.round(Math.min(1200, Math.max(720, stage.width || 960)));
  const height = Math.round(Math.min(860, Math.max(520, stage.height || 680)));
  const win = window.open('', 'peiskos-game', `popup,width=${width},height=${height}`);
  if (!win) return toast("Couldn't pop it out. Allow pop-ups for Peiskos and try again.");
  win.peiskosHost = window; // the games talk to this page, not to the window they're in
  const doc = win.document;
  doc.head.replaceChildren();
  doc.head.insertAdjacentHTML('beforeend', '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">');
  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
    const copy = doc.createElement('link');
    copy.rel = 'stylesheet';
    copy.href = link.href;
    doc.head.append(copy);
  }
  doc.title = spec.title();
  // The same theme and text size as the app's window, kept in step.
  const copyLook = () => {
    for (const { name } of [...doc.documentElement.attributes]) if (!document.documentElement.hasAttribute(name)) doc.documentElement.removeAttribute(name);
    for (const { name, value } of document.documentElement.attributes) doc.documentElement.setAttribute(name, value);
  };
  copyLook();
  const look = new MutationObserver(copyLook);
  look.observe(document.documentElement, { attributes: true });
  doc.body.className = 'game-pop';

  const pin = doc.createElement('button');
  pin.type = 'button';
  pin.className = 'icon-btn game-pop-pin';
  pin.innerHTML = PIN_ICON;
  const setPinned = (on) => {
    pin.classList.toggle('on', on);
    pin.title = on ? 'Stop keeping on top' : 'Keep on top of other windows';
    pin.setAttribute('aria-label', pin.title);
    pin.setAttribute('aria-pressed', String(on));
    window.burrowDesktop.popout.setOnTop(on, 'game');
    store.set('gamePopoutOnTop', on ? '1' : '');
  };
  if (window.burrowDesktop?.popout) {
    pin.onclick = () => setPinned(!pin.classList.contains('on'));
    view.querySelector('.game-pop-btn')?.before(pin);
    setPinned(!!store.get('gamePopoutOnTop'));
  }

  // A frame's page loads again in its new window. Fireside Angler's last save still comes from
  // the page it leaves, so that one is let through too.
  if (kind === 'fishing' && fishing.play) fishing.play.before = fishing.play.frame.contentWindow;
  if (kind === 'game' && gamePlay) gamePhase.to('loading'); // its page loads again over there
  gamePop = { kind, win, doc, view, home: { parent: view.parentNode, next: view.nextSibling }, look, pin };
  doc.body.append(view);
  for (const [type, fn, options] of docListeners) doc.addEventListener(type, fn, options);
  win.addEventListener('pagehide', () => { if (gamePop?.win === win) putGameBack({ show: false }); });

  if (state.stageShow === kind) {
    state.stageShow = 'fire';
    renderStage();
  }
  renderGamePopButtons();
  renderVoicePlaces();
  win.focus();
}

/** Puts the popped-out game back on the stage; show opens it there (Put it back), or not (the window closed). */
function putGameBack({ show = true } = {}) {
  const p = gamePop;
  if (!p) return;
  gamePop = null;
  p.look.disconnect();
  p.pin.remove();
  for (const [type, fn, options] of docListeners) p.doc.removeEventListener(type, fn, options);
  // Dialogs and toasts that were showing over the game come back too.
  for (const sel of ['#modal', '#ask', '#toasts']) {
    const el = p.doc.querySelector(sel);
    if (el) document.body.append(el);
  }
  if (p.kind === 'fishing' && fishing.play) fishing.play.before = fishing.play.frame.contentWindow;
  if (p.kind === 'game' && gamePlay) gamePhase.to('loading');
  p.home.parent.insertBefore(p.view, p.home.next?.parentNode === p.home.parent ? p.home.next : null);
  if (!p.win.closed) p.win.close();
  renderGamePopButtons();
  renderVoicePlaces();
  if (show && GAME_POPS[p.kind].live()) GAME_POPS[p.kind].show();
  else if (!state.stageOpen && GAME_POPS[p.kind].live()) { state.leftGame = p.kind; renderVoicePlaces(); }
}

/** The game ended or you left it: its window goes too. */
function closeGamePop(kind) {
  if (gamePop?.kind === kind) putGameBack({ show: false });
}

function focusGamePop() {
  if (!gamePop || gamePop.win.closed) return false;
  gamePop.win.focus();
  return true;
}

/** Dialogs and toasts show in whichever window you're using: the game's, when you're in it. */
function placeLayer(sel) {
  const el = $(sel);
  if (!el) return;
  const doc = gamePop && !gamePop.win.closed && gamePop.doc.hasFocus() ? gamePop.doc : document;
  if (el.ownerDocument !== doc) doc.body.append(el);
}

function renderGamePopButtons() {
  for (const b of document.querySelectorAll('.game-pop-btn')) {
    b.classList.toggle('hidden', !gamePopSupported);
    if (!gamePopSupported) continue;
    const out = gamePop?.kind === b.dataset.pop;
    const busy = gamePopBusy(b.dataset.pop);
    b.classList.toggle('on', out);
    b.disabled = busy;
    b.title = busy ? 'You can pop it out between rounds' : out ? 'Put it back in Peiskos' : 'Pop out into its own window';
    b.setAttribute('aria-label', b.title);
  }
  if (gamePop) {
    const b = gamePop.doc.querySelector('.game-pop-btn');
    if (b) {
      const busy = gamePopBusy(gamePop.kind);
      b.classList.toggle('hidden', false);
      b.classList.add('on');
      b.disabled = busy;
      b.title = busy ? 'You can put it back between rounds' : 'Put it back in Peiskos';
      b.setAttribute('aria-label', b.title);
    }
  }
}

for (const b of document.querySelectorAll('.game-pop-btn')) {
  b.innerHTML = PIP_ICON;
  b.onclick = () => (gamePop?.kind === b.dataset.pop ? putGameBack() : popOutGame(b.dataset.pop));
}
renderGamePopButtons();

// The game in the pop-out is run from this page, so when the page goes (reloaded, closed, or the
// tab navigated away) the window would be left showing a game that's stopped. The desktop app
// closes it itself; a browser leaves it open, so it's closed here.
window.addEventListener('pagehide', () => { if (gamePop && !gamePop.win.closed) gamePop.win.close(); });
