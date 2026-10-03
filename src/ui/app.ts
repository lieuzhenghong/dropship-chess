import {
  applyMove,
  col,
  type Colour,
  dropTargets,
  type GameState,
  HAND_KINDS,
  type HandKind,
  inCheck,
  initialState,
  type Kind,
  type Move,
  moveTargets,
  row,
  SIZE,
  SQUARES,
} from '../engine/rules';
import { chooseMove } from '../engine/ai';
import { type Palette, spriteUrl } from '../sprites/render';
import { type History, type KeyValueStore, loadHistory, saveHistory } from '../storage';

const PALETTE: Palette = { ink: '#263024', fill: '#f4efda' };
const MAX_HISTORY = 400;
const SEEN_HELP_KEY = 'dropship-chess:seen-help';
const MODE_KEY = 'dropship-chess:mode';
/** Pause before the computer moves, so its move is visible as a separate step. */
const AI_DELAY_MS = 450;

const NAMES: Record<Kind, string> = {
  P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king',
};
const COLOUR_NAMES: Record<Colour, string> = { w: 'White', b: 'Black' };

type Selection = { type: 'square'; sq: number } | { type: 'hand'; kind: HandKind } | null;

const isDark = (sq: number) => (row(sq) + col(sq)) % 2 === 1;
const squareName = (sq: number) => `${'abcdef'[col(sq)]}${SIZE - row(sq)}`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

export function mountApp(root: HTMLElement, store: KeyValueStore): void {
  let history: History = loadHistory(store) ?? [initialState()];
  let selection: Selection = null;
  let cursor = SQUARES - 3; // keyboard cursor starts on White's King
  let showCursor = false;
  /** Which colour the computer plays, or null for two players. */
  let aiColour: Colour | null = (() => {
    const m = store.get(MODE_KEY);
    return m === 'w' || m === 'b' ? m : null;
  })();
  let aiTimer: ReturnType<typeof setTimeout> | undefined;

  const current = () => history[history.length - 1];
  const aiToMove = () => aiColour !== null && current().turn === aiColour && !current().winner;

  // ---- DOM ----
  const undoBtn = el('button', { className: 'icon-btn', textContent: 'Undo', type: 'button' });
  const newBtn = el('button', { className: 'icon-btn', textContent: 'New', type: 'button' });
  const helpBtn = el('button', { className: 'icon-btn', textContent: '?', type: 'button' });
  helpBtn.setAttribute('aria-label', 'How to play');
  const header = el(
    'header',
    { className: 'bar' },
    el('h1', {}, 'Dropship Chess'),
    el('div', { className: 'actions' }, undoBtn, newBtn, helpBtn),
  );

  const boardEl = el('div', { className: 'board' });
  boardEl.setAttribute('role', 'group');
  boardEl.setAttribute('aria-label', 'Board');
  const cells: HTMLButtonElement[] = [];
  const pieces: HTMLSpanElement[] = [];
  for (let sq = 0; sq < SQUARES; sq++) {
    const piece = el('span', { className: 'piece' });
    const cell = el(
      'button',
      { type: 'button', className: `cell ${isDark(sq) ? 'dark' : 'light'}` },
      piece,
    );
    cell.dataset.sq = String(sq);
    cells.push(cell);
    pieces.push(piece);
    boardEl.append(cell);
  }

  const makeHand = (colour: Colour) => {
    const slots = new Map<HandKind, { btn: HTMLButtonElement; count: HTMLSpanElement }>();
    const section = el('section', { className: `hand hand-${colour}` });
    const title = el('h2');
    section.append(title);
    const list = el('div', { className: 'slots' });
    HAND_KINDS.forEach((kind, i) => {
      const count = el('span', { className: 'count' });
      const btn = el(
        'button',
        { type: 'button', className: 'slot' },
        el('img', { src: spriteUrl(colour, kind, PALETTE), alt: '', draggable: false }),
        count,
      );
      btn.dataset.kind = kind;
      btn.dataset.colour = colour;
      btn.title = `${NAMES[kind]} (key ${i + 1})`;
      slots.set(kind, { btn, count });
      list.append(btn);
    });
    section.append(list);
    return { section, slots, title };
  };
  const hands = { b: makeHand('b'), w: makeHand('w') };

  const status = el('p', { className: 'status' });
  status.setAttribute('role', 'status');

  const helpDialog = el('dialog', { className: 'sheet' });
  helpDialog.innerHTML = `
    <h2>Dropship Chess</h2>
    <p class="byline">A better “Really Bad Chess”, originally by
      <a href="https://github.com/lieuzhenghong/nand2tetris-dropship-chess"
         target="_blank" rel="noopener">@lieuzhenghong</a> for nand2tetris.</p>
    <ul>
      <li>Chess on a 6×6 board. White starts with knights, Black with bishops.</li>
      <li>Capture a piece and it joins your <b>dropships</b>. On your turn you may
        drop it onto any empty square instead of moving.</li>
      <li>Win by <b>capturing the King</b>. There’s no checkmate, and nothing
        stops you walking into check, so watch out.</li>
      <li>Pawns move one square, never two. A pawn that reaches the far rank becomes a
        Queen, and turns back into a pawn if it’s captured. No castling, no en passant.</li>
      <li>Pawns can’t be dropped onto the far rank.</li>
      <li>Tap <b>New</b> to play two players on one device, or against the computer.</li>
    </ul>
    <p class="keys">Keyboard: arrows move, Space selects, Esc cancels, 1–5 pick a dropship,
      U undoes.</p>
    <form method="dialog"><button class="primary">Play</button></form>`;

  const confirmDialog = el('dialog', { className: 'sheet' });
  confirmDialog.innerHTML = `
    <h2>New game</h2>
    <p class="warn">The current game will be lost.</p>
    <form method="dialog" class="stack">
      <button value="pvp" class="primary">2 players, one device</button>
      <button value="b" class="primary">vs computer: you’re White</button>
      <button value="w" class="primary">vs computer: you’re Black</button>
      <button value="cancel">Cancel</button>
    </form>`;
  const warn = confirmDialog.querySelector<HTMLElement>('.warn')!;

  root.replaceChildren(
    header,
    el(
      'div',
      { className: 'stage' },
      el('main', { className: 'game' }, hands.b.section, boardEl, hands.w.section),
      status,
    ),
    helpDialog,
    confirmDialog,
  );

  // ---- State transitions ----
  const commit = (next: GameState) => {
    history = [...history, next].slice(-MAX_HISTORY);
    selection = null;
    saveHistory(store, history);
  };

  const targets = (): number[] => {
    const s = current();
    if (!selection) return [];
    return selection.type === 'square'
      ? moveTargets(s, selection.sq)
      : dropTargets(s, selection.kind);
  };

  const activateSquare = (sq: number) => {
    const s = current();
    if (s.winner || aiToMove()) return;
    if (selection && targets().includes(sq)) {
      const move: Move =
        selection.type === 'square'
          ? { type: 'move', from: selection.sq, to: sq }
          : { type: 'drop', kind: selection.kind, to: sq };
      commit(applyMove(s, move));
    } else if (s.board[sq]?.colour === s.turn &&
               !(selection?.type === 'square' && selection.sq === sq)) {
      selection = { type: 'square', sq };
    } else {
      selection = null;
    }
    render();
  };

  const activateHand = (colour: Colour, kind: HandKind) => {
    const s = current();
    if (s.winner || aiToMove() || colour !== s.turn || s.hands[colour][kind] <= 0) return;
    selection =
      selection?.type === 'hand' && selection.kind === kind ? null : { type: 'hand', kind };
    render();
  };

  const undo = () => {
    if (undoBtn.disabled) return; // same rule as the button (keyboard U bypasses it)
    clearTimeout(aiTimer);
    history = history.slice(0, -1);
    // Against the computer, step back to the human's previous turn.
    while (history.length > 1 && aiToMove()) history = history.slice(0, -1);
    selection = null;
    saveHistory(store, history);
    render();
  };

  const newGame = (ai: Colour | null) => {
    clearTimeout(aiTimer);
    aiColour = ai;
    store.set(MODE_KEY, ai ?? 'pvp');
    history = [initialState()];
    selection = null;
    saveHistory(store, history);
    render();
  };

  /** Schedules the computer's move if it's its turn. Called after every render. */
  const maybePlayAi = () => {
    clearTimeout(aiTimer);
    if (!aiToMove()) return;
    aiTimer = setTimeout(() => {
      if (!aiToMove()) return;
      const move = chooseMove(current());
      if (!move) return;
      commit(applyMove(current(), move));
      render();
    }, AI_DELAY_MS);
  };

  // ---- Rendering ----
  function render() {
    const s = current();
    const t = new Set(targets());
    const last = s.lastMove;
    const checked = (['w', 'b'] as const).filter((c) => !s.winner && inCheck(s, c));

    cells.forEach((cell, sq) => {
      const p = s.board[sq];
      pieces[sq].style.backgroundImage = p ? `url(${spriteUrl(p.colour, p.kind, PALETTE)})` : '';
      const cl = cell.classList;
      cl.toggle('selected', selection?.type === 'square' && selection.sq === sq);
      cl.toggle('target', t.has(sq) && !p);
      cl.toggle('capture', t.has(sq) && !!p);
      cl.toggle('last', !!last && (last.to === sq || (last.type === 'move' && last.from === sq)));
      cl.toggle('check', !!p && p.kind === 'K' && checked.includes(p.colour));
      cl.toggle('cursor', showCursor && cursor === sq);
      cell.setAttribute('aria-label', `${squareName(sq)}${
        p ? `, ${COLOUR_NAMES[p.colour].toLowerCase()} ${NAMES[p.kind]}` : ''
      }${t.has(sq) ? ', legal move' : ''}`);
    });

    (['w', 'b'] as const).forEach((colour) => {
      const { section, slots, title } = hands[colour];
      section.classList.toggle('active', !s.winner && s.turn === colour);
      title.textContent =
        aiColour === null ? `${COLOUR_NAMES[colour]}’s dropships`
        : colour === aiColour ? 'Computer’s dropships' : 'Your dropships';
      for (const [kind, { btn, count }] of slots) {
        const n = s.hands[colour][kind];
        count.textContent = n > 1 ? `×${n}` : '';
        btn.disabled = n === 0;
        btn.classList.toggle('selected', selection?.type === 'hand' &&
          selection.kind === kind && s.turn === colour);
        btn.setAttribute('aria-label',
          `${COLOUR_NAMES[colour]} ${NAMES[kind]} dropship, ${n} available`);
      }
    });

    const score = s.winner === 'w' ? '1–0' : '0–1';
    if (s.winner && aiColour !== null) {
      status.textContent = `${s.winner === aiColour ? 'Computer wins' : 'You win'}, ${score}`;
    } else if (s.winner) {
      status.textContent = `${COLOUR_NAMES[s.winner]} wins, ${score}`;
    } else if (aiToMove()) {
      status.textContent = 'Computer is thinking…';
    } else {
      status.textContent = `${aiColour === null ? `${COLOUR_NAMES[s.turn]} to move` : 'Your move'}${
        checked.includes(s.turn) ? ' · your King is under attack' : ''
      }`;
    }
    status.classList.toggle('over', !!s.winner);
    // With the computer as White, undoing its opening move would just replay it.
    undoBtn.disabled = history.length <= (aiColour === 'w' ? 2 : 1);
    document.body.dataset.turn = s.turn;
    maybePlayAi();
  }

  // ---- Input ----
  boardEl.addEventListener('click', (e) => {
    const cell = (e.target as HTMLElement).closest<HTMLButtonElement>('.cell');
    if (!cell) return;
    // Pointer clicks hide the keyboard cursor; keyboard "clicks" have detail 0.
    showCursor = e.detail === 0;
    cursor = Number(cell.dataset.sq);
    activateSquare(cursor);
  });
  for (const colour of ['w', 'b'] as const) {
    hands[colour].section.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.slot');
      if (btn) activateHand(colour, btn.dataset.kind as HandKind);
    });
  }
  undoBtn.addEventListener('click', undo);
  helpBtn.addEventListener('click', () => helpDialog.showModal());
  newBtn.addEventListener('click', () => {
    warn.hidden = history.length <= 1 || !!current().winner;
    confirmDialog.returnValue = '';
    confirmDialog.showModal();
  });
  confirmDialog.addEventListener('close', () => {
    const v = confirmDialog.returnValue;
    if (v === 'pvp') newGame(null);
    else if (v === 'w' || v === 'b') newGame(v);
  });
  helpDialog.addEventListener('close', () => store.set(SEEN_HELP_KEY, '1'));

  // Keyboard controls, after the original's (arrows / space / escape / numbers).
  document.addEventListener('keydown', (e) => {
    if (helpDialog.open || confirmDialog.open || e.metaKey || e.ctrlKey || e.altKey) return;
    const move = (dr: number, dc: number) => {
      const r = (row(cursor) + dr + SIZE) % SIZE;
      const c = (col(cursor) + dc + SIZE) % SIZE;
      cursor = r * SIZE + c;
      showCursor = true;
      cells[cursor].focus({ preventScroll: true });
      render();
    };
    switch (e.key) {
      case 'ArrowUp': move(-1, 0); break;
      case 'ArrowDown': move(1, 0); break;
      case 'ArrowLeft': move(0, -1); break;
      case 'ArrowRight': move(0, 1); break;
      case ' ':
      case 'Enter':
        // A focused button (a board cell after arrow keys, or Undo etc.) gets
        // its native click instead, which avoids activating twice.
        if (document.activeElement instanceof HTMLButtonElement) return;
        showCursor = true;
        activateSquare(cursor);
        break;
      case 'Escape': selection = null; render(); break;
      case 'u': case 'U': undo(); break;
      default: {
        const i = Number(e.key) - 1;
        if (i >= 0 && i < HAND_KINDS.length) activateHand(current().turn, HAND_KINDS[i]);
        else return;
      }
    }
    e.preventDefault();
  });

  render();
  if (!store.get(SEEN_HELP_KEY)) helpDialog.showModal();
}
