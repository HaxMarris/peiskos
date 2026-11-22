// Your login and your account: the username, devices and sessions, two-step login, passkeys,
// recovery codes, and leaving for good (deleting the account, or downloading your things).
import { randomBytes } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname } from 'node:path';
import type { WebSocket } from 'ws';
import { checkTotp, hashRecovery, newRecoveryCodes, newTotpSecret, verifyAssertion, verifyRegistration, ZipWriter } from './account.ts';
import type { AppOptions, Channel, Handler, User } from './app.ts';
import { hashPassword, newToken, verifyPassword } from './auth.ts';
import type { Db } from './db.ts';
import { bearer, HttpError, type Json } from './http.ts';

export interface LoginContext {
  accessChanged: (serverId: number) => void;
  avatarPath: (file: string) => string;
  broadcastToChannel: (channel: Channel, event: Json) => void;
  channelById: (id: number) => Channel | undefined;
  checkNameFree: (username: string, userId?: number | undefined) => void;
  checkTries: (keys: string[], limit: number) => void;
  cleanUsername: (value: unknown) => string;
  clearTries: (key: string) => boolean;
  db: Db;
  deleteBurrow: (serverId: number) => void;
  failedTry: (keys: string[], windowMs?: number) => void;
  filePath: (id: string) => string;
  friendsOf: (userId: number) => { friends: { status: string; custom: { text: string; emoji: string; until: number | null; } | null; activity: { name: string; since: number; } | null; online: boolean; id: number; username: string; displayName: string | null; avatar: string | null; }[]; incoming: { status: string; custom: { text: string; emoji: string; until: number | null; } | null; activity: { name: string; since: number; } | null; online: boolean; id: number; username: string; displayName: string | null; avatar: string | null; }[]; outgoing: { status: string; custom: { text: string; emoji: string; until: number | null; } | null; activity: { name: string; since: number; } | null; online: boolean; id: number; username: string; displayName: string | null; avatar: string | null; }[]; blocked: User[]; };
  hashCode: (code: string) => string;
  holdName: (name: string, userId: number) => void;
  isBotUser: (id: number) => boolean;
  leaveGroup: (serverId: number, user: User) => { ok: boolean; };
  meJson: (user: User) => Json;
  newPassword: (body: Json) => string;
  now: () => number;
  opts: AppOptions;
  placeOf: (channelId: number, viewerId: number) => { serverId: unknown; channelId: number; kind: string; serverName: unknown; channelName: unknown; threadName: unknown; } | null;
  removeFiles: (rows: Json[]) => void;
  removeMember: (serverId: number, userId: number) => void;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => number;
  sendServerUpdate: (serverId: number) => void;
  sendTo: (userIds: Iterable<number>, event: Json) => void;
  serverMemberIds: (serverId: number) => number[];
  socketTokens: WeakMap<WebSocket, string>;
  sockets: Map<number, Set<WebSocket>>;
  startSession: (user: User, from?: { ip: string; ua: string; } | undefined) => { token: string; user: User; };
  userById: (id: number) => User | undefined;
  userByToken: (raw: string | undefined) => User | undefined;
  userChanged: (userId: number) => unknown;
}

export function login(ctx: LoginContext) {
  const {
    accessChanged, avatarPath, broadcastToChannel, channelById, checkNameFree, checkTries, cleanUsername,
    clearTries, db, deleteBurrow, failedTry, filePath, friendsOf, hashCode, holdName, isBotUser, leaveGroup,
    meJson, newPassword, now, opts, placeOf, removeFiles, removeMember, route, sendServerUpdate, sendTo,
    serverMemberIds, socketTokens, sockets, startSession, userById, userByToken, userChanged,
  } = ctx;

  // ---- your login: username, devices, two-step login, passkeys ------------

  /** Checks your password (and with two-step login on, a code) before something big. */
  const confirmIdentity = (user: User, body: Json, { needCode = true } = {}) => {
    const key = `confirm-user:${user.id}`;
    checkTries([key], 10);
    const row = db.prepare('SELECT password_hash, totp_secret FROM users WHERE id = ?').get(user.id) as { password_hash: string; totp_secret: string | null };
    if (!verifyPassword(String(body.password ?? ''), row.password_hash)) {
      failedTry([key]);
      throw new HttpError(403, 'Your password is wrong');
    }
    if (needCode && row.totp_secret && !useSecondFactor(user.id, String(body.code ?? ''))) {
      failedTry([key]);
      throw new HttpError(403, 'That code from your authenticator app isn\'t right');
    }
    clearTries(key);
  };

  /** Signs a person out everywhere (but this login, if given) and closes those connections. */
  const signOutOthers = (userId: number, keepToken: string | null, reason: string) => {
    if (keepToken) db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(userId, keepToken);
    else db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    for (const ws of sockets.get(userId) ?? []) if (socketTokens.get(ws) !== keepToken) ws.close(4001, reason);
  };

  route('POST', '/api/me/username', ({ user, body }) => {
    confirmIdentity(user, body);
    const username = cleanUsername(body.username);
    // Keeping your own name in a different case is fine, reserved or not.
    if (username.toLowerCase() !== user.username.toLowerCase()) {
      checkNameFree(username, user.id);
      holdName(user.username, user.id);
    }
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, user.id);
    return userChanged(user.id);
  });

  // A device's id in "your devices": the start of its login's hash.
  const sessionId = (hash: string) => hash.slice(0, 16);
  /** "Chrome on Windows", "Peiskos app on Mac" and so on, from a user agent. */
  const deviceName = (ua: string | null) => {
    if (!ua) return 'Unknown device';
    const os = /iPhone|iPad/.test(ua) ? (/iPad/.test(ua) ? 'iPad' : 'iPhone') : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
    const app = /Electron|Burrow\//.test(ua) ? 'Peiskos app' : /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /node/i.test(ua) ? 'Script' : 'Browser';
    return os ? `${app} on ${os}` : app;
  };
  route('GET', '/api/me/sessions', ({ user, session }) =>
    (
      db.prepare('SELECT token, created_at, last_used_at, device, ip FROM sessions WHERE user_id = ? ORDER BY COALESCE(last_used_at, created_at) DESC').all(user.id) as
        { token: string; created_at: number; last_used_at: number | null; device: string | null; ip: string | null }[]
    ).map((s) => ({
      id: sessionId(s.token),
      device: deviceName(s.device),
      ip: s.ip,
      createdAt: s.created_at,
      lastUsedAt: s.last_used_at ?? s.created_at,
      current: s.token === session,
      online: [...(sockets.get(user.id) ?? [])].some((ws) => socketTokens.get(ws) === s.token),
    })),
  );
  route('DELETE', '/api/me/sessions/:code', ({ user, params, session }) => {
    const all = db.prepare('SELECT token FROM sessions WHERE user_id = ?').all(user.id) as { token: string }[];
    const s = all.find((x) => sessionId(x.token) === params[0]);
    if (!s) throw new HttpError(404, 'That device is already signed out');
    if (s.token === session) throw new HttpError(400, 'Use Log out to sign out of this device');
    db.prepare('DELETE FROM sessions WHERE token = ?').run(s.token);
    for (const ws of sockets.get(user.id) ?? []) if (socketTokens.get(ws) === s.token) ws.close(4001, 'Signed out');
    return { ok: true };
  });
  route('DELETE', '/api/me/sessions', ({ user, session }) => {
    signOutOthers(user.id, session ?? null, 'Signed out');
    return { ok: true };
  });

  // Two-step login. Turning it on is a choice; nobody has to.
  const twoStepTickets = new Map<string, { userId: number; until: number; tries: number; from: { ip: string; ua: string } }>();
  /** A login that's passed the password: straight in, or (with two-step login on) a ticket to swap for one with a code. */
  const loginOrAskCode = (userId: number, from: { ip: string; ua: string }) => {
    const row = db.prepare('SELECT totp_secret FROM users WHERE id = ?').get(userId) as { totp_secret: string | null };
    if (!row.totp_secret) return startSession(userById(userId)!, from);
    const t = now();
    for (const [k, v] of twoStepTickets) if (v.until < t) twoStepTickets.delete(k);
    const ticket = newToken();
    twoStepTickets.set(ticket, { userId, until: t + 5 * 60 * 1000, tries: 0, from });
    return { twoStep: true, ticket };
  };
  /** A code from the authenticator app (used at most once) or one of the recovery codes (then gone). */
  const useSecondFactor = (userId: number, code: string) => {
    const r = db.prepare('SELECT totp_secret, totp_last_step, recovery_codes FROM users WHERE id = ?').get(userId) as
      { totp_secret: string | null; totp_last_step: number; recovery_codes: string };
    if (!r.totp_secret) return true;
    const step = checkTotp(r.totp_secret, code, r.totp_last_step, now());
    if (step !== null) {
      db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ?').run(step, userId);
      return true;
    }
    const codes = JSON.parse(r.recovery_codes) as string[];
    const i = code.trim() ? codes.indexOf(hashRecovery(code)) : -1;
    if (i < 0) return false;
    codes.splice(i, 1);
    db.prepare('UPDATE users SET recovery_codes = ? WHERE id = ?').run(JSON.stringify(codes), userId);
    return true;
  };
  route(
    'POST',
    '/api/login/two-step',
    ({ body, ip }) => {
      checkTries([`two-step-ip:${ip}`], 20);
      const ticket = twoStepTickets.get(String(body.ticket ?? ''));
      if (!ticket || ticket.until < now()) throw new HttpError(400, 'That took too long. Log in again.');
      checkTries([`two-step-user:${ticket.userId}`], 10);
      if (!useSecondFactor(ticket.userId, String(body.code ?? ''))) {
        failedTry([`two-step-ip:${ip}`, `two-step-user:${ticket.userId}`]);
        if (++ticket.tries >= 5) twoStepTickets.delete(String(body.ticket));
        throw new HttpError(401, ticket.tries >= 5 ? 'Too many wrong codes. Log in again.' : "That code isn't right");
      }
      twoStepTickets.delete(String(body.ticket));
      clearTries(`two-step-user:${ticket.userId}`);
      return startSession(userById(ticket.userId)!, ticket.from);
    },
    false,
  );
  // Setting it up: a secret for the authenticator app (shown as a QR code), then a code to prove it works.
  route('POST', '/api/me/two-step/setup', ({ user, body }) => {
    confirmIdentity(user, body, { needCode: false });
    const secret = newTotpSecret();
    db.prepare('UPDATE users SET totp_pending = ? WHERE id = ?').run(secret, user.id);
    const label = encodeURIComponent(`Peiskos:${user.username}`);
    return { secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=Peiskos&digits=6&period=30` };
  });
  route('POST', '/api/me/two-step/enable', ({ user, body }) => {
    const r = db.prepare('SELECT totp_pending FROM users WHERE id = ?').get(user.id) as { totp_pending: string | null };
    if (!r.totp_pending) throw new HttpError(400, 'Start again from the beginning');
    checkTries([`two-step-setup:${user.id}`], 10);
    const step = checkTotp(r.totp_pending, String(body.code ?? ''), -1, now());
    if (step === null) {
      failedTry([`two-step-setup:${user.id}`]);
      throw new HttpError(400, "That code isn't right. Check the time on your phone, and try the newest code.");
    }
    const codes = newRecoveryCodes();
    db.prepare('UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_last_step = ?, recovery_codes = ? WHERE id = ?').run(
      step, JSON.stringify(codes.map(hashRecovery)), user.id,
    );
    sendTo([user.id], { type: 'me_updated', me: meJson(user) });
    return { recoveryCodes: codes, me: meJson(user) };
  });
  route('POST', '/api/me/two-step/disable', ({ user, body }) => {
    confirmIdentity(user, body);
    db.prepare("UPDATE users SET totp_secret = NULL, totp_pending = NULL, recovery_codes = '[]' WHERE id = ?").run(user.id);
    sendTo([user.id], { type: 'me_updated', me: meJson(user) });
    return meJson(user);
  });
  route('POST', '/api/me/two-step/recovery', ({ user, body }) => {
    confirmIdentity(user, body);
    const codes = newRecoveryCodes();
    db.prepare('UPDATE users SET recovery_codes = ? WHERE id = ? AND totp_secret IS NOT NULL').run(JSON.stringify(codes.map(hashRecovery)), user.id);
    return { recoveryCodes: codes, me: meJson(user) };
  });

  // Passkeys: Face ID, Windows Hello, a phone or a security key instead of a password.
  // The site name a passkey is tied to: PUBLIC_URL's host, or the host the app was opened at.
  const rpIdFor = (host: string) => {
    if (opts.publicUrl) return new URL(opts.publicUrl).hostname;
    return host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '') || 'localhost';
  };
  const passkeyChallenges = new Map<string, { challenge: string; until: number; userId?: number; rpId: string }>();
  const newChallenge = (key: string, rpId: string, userId?: number) => {
    const t = now();
    for (const [k, v] of passkeyChallenges) if (v.until < t) passkeyChallenges.delete(k);
    // Oldest first, so a flood of login attempts can't grow this without end.
    while (passkeyChallenges.size >= 10000) passkeyChallenges.delete(passkeyChallenges.keys().next().value!);
    const challenge = randomBytes(32).toString('base64url');
    passkeyChallenges.set(key, { challenge, until: t + 5 * 60 * 1000, userId, rpId });
    return challenge;
  };
  const takeChallenge = (key: string) => {
    const c = passkeyChallenges.get(key);
    passkeyChallenges.delete(key);
    if (!c || c.until < now()) throw new HttpError(400, 'That took too long. Try again.');
    return c;
  };
  const passkeysOf = (userId: number) =>
    db.prepare('SELECT id, name, created_at AS createdAt, last_used_at AS lastUsedAt FROM passkeys WHERE user_id = ? ORDER BY created_at').all(userId);

  route('GET', '/api/me/passkeys', ({ user }) => passkeysOf(user.id));
  route('POST', '/api/me/passkeys/options', ({ user, body, host }) => {
    confirmIdentity(user, body);
    const rpId = rpIdFor(host);
    const challenge = newChallenge(`add:${user.id}`, rpId, user.id);
    return {
      challenge,
      rp: { name: 'Peiskos', id: rpId },
      user: { id: Buffer.from(String(user.id)).toString('base64url'), name: user.username, displayName: user.displayName || user.username },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -8 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
      excludeCredentials: (passkeysOf(user.id) as { id: string }[]).map((p) => ({ type: 'public-key', id: p.id })),
      attestation: 'none',
      timeout: 120_000,
    };
  });
  route('POST', '/api/me/passkeys', ({ user, body, ua }) => {
    const c = takeChallenge(`add:${user.id}`);
    const cred = (body.credential ?? {}) as Json;
    const response = (cred.response ?? {}) as Json;
    let key;
    try {
      key = verifyRegistration({ clientDataJSON: String(response.clientDataJSON ?? ''), attestationObject: String(response.attestationObject ?? '') }, c.challenge, c.rpId);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : 'That passkey didn\'t work');
    }
    if (db.prepare('SELECT 1 FROM passkeys WHERE id = ?').get(key.id)) throw new HttpError(409, 'That passkey is already added');
    const name = (typeof body.name === 'string' && body.name.trim().slice(0, 40)) || `Passkey on ${deviceName(ua).replace(/^.* on /, '')}`;
    db.prepare('INSERT INTO passkeys (id, user_id, name, public_key, alg, sign_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      key.id, user.id, name, JSON.stringify(key.jwk), key.alg, key.signCount, now(),
    );
    return passkeysOf(user.id);
  });
  route('DELETE', '/api/me/passkeys/:code', ({ user, params }) => {
    db.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?').run(params[0], user.id);
    return passkeysOf(user.id);
  });
  route(
    'POST',
    '/api/login/passkey/options',
    ({ ip, host }) => {
      // Every ask counts (it needs no login): 30 a minute from one address.
      checkTries([`passkey-ip:${ip}`], 30);
      failedTry([`passkey-ip:${ip}`], 60_000);
      const id = newToken();
      const rpId = rpIdFor(host);
      return { id, challenge: newChallenge(`login:${id}`, rpId), rpId, userVerification: 'preferred', timeout: 120_000 };
    },
    false,
  );
  route(
    'POST',
    '/api/login/passkey',
    ({ body, ip, ua }) => {
      checkTries([`passkey-ip:${ip}`], 30);
      const c = takeChallenge(`login:${String(body.id ?? '')}`);
      const cred = (body.credential ?? {}) as Json;
      const response = (cred.response ?? {}) as Json;
      const key = db.prepare('SELECT p.user_id, p.public_key, p.alg, p.sign_count FROM passkeys p JOIN users u ON u.id = p.user_id WHERE p.id = ? AND u.deleted_at IS NULL').get(String(cred.id ?? '')) as
        | { user_id: number; public_key: string; alg: number; sign_count: number }
        | undefined;
      if (!key) {
        failedTry([`passkey-ip:${ip}`]);
        throw new HttpError(401, "That passkey isn't on this server anymore. Log in with your password.");
      }
      let signCount;
      try {
        ({ signCount } = verifyAssertion(
          { clientDataJSON: String(response.clientDataJSON ?? ''), authenticatorData: String(response.authenticatorData ?? ''), signature: String(response.signature ?? '') },
          { jwk: JSON.parse(key.public_key), alg: key.alg, signCount: key.sign_count },
          c.challenge,
          c.rpId,
        ));
      } catch (err) {
        failedTry([`passkey-ip:${ip}`]);
        throw new HttpError(401, err instanceof Error ? err.message : "That passkey didn't check out");
      }
      db.prepare('UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE id = ?').run(signCount, now(), String(cred.id));
      // A passkey already proves two things (the device, and the face or PIN that unlocked it).
      return startSession(userById(key.user_id)!, { ip, ua });
    },
    false,
  );

  // A reset link made by whoever runs the server (server/src/reset-link.ts), for someone locked out.
  const resetLinkUser = (token: unknown) => {
    const u = db.prepare('SELECT id, username, reset_link_expires FROM users WHERE reset_link = ? AND deleted_at IS NULL').get(hashCode(String(token ?? ''))) as
      | { id: number; username: string; reset_link_expires: number }
      | undefined;
    if (!u || u.reset_link_expires < now()) throw new HttpError(400, 'That reset link has run out or was already used. Ask whoever runs this server for a new one.');
    return u;
  };
  route('GET', '/api/password/link', ({ url, ip }) => {
    checkTries([`reset-link-ip:${ip}`], 20);
    try { return { username: resetLinkUser(url.searchParams.get('token')).username }; }
    catch (err) { failedTry([`reset-link-ip:${ip}`]); throw err; }
  }, false);
  route('POST', '/api/password/link', ({ body, ip, ua }) => {
    checkTries([`reset-link-ip:${ip}`], 20);
    let u;
    try { u = resetLinkUser(body.token); }
    catch (err) { failedTry([`reset-link-ip:${ip}`]); throw err; }
    db.prepare('UPDATE users SET password_hash = ?, reset_link = NULL, reset_link_expires = NULL WHERE id = ?').run(hashPassword(newPassword(body)), u.id);
    signOutOthers(u.id, null, 'Password changed');
    clearTries(`login-user:${u.username.toLowerCase()}|${ip}`);
    clearTries(`login-user:${u.username.toLowerCase()}`);
    return loginOrAskCode(u.id, { ip, ua });
  }, false);

  // ---- leaving for good, and taking your things with you ------------------

  // Deleting your account: burrows you host with other people in them have to be handed over first.
  // Your messages stay (as "Deleted user") or go, as you choose.
  route('DELETE', '/api/me', ({ user, body }) => {
    confirmIdentity(user, body);
    const busy = busyHearths(user.id);
    if (busy.length)
      throw new HttpError(409, `Hand over or delete ${busy.map((s) => s.name).join(', ')} first: you're the host${busy.length > 1 ? ' of those burrows' : ''}.`);
    deleteAccount(user, body.deleteMessages === true);
    return { ok: true };
  });

  /** Burrows someone hosts that other people are in too. */
  const busyHearths = (userId: number) =>
    (db.prepare("SELECT id, name FROM servers WHERE owner_id = ? AND kind = 'burrow'").all(userId) as { id: number; name: string }[])
      // Bots can't be handed a hearth, so a hearth of only bots goes with its host.
      .filter((s) => serverMemberIds(s.id).some((id) => id !== userId && !isBotUser(id)));

  /**
   * Deletes an account: out of everything, their own things gone, their messages kept as
   * "Deleted user" or removed. Burrows they still host with other people in them go to whoever
   * has been there longest (only the admin page gets that far; people deleting themselves hand over first).
   */
  const deleteAccount = (user: User, deleteMessages: boolean) => {
    for (const s of busyHearths(user.id)) {
      const next = db
        .prepare('SELECT m.user_id AS id FROM members m JOIN users u ON u.id = m.user_id WHERE m.server_id = ? AND m.user_id != ? AND u.bot = 0 AND u.deleted_at IS NULL ORDER BY m.joined_at, m.user_id LIMIT 1')
        .get(s.id, user.id) as { id: number } | undefined;
      if (!next) continue;
      db.prepare('UPDATE servers SET owner_id = ? WHERE id = ?').run(next.id, s.id);
      accessChanged(s.id);
    }
    const hosted = db.prepare("SELECT id FROM servers WHERE owner_id = ? AND kind = 'burrow'").all(user.id) as { id: number }[];
    signOutOthers(user.id, null, 'Account deleted');
    for (const s of hosted) deleteBurrow(s.id);
    const places = db.prepare('SELECT m.server_id AS id, s.kind, s.dm_key FROM members m JOIN servers s ON s.id = m.server_id WHERE m.user_id = ?').all(user.id) as
      { id: number; kind: string; dm_key: string | null }[];
    if (deleteMessages) {
      const touched = db.prepare('SELECT DISTINCT channel_id AS id FROM messages WHERE author_id = ?').all(user.id) as { id: number }[];
      removeFiles(db.prepare('SELECT a.id FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.author_id = ?').all(user.id) as Json[]);
      db.prepare('DELETE FROM messages WHERE author_id = ?').run(user.id);
      for (const { id } of touched) {
        const channel = channelById(id);
        if (channel) broadcastToChannel(channel, { type: 'messages_purged', channelId: id, userId: user.id });
      }
    }
    // Out of every burrow and group. One-to-one conversations stay, so the other person keeps theirs.
    for (const p of places) {
      if (p.kind === 'burrow') removeMember(p.id, user.id);
      else if (!p.dm_key) leaveGroup(p.id, user);
    }
    const files = db.prepare('SELECT avatar, banner FROM users WHERE id = ?').get(user.id) as { avatar: string | null; banner: string | null };
    for (const f of [files.avatar, files.banner]) if (f && opts.uploadDir) unlink(avatarPath(f)).catch(() => {});
    for (const table of ['friends_a', 'friends_b', 'blocks', 'blocks_by', 'passkeys', 'push_subs', 'scheduled_messages', 'saved_messages', 'drafts', 'calendar_feeds']) {
      const [t, col] =
        table === 'friends_a' ? ['friends', 'user_a'] : table === 'friends_b' ? ['friends', 'user_b'] : table === 'blocks_by' ? ['blocks', 'blocked_id'] : [table, 'user_id'];
      try { db.prepare(`DELETE FROM ${t} WHERE ${col} = ?`).run(user.id); } catch { /* a table this server doesn't have */ }
    }
    db.prepare(
      `UPDATE users SET username = ?, display_name = 'Deleted user', password_hash = '!', avatar = NULL, banner = NULL, bio = '', accent = NULL, birthday = NULL, fire_item = NULL, look = NULL,
         email = NULL, email_verified = 0, email_code = NULL, reset_code = NULL, reset_link = NULL, totp_secret = NULL, totp_pending = NULL,
         recovery_codes = '[]', status_text = NULL, status_emoji = NULL, deleted_at = ? WHERE id = ?`,
    ).run(`deleted-${user.id}-${randomBytes(4).toString('hex')}`, now(), user.id);
    holdName(user.username, -1);
    for (const p of places) if (p.kind === 'dm' && p.dm_key) sendServerUpdate(p.id);
    userChanged(user.id);
  };

  // Export my data: a zip of your account, your messages (as JSON) and the files you sent.
  const handleExport = async (req: IncomingMessage, res: ServerResponse) => {
    const user = userByToken(bearer(req));
    if (!user) throw new HttpError(401, "You're logged out. Log in again.");
    checkTries([`export:${user.id}`], 5);
    failedTry([`export:${user.id}`], 60 * 60 * 1000);
    const me = meJson(user);
    const burrows = db.prepare("SELECT s.id, s.name, m.joined_at AS joinedAt, m.nickname FROM members m JOIN servers s ON s.id = m.server_id WHERE m.user_id = ? AND s.kind = 'burrow'").all(user.id);
    const messages = (
      db
        .prepare(
          `SELECT m.id, m.channel_id AS channelId, m.content, m.created_at AS createdAt, m.edited_at AS editedAt, m.reply_to AS replyTo, c.name AS room, s.name AS burrow, s.kind
           FROM messages m JOIN channels c ON c.id = m.channel_id JOIN servers s ON s.id = c.server_id WHERE m.author_id = ? ORDER BY m.id`,
        )
        .all(user.id) as Json[]
    ).map(({ kind, burrow, room, ...m }) => ({ ...m, id: m.id as number, place: kind === 'dm' ? placeOf(m.channelId as number, user.id)?.serverName ?? 'Direct message' : `${burrow} › #${room}` }));
    const files = db
      .prepare('SELECT a.id, a.name, a.type, a.size, a.message_id AS messageId FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.author_id = ? ORDER BY a.message_id, a.position')
      .all(user.id) as { id: string; name: string; type: string; size: number; messageId: number }[];
    const safe = (name: string) => name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(-120);
    const fileName = (f: { id: string; name: string }) => `files/${f.id.slice(0, 8)}-${safe(f.name)}`;
    const byMessage = new Map<number, string[]>();
    for (const f of files) byMessage.set(f.messageId, [...(byMessage.get(f.messageId) ?? []), fileName(f)]);
    const zip = new ZipWriter();
    res.writeHead(200, {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="burrow-${safe(user.username)}.zip"`,
      'cache-control': 'no-store',
    });
    const write = async (chunks: Buffer[]) => {
      for (const c of chunks) {
        // A cancelled download never drains, so closing ends the wait (and the export) too.
        if (res.destroyed) throw new Error('Download cancelled');
        if (!res.write(c)) await new Promise((r) => { res.once('drain', r); res.once('close', r); });
      }
    };
    try {
      const json = (v: unknown) => Buffer.from(JSON.stringify(v, null, 2));
      const { id: _, blockedIds: __, ...account } = me;
      await write(zip.add('account.json', json({ ...account, burrows, friends: friendsOf(user.id).friends.map((f) => f.username), exportedAt: new Date().toISOString() })));
      await write(zip.add('messages.json', json(messages.map((m) => ({ ...m, files: byMessage.get(m.id as number) ?? [] })))));
      const pictures = db.prepare('SELECT avatar, banner FROM users WHERE id = ?').get(user.id) as { avatar: string | null; banner: string | null };
      let total = 0;
      const LIMIT = 3.5 * 1024 ** 3; // a plain zip can't go past 4 GB
      const skipped: string[] = [];
      const addFile = async (path: string, name: string) => {
        const data = await readFile(path).catch(() => null);
        if (!data) return;
        // Nor past 65,535 entries (a few kept back for the notes and lists).
        if (total + data.length > LIMIT || zip.count >= 65_000) return void skipped.push(name);
        total += data.length;
        await write(zip.add(name, data));
      };
      if (opts.uploadDir) {
        if (pictures.avatar) await addFile(avatarPath(pictures.avatar), `profile/picture${extname(pictures.avatar)}`);
        if (pictures.banner) await addFile(avatarPath(pictures.banner), `profile/banner${extname(pictures.banner)}`);
        for (const f of files) await addFile(filePath(f.id), fileName(f));
      }
      if (skipped.length) await write(zip.add('files-left-out.txt', Buffer.from(`These files didn't fit in one zip:\n${skipped.join('\n')}\n`)));
      res.end(zip.finish());
    } catch (err) {
      // Too late for an error message once the download has started, so cut it off.
      console.error('Export failed:', err);
      res.destroy();
    }
  };

  return { confirmIdentity, deleteAccount, handleExport, loginOrAskCode, signOutOthers };
}
