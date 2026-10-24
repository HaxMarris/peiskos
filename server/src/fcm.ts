// Alerts for the Android app, sent through Google's Firebase Cloud Messaging (FCM).
//
// The app gives the server its Firebase token. A push is a small JSON message posted to Google,
// authorised with a short-lived access token that the server gets by signing a request with the
// Firebase project's service account key (Project settings › Service accounts › Generate new
// private key). FCM_SERVICE_ACCOUNT holds that .json file, either as it is or base64'd onto one line.
import { createPrivateKey, sign, type KeyObject } from 'node:crypto';

export type FcmConfig = { serviceAccount: string; tokenUrl?: string; apiUrl?: string };
export type FcmMessage = { title: string; body: string; tag?: string; badge?: number; silent?: boolean; data?: Record<string, unknown> };
type Account = { projectId: string; email: string; key: KeyObject; tokenUrl: string };

const b64u = (buf: Buffer) => buf.toString('base64url');

/** The project and signing key from FCM_SERVICE_ACCOUNT, or null when it isn't a service account file. */
export function fcmAccount(text: string): Account | null {
  const raw = text.trim();
  try {
    const json = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
    if (!json.project_id || !json.client_email || !json.private_key) return null;
    return {
      projectId: String(json.project_id),
      email: String(json.client_email),
      key: createPrivateKey(String(json.private_key)),
      tokenUrl: String(json.token_uri || 'https://oauth2.googleapis.com/token'),
    };
  } catch {
    return null;
  }
}

export function createFcm(config: FcmConfig) {
  const account = fcmAccount(config.serviceAccount);
  const tokenUrl = config.tokenUrl ?? account?.tokenUrl ?? '';
  const apiUrl = config.apiUrl ?? 'https://fcm.googleapis.com';
  let access = { value: '', until: 0 };
  let pending: Promise<string> | null = null;

  // Google's access tokens last an hour; get a new one a few minutes before it runs out.
  const accessToken = () => {
    if (access.value && Date.now() < access.until) return Promise.resolve(access.value);
    pending ??= (async () => {
      const now = Math.floor(Date.now() / 1000);
      const head = b64u(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
      const claims = b64u(
        Buffer.from(JSON.stringify({ iss: account!.email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: tokenUrl, iat: now, exp: now + 3600 })),
      );
      const signature = sign('sha256', Buffer.from(`${head}.${claims}`), account!.key);
      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${b64u(signature)}` }),
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
      if (!res.ok || !json.access_token) throw new Error(`Google didn't give an access token (${res.status} ${json.error ?? ''})`);
      access = { value: json.access_token, until: Date.now() + Math.max(60, (json.expires_in ?? 3600) - 300) * 1000 };
      return access.value;
    })().finally(() => (pending = null));
    return pending;
  };

  /** Sends one alert. Resolves to 'sent', 'gone' (the app was removed: forget the token) or 'failed'. */
  const send = async (deviceToken: string, message: FcmMessage): Promise<'sent' | 'gone' | 'failed'> => {
    if (!account) return 'failed';
    try {
      // Firebase only carries text in data.
      const data = Object.fromEntries(Object.entries(message.data ?? {}).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
      const res = await fetch(`${apiUrl}/v1/projects/${encodeURIComponent(account.projectId)}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: deviceToken,
            notification: { title: message.title, body: message.body },
            data,
            android: {
              priority: 'high',
              ttl: '86400s',
              notification: {
                // The two channels the app makes: quiet hours go to the one without sound.
                channel_id: message.silent ? 'quiet' : 'messages',
                icon: 'ic_stat_peiskos',
                color: '#c4561c',
                ...(message.tag ? { tag: message.tag } : {}),
                ...(message.badge != null ? { notification_count: message.badge } : {}),
              },
            },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return 'sent';
      const reply = (await res.json().catch(() => ({}))) as { error?: { status?: string; message?: string; details?: { errorCode?: string }[] } };
      const code = reply.error?.details?.find((d) => d.errorCode)?.errorCode ?? reply.error?.status ?? '';
      if (code === 'UNREGISTERED' || (res.status === 400 && /registration token/i.test(reply.error?.message ?? ''))) return 'gone';
      if (res.status === 401) access = { value: '', until: 0 };
      console.warn(`Firebase didn't take an alert (${res.status} ${code})`);
      return 'failed';
    } catch (err) {
      console.warn(`Firebase alert failed: ${(err as Error).message}`);
      return 'failed';
    }
  };

  return { ready: !!account, send };
}
