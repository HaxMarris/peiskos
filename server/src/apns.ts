// Alerts for the iPhone app, sent through Apple (APNs).
//
// The app gives the server its device token. A push is a small JSON message posted over HTTP/2 to
// Apple, signed with a key from the Apple Developer account (Keys › "Apple Push Notifications
// service"). The key is a .p8 file; APNS_KEY holds its contents, either as they are (with \n for
// line breaks) or base64'd onto one line.
import { connect, type ClientHttp2Session } from 'node:http2';
import { createPrivateKey, sign, type KeyObject } from 'node:crypto';

export type ApnsConfig = { key: string; keyId: string; teamId: string; topic: string; host?: string };
export type ApnsMessage = { title: string; body: string; thread?: string; badge?: number; silent?: boolean; data?: Record<string, unknown> };

const b64u = (buf: Buffer) => buf.toString('base64url');

/** The signing key from APNS_KEY, or null when it isn't a key. */
export function apnsKey(text: string): KeyObject | null {
  const pem = text.includes('-----BEGIN') ? text.replace(/\\n/g, '\n') : Buffer.from(text, 'base64').toString('utf8');
  try {
    return createPrivateKey(pem);
  } catch {
    return null;
  }
}

export function createApns(config: ApnsConfig) {
  const key = apnsKey(config.key);
  const host = config.host ?? 'https://api.push.apple.com';
  let token = { value: '', at: 0 };
  let session: ClientHttp2Session | null = null;

  // Apple wants a fresh token at least hourly, but not more than every 20 minutes.
  const authToken = () => {
    const now = Math.floor(Date.now() / 1000);
    if (token.value && now - token.at < 40 * 60) return token.value;
    const head = b64u(Buffer.from(JSON.stringify({ alg: 'ES256', kid: config.keyId })));
    const claims = b64u(Buffer.from(JSON.stringify({ iss: config.teamId, iat: now })));
    const signature = sign('sha256', Buffer.from(`${head}.${claims}`), { key: key!, dsaEncoding: 'ieee-p1363' });
    token = { value: `${head}.${claims}.${b64u(signature)}`, at: now };
    return token.value;
  };

  const connection = () => {
    if (session && !session.closed && !session.destroyed) return session;
    session = connect(host);
    session.on('error', () => session?.destroy());
    session.on('goaway', () => session?.close());
    // Don't keep the process alive just for this.
    session.unref();
    return session;
  };

  /** Sends one alert. Resolves to 'sent', 'gone' (the app was removed: forget the token) or 'failed'. */
  const send = (deviceToken: string, message: ApnsMessage): Promise<'sent' | 'gone' | 'failed'> =>
    new Promise((resolve) => {
      if (!key) return resolve('failed');
      const body = JSON.stringify({
        aps: {
          alert: { title: message.title, body: message.body },
          ...(message.badge != null ? { badge: message.badge } : {}),
          ...(message.silent ? {} : { sound: 'default' }),
          ...(message.thread ? { 'thread-id': message.thread } : {}),
        },
        ...message.data,
      });
      let req;
      try {
        req = connection().request({
          ':method': 'POST',
          ':path': `/3/device/${deviceToken}`,
          authorization: `bearer ${authToken()}`,
          'apns-topic': config.topic,
          'apns-push-type': 'alert',
          'apns-priority': message.silent ? '5' : '10',
          'apns-expiration': String(Math.floor(Date.now() / 1000) + 24 * 3600),
          'content-type': 'application/json',
        });
      } catch {
        return resolve('failed');
      }
      let status = 0;
      let reply = '';
      req.setTimeout(10_000, () => req.close());
      req.on('response', (headers) => (status = Number(headers[':status'])));
      req.on('data', (chunk) => (reply += chunk));
      req.on('error', () => resolve('failed'));
      req.on('close', () => {
        if (status === 200) return resolve('sent');
        const reason = (() => { try { return JSON.parse(reply).reason as string; } catch { return ''; } })();
        if (status === 410 || reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic') return resolve('gone');
        if (status === 403 && reason === 'ExpiredProviderToken') token = { value: '', at: 0 };
        if (status && status !== 200) console.warn(`Apple didn't take an alert (${status} ${reason})`);
        resolve('failed');
      });
      req.end(body);
    });

  return { ready: !!key, send };
}
