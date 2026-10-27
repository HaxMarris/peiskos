import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { brotliCompress, gzip, constants } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.svg', '.wasm']);

interface Entry {
  mtime: number;
  size: number;
  etag: string;
  raw: Buffer;
  br?: Buffer;
  gzip?: Buffer;
}

/** The encodings the browser accepts, leaving out any it marks q=0. */
function accepted(header: string | string[] | undefined) {
  const out = new Set<string>();
  for (const part of String(header ?? '').split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    if (!params.some((p) => /^\s*q=0(\.0*)?\s*$/.test(p))) out.add(name.trim());
  }
  return out;
}

/** A short name for a file's contents, for the ?v= on its address. */
const versionOf = (entry: Entry) => entry.etag.slice(3, 13);

async function compress(raw: Buffer) {
  return Promise.all([
    // Big files (the camera background's WebAssembly) at a quicker setting, so the first download doesn't wait long.
    brotli(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: raw.length > 2_000_000 ? 9 : 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }),
    gzipAsync(raw, { level: 9 }),
  ]);
}

/**
 * Serves the web app's files from memory: each is read and compressed once (and again when it
 * changes on disk), and browsers that already have it get a 304 instead of the whole file.
 *
 * The page itself (index.html) names its scripts and stylesheets with a ?v= of their contents.
 * An address with the current ?v= can't change, so browsers keep it for good and opening Peiskos
 * again asks the server only for the page; an update gives the files new addresses.
 */
export function staticFiles() {
  const cache = new Map<string, Promise<Entry>>();
  const pages = new Map<string, Promise<Entry>>(); // index.html with versions, by the versions it names

  const load = async (file: string): Promise<Entry | null> => {
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return null;
    const hit = cache.get(file);
    if (hit) {
      const entry = await hit.catch(() => null);
      if (entry && entry.mtime === info.mtimeMs && entry.size === info.size) return entry;
    }
    const next = (async () => {
      const raw = await readFile(file);
      const entry: Entry = {
        mtime: info.mtimeMs,
        size: info.size,
        etag: `W/"${createHash('sha1').update(raw).digest('base64url')}"`,
        raw,
      };
      const ext = file.slice(file.lastIndexOf('.'));
      if (COMPRESSIBLE.has(ext) && raw.length > 1024) [entry.br, entry.gzip] = await compress(raw);
      return entry;
    })();
    cache.set(file, next);
    next.catch(() => cache.delete(file));
    return next;
  };

  /** index.html with ?v= on each local script and stylesheet it loads. */
  const versionedPage = async (file: string, page: Entry) => {
    const dir = file.slice(0, file.lastIndexOf('/') + 1);
    const html = page.raw.toString('utf8');
    const refs = [...new Set([...html.matchAll(/(?:src|href)="((?:js\/|vendor\/)?[\w.-]+\.(?:js|css))"/g)].map((m) => m[1]))];
    const versions = new Map<string, string>();
    for (const ref of refs) {
      const entry = await load(dir + ref);
      if (entry) versions.set(ref, versionOf(entry));
    }
    const key = page.etag + [...versions.values()].join('');
    let built = pages.get(key);
    if (!built) {
      built = (async () => {
        const raw = Buffer.from(html.replace(/((?:src|href)=")((?:js\/|vendor\/)?[\w.-]+\.(?:js|css))"/g, (all, attr, ref) =>
          versions.has(ref) ? `${attr}${ref}?v=${versions.get(ref)}"` : all));
        const [br, gz] = await compress(raw);
        return { mtime: page.mtime, size: page.size, etag: `W/"${createHash('sha1').update(raw).digest('base64url')}"`, raw, br, gzip: gz };
      })();
      pages.clear(); // only the newest is ever asked for
      pages.set(key, built);
    }
    return built;
  };

  /**
   * Sends `file`, or returns false when there is no such file. `version` is the ?v= the address
   * asked for: when it's the file's current one, browsers may keep it for good.
   */
  return async (req: IncomingMessage, res: ServerResponse, file: string, type: string, version?: string | null) => {
    let entry = await load(file);
    if (!entry) return false;
    if (file.endsWith('/index.html')) entry = await versionedPage(file, entry);
    const lasting = !!version && version === versionOf(entry);
    const headers: Record<string, string | number> = {
      'content-type': type,
      // Otherwise always check, but a 304 costs almost nothing.
      'cache-control': lasting ? 'public, max-age=31536000, immutable' : 'no-cache',
      etag: entry.etag,
      vary: 'accept-encoding',
    };
    if (req.headers['if-none-match'] === entry.etag) {
      res.writeHead(304, headers).end();
      return true;
    }
    const wants = accepted(req.headers['accept-encoding']);
    let body = entry.raw;
    if (entry.br && wants.has('br')) [body, headers['content-encoding']] = [entry.br, 'br'];
    else if (entry.gzip && wants.has('gzip')) [body, headers['content-encoding']] = [entry.gzip, 'gzip'];
    headers['content-length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  };
}
