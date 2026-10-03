# Dropship Chess

A mobile-web port of [nand2tetris-dropship-chess](https://github.com/lieuzhenghong/nand2tetris-dropship-chess):
chess on a 6×6 board where captured pieces switch sides and can be "dropped"
back onto any empty square. Each side has two rooks, a queen, a king, a knight
and a bishop, with the back rank shuffled every game (Fischer random style).

Two players on one device, against a rudimentary computer opponent, or online
against a friend with a 3+2 clock.
Touch-first. The pieces are the original 32×32 1-bit sprites, extracted from `SpriteSheet.jack`.

## Running

```sh
npm install
npm run dev        # dev server (also reachable from a phone on the same network)
npm test           # rules engine tests
npm run build      # typecheck + static build into dist/
npm run preview    # serve dist/
```

`dist/` is a fully static bundle with relative paths and no network requests,
so it can be hosted anywhere (GitHub Pages, Netlify, S3) or loaded from `file://`.

Live at **https://lieuzhenghong.github.io/dropship-chess/**.
`.github/workflows/deploy.yml` runs the tests and build on every PR, and on each
push to `master` it publishes `dist/` to the `gh-pages` branch, which Pages
serves.

## Rules

- Each side starts with R, R, Q, K, N, B on the back rank and six pawns in
  front. The back rank is shuffled at the start of every game, and Black's
  mirrors White's (same piece on the same file), so the only asymmetry is
  that White moves first. With one bishop each and no castling, none of
  chess960's placement rules are needed, so all 360 arrangements can come up.
  Online, the server deals the position so both players get the same one.
- Moves are standard chess, except that pawns only ever step one square.
  There's no castling and no en passant.
- Capturing a piece adds it to your **dropships**. On your turn, you can drop
  one onto any empty square instead of moving, except that you can't drop a
  pawn into your opponent's starting rows (their back two ranks). A pawn
  dropped one step from promotion turned out to be too strong.
- There's no check or checkmate: you win by **capturing the King**. Nothing
  stops a King walking into check, though the UI warns you when it is attacked.

Changes from the original Jack version:

| | Original | Here |
|---|---|---|
| Starting position | Fixed: White has two knights, Black two bishops | Both sides R, R, Q, K, N, B, shuffled each game and mirrored |
| Rooks/bishops/queens on the board edge | Could wrap around to the other side (index-arithmetic bug) | Fixed |
| Pawn reaching the last rank | Stuck forever (listed as a limitation) | Promotes to Queen; reverts to a pawn if captured (crazyhouse rule) |
| Dropping pawns deep | Allowed anywhere (a TODO in the source to forbid the last rank) | Not into the opponent's starting rows (their back two ranks) |
| Dropships | 12 fixed slots, picked with keys 1–9, 0, -, = | Grouped by piece type with a count |
| Controls | Arrow keys, Space, Escape | Touch (tap to select, tap to move) |
| Undo / save | None | Undo history, and the game persists across reloads |
| AI | None (listed as a future extension) | A basic computer opponent |

## Computer opponent

Choose "vs computer" under **New**; you get a random colour. It's meant as something to test against,
not a strong player: `src/engine/ai.ts` runs a three-ply negamax search with
alpha-beta pruning (its move, your reply, its next move) and scores positions
by material only, counting pieces in hand. It takes free pieces, captures the
King when it can, and avoids the most obvious blunders, but it has no
positional sense and can't see beyond three plies. Equal moves are chosen at
random. It runs on the main thread, taking a few milliseconds per move on a
laptop, so no worker is needed yet. Against the computer, Undo takes back your
last move together with its reply.

## Online play

Choose **New → Online: invite a friend** and send the link. Whoever opens it
plays Black. The time control is 3+2: 3 minutes each, plus 2 seconds per move.
As on most chess sites, each side's first move is untimed but must be made
within 30 seconds, or the game is aborted with no result; the clocks start
after Black's first move. A clock reaching zero loses, as does losing your
King. Reloading or losing your connection rejoins the same game: each browser
keeps a secret per-game token in `localStorage`, pruned to the 20 most recent
games. Anyone else who opens the link can watch.

The server (`server/`) is a Cloudflare Worker with one
[Durable Object](https://developers.cloudflare.com/durable-objects/) per game.
It validates every move with the same rules engine, `src/engine/rules.ts`, and
keeps the clocks. It runs no timers: the clocks and the first-move deadline
are checked whenever a message arrives, and when a deadline passes the waiting
player's app asks the server to check. A game both players have left stays
unresolved until someone reopens the link, which resolves it immediately.
Games are kept indefinitely, as a record for replays or stats later; at a few
KB each, storage isn't a concern. The
game logic is in `server/src/room.ts`, with unit tests.

Deliberately left out: accounts, matchmaking, rematch and resign buttons,
chat, lag compensation, server-side timers, and a configurable time control (it's two constants
in `src/protocol.ts`).

```sh
npm run server:dev                                  # local server on :8787
VITE_SERVER_URL=ws://localhost:8787 npm run dev     # client pointing at it
```

The Worker config is `wrangler.toml` at the repo root, so a plain
`npx wrangler deploy` works. To deploy, pick **one** of:

- **Cloudflare's Git integration** (Workers & Pages → Create → Import a
  repository): the defaults work. It deploys on every push to `master`.
- **GitHub Actions**: add repository secrets `CLOUDFLARE_API_TOKEN` (from the
  "Edit Cloudflare Workers" template) and `CLOUDFLARE_ACCOUNT_ID`. The
  `deploy-server` job then deploys on every push to `master`, and skips itself
  when the secrets are absent.
- **By hand**: `npx wrangler login && npm run server:deploy`.

Durable Objects (SQLite-backed) are available on Cloudflare's free plan.

Then set the repository variable `SERVER_URL` to the deployed address, e.g.
`wss://dropship-chess.<your-subdomain>.workers.dev`, and re-run the workflow.
The online option appears only once this is set.

## Controls

Tap a piece, then tap a highlighted square. To drop, tap a piece in your
dropships, then an empty square. (Squares and buttons are ordinary buttons, so
Tab and Enter work too.)

## Layout

```
src/
  engine/rules.ts       pure, immutable rules engine (no DOM), plus tests
  engine/ai.ts          computer opponent (negamax + alpha-beta, material eval)
  protocol.ts           client/server message types
  online.ts             WebSocket client with auto-reconnect
  sprites/data.ts       generated from SpriteSheet.jack
  sprites/render.ts     sprite → transparent PNG (background removed by flood fill)
  storage.ts            KeyValueStore interface + localStorage implementation
  ui/app.ts, styles.css DOM UI
wrangler.toml           Worker config (entry point: server/src/index.ts)
server/
  src/room.ts           authoritative game + clock logic (pure, tested)
  src/index.ts          Worker entry + Durable Object (one per game)
scripts/
  extract-sprites.mjs   node scripts/extract-sprites.mjs path/to/SpriteSheet.jack
  make-icons.mjs        regenerates public/icon*.{svg,png}
```

## Wrapping as a native app (later)

The app was built with this in mind:

- The build is static with relative asset paths (`base: './'`), so it runs
  from a WebView's local file server.
- The viewport uses `viewport-fit=cover` with safe-area insets, there's no
  pinch zoom or tap highlight, and touch targets are at least 44px.
- There are no network requests and no external fonts.
- Persistence goes through `KeyValueStore` (`src/storage.ts`), so it can be
  swapped for Capacitor Preferences if WebView `localStorage` eviction is a
  concern.
- The rules engine is framework-free and pure, so it can be reused for an AI
  opponent or online play.

With [Capacitor](https://capacitorjs.com/), roughly:

```sh
npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npx cap init "Dropship Chess" com.example.dropshipchess --web-dir dist
npm run build && npx cap add ios && npx cap add android && npx cap sync
```

It also ships a web app manifest, so it can already be added to a home screen
as a standalone PWA. There's no service worker yet, so offline use after
install isn't guaranteed.

## Credits

Original game and sprites by [@lieuzhenghong](https://github.com/lieuzhenghong),
written in Jack for the nand2tetris course.
