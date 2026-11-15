// Link previews: the card under a message with a link, fetched by the server (see embeds.ts).
import { createHmac, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppOptions, Channel, Handler, User } from './app.ts';
import type { Db } from './db.ts';
import { type Embed, fetchEmbed, fetchImage, linksIn } from './embeds.ts';
import { HttpError, type Json, sameText } from './http.ts';

export interface LinkPreviewsContext {
  db: Db;
  messageChanged: (id: number, channel: Channel) => Json | undefined;
  now: () => number;
  opts: AppOptions;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => number;
  visibleMessage: (user: User, id: number) => { channel: Channel; authorId: number; };
}

export function linkPreviews(ctx: LinkPreviewsContext) {
  const {
    db, messageChanged, now, opts, route, visibleMessage,
  } = ctx;

  // ---- link previews ----

  const previewOpts = opts.linkPreviews === false ? null : opts.linkPreviews ?? {};
  const secret = (name: string) => {
    const row = db.prepare('SELECT value FROM app_secrets WHERE name = ?').get(name) as { value: string } | undefined;
    if (row) return row.value;
    const value = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO app_secrets (name, value) VALUES (?, ?)').run(name, value);
    return value;
  };
  // Preview pictures load in <img> tags, which can't log in, so their links are signed instead.
  const embedKey = secret('embed-images');
  const embedSig = (messageId: number, position: number) =>
    createHmac('sha256', embedKey).update(`${messageId}:${position}`).digest('base64url').slice(0, 22);
  const embedsFor = (messageId: number) =>
    (db.prepare('SELECT position, data FROM message_embeds WHERE message_id = ? ORDER BY position').all(messageId) as { position: number; data: string }[]).map((r) => {
      const e = JSON.parse(r.data) as Embed;
      return { ...e, image: e.image ? `/api/embeds/${messageId}/${r.position}/${embedSig(messageId, r.position)}` : null };
    });

  // The same link is often posted more than once; previews are remembered for an hour.
  const previewCache = new Map<string, { at: number; embed: Embed | null }>();
  const cachedPreview = async (link: string) => {
    const hit = previewCache.get(link);
    if (hit && now() - hit.at < 3600_000) return hit.embed;
    const embed = await fetchEmbed(link, previewOpts!).catch(() => null);
    previewCache.set(link, { at: now(), embed });
    if (previewCache.size > 500) previewCache.delete(previewCache.keys().next().value!);
    return embed;
  };

  /** Fetches previews for a message's links in the background, then shows them to everyone. */
  const previewLinks = (messageId: number, channel: Channel, content: string) => {
    const links = previewOpts ? linksIn(content) : [];
    if (!links.length) return;
    Promise.all(links.map(cachedPreview)).then((embeds) => {
      // The message may have been deleted or edited to other links in the meantime.
      const current = db.prepare('SELECT content, embeds_off FROM messages WHERE id = ?').get(messageId) as { content: string; embeds_off: number } | undefined;
      if (!current || current.embeds_off || linksIn(current.content).join() !== links.join()) return;
      const found = embeds.filter((e): e is Embed => !!e);
      if (!found.length) return;
      db.prepare('DELETE FROM message_embeds WHERE message_id = ?').run(messageId);
      found.forEach((e, i) => db.prepare('INSERT INTO message_embeds (message_id, position, data) VALUES (?, ?, ?)').run(messageId, i, JSON.stringify(e)));
      messageChanged(messageId, channel);
    }).catch((err) => console.warn(`Link preview failed: ${err.message}`));
  };

  // Whoever wrote a message can hide its previews.
  route('POST', '/api/messages/:id/embeds', ({ user, params }) => {
    const id = Number(params[0]);
    const { channel, authorId } = visibleMessage(user, id);
    if (authorId !== user.id) throw new HttpError(403, 'You can only change your own messages');
    db.prepare('UPDATE messages SET embeds_off = 1 WHERE id = ?').run(id);
    db.prepare('DELETE FROM message_embeds WHERE message_id = ?').run(id);
    return messageChanged(id, channel);
  });

  const imageCache = new Map<string, { type: string; data: Buffer }>();
  let imageCacheBytes = 0;
  const serveEmbedImage = async (req: IncomingMessage, res: ServerResponse, messageId: number, position: number, sig: string) => {
    if (!sameText(sig, embedSig(messageId, position))) throw new HttpError(404, 'That picture is gone');
    const row = db.prepare('SELECT data FROM message_embeds WHERE message_id = ? AND position = ?').get(messageId, position) as { data: string } | undefined;
    const link = row && (JSON.parse(row.data) as Embed).image;
    if (!link || !previewOpts) throw new HttpError(404, 'That picture is gone');
    let image = imageCache.get(link);
    if (!image) {
      try {
        image = await fetchImage(link, previewOpts);
      } catch {
        throw new HttpError(502, "Couldn't load that picture");
      }
      imageCache.set(link, image);
      imageCacheBytes += image.data.length;
      for (const [k, v] of imageCache) {
        if (imageCacheBytes <= 40 * 1024 * 1024) break;
        imageCache.delete(k);
        imageCacheBytes -= v.data.length;
      }
    }
    res.writeHead(200, {
      'content-type': image.type,
      'content-length': image.data.length,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, max-age=86400',
    });
    res.end(req.method === 'HEAD' ? undefined : image.data);
  };

  return { embedsFor, previewLinks, previewOpts, serveEmbedImage };
}
