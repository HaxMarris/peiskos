// Email: confirming your address, so you can reset a forgotten password, and the reset itself.
import { createHash } from 'node:crypto';
import type { AppOptions, Handler, User } from './app.ts';
import { hashPassword } from './auth.ts';
import { avatarUrl } from './common.ts';
import type { Db } from './db.ts';
import { HttpError, type Json, sameText } from './http.ts';
import { codeEmail, type CodeEmail } from './mail-template.ts';
import { looksLikeEmail, sendMail } from './mail.ts';

export interface EmailContext {
  checkTries: (keys: string[], limit: number) => void;
  clearTries: (key: string) => boolean;
  confirmIdentity: (user: User, body: Json, { needCode }?: { needCode?: boolean | undefined; }) => void;
  db: Db;
  failedTry: (keys: string[], windowMs?: number) => void;
  knownAddress: (userId: number | undefined, ip: string) => boolean;
  loginOrAskCode: (userId: number, from: { ip: string; ua: string; }) => unknown;
  meJson: (user: User) => unknown;
  newPassword: (body: Json) => string;
  now: () => number;
  opts: AppOptions;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => number;
  signOutOthers: (userId: number, keepToken: string | null, reason: string) => void;
  sixDigitCode: () => string;
}

export function emailAddress(ctx: EmailContext) {
  const {
    checkTries, clearTries, confirmIdentity, db, failedTry, knownAddress, loginOrAskCode, meJson,
    newPassword, now, opts, route, signOutOthers, sixDigitCode,
  } = ctx;

  // ---- email: confirming your address, so you can reset a forgotten password ----

  const mailTo = async (to: string, subject: string, content: Omit<CodeEmail, 'publicUrl' | 'contact'>) => {
    if (!opts.mail) throw new HttpError(400, "Email isn't set up on this server");
    // Replies go to whoever runs the server, not to the address codes are sent from.
    const contact = opts.legal?.contact;
    const { text, html } = codeEmail({ ...content, publicUrl: opts.publicUrl, contact });
    // LEGAL_CONTACT may be a web page rather than an address; then replies go to the sender as before.
    // (No line breaks either, so it can't add mail headers of its own.)
    const replyTo = contact && looksLikeEmail(contact) ? contact : undefined;
    await sendMail(opts.mail, { to, subject, text, html, replyTo });
  };

  /** Tells the address that used to reset this account that it doesn't any more, in case that wasn't them. */
  const emailRemovedNotice = (user: User, to: string) =>
    void mailTo(to, 'Your Peiskos email was changed', {
      username: user.username,
      intro: 'This address no longer resets the password of your Peiskos account.',
      note: "If you didn't do this, someone may have your password: ask whoever runs this server for a reset link.",
    }).catch((err) => console.error('Sending an email-changed notice failed:', err));

  route('POST', '/api/me/email', async ({ user, body }) => {
    if (!opts.mail) throw new HttpError(400, "Email isn't set up on this server");
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (!looksLikeEmail(email)) throw new HttpError(400, "That doesn't look like an email address");
    // Whoever has the email can reset the password, so changing it takes the password (and code) too:
    // a login someone got hold of for a while can't be turned into the account for good.
    confirmIdentity(user, body);
    checkTries([`email:${user.id}`], 5);
    failedTry([`email:${user.id}`], 60 * 60 * 1000); // every code sent counts, so nobody's inbox is flooded
    const code = sixDigitCode();
    const before = db.prepare('SELECT email, email_verified FROM users WHERE id = ?').get(user.id) as { email: string | null; email_verified: number };
    db.prepare('UPDATE users SET email = ?, email_verified = 0, email_code = ?, email_code_expires = ? WHERE id = ?').run(email, code, now() + 30 * 60 * 1000, user.id);
    try {
      await mailTo(email, `Your Peiskos code: ${code}`, {
        username: user.username,
        intro: 'Here is your code to confirm this email address on Peiskos.',
        code,
        minutes: 30,
        note: "If you didn't ask for this, you can ignore this email.",
      });
    } catch (err) {
      console.error('Sending email failed:', err);
      throw new HttpError(502, "Peiskos couldn't send the email. Check the address, or ask whoever runs this server.");
    }
    if (before.email && before.email_verified && before.email.toLowerCase() !== email.toLowerCase()) emailRemovedNotice(user, before.email);
    return meJson(user);
  });
  route('POST', '/api/me/email/verify', ({ user, body }) => {
    const r = db.prepare('SELECT email_code, email_code_expires FROM users WHERE id = ?').get(user.id) as { email_code: string | null; email_code_expires: number | null };
    checkTries([`email-code:${user.id}`], 5);
    if (!r.email_code || !r.email_code_expires || r.email_code_expires < now()) throw new HttpError(400, 'That code has run out. Send a new one.');
    if (!sameText(String(body.code ?? '').trim(), r.email_code)) {
      failedTry([`email-code:${user.id}`], 30 * 60 * 1000);
      throw new HttpError(400, "That code isn't right");
    }
    db.prepare('UPDATE users SET email_verified = 1, email_code = NULL, email_code_expires = NULL WHERE id = ?').run(user.id);
    return meJson(user);
  });
  route('DELETE', '/api/me/email', ({ user, body }) => {
    confirmIdentity(user, body);
    const before = db.prepare('SELECT email, email_verified FROM users WHERE id = ?').get(user.id) as { email: string | null; email_verified: number };
    if (before.email && before.email_verified) emailRemovedNotice(user, before.email);
    db.prepare('UPDATE users SET email = NULL, email_verified = 0, email_code = NULL, email_code_expires = NULL, reset_code = NULL WHERE id = ?').run(user.id);
    return meJson(user);
  });

  // Forgot your password: a code goes to your confirmed email, and the code sets a new one.
  const RESET_MINUTES = 30;
  const hashCode = (code: string) => createHash('sha256').update(code).digest('hex');
  route(
    'POST',
    '/api/password/forgot',
    ({ body, ip }) => {
      if (!opts.mail) throw new HttpError(400, "Email isn't set up on this server, so ask whoever runs it to reset your password.");
      const name = String(body.username ?? '').trim();
      checkTries([`forgot-ip:${ip}`], 10);
      const u = db.prepare('SELECT id, username, email, email_verified FROM users WHERE username = ?').get(name) as
        | { id: number; username: string; email: string | null; email_verified: number }
        | undefined;
      // Every code sent counts, so nobody's inbox is flooded: 3 an hour from one address, and 10 an
      // hour from all the others together. Where they've logged in before only the first applies,
      // so strangers asking for their codes can't use up their own asks.
      const here = `reset-user:${name.toLowerCase()}|${ip}`;
      const anywhere = knownAddress(u?.id, ip) ? null : `reset-user:${name.toLowerCase()}`;
      checkTries([here], 3);
      if (anywhere) checkTries([anywhere], 10);
      failedTry([`forgot-ip:${ip}`, here], 60 * 60 * 1000);
      if (anywhere) failedTry([anywhere], 60 * 60 * 1000);
      // The same answer either way, so this can't be used to find out who has an email on file.
      const answer = { ok: true, minutes: RESET_MINUTES };
      if (!u?.email || !u.email_verified) return answer;
      const code = sixDigitCode();
      db.prepare('UPDATE users SET reset_code = ?, reset_expires = ?, reset_tries = 0 WHERE id = ?').run(hashCode(code), now() + RESET_MINUTES * 60 * 1000, u.id);
      // Not waited for, so how long the answer takes doesn't give away who has an email on file either.
      void mailTo(u.email, `Your Peiskos password code: ${code}`, {
        username: u.username,
        intro: 'Someone (hopefully you) asked to reset your Peiskos password. Here is your code.',
        code,
        minutes: RESET_MINUTES,
        note: "If it wasn't you, ignore this email: your password stays the same.",
      }).catch((err) =>
        console.error('Sending a password reset email failed:', err),
      );
      return answer;
    },
    false,
  );
  route(
    'POST',
    '/api/password/reset',
    ({ body, ip, ua }) => {
      const name = String(body.username ?? '').trim();
      checkTries([`reset-ip:${ip}`], 10);
      const u = db.prepare(`SELECT id, username, ${avatarUrl('avatar')} AS avatar, reset_code, reset_expires, reset_tries FROM users WHERE username = ?`).get(name) as
        | (User & { reset_code: string | null; reset_expires: number | null; reset_tries: number })
        | undefined;
      if (!u?.reset_code || !u.reset_expires || u.reset_expires < now()) throw new HttpError(400, 'That code has run out. Ask for a new one.');
      // Wrong guesses from addresses they've never logged in from count up for the account across
      // every code, so asking for new codes from many addresses doesn't buy more guesses. Where they
      // have logged in before it doesn't apply, so strangers can't use it to stop their reset.
      const guesses = knownAddress(u.id, ip) ? null : `reset-guess:${u.id}`;
      if (guesses) checkTries([guesses], 15);
      if (!sameText(hashCode(String(body.code ?? '').trim()), u.reset_code)) {
        failedTry([`reset-ip:${ip}`]);
        if (guesses) failedTry([guesses], 24 * 60 * 60 * 1000);
        // Five wrong guesses and the code is gone, so it can't be guessed.
        if (u.reset_tries + 1 >= 5) db.prepare('UPDATE users SET reset_code = NULL WHERE id = ?').run(u.id);
        else db.prepare('UPDATE users SET reset_tries = reset_tries + 1 WHERE id = ?').run(u.id);
        throw new HttpError(400, u.reset_tries + 1 >= 5 ? 'Too many wrong codes. Ask for a new one.' : "That code isn't right");
      }
      db.prepare('UPDATE users SET password_hash = ?, reset_code = NULL, reset_expires = NULL, reset_tries = 0 WHERE id = ?').run(hashPassword(newPassword(body)), u.id);
      // Signed out everywhere, as when you change it yourself.
      signOutOthers(u.id, null, 'Password changed');
      clearTries(`login-user:${name.toLowerCase()}|${ip}`);
      clearTries(`login-user:${name.toLowerCase()}`);
      // With two-step login on, the new password still needs the code from their phone.
      return loginOrAskCode(u.id, { ip, ua });
    },
    false,
  );

  return { hashCode };
}
