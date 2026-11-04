// The main window opens where it was last left: same size, same place, still maximized or
// full screen if it was. A spot that's no longer on any screen (a monitor unplugged) is skipped.
const { app, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const file = () => path.join(app.getPath('userData'), 'window-state.json');

function load() {
  try {
    const s = JSON.parse(fs.readFileSync(file(), 'utf8'));
    if (!(s.width >= 480 && s.height >= 400)) return {};
    const onScreen = Number.isFinite(s.x) && Number.isFinite(s.y) && screen.getAllDisplays().some(({ workArea: a }) =>
      s.x < a.x + a.width - 80 && s.x + s.width > a.x + 80 && s.y >= a.y - 10 && s.y < a.y + a.height - 60);
    return onScreen ? s : { width: s.width, height: s.height, maximized: s.maximized };
  } catch {
    return {};
  }
}

function track(win) {
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = null;
    if (win.isDestroyed() || win.isMinimized()) return;
    // The size it goes back to when un-maximized, so that isn't lost.
    const b = win.getNormalBounds();
    const state = { ...b, maximized: win.isMaximized(), fullScreen: win.isFullScreen() };
    try { fs.writeFileSync(file(), JSON.stringify(state)); } catch {}
  };
  const soon = () => { clearTimeout(timer); timer = setTimeout(save, 500); };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, soon);
  win.on('close', save);
}

module.exports = { load, track };
