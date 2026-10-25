// Peiskos used to be called Burrow, and the update renamed Burrow.exe to Peiskos.exe. Shortcuts
// still pointing at the old file (a pinned taskbar icon, the Start menu, the desktop) show a blank
// page and won't open, so point them at this copy of the app instead.
const { app, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function shortcutFolders() {
  const roaming = app.getPath('appData');
  return [
    path.join(roaming, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'),
    path.join(roaming, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'StartMenu'),
    path.join(roaming, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    app.getPath('desktop'),
  ];
}

function fixOldShortcuts() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  for (const folder of shortcutFolders()) {
    let names;
    try { names = fs.readdirSync(folder); } catch { continue; }
    for (const name of names) {
      if (!name.toLowerCase().endsWith('.lnk')) continue;
      const file = path.join(folder, name);
      try {
        const link = shell.readShortcutLink(file);
        if (path.basename(link.target).toLowerCase() !== 'burrow.exe' || fs.existsSync(link.target)) continue;
        shell.writeShortcutLink(file, 'update', {
          target: process.execPath,
          cwd: path.dirname(process.execPath),
          icon: process.execPath,
          iconIndex: 0,
          appUserModelId: 'chat.burrow.desktop',
        });
      } catch {}
    }
  }
}

// Windows keeps its own copy of each shortcut's picture, so after an update that changes the app
// icon, pinned taskbar and desktop shortcuts keep showing the old one. Once per new version,
// rewrite our shortcuts and ask Windows to reload its icon cache.
function refreshIcons() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const marker = path.join(app.getPath('userData'), 'icon-version');
  let seen = '';
  try { seen = fs.readFileSync(marker, 'utf8').trim(); } catch {}
  if (seen === app.getVersion()) return;
  try { fs.writeFileSync(marker, app.getVersion()); } catch {}
  const exe = process.execPath.toLowerCase();
  for (const folder of shortcutFolders()) {
    let names;
    try { names = fs.readdirSync(folder); } catch { continue; }
    for (const name of names) {
      if (!name.toLowerCase().endsWith('.lnk')) continue;
      const file = path.join(folder, name);
      try {
        const link = shell.readShortcutLink(file);
        if ((link.target || '').toLowerCase() !== exe) continue;
        shell.writeShortcutLink(file, 'update', { icon: process.execPath, iconIndex: 0 });
      } catch {}
    }
  }
  try {
    const tool = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'ie4uinit.exe');
    spawn(tool, ['-show'], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
  } catch {}
}

module.exports = { fixOldShortcuts, refreshIcons };
