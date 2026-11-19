// Logins (the page's "token" and "accounts") kept in the system's locked storage instead of the
// page's own storage, which is a plain file any program running as you could read. Windows locks
// them to your Windows account; Linux uses the desktop's keyring when there is one.
//
// Not on a Mac yet: there the lock is tied to the app's signature, and an unsigned app's signature
// changes with every update, so the Mac would ask for your password after each one.
const { app, ipcMain, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const KEYS = new Set(['token', 'accounts']);
const file = () => path.join(app.getPath('userData'), 'logins.json');

function usable() {
  if (process.platform === 'darwin') return false;
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    // Without a keyring, Linux "encrypts" with a key everyone knows.
    return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text';
  } catch {
    return false;
  }
}

let saved = null;
function read() {
  if (saved) return saved;
  try { saved = JSON.parse(fs.readFileSync(file(), 'utf8')) || {}; } catch { saved = {}; }
  return saved;
}
function write() {
  const part = `${file()}.part`;
  fs.writeFileSync(part, JSON.stringify(saved), { mode: 0o600 });
  fs.renameSync(part, file());
}

function serveSecrets() {
  ipcMain.on('secrets-available', (e) => { e.returnValue = usable(); });
  ipcMain.on('secrets-get', (e, key) => {
    const value = KEYS.has(key) && usable() ? read()[key] : undefined;
    try { e.returnValue = value == null ? null : safeStorage.decryptString(Buffer.from(value, 'base64')); } catch { e.returnValue = null; }
  });
  // Answers whether it was kept, so the page only forgets its own copy once it's safe here.
  ipcMain.on('secrets-set', (e, key, value) => {
    try {
      if (!KEYS.has(key) || !usable()) throw new Error('not kept');
      read();
      if (value == null) delete saved[key];
      else saved[key] = safeStorage.encryptString(String(value)).toString('base64');
      write();
      e.returnValue = true;
    } catch {
      e.returnValue = false;
    }
  });
}

module.exports = { serveSecrets };
