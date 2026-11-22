import { resolve, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { endLiveStreams, openDb } from './db.ts';
import { createApp } from './app.ts';
import { finishRestore, scheduleBackups } from './backup.ts';
import { s3FromEnv } from './s3.ts';
import { parseCertList } from './app-links.ts';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const dbFile = process.env.DB_FILE ?? resolve(here, '../data/chat.db');

// A backup chosen to restore (on the admin page, or with restore.ts) replaces the database now.
const replaced = finishRestore(dbFile);
if (replaced) console.log(`Restored a backup. The database it replaced is kept as ${replaced}.`);

const db = openDb(dbFile);
endLiveStreams(db);
const backupDir = process.env.BACKUP_DIR ?? join(dirname(dbFile), 'backups');
const backupKeep = Number(process.env.BACKUP_KEEP ?? 7);
const uploadDir = process.env.UPLOAD_DIR ?? join(dirname(dbFile), 'uploads');
const offsite = s3FromEnv();
if (backupKeep > 0) scheduleBackups(db, backupDir, backupKeep, offsite ? { cfg: offsite, uploadDir } : undefined);

// Clips at the fire are cut and mixed with ffmpeg, so they're on wherever it's installed (it is in Docker).
const tapesOn = process.env.TAPES !== 'off' && spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
/** TAPE_TRANSCRIBE_HOURS: "1-7" (from 1 to 7 at night, server time), or "always". */
function nightHours(text: string | undefined): [number, number] | undefined {
  if (text === 'always') return [0, 24];
  const m = text?.match(/^(\d{1,2})-(\d{1,2})$/);
  return m && Number(m[1]) <= 24 && Number(m[2]) <= 24 ? [Number(m[1]), Number(m[2])] : undefined;
}

const app = createApp({
  db,
  publicDir: resolve(process.env.PUBLIC_DIR ?? resolve(here, '../../client')),
  registrationCode: process.env.REGISTRATION_CODE || undefined,
  uploadDir,
  hosting: {
    dbFile,
    backupDir,
    backupKeep,
    offsite: offsite ?? undefined,
    // The updater (see docker-compose.yml) and Peiskos talk through files in the data folder.
    dataDir: dirname(dbFile),
    admins: (process.env.ADMIN_USERS ?? '').split(',').map((n) => n.trim()).filter(Boolean),
    heartbeatUrl: process.env.HEARTBEAT_URL || undefined,
  },
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 25) * 1024 * 1024,
  dailyUploadBytes: Number(process.env.UPLOAD_DAILY_MB ?? 2048) * 1024 * 1024,
  minFreeDiskBytes: Number(process.env.MIN_FREE_DISK_MB ?? 2048) * 1024 * 1024,
  movies: {
    maxBytes: Number(process.env.MOVIE_MAX_MB ?? 4096) * 1024 * 1024,
    storageBytes: Number(process.env.MOVIE_STORAGE_MB ?? 20480) * 1024 * 1024,
    keepDays: Number(process.env.MOVIE_KEEP_DAYS ?? 14),
  },
  mail: process.env.SMTP_URL ? { url: process.env.SMTP_URL, from: process.env.MAIL_FROM || `Peiskos <${decodeURIComponent(new URL(process.env.SMTP_URL).username).includes('@') ? decodeURIComponent(new URL(process.env.SMTP_URL).username) : 'burrow@localhost'}>` } : undefined,
  publicUrl: process.env.PUBLIC_URL || undefined,
  pushContact: process.env.PUSH_CONTACT || undefined,
  apns:
    process.env.APNS_KEY && process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID
      ? { key: process.env.APNS_KEY, keyId: process.env.APNS_KEY_ID.trim(), teamId: process.env.APNS_TEAM_ID.trim(), topic: process.env.APNS_TOPIC || 'app.peiskos' }
      : undefined,
  // Invite links that open the phone apps: the Apple team is the one alerts already use.
  appLinks: {
    appleAppId: process.env.APNS_TEAM_ID ? `${process.env.APNS_TEAM_ID.trim()}.${process.env.APNS_TOPIC || 'app.peiskos'}` : undefined,
    androidPackage: 'app.peiskos',
    androidCerts: parseCertList(process.env.ANDROID_CERT_SHA256),
  },
  fcm: process.env.FCM_SERVICE_ACCOUNT ? { serviceAccount: process.env.FCM_SERVICE_ACCOUNT } : undefined,
  legal: { name: process.env.LEGAL_NAME || undefined, contact: process.env.LEGAL_CONTACT || undefined },
  gifs: process.env.KLIPY_API_KEY ? { apiKey: process.env.KLIPY_API_KEY, rating: process.env.GIF_RATING || undefined } : undefined,
  tapes: tapesOn
    ? {
        maxMinutes: Number(process.env.TAPE_MAX_MINUTES ?? 180),
        storageBytes: Number(process.env.TAPE_STORAGE_MB ?? 10240) * 1024 * 1024,
        whisperUrl: process.env.WHISPER_URL || undefined,
        language: process.env.TAPE_LANGUAGE || undefined,
        nightHours: nightHours(process.env.TAPE_TRANSCRIBE_HOURS),
      }
    : false,
  voice:
    process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET
      ? {
          apiKey: process.env.LIVEKIT_API_KEY,
          apiSecret: process.env.LIVEKIT_API_SECRET,
          url: process.env.LIVEKIT_URL || undefined,
          apiUrl: process.env.LIVEKIT_API_URL || 'http://localhost:7880',
        }
      : undefined,
});

app.listen(port, () => {
  // The app's files are compressed the first time someone asks for them, which takes a second or
  // two. Asking once now means the first person to open Peiskos after a restart doesn't wait for it.
  fetch(`http://localhost:${port}/`, { headers: { 'accept-encoding': 'br' } }).then((r) => r.arrayBuffer()).catch(() => {});
  console.log(`Chat server listening on http://localhost:${port}`);
  console.log(`Database: ${dbFile}`);
  console.log(backupKeep > 0 ? `Daily backups: ${backupDir} (keeping ${backupKeep})` : 'Daily backups are off.');
  if (backupKeep > 0) console.log(offsite ? `Off-site copies: ${offsite.bucket}` : 'Off-site copies are off (set the BACKUP_S3_ settings to turn them on).');
  if (!process.env.REGISTRATION_CODE)
    console.log('Warning: REGISTRATION_CODE is not set, so anyone who can reach this server can sign up.');
  if (!process.env.KLIPY_API_KEY) console.log('The GIF picker is off (set KLIPY_API_KEY to turn it on).');
  if (!process.env.SMTP_URL) console.log("Email is off, so people can't reset a forgotten password themselves (set SMTP_URL to turn it on).");
  if (process.env.LIVEKIT_API_KEY && process.env.TAPES !== 'off' && !tapesOn) console.log("Clips at the fire are off: install ffmpeg to turn them on.");
  if (tapesOn && !process.env.WHISPER_URL) console.log('Clips have no transcripts (set WHISPER_URL to turn them on; see README).');
  if (!process.env.LIVEKIT_API_KEY) console.log('Voice rooms are off (set LIVEKIT_API_KEY and LIVEKIT_API_SECRET to turn them on).');
});
