// Visual effects ("juice"): pieces sliding, flying to and from the dropship
// trays, particle bursts, shakes and confetti.
//
// Everything is drawn on a fixed overlay in viewport coordinates, so it works
// unchanged when the board is rotated for Black. All effects are skipped
// when the user prefers reduced motion.

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let layer: HTMLDivElement | null = null;
function fxLayer(): HTMLDivElement {
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'fx-layer';
    document.body.append(layer);
  }
  return layer;
}

/** An absolutely positioned sprite sitting exactly over `rect`. */
function ghost(url: string, rect: DOMRect): HTMLDivElement {
  const g = document.createElement('div');
  g.className = 'fx-ghost';
  Object.assign(g.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    backgroundImage: `url(${url})`,
  });
  fxLayer().append(g);
  return g;
}

const delta = (from: DOMRect, to: DOMRect) =>
  `${from.left + from.width / 2 - (to.left + to.width / 2)}px ${from.top + from.height / 2 - (to.top + to.height / 2)}px`;

/** Hides `el` while `anim` runs, then restores it. */
function hideDuring(el: HTMLElement | null, anim: Animation) {
  if (!el) return;
  el.style.visibility = 'hidden';
  const restore = () => (el.style.visibility = '');
  anim.addEventListener('finish', restore);
  anim.addEventListener('cancel', restore);
}

/** Slides a piece sprite from one cell to another; `landing` is hidden until it arrives. */
export function slide(url: string, from: Element, to: Element, landing: HTMLElement): Promise<void> {
  if (reducedMotion()) return Promise.resolve();
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const g = ghost(url, b);
  const anim = g.animate(
    [
      { translate: delta(a, b), scale: '1.08' },
      { translate: '0 0', scale: '1' },
    ],
    { duration: 170, easing: 'cubic-bezier(.2,.8,.3,1)' },
  );
  hideDuring(landing, anim);
  return anim.finished.then(() => g.remove(), () => g.remove());
}

/** A piece leaves the tray and lands on the board with a little bounce. */
export function dropIn(url: string, from: Element, to: Element, landing: HTMLElement): Promise<void> {
  if (reducedMotion()) return Promise.resolve();
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const g = ghost(url, b);
  const anim = g.animate(
    [
      { translate: delta(a, b), scale: '0.7', offset: 0 },
      { translate: '0 -18%', scale: '1.25', offset: 0.65 },
      { translate: '0 0', scale: '0.92', offset: 0.85 },
      { translate: '0 0', scale: '1', offset: 1 },
    ],
    { duration: 300, easing: 'ease-out' },
  );
  hideDuring(landing, anim);
  return anim.finished.then(() => g.remove(), () => g.remove());
}

/** A captured piece pops off the board and flies into the capturer's tray slot. */
export function captureTo(url: string, from: Element, slot: Element, slotImg: HTMLElement | null): Promise<void> {
  if (reducedMotion()) return Promise.resolve();
  const a = from.getBoundingClientRect();
  const b = slot.getBoundingClientRect();
  const g = ghost(url, b);
  const anim = g.animate(
    [
      { translate: delta(a, b), scale: `${a.width / b.width}`, rotate: '0deg', offset: 0 },
      { translate: delta(a, b), scale: `${(a.width / b.width) * 1.2}`, rotate: '-12deg', offset: 0.2 },
      { translate: '0 0', scale: '1', rotate: '0deg', offset: 1 },
    ],
    { duration: 420, delay: 60, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'backwards' },
  );
  hideDuring(slotImg, anim);
  return anim.finished.then(() => {
    g.remove();
    bump(slot);
  }, () => g.remove());
}

/** Square pixel particles bursting out of an element's centre. */
export function burst(at: Element, colours: string[], count = 12): void {
  if (reducedMotion()) return;
  const r = at.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const size = Math.max(3, Math.round(r.width / 14));
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'fx-particle';
    Object.assign(p.style, {
      left: `${cx}px`,
      top: `${cy}px`,
      width: `${size}px`,
      height: `${size}px`,
      background: colours[i % colours.length],
    });
    fxLayer().append(p);
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const dist = r.width * (0.45 + Math.random() * 0.45);
    p.animate(
      [
        { translate: '-50% -50%', opacity: 1 },
        { translate: `calc(-50% + ${Math.cos(angle) * dist}px) calc(-50% + ${Math.sin(angle) * dist}px)`, opacity: 0 },
      ],
      { duration: 380 + Math.random() * 200, easing: 'cubic-bezier(.2,.7,.4,1)' },
    ).finished.then(() => p.remove(), () => p.remove());
  }
}

/** A quick scale pop, e.g. when a tray slot gains a piece. */
export function bump(el: Element): void {
  if (reducedMotion()) return;
  el.animate([{ scale: '1' }, { scale: '1.22' }, { scale: '1' }], { duration: 220, easing: 'ease-out' });
}

/** Horizontal shake: small for a rejected tap, big for a King capture. */
export function shake(el: Element, strength = 4): void {
  if (reducedMotion()) return;
  const s = strength;
  el.animate(
    [
      { translate: '0 0' },
      { translate: `${-s}px 0` },
      { translate: `${s}px 0` },
      { translate: `${-s / 2}px ${s / 3}px` },
      { translate: `${s / 2}px ${-s / 3}px` },
      { translate: '0 0' },
    ],
    { duration: strength > 6 ? 420 : 220, easing: 'ease-out' },
  );
}

/** Pixel confetti falling from the top of the screen. */
export function confetti(colours: string[], count = 70): void {
  if (reducedMotion()) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'fx-particle';
    const size = 5 + Math.round(Math.random() * 5);
    Object.assign(p.style, {
      left: `${Math.random() * w}px`,
      top: `${-20 - Math.random() * h * 0.3}px`,
      width: `${size}px`,
      height: `${size}px`,
      background: colours[i % colours.length],
    });
    fxLayer().append(p);
    const drift = (Math.random() - 0.5) * 160;
    p.animate(
      [
        { translate: '0 0', rotate: '0deg', opacity: 1 },
        { translate: `${drift}px ${h * (0.9 + Math.random() * 0.4)}px`, rotate: `${(Math.random() - 0.5) * 720}deg`, opacity: 0.9 },
      ],
      { duration: 1400 + Math.random() * 1200, delay: Math.random() * 400, easing: 'cubic-bezier(.3,.1,.6,1)', fill: 'backwards' },
    ).finished.then(() => p.remove(), () => p.remove());
  }
}
