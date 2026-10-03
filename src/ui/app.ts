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
  randomBackRank,
  type Kind,
  type Move,
  moveTargets,
  positionKey,
  type Seen,
  type Piece,
  other,
  row,
  SIZE,
  SQUARES,
} from '../engine/rules';
import { chooseMove } from '../engine/ai';
import { createWebFeedback, type Feedback } from '../feedback';
import * as fx from './fx';
import { connect, type ConnectionStatus, newGameId, type OnlineGame, SERVER_URL } from '../online';
import { type GameResult, INCREMENT_MS, type RoomView } from '../protocol';
import { type Palette, spriteUrl } from '../sprites/render';
import { type History, type KeyValueStore, loadHistory, saveHistory } from '../storage';

const PALETTE: Palette = { ink: '#263024', fill: '#f4efda' };
const MAX_HISTORY = 400;
const SEEN_HELP_KEY = 'dropship-chess:seen-help';
const MODE_KEY = 'dropship-chess:mode';
/**
 * Pause before the computer starts thinking, so your move's animation can
 * finish first. Its search then takes up to 250 ms more.
 */
const AI_DELAY_MS = 200;

const NAMES: Record<Kind, string> = {
  P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king',
};
const COLOUR_NAMES: Record<Colour, string> = { w: 'White', b: 'Black' };

type Selection = { type: 'square'; sq: number } | { type: 'hand'; kind: HandKind } | null;

const GAME_ID = /^[a-z0-9]{6,32}$/;

/** m:ss, with tenths in the last ten seconds. */
function formatClock(ms: number): string {
  const t = Math.max(0, ms);
  if (t < 10_000) return `0:0${(t / 1000).toFixed(1)}`;
  const s = Math.ceil(t / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const BASE_TITLE = 'Dropship Chess';
const DUST = ['#3d4a3c', '#8fa27c', '#e3dcbc'];
const SPARKS = ['#d99a2b', '#f4efda', '#c4513b', '#263024'];
const CONFETTI = ['#d99a2b', '#8fa27c', '#3d4a3c', '#c4513b', '#f4efda'];

const snapshotKey = (s: GameState) => JSON.stringify([s.board, s.hands, s.turn, s.winner]);

interface Transition {
  move: Move;
  mover: Colour;
  /** The piece that was on the destination square, if any. */
  captured: Piece | null;
  promoted: boolean;
}

/**
 * Describes how `next` follows from `prev` by a single move, or returns null
 * if it doesn't (undo, new game, a resync from the server, or the server
 * echoing a move we already showed).
 */
function transition(prev: GameState, next: GameState): Transition | null {
  const move = next.lastMove;
  if (!move || prev === next) return null;
  let expected: GameState;
  try {
    expected = applyMove(prev, move);
  } catch {
    return null;
  }
  if (snapshotKey(expected) !== snapshotKey(next)) return null;
  const captured = move.type === 'move' ? prev.board[move.to] : null;
  const promoted = move.type === 'move' && prev.board[move.from]?.kind === 'P' &&
    next.board[move.to]?.kind === 'Q';
  return { move, mover: prev.turn, captured, promoted };
}

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

export function mountApp(
  root: HTMLElement,
  store: KeyValueStore,
  feedback: Feedback = createWebFeedback(store),
): void {
  let history: History = loadHistory(store) ?? [initialState(randomBackRank())];
  let selection: Selection = null;
  /** Which colour the computer plays, or null for two players. */
  let aiColour: Colour | null = (() => {
    const m = store.get(MODE_KEY);
    return m === 'w' || m === 'b' ? m : null;
  })();
  let aiTimer: ReturnType<typeof setTimeout> | undefined;

  /** Set while playing online; the server's snapshot replaces local history. */
  let online: {
    id: string;
    conn: OnlineGame;
    view: RoomView | null;
    /** Local time `view` arrived, for counting down the running clock. */
    receivedAt: number;
    status: ConnectionStatus;
    flagClaimed: boolean;
  } | null = null;

  /** The position drawn by the previous render, to spot moves worth animating. */
  let lastRendered: GameState | null = null;
  let lastResult: GameResult | null | undefined; // undefined until the first render
  let lastTick = 0;

  const current = (): GameState =>
    online ? (online.view?.game ?? initialState()) : history[history.length - 1];
  const aiToMove = () =>
    !online && aiColour !== null && current().turn === aiColour && !current().winner;
  /** Whether the person at this device may move now. */
  /** Whose move it is in a started, unfinished online game. */
  const onlineTurn = (v: RoomView | null | undefined): Colour | null =>
    v && v.started && !v.result ? v.game.turn : null;
  const canAct = (): boolean => {
    if (!online) return !current().winner && !aiToMove();
    const v = online.view;
    return !!v && v.you !== null && onlineTurn(v) === v.you && online.status === 'open';
  };
  /** Time left to make a first move, counting down locally. */
  const abortLeft = (): number | null => {
    const v = online?.view;
    return v?.abortIn != null ? Math.max(0, v.abortIn - (Date.now() - online!.receivedAt)) : null;
  };
  const result = (): GameResult | null => {
    if (online) return online.view?.result ?? null;
    const w = current().winner;
    return w ? { winner: w, reason: current().winBy ?? 'king' } : null;
  };
  /** The colour the person at this device plays, or null when both sides share it. */
  const me = (): Colour | null =>
    online ? (online.view?.you ?? null) : aiColour ? other(aiColour) : null;
  /** Clocks as they stand now, counting down the running side locally. */
  const liveClocks = (): Record<Colour, number> | null => {
    const v = online?.view;
    if (!v) return null;
    const clocks = { ...v.clocks };
    if (v.running) clocks[v.running] -= Date.now() - online!.receivedAt;
    return clocks;
  };

  // ---- DOM ----
  const undoBtn = el('button', { className: 'icon-btn', textContent: 'Undo', type: 'button' });
  const newBtn = el('button', { className: 'icon-btn', textContent: 'New', type: 'button' });
  const helpBtn = el('button', { className: 'icon-btn', textContent: '?', type: 'button' });
  helpBtn.setAttribute('aria-label', 'How to play');
  const soundBtn = el('button', { className: 'icon-btn sound', type: 'button' });
  soundBtn.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges">
      <path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor"/>
      <path class="waves" d="M11 5h1v6h-1zM13 3h1v10h-1z" fill="currentColor"/>
      <path class="slash" d="M10 5l1-1 5 6-1 1zM10 10l5-6 1 1-5 6z" fill="currentColor"/>
    </svg>`;
  const syncSoundBtn = () => {
    soundBtn.classList.toggle('muted', !feedback.enabled);
    soundBtn.setAttribute('aria-label', feedback.enabled ? 'Mute sound and vibration' : 'Turn on sound and vibration');
    soundBtn.setAttribute('aria-pressed', String(!feedback.enabled));
  };
  syncSoundBtn();
  const header = el(
    'header',
    { className: 'bar' },
    el('h1', {}, 'Dropship Chess'),
    el('div', { className: 'actions' }, soundBtn, undoBtn, newBtn, helpBtn),
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
    const clock = el('span', { className: 'clock' });
    section.append(el('div', { className: 'hand-head' }, title, clock));
    const list = el('div', { className: 'slots' });
    HAND_KINDS.forEach((kind) => {
      const count = el('span', { className: 'count' });
      const btn = el(
        'button',
        { type: 'button', className: 'slot' },
        el('img', { src: spriteUrl(colour, kind, PALETTE), alt: '', draggable: false }),
        count,
      );
      btn.dataset.kind = kind;
      btn.dataset.colour = colour;
      btn.title = NAMES[kind];
      slots.set(kind, { btn, count });
      list.append(btn);
    });
    section.append(list);
    return { section, slots, title, clock };
  };
  const hands = { b: makeHand('b'), w: makeHand('w') };

  const status = el('p', { className: 'status' });
  status.setAttribute('role', 'status');
  const abortEl = el('span', { className: 'abort' });
  const shareBtn = el('button', { className: 'icon-btn share', type: 'button', textContent: 'Share invite link' });
  shareBtn.hidden = true;
  // Online-only game controls, shown under the status line.
  const resignBtn = el('button', { className: 'icon-btn share', type: 'button', textContent: 'Resign' });
  const rematchBtn = el('button', { className: 'icon-btn share', type: 'button' });
  resignBtn.hidden = rematchBtn.hidden = true;

  const helpDialog = el('dialog', { className: 'sheet' });
  helpDialog.innerHTML = `
    <h2>Dropship Chess</h2>
    <p class="byline">A better “Really Bad Chess”, originally by
      <a href="https://github.com/lieuzhenghong/nand2tetris-dropship-chess"
         target="_blank" rel="noopener">@lieuzhenghong</a> for nand2tetris.</p>
    <ul>
      <li>Chess on a 6×6 board. Each side has two rooks, a queen, a king, a knight and a
        bishop, shuffled every game. Black’s back rank mirrors White’s.</li>
      <li>Capture a piece and it joins your <b>dropships</b>. On your turn you may
        drop it onto any empty square instead of moving.</li>
      <li>Win by <b>capturing the King</b>. There’s no checkmate, and nothing
        stops you walking into check, so watch out.</li>
      <li>Pawns move one square, never two. A pawn that reaches the far rank becomes a
        Queen, and turns back into a pawn if it’s captured. No castling, no en passant.</li>
      <li>You can’t drop a pawn into your opponent’s starting rows.</li>
      <li>If you have no legal move on your turn, you lose.</li>
      <li>No move may recreate a position that has already happened, so games can’t
        go round in circles.</li>
      <li>Tap <b>New</b> to play two players on one device, against the computer${
        SERVER_URL ? ', or online against a friend (3 minutes each, plus 2 seconds per move)' : ''}.</li>
    </ul>
    <form method="dialog"><button class="primary">Play</button></form>`;

  const confirmDialog = el('dialog', { className: 'sheet' });
  confirmDialog.innerHTML = `
    <h2>New game</h2>
    <p class="warn">The current game will be lost.</p>
    <form method="dialog" class="stack">
      <button value="pvp" class="primary">2 players, one device</button>
      <button value="ai" class="primary">vs computer</button>${
        SERVER_URL ? '<button value="online" class="primary">Online: invite a friend</button>' : ''}
      <button value="cancel">Cancel</button>
    </form>`;
  const warn = confirmDialog.querySelector<HTMLElement>('.warn')!;

  const gameEl = el('main', { className: 'game' }, hands.b.section, boardEl, hands.w.section);
  root.replaceChildren(
    header,
    el('div', { className: 'stage' }, gameEl, status, shareBtn, resignBtn, rematchBtn),
    helpDialog,
    confirmDialog,
  );

  // ---- State transitions ----
  const commit = (next: GameState) => {
    history = [...history, next].slice(-MAX_HISTORY);
    selection = null;
    saveHistory(store, history);
  };

  /** Positions that have occurred this game, for the no-repetition rule. */
  const seen = (): Seen =>
    new Set(online ? (online.view?.seen ?? []) : history.map(positionKey));

  const targets = (): number[] => {
    const s = current();
    if (!selection) return [];
    return selection.type === 'square'
      ? moveTargets(s, selection.sq, seen())
      : dropTargets(s, selection.kind, seen());
  };

  const activateSquare = (sq: number) => {
    const s = current();
    if (!canAct()) {
      if (!result()) {
        feedback.play('invalid');
        fx.shake(boardEl, 3);
      }
      return;
    }
    if (selection && targets().includes(sq)) {
      const move: Move =
        selection.type === 'square'
          ? { type: 'move', from: selection.sq, to: sq }
          : { type: 'drop', kind: selection.kind, to: sq };
      if (online?.view) {
        // Show the move straight away; the server's next snapshot is authoritative.
        const next = applyMove(s, move, seen());
        const clocks = liveClocks()!;
        const timed = online.view.running !== null; // first moves are untimed
        if (timed) clocks[s.turn] += INCREMENT_MS;
        online.view = {
          ...online.view,
          game: next,
          seen: [...(online.view.seen ?? []), positionKey(next)],
          clocks,
          running: timed && !next.winner ? next.turn : null,
          abortIn: null,
        };
        online.receivedAt = Date.now();
        online.conn.sendMove(move);
        selection = null;
      } else {
        commit(applyMove(s, move, seen()));
      }
    } else if (s.board[sq]?.colour === s.turn &&
               !(selection?.type === 'square' && selection.sq === sq)) {
      selection = { type: 'square', sq };
      feedback.play('select');
    } else if (s.board[sq] && s.board[sq]!.colour !== s.turn && !selection) {
      // Tapped an opponent's piece with nothing selected.
      feedback.play('invalid');
      fx.shake(pieces[sq], 3);
    } else {
      selection = null;
    }
    render();
  };

  const activateHand = (colour: Colour, kind: HandKind) => {
    const s = current();
    if (!canAct() || colour !== s.turn || s.hands[colour][kind] <= 0) return;
    selection =
      selection?.type === 'hand' && selection.kind === kind ? null : { type: 'hand', kind };
    if (selection) feedback.play('select');
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

  const leaveOnline = () => {
    if (!online) return;
    online.conn.close();
    online = null;
    const url = new URL(location.href);
    url.searchParams.delete('game');
    window.history.replaceState(null, '', url);
  };

  const startOnline = (id: string) => {
    leaveOnline();
    clearTimeout(aiTimer);
    selection = null;
    const url = new URL(location.href);
    url.searchParams.set('game', id);
    window.history.replaceState(null, '', url);
    online = {
      id,
      view: null,
      receivedAt: 0,
      status: 'connecting',
      flagClaimed: false,
      conn: connect(id, store, {
        onState(view, receivedAt) {
          if (!online) return;
          const prev = online.view;
          // Opponent joined, or a rematch began.
          if (prev && !view.result && ((!prev.started && view.started) || prev.result)) {
            feedback.play('start');
            selection = null;
          }
          online.view = view;
          online.receivedAt = receivedAt;
          online.flagClaimed = false;
          // Drop a selection the new position no longer supports.
          if (!canAct()) selection = null;
          render();
        },
        onStatus(st) {
          if (!online) return;
          online.status = st;
          render();
        },
        onError(message) {
          console.warn('server:', message);
        },
      }),
    };
    render();
  };

  const newGame = (ai: Colour | null) => {
    leaveOnline();
    clearTimeout(aiTimer);
    aiColour = ai;
    store.set(MODE_KEY, ai ?? 'pvp');
    history = [initialState(randomBackRank())];
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
      const move = chooseMove(current(), { seen: seen() });
      if (!move) return;
      commit(applyMove(current(), move, seen()));
      render();
    }, AI_DELAY_MS);
  };

  // ---- Rendering ----
  function render() {
    const s = current();
    const prevState = lastRendered;
    const tr = prevState && prevState !== s ? transition(prevState, s) : null;
    lastRendered = s;
    const t = new Set(targets());
    const movable = canAct();
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
      cl.toggle('movable', movable && p?.colour === s.turn);
      cell.setAttribute('aria-label', `${squareName(sq)}${
        p ? `, ${COLOUR_NAMES[p.colour].toLowerCase()} ${NAMES[p.kind]}` : ''
      }${t.has(sq) ? ', legal move' : ''}`);
    });

    const view = online?.view ?? null;
    const you = view?.you ?? null;
    const res = result();
    const flipped = you === 'b';
    boardEl.classList.toggle('flipped', flipped);
    gameEl.classList.toggle('flipped', flipped);

    (['w', 'b'] as const).forEach((colour) => {
      const { section, slots, title } = hands[colour];
      section.classList.toggle('active', online ? onlineTurn(view) === colour : !res && s.turn === colour);
      if (online && you) {
        title.textContent = colour === you ? 'Your dropships' : 'Opponent’s dropships';
      } else {
        title.textContent =
          aiColour === null || online ? `${COLOUR_NAMES[colour]}’s dropships`
          : colour === aiColour ? 'Computer’s dropships' : 'Your dropships';
      }
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

    renderClocks();
    const score = res?.winner === 'w' ? '1–0' : '0–1';
    shareBtn.hidden = true;
    resignBtn.hidden = !(online && you && view?.started && !res);
    rematchBtn.hidden = !(online && you && res);
    if (online && you && view && res) {
      // `rematch` is missing if an older server is still deployed.
      const mine = !!view.rematch?.[you];
      const theirs = !!view.rematch?.[other(you)];
      rematchBtn.textContent = mine ? 'Rematch requested…' : theirs ? 'Accept rematch' : 'Rematch';
      rematchBtn.disabled = mine;
    }
    if (online) {
      const opp = you ? other(you) : null;
      const how = res?.reason === 'time' ? 'on time'
        : res?.reason === 'resign' ? 'by resignation'
        : res?.reason === 'stuck' ? '(no legal moves left)' : 'by capturing the King';
      const turn = onlineTurn(view);
      if (!view) {
        status.textContent = 'Connecting…';
      } else if (res?.reason === 'aborted') {
        status.textContent = 'Game aborted: a first move wasn’t made in time.';
      } else if (res && res.winner) {
        status.textContent = you
          ? `${res.winner === you ? 'You win' : 'You lose'} ${how}, ${score}`
          : `${COLOUR_NAMES[res.winner]} wins ${how}, ${score}`;
      } else if (!view.started) {
        status.textContent = 'Waiting for your opponent to open the link…';
        shareBtn.hidden = you !== 'w';
      } else if (!you) {
        status.textContent = `Watching · ${COLOUR_NAMES[s.turn]} to move`;
      } else {
        status.textContent = `${turn === you ? 'Your move' : 'Opponent’s move'}${
          turn === you && checked.includes(you) ? ' · your King is under attack' : ''
        }${opp && !view.connected[opp] ? ' · opponent offline' : ''}`;
      }
      if (view && !res && view.abortIn !== null && view.started) {
        status.append(abortEl);
        renderAbort();
      }
      if (online.status !== 'open' && view) status.append(' · reconnecting…');
    } else if (s.winner && aiColour !== null) {
      status.textContent = `${s.winner === aiColour ? 'Computer wins' : 'You win'}${
        s.winBy === 'stuck' ? ' (no legal moves left)' : ''}, ${score}`;
    } else if (s.winner) {
      status.textContent = `${COLOUR_NAMES[s.winner]} wins${
        s.winBy === 'stuck' ? `: ${COLOUR_NAMES[other(s.winner)]} has no legal moves` : ''}, ${score}`;
    } else if (aiToMove()) {
      status.textContent = 'Computer is thinking…';
    } else {
      status.textContent = `${aiColour === null ? `${COLOUR_NAMES[s.turn]} to move` : 'Your move'}${
        checked.includes(s.turn) ? ' · your King is under attack' : ''
      }`;
    }
    status.classList.toggle('over', !!res);
    gameEl.classList.toggle('lost', !!res?.winner && me() !== null && res.winner !== me());
    document.title = online && you && onlineTurn(view) === you
      ? `● Your move · ${BASE_TITLE}`
      : res?.winner && me() ? `${res.winner === me() ? 'You win' : 'You lose'} · ${BASE_TITLE}` : BASE_TITLE;
    if (tr && prevState) playTransition(tr, prevState, s);
    // Celebrate (or commiserate) once when a game ends, however it ended.
    if (lastResult === null && res) celebrate(res);
    lastResult = res;
    // With the computer as White, undoing its opening move would just replay it.
    undoBtn.disabled = !!online || history.length <= (aiColour === 'w' ? 2 : 1);
    document.body.dataset.turn = s.turn;
    maybePlayAi();
  }

  /** Animation and sound for a single move, after the board has been redrawn. */
  function playTransition(tr: Transition, prev: GameState, s: GameState) {
    const { move, mover, captured } = tr;
    const to = cells[move.to];
    const mine = me() === null || mover === me();
    if (move.type === 'drop') {
      const slot = hands[mover].slots.get(move.kind)!.btn;
      void fx.dropIn(spriteUrl(mover, move.kind, PALETTE), slot, to, pieces[move.to])
        .then(() => fx.burst(to, DUST, 10));
    } else {
      const kind = prev.board[move.from]!.kind;
      void fx.slide(spriteUrl(mover, kind, PALETTE), cells[move.from], to, pieces[move.to]).then(() => {
        if (tr.promoted) {
          fx.burst(to, SPARKS, 16);
          fx.bump(pieces[move.to]);
        }
      });
      if (captured) {
        fx.burst(to, [...DUST, '#c4513b'], 14);
        if (captured.kind !== 'K') {
          const handKind = captured.promoted ? 'P' : (captured.kind as HandKind);
          const slot = hands[mover].slots.get(handKind)!.btn;
          void fx.captureTo(spriteUrl(mover, handKind, PALETTE), to, slot, slot.querySelector('img'));
        }
      }
    }
    if (s.winner) {
      fx.shake(boardEl, 10);
      return; // celebrate() plays the end-of-game sound
    }
    feedback.play(
      captured ? 'capture' : move.type === 'drop' ? 'drop' : tr.promoted ? 'promote' : 'move',
      { mine },
    );
    if (inCheck(s, s.turn)) setTimeout(() => feedback.play('check', { mine: false }), 200);
  }

  function celebrate(res: GameResult) {
    fx.bump(status);
    if (!res.winner) return; // aborted: nothing to celebrate
    const won = me() === null || res.winner === me();
    feedback.play(won ? 'win' : 'lose');
    if (won) setTimeout(() => fx.confetti(CONFETTI), 200);
  }

  /** The first-move countdown shown in the status line; asks the server to abort at zero. */
  function renderAbort() {
    const left = abortLeft();
    if (left === null) return;
    if (left <= 0 && online && !online.flagClaimed) {
      online.flagClaimed = true;
      online.conn.claimFlag();
    }
    const mine = online?.view && onlineTurn(online.view) === online.view.you;
    abortEl.textContent = ` · ${mine ? 'first move within' : 'first move due in'} ${Math.ceil(left / 1000)}s`;
    abortEl.classList.toggle('urgent', left < 10_000);
  }

  /** Updates the clock readouts; also asks the server to call a flag we can see. */
  function renderClocks() {
    const clocks = liveClocks();
    const running = online?.view?.running ?? null;
    for (const colour of ['w', 'b'] as const) {
      const { clock } = hands[colour];
      clock.hidden = !clocks;
      if (!clocks) continue;
      clock.textContent = formatClock(clocks[colour]);
      clock.classList.toggle('running', running === colour);
      clock.classList.toggle('low', clocks[colour] < 20_000);
      clock.classList.toggle('critical', running === colour && clocks[colour] < 10_000);
    }
    // Tick each second through your own last ten seconds.
    const you = online?.view?.you;
    if (clocks && you && running === you && clocks[you] > 0 && clocks[you] < 10_000) {
      const sec = Math.ceil(clocks[you] / 1000);
      if (sec !== lastTick) {
        lastTick = sec;
        feedback.play('tick');
      }
    }
    if (online && clocks && running && clocks[running] <= 0 && !online.flagClaimed) {
      online.flagClaimed = true;
      online.conn.claimFlag();
    }
  }
  setInterval(() => {
    if (online?.view?.running) renderClocks();
    if (online?.view?.abortIn != null) renderAbort();
  }, 100);

  // ---- Input ----
  boardEl.addEventListener('click', (e) => {
    const cell = (e.target as HTMLElement).closest<HTMLButtonElement>('.cell');
    if (!cell) return;
    activateSquare(Number(cell.dataset.sq));
  });
  for (const colour of ['w', 'b'] as const) {
    hands[colour].section.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.slot');
      if (btn) activateHand(colour, btn.dataset.kind as HandKind);
    });
  }
  undoBtn.addEventListener('click', undo);
  soundBtn.addEventListener('click', () => {
    feedback.setEnabled(!feedback.enabled);
    syncSoundBtn();
    if (feedback.enabled) feedback.play('select');
  });
  helpBtn.addEventListener('click', () => helpDialog.showModal());
  resignBtn.addEventListener('click', () => {
    if (online && window.confirm('Resign this game?')) online.conn.resign();
  });
  rematchBtn.addEventListener('click', () => online?.conn.rematch());
  shareBtn.addEventListener('click', async () => {
    const url = location.href;
    try {
      if (navigator.share) await navigator.share({ title: 'Dropship Chess', text: 'Play me at Dropship Chess', url });
      else {
        await navigator.clipboard.writeText(url);
        shareBtn.textContent = 'Link copied';
        setTimeout(() => (shareBtn.textContent = 'Share invite link'), 2000);
      }
    } catch {
      // Share sheet dismissed, or clipboard blocked: the link is still in the address bar.
    }
  });
  newBtn.addEventListener('click', () => {
    warn.textContent = online ? 'You’ll leave this online game.' : 'The current game will be lost.';
    warn.hidden = online ? !!result() : history.length <= 1 || !!current().winner;
    confirmDialog.returnValue = '';
    confirmDialog.showModal();
  });
  confirmDialog.addEventListener('close', () => {
    const v = confirmDialog.returnValue;
    if (v === 'online') startOnline(newGameId());
    else if (v === 'pvp') newGame(null);
    // The computer takes a random colour.
    else if (v === 'ai') newGame(Math.random() < 0.5 ? 'w' : 'b');
  });
  helpDialog.addEventListener('close', () => store.set(SEEN_HELP_KEY, '1'));

  const linkedGame = new URLSearchParams(location.search).get('game');
  if (SERVER_URL && linkedGame && GAME_ID.test(linkedGame)) startOnline(linkedGame);
  else render();
  if (!store.get(SEEN_HELP_KEY)) helpDialog.showModal();
}
