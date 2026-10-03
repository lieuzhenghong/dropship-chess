// Sound and haptic feedback, behind one small interface so a native wrapper
// (e.g. Capacitor Haptics) can replace the web implementation later.
//
// Sounds are synthesised with Web Audio (square waves and noise, in keeping
// with the 1-bit look), so there are no audio files to load. Vibration uses
// navigator.vibrate, which only Chromium-based browsers implement (Chrome,
// Samsung Internet, Edge...). It does nothing in Safari/iOS and, since
// version 129, in Firefox; real haptics there need the native app wrapper.

import type { KeyValueStore } from './storage';

export type FeedbackEvent =
  | 'select'
  | 'move'
  | 'capture'
  | 'drop'
  | 'promote'
  | 'check'
  | 'invalid'
  | 'start'
  | 'win'
  | 'lose'
  | 'tick';

export interface Feedback {
  /** `mine` is false for the opponent's (or computer's) moves, which buzz harder. */
  play(event: FeedbackEvent, opts?: { mine?: boolean }): void;
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
}

const ENABLED_KEY = 'dropship-chess:sound';

/** Vibration patterns in ms. Opponent moves get a stronger buzz: that's the notification. */
const VIBRATE: Partial<Record<FeedbackEvent, number | number[]>> = {
  capture: [18, 40, 18],
  drop: 25,
  promote: [15, 30, 15, 30, 15],
  check: [40, 60, 40],
  invalid: 12,
  start: [30, 60, 30],
  win: [30, 50, 30, 50, 90],
  lose: 150,
};

export function createWebFeedback(store: KeyValueStore): Feedback {
  let enabled = store.get(ENABLED_KEY) !== '0';
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;

  // Browsers only allow audio after a user gesture, so create or resume the
  // context on the first tap or key press (and again if it gets suspended).
  const unlock = () => {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
  };
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });

  function tone(
    freq: number,
    dur: number,
    { type = 'square', gain = 0.12, to, at = 0 }: { type?: OscillatorType; gain?: number; to?: number; at?: number } = {},
  ) {
    if (!ctx || !master) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noise(dur: number, { gain = 0.15, cutoff = 2000, at = 0 } = {}) {
    if (!ctx || !master) return;
    const t = ctx.currentTime + at;
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const env = ctx.createGain();
    env.gain.value = gain;
    src.connect(filter).connect(env).connect(master);
    src.start(t);
  }

  const SOUNDS: Record<FeedbackEvent, () => void> = {
    select: () => tone(1320, 0.025, { gain: 0.05 }),
    move: () => {
      tone(520, 0.05, { gain: 0.1, to: 380 });
      noise(0.03, { gain: 0.06, cutoff: 1200 });
    },
    capture: () => {
      noise(0.12, { gain: 0.22, cutoff: 3000 });
      tone(300, 0.12, { gain: 0.12, to: 120 });
    },
    // A dropship coming in to land: falling whistle, then a thud.
    drop: () => {
      tone(1400, 0.12, { gain: 0.06, to: 300, type: 'triangle' });
      noise(0.08, { gain: 0.2, cutoff: 700, at: 0.11 });
      tone(140, 0.08, { gain: 0.12, at: 0.11 });
    },
    promote: () => [660, 880, 1320].forEach((f, i) => tone(f, 0.09, { gain: 0.09, at: i * 0.07 })),
    check: () => {
      tone(880, 0.08, { gain: 0.08 });
      tone(660, 0.12, { gain: 0.08, at: 0.1 });
    },
    invalid: () => tone(110, 0.09, { gain: 0.1, type: 'sawtooth' }),
    start: () => [523, 659, 784].forEach((f, i) => tone(f, 0.08, { gain: 0.08, at: i * 0.08 })),
    win: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) =>
      tone(f, i === 5 ? 0.3 : 0.1, { gain: 0.09, at: i * 0.09 })),
    lose: () => [392, 330, 262, 196].forEach((f, i) =>
      tone(f, i === 3 ? 0.35 : 0.14, { gain: 0.09, type: 'triangle', at: i * 0.15 })),
    tick: () => tone(1800, 0.015, { gain: 0.05 }),
  };

  return {
    get enabled() {
      return enabled;
    },
    setEnabled(on) {
      enabled = on;
      store.set(ENABLED_KEY, on ? '1' : '0');
      if (on) unlock();
    },
    play(event, { mine = true } = {}) {
      if (!enabled) return;
      try {
        SOUNDS[event]();
      } catch {
        // Audio is best-effort.
      }
      const pattern = VIBRATE[event] ?? (event === 'move' && !mine ? 30 : event === 'move' ? 8 : undefined);
      if (pattern !== undefined && 'vibrate' in navigator) {
        try {
          navigator.vibrate(pattern);
        } catch {
          // Some browsers throw if vibration is blocked; ignore.
        }
      }
    },
  };
}
