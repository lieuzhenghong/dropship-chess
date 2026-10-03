# Dropship Chess

A mobile-web port of [nand2tetris-dropship-chess](https://github.com/lieuzhenghong/nand2tetris-dropship-chess):
chess on a 6×6 board where captured pieces switch sides and can be "dropped"
back onto any empty square. White starts with knights and Black with bishops,
so you have to capture the other side's minor pieces to get them.

Two-player pass-and-play, touch-first, and it also works with a keyboard. The
pieces are the original 32×32 1-bit sprites, extracted from `SpriteSheet.jack`.

## Running

```sh
npm install
npm run dev        # dev server (also reachable from a phone on the same network)
npm test           # rules engine tests
npm run build      # typecheck + static build into dist/
npm run preview    # serve dist/
```

`dist/` is a fully static, offline-capable bundle with relative paths, so it can
be hosted anywhere (GitHub Pages, Netlify, S3) or loaded from `file://`.

## Rules

- Moves are standard chess, except that pawns only ever step one square.
  There's no castling and no en passant.
- Capturing a piece adds it to your **dropships**. On your turn, you can drop
  one onto any empty square instead of moving.
- There's no check or checkmate: you win by **capturing the King**. Nothing
  stops a King walking into check, though the UI warns you when it is attacked.

Changes from the original Jack version:

| | Original | Here |
|---|---|---|
| Rooks/bishops/queens on the board edge | Could wrap around to the other side (index-arithmetic bug) | Fixed |
| Pawn reaching the last rank | Stuck forever (listed as a limitation) | Promotes to Queen; reverts to a pawn if captured (crazyhouse rule) |
| Dropping a pawn on the last rank | Allowed (a TODO in the source) | Not allowed |
| Dropships | 12 fixed slots, picked with keys 1–9, 0, -, = | Grouped by piece type with a count, keys 1–5 |
| Undo / save | None | Undo history, and the game persists across reloads |

## Controls

- **Touch/mouse:** tap a piece, then tap a highlighted square. To drop, tap a
  piece in your dropships, then an empty square.
- **Keyboard:** arrow keys move the cursor, Space/Enter selects, Esc cancels,
  1–5 pick a dropship (P, N, B, R, Q), U undoes.

## Layout

```
src/
  engine/rules.ts       pure, immutable rules engine (no DOM), plus tests
  sprites/data.ts       generated from SpriteSheet.jack
  sprites/render.ts     sprite → transparent PNG (background removed by flood fill)
  storage.ts            KeyValueStore interface + localStorage implementation
  ui/app.ts, styles.css DOM UI
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
