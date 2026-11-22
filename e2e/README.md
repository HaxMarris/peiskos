# End-to-end tests

These use Peiskos for real: chatting, direct messages, sitting at the fire, and the games. Each
test file starts its own Peiskos server with an empty database, makes a hearth, and opens one
Chromium window per friend. The windows then click, type and draw their way through, and the test
checks what each friend sees.

Everything is the real thing except the voice call: there is no LiveKit server here, so the call
connects to nothing. Peiskos's own server still seats everyone at the fire, which is all the games
go by.

| File | What it plays |
| --- | --- |
| `chat.test.mjs` | A room (send, reply, edit, react, delete), a direct message, sitting at the fire and muting, and Fireside Angler opening |
| `fire.test.mjs` | The game picker and the fire's game bar: start, join, full, leave, the host ending it. A Melon Bomber match reaching a second player. |
| `fire-event.test.mjs` | An event on now at a fire: the lights and banner, a seat kept for someone going, the sidebar saying where it's on |
| `hearthland.test.mjs` | The hearth map: walking into a fire's ring joins its call and out leaves, Sit down and back, a new look showing for others |
| `camp.test.mjs` | The camp: fish caught putting builds on the map, the Camp panel, being told when something goes up |
| `party-games.test.mjs` | Same Page, Odd One Out, Fireside Trivia |
| `drawing-games.test.mjs` | Sketch & Guess, Sketchpad |
| `smoke-signals.test.mjs` | Smoke Signals: three and four players, someone leaving mid-game |
| `stockpile.test.mjs` | Two whole rounds of Stockpile |
| `casino.test.mjs` | Chips, blackjack, slots, cases, the poker table, a case battle |

## Running them

```
cd server && npm ci
cd ../e2e && npm install && npx playwright install chromium
npm test                                  # everything, about two minutes
node --test --test-timeout=240000 party-games.test.mjs       # one file
node --test --test-name-pattern="Same Page" party-games.test.mjs
```

They also run on every pull request (the "Games at the fire, end to end" check). When a test
fails, a picture of every player's screen is saved in `e2e/failures/` (on GitHub: the
`game-failures` artifact of the run).

## Writing one

`lib.mjs` has the pieces: `fireWith(t, base, ['Maya', 'Theo'])` gives a hearth and a seat per
friend; `openApp(base, person)` opens the app without sitting down, and `closeWhenDone(t, seats)` closes those windows (with pictures if the test failed); `startGame(seat, 'trivia')` and `joinGame(seat)` use the same buttons a person would;
`seat.game()` is the game's own page; `sees(locator, text)` waits for a page to catch up.

Games keep time on the host's copy. `startGame` takes over that window's clock, so
`await host.wait(30.5)` jumps half a minute ahead instead of waiting it out. Keep Playwright at
1.63 or later (tested): 1.56's clock could undo a jump now and then on a busy machine (`clock.test.mjs`
checks for it). A jump only moves the host's time, not the messages between windows, so when a
player's clock sends something just before the host's runs out, wait until the host has it
before jumping the host ahead.

The casino's cards and reels are random, so its tests check what must always be true (whose cards
you can see, whose turn it is, that chips add up) and not who wins.
