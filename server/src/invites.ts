// Invites: each hearth's permanent code, plus links that run out or can only be used so often.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppOptions, Handler, Perm, Standing, User } from './app.ts';
import { newInviteCode } from './auth.ts';
import type { Db } from './db.ts';
import { clientIp, HttpError } from './http.ts';

export interface InvitesContext {
  allowed: (serverId: number, user: User, perm: Perm) => Standing;
  audit: (serverId: number, actorId: number | null, action: string, targetId: number | null, detail?: string) => void;
  can: (serverId: number, userId: number, perm: Perm) => boolean;
  checkTries: (keys: string[], limit: number) => void;
  db: Db;
  escHtml: (t: string) => string;
  failedTry: (keys: string[], windowMs?: number) => void;
  isGroupDm: (serverId: number) => boolean;
  isMember: (serverId: number, userId: number) => boolean;
  now: () => number;
  online: Set<number>;
  opts: AppOptions;
  route: (method: string, path: string, handler: Handler, auth?: boolean) => number;
  sendServerUpdate: (serverId: number) => void;
  serverKind: (serverId: number) => string | undefined;
  serverMemberIds: (serverId: number) => number[];
  serverSummary: (serverId: number, viewerId: number) => unknown;
  standing: (serverId: number, userId: number) => Standing | null;
}

export function invites(ctx: InvitesContext) {
  const {
    allowed, audit, can, checkTries, db, escHtml, failedTry, isGroupDm, isMember, now, online, opts, route,
    sendServerUpdate, serverKind, serverMemberIds, serverSummary, standing,
  } = ctx;

  // ---- invites: each burrow's permanent code, plus links that run out ----

  /** The burrow an invite code or link opens, or why it doesn't. */
  const inviteTarget = (raw: unknown) => {
    const code = String(raw ?? '').trim().split('/').pop() ?? '';
    const permanent = db.prepare("SELECT id FROM servers WHERE invite_code = ? AND kind = 'burrow'").get(code) as { id: number } | undefined;
    if (permanent) return { serverId: permanent.id, invite: null };
    const inv = db.prepare('SELECT code, server_id, expires_at, max_uses, uses, created_by FROM invites WHERE code = ?').get(code) as
      | { code: string; server_id: number; expires_at: number | null; max_uses: number | null; uses: number; created_by: number | null }
      | undefined;
    if (!inv) throw new HttpError(404, "That invite doesn't work. Ask for a new one.");
    if (inv.expires_at !== null && inv.expires_at <= now()) throw new HttpError(410, 'This invite has run out. Ask for a new one.');
    if (inv.max_uses !== null && inv.uses >= inv.max_uses) throw new HttpError(410, 'This invite has been used up. Ask for a new one.');
    return { serverId: inv.server_id, invite: inv.code, createdBy: inv.created_by };
  };

  const invitesOf = (serverId: number, user: User) => {
    const all = can(serverId, user.id, 'invites');
    return db
      .prepare(
        `SELECT i.code, i.created_at AS createdAt, i.expires_at AS expiresAt, i.max_uses AS maxUses, i.uses, u.username AS createdBy
         FROM invites i LEFT JOIN users u ON u.id = i.created_by
         WHERE i.server_id = ? AND (? OR i.created_by = ?)
           AND (i.expires_at IS NULL OR i.expires_at > ?) AND (i.max_uses IS NULL OR i.uses < i.max_uses)
         ORDER BY i.created_at DESC`,
      )
      .all(serverId, all ? 1 : 0, user.id, now());
  };

  // Anyone in a burrow can make an invite; people who can edit the burrow see and cancel everyone's.
  route('GET', '/api/servers/:id/invites', ({ user, params }) => {
    const serverId = Number(params[0]);
    if (!standing(serverId, user.id) || isGroupDm(serverId)) throw new HttpError(404, "That hearth is gone, or you're not in it.");
    return invitesOf(serverId, user);
  });

  route('POST', '/api/servers/:id/invites', ({ user, params, body }) => {
    const serverId = Number(params[0]);
    const kind = serverKind(serverId);
    if (kind !== 'burrow' || !isMember(serverId, user.id)) throw new HttpError(404, "That hearth is gone, or you're not in it.");
    const expiresIn = body.expiresIn == null ? null : Math.floor(Number(body.expiresIn));
    if (expiresIn !== null && !(expiresIn >= 60 && expiresIn <= 30 * 86400)) throw new HttpError(400, 'Invites can last from a minute to 30 days');
    const maxUses = body.maxUses == null ? null : Math.floor(Number(body.maxUses));
    if (maxUses !== null && !(maxUses >= 1 && maxUses <= 1000)) throw new HttpError(400, 'Invites can be used from 1 to 1000 times');
    // Used-up invites aren't listed (so can't be cancelled), so they don't count either.
    const live = (db.prepare('SELECT COUNT(*) AS n FROM invites WHERE server_id = ? AND (expires_at IS NULL OR expires_at > ?) AND (max_uses IS NULL OR uses < max_uses)').get(serverId, now()) as { n: number }).n;
    if (live >= 100) throw new HttpError(400, 'This hearth has too many invites. Cancel some first.');
    const code = newInviteCode();
    db.prepare('INSERT INTO invites (code, server_id, created_by, created_at, expires_at, max_uses) VALUES (?, ?, ?, ?, ?, ?)').run(
      code, serverId, user.id, now(), expiresIn === null ? null : now() + expiresIn * 1000, maxUses,
    );
    return { code, invites: invitesOf(serverId, user) };
  });

  route('DELETE', '/api/invites/:code', ({ user, params }) => {
    const inv = db.prepare('SELECT server_id, created_by FROM invites WHERE code = ?').get(params[0]) as { server_id: number; created_by: number | null } | undefined;
    if (!inv || !isMember(inv.server_id, user.id)) throw new HttpError(404, "That invite doesn't work. Ask for a new one.");
    if (inv.created_by !== user.id) allowed(inv.server_id, user, 'invites');
    db.prepare('DELETE FROM invites WHERE code = ?').run(params[0]);
    return invitesOf(inv.server_id, user);
  });

  // A new permanent code; the old one stops working.
  route('POST', '/api/servers/:id/invite-code', ({ user, params }) => {
    const serverId = Number(params[0]);
    allowed(serverId, user, 'invites');
    db.prepare('UPDATE servers SET invite_code = ? WHERE id = ?').run(newInviteCode(), serverId);
    audit(serverId, user.id, 'invite_reset', null);
    sendServerUpdate(serverId);
    return serverSummary(serverId, user.id);
  });

  // What an invite shows before joining: the hearth, how many are in it, and who sent a personal
  // invite (still a member), so a friend knows it's from someone they know.
  const invitePreview = (target: { serverId: number; createdBy?: number | null }) => {
    const s = db
      .prepare(
        `SELECT name, description,
                CASE WHEN icon IS NULL THEN NULL ELSE '/api/burrow-pictures/' || icon END AS icon,
                CASE WHEN banner IS NULL THEN NULL ELSE '/api/burrow-pictures/' || banner END AS banner
         FROM servers WHERE id = ?`,
      )
      .get(target.serverId) as { name: string; description: string | null; icon: string | null; banner: string | null };
    const ids = serverMemberIds(target.serverId);
    const by = target.createdBy && ids.includes(target.createdBy)
      ? (db.prepare('SELECT COALESCE(display_name, username) AS name FROM users WHERE id = ? AND deleted_at IS NULL').get(target.createdBy) as { name: string } | undefined)
      : undefined;
    return { ...s, members: ids.length, online: ids.filter((id) => online.has(id)).length, invitedBy: by?.name ?? null };
  };

  // What an invite link opens, shown before joining. Anyone with the link can see this much.
  route(
    'GET',
    '/api/invites/:code',
    ({ params, ip }) => {
      checkTries([`invite:${ip}`], 60);
      let target;
      try {
        target = inviteTarget(params[0]);
      } catch (err) {
        failedTry([`invite:${ip}`]);
        throw err;
      }
      return invitePreview(target);
    },
    false,
  );

  // An invite link is a small page that names the hearth for link previews (chat apps read these
  // tags), then sends the browser on to the app, which shows the invite. A bad code just goes on.
  const sendInvitePage = (req: IncomingMessage, res: ServerResponse, code: string) => {
    const go = `/?invite=${code}`;
    const ip = clientIp(req);
    let tags = '';
    try {
      checkTries([`invite:${ip}`], 60);
      const p = invitePreview(inviteTarget(code));
      const secure = req.headers['x-forwarded-proto'] === 'https' || !!(req.socket as { encrypted?: boolean }).encrypted;
      const base = (opts.publicUrl || `${secure ? 'https' : 'http'}://${String(req.headers.host ?? 'localhost')}`).replace(/\/$/, '');
      const title = p.invitedBy ? `${p.invitedBy} invited you to ${p.name}` : `Join ${p.name} on Peiskos`;
      const about = p.description?.trim() || `${p.members} member${p.members === 1 ? '' : 's'} on Peiskos.`;
      tags = [
        ['og:title', title], ['og:description', about], ['og:site_name', 'Peiskos'], ['og:type', 'website'],
        ['og:url', `${base}/invite/${code}`], ['og:image', `${base}${p.icon ?? '/icon-512.png'}`],
      ].map(([k, v]) => `<meta property="${k}" content="${escHtml(v)}">`).join('')
        + `<meta name="twitter:card" content="summary"><title>${escHtml(title)}</title>`;
    } catch (err) {
      if (err instanceof HttpError && err.status !== 429) failedTry([`invite:${ip}`]);
    }
    const html = `<!doctype html><html><head><meta charset="utf-8">${tags || '<title>Peiskos</title>'}<meta http-equiv="refresh" content="0;url=${go}"></head><body><a href="${go}">Open Peiskos</a></body></html>`;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(html);
  };

  return { inviteTarget, sendInvitePage };
}
