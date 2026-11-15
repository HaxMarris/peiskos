// What most server tests share: the app listening on a free port, and a JSON call to it.
import { before, after } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export type Reply = { status: number; data: any };
export type CallOptions = { method?: string; body?: unknown; token?: string };

/** A JSON request to the app: POST when there's a body, GET otherwise, signed in with `token`. */
export function caller(base: () => string) {
  return async function call(path: string, opts: CallOptions = {}): Promise<Reply> {
    const res = await fetch(base() + path, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return { status: res.status, data: (await res.json()) as any };
  };
}

/** Starts the app before the file's tests and stops it after them; `onBase` gets its address. */
export function listening(app: Server, onBase: (base: string) => void) {
  before(async () => {
    await new Promise<void>((r) => app.listen(0, r));
    onBase(`http://localhost:${(app.address() as AddressInfo).port}`);
  });
  after(() => {
    app.closeAllConnections();
    app.close();
  });
}
