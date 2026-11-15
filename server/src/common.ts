// Pieces many server files share: the permission names, and SQL for rooms and pictures.

/** What a role can let someone do in a hearth. 'burrow' is editing the hearth itself. */
export const PERMS = ['rooms', 'messages', 'remove', 'ban', 'roles', 'burrow', 'emoji', 'voice', 'everyone', 'pin', 'invites', 'timeout', 'audit'] as const;
export type Perm = (typeof PERMS)[number];
/** The permissions in a role's stored list (commas between), leaving out any unknown ones. */
export const parsePerms = (text: string) => text.split(',').filter((p): p is Perm => (PERMS as readonly string[]).includes(p));

/** A room's columns, named as the Channel type in app.ts has them. */
export const CHANNEL_COLS = `id, server_id AS serverId, name, kind, private, parent_id AS parentId,
  slow_seconds AS slow, announce, archived_at AS archivedAt, user_limit AS userLimit, keep_chat AS keepChat`;
// A user's picture link, from their users.avatar file name (or null).
export const avatarUrl = (col: string) => `CASE WHEN ${col} IS NULL THEN NULL ELSE '/api/avatars/' || ${col} END`;
