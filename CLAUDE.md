# Peiskos

A self-hosted, Discord-style app for a group of friends: hearths with rooms, direct messages, voice
at "fires" (LiveKit), and games and a casino at the fire. The project was called Burrow first, so
older code and the database still say `burrow` in places (see the names below).

- `server/`: Node 22+, TypeScript run directly (Node strips the types), SQLite (`node:sqlite`), `ws`.
- `client/`: the web app. Plain scripts with no build step, loaded in order by `client/index.html`.
  The desktop app (`desktop/`, Electron) and phone apps (`mobile/`, Capacitor) bundle this folder.
- `client/games/`: each game at the fire is its own page in an iframe.
- `e2e/`: Playwright tests against a real server (see `e2e/README.md`).

## Names: one thing, several words

| On screen | In the database and API | In older code |
| --- | --- | --- |
| hearth | `servers` table, `/api/servers`, `serverId` | `burrow` (`burrows.js`, `kind = 'burrow'`, the `'burrow'` permission, `/api/burrow-pictures`) |
| room | `channels` (`kind = 'text'`), `channelId` | |
| fire | a voice channel (`kind = 'voice'`); the first one is the Campfire | |
| fireside chat | `fireside_messages`: the chat beside a fire, gone once everyone leaves unless `keep_chat` | |
| direct message | a tiny private hearth with `kind = 'dm'` and one room | |
| thread | a channel with `kind = 'thread'` under the room it started in | |

Don't rename the database columns or API paths: older desktop and phone builds still call them. In
new code and text, say hearth, room and fire, and don't add new `burrow` names.

## Server

- `server/src/app.ts` is `createApp`: shared helpers (who can see what, sending to sockets, posting a
  message), the message routes, HTTP plumbing and the WebSocket. Each feature area lives in its own
  module that takes a context object of what it needs from `createApp` and hands back what others
  need: `login.ts`, `dms.ts`, `uploads.ts`, `planning.ts`, `casino.ts`, `moderation.ts` and so on.
  Add new features the same way rather than growing `app.ts`. A helper defined further down
  `createApp` than the module's call goes in as `name: (...a) => name(...a)`.
- Errors a person should see: `throw new HttpError(status, 'Plain sentence.')` (`http.ts`).
- Size limits are in `limits.ts`; permission names and shared SQL column lists in `common.ts`.
- New rows in `messages` must take their id from the `id_floor` expression used in `postMessage`
  (`app.ts`), so a deleted message's id is never handed out again.
- Database changes: add a step to the end of `MIGRATIONS` in `db.ts`. Never edit or reorder a step
  that has shipped. (The `add*` functions above it are the older, self-checking schema.)
- Tests: `cd server && npm test` (node:test) and `npm run typecheck`. Start a test file with
  `listening(app, ...)` and `caller(...)` from `test/helpers.ts`; name the file after the feature.

## Client

- All scripts in `client/js/` share one global scope. `node scripts/check-client.mjs` (run in CI)
  catches duplicate top-level names, using something before the script that defines it loads, and
  undefined names. `server/test/client-globals.test.ts` catches top-level names that clash with the
  window's own (`screen`, `toolbar`...): Safari drops the whole file over those.
- State machines (connection, voice, joining a game, uploads, the login screen) are declared in
  `PHASES` in `client/js/phases.js` and made with `phaseMachine()`. Add new ones there; each sets
  `data-phase` on its element, which the e2e tests wait on.
- Escape anything a person typed with `escapeHtml` before it goes into `innerHTML`.
- Desktop and phone apps only get client changes with a new release of those apps.

## Games at the fire

- Party games load `client/games/shared/bridge.js` and talk to Peiskos through its `Peiskos`
  object (`on('init' | 'players' | 'msg')`, `send`, `snapshot`, `busy`, `leave`). Whoever started the
  game hosts it; other players' messages go to the host through the server.
- Fireside Angler (`games/fishing`) is solo and has its own messages (saves, the board, the derby).
  Its waters and fish are in `fish-data.js`, which the server also reads (`server/src/fishing.ts`).
  Keep that file plain data.
- The server's side of the games is `server/src/games.ts` (seats and relaying) and the game's own
  module for anything kept (casino, fishing, trivia).

## Writing for people

Interface text is short and plain: say what happened and what to do. No reassuring or chatty filler.
Code comments say why, in the same plain voice.
