/**
 * The audio engine: one lazily created AudioContext behind a master gain.
 *
 * Audio never starts on its own. The context is made, and resumed, only after a user gesture
 * (pointer, touch, click or key press anywhere on the page); iPad Safari and Chrome both refuse
 * sound before one. Until then, and wherever Web Audio does not exist (tests, old browsers),
 * `graph()` returns null and every sound is a quiet no-op.
 *
 * `setEnabled(false)` ramps the master to silence and then suspends the context, so a muted game
 * costs nothing. A hidden tab suspends it too.
 */

export interface AudioGraph {
  readonly ctx: AudioContext;
  /** Everything audible connects here. */
  readonly master: GainNode;
}

export interface AudioEngine {
  /**
   * The running graph, or null when sound cannot play right now: no gesture yet, muted, tab hidden,
   * context not running, or no Web Audio. Callers must treat null as "do nothing".
   */
  graph(): AudioGraph | null;
  isEnabled(): boolean;
  /** Mute or unmute. Off ramps to silence, then suspends. Safe before any gesture. */
  setEnabled(enabled: boolean): void;
  /** Called whenever `graph()` may have changed (unlock, mute, hidden tab, context state). */
  onChange(listener: () => void): () => void;
  dispose(): void;
}

type EngineTarget = Pick<Document, 'addEventListener' | 'removeEventListener'> & { readonly hidden?: boolean };

export interface EngineOptions {
  /** Makes the context. Defaults to the browser AudioContext (or webkitAudioContext). Tests pass a stub. */
  createContext?: () => AudioContext | null;
  /** Where gestures and visibility changes are heard. Defaults to `document`; null listens to nothing. */
  target?: EngineTarget | null;
}

/**
 * Events that count as a user gesture. Pointer-up, touch-end and click are listed as well as
 * pointer-down and key-down because iOS Safari only unlocks audio on those.
 */
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;

const MASTER_LEVEL = 1;
const RAMP_SECONDS = 0.08;
const SUSPEND_AFTER_MS = 140;

function defaultCreateContext(): AudioContext | null {
  const scope = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

export function createAudioEngine(options: EngineOptions = {}): AudioEngine {
  const create = options.createContext ?? defaultCreateContext;
  const target: EngineTarget | null =
    options.target === undefined ? (typeof document === 'undefined' ? null : document) : options.target;

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let current: AudioGraph | null = null;
  let enabled = true;
  let gestureSeen = false;
  let unavailable = false;
  let masterTarget = -1;
  let suspendTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  const hidden = (): boolean => target?.hidden === true;

  function notify(): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.warn('audio listener failed', error);
      }
    }
  }

  function ensureContext(): AudioContext | null {
    if (ctx) return ctx;
    if (unavailable) return null;
    const made = create();
    if (!made) {
      unavailable = true;
      return null;
    }
    ctx = made;
    master = made.createGain();
    master.gain.value = 0;
    master.connect(made.destination);
    made.onstatechange = notify;
    current = { ctx: made, master };
    return made;
  }

  function rampMaster(to: number): void {
    if (!ctx || !master || masterTarget === to) return;
    masterTarget = to;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(to, now + RAMP_SECONDS);
  }

  function resume(): void {
    if (!ctx || ctx.state === 'running') return;
    // Not guarded against overlap: on iOS Safari a resume() made outside a gesture can stay pending
    // forever, and the next gesture must still be free to try again.
    try {
      // Old Safari returns undefined here.
      Promise.resolve(ctx.resume()).then(notify, () => {});
    } catch {
      // Closed or unusable: stay silent.
    }
  }

  function suspend(c: AudioContext): void {
    try {
      Promise.resolve(c.suspend()).catch(() => {});
    } catch {
      // Nothing to do: the context is already unusable.
    }
  }

  /** Make the context, bring the master up and resume, when sound is allowed right now. */
  function activate(): void {
    if (!enabled || !gestureSeen || hidden()) return;
    if (!ensureContext()) return;
    rampMaster(MASTER_LEVEL);
    resume();
  }

  function onGesture(): void {
    const first = !gestureSeen;
    gestureSeen = true;
    activate();
    if (first) notify();
  }

  function onVisibility(): void {
    if (hidden()) {
      if (ctx && ctx.state === 'running') suspend(ctx);
    } else {
      activate();
    }
    notify();
  }

  const listen = { capture: true, passive: true } as const;
  if (target) {
    for (const name of GESTURES) target.addEventListener(name, onGesture, listen);
    target.addEventListener('visibilitychange', onVisibility);
  }

  return {
    graph() {
      if (!current || !enabled || !gestureSeen || hidden() || current.ctx.state !== 'running') return null;
      return current;
    },
    isEnabled: () => enabled,
    setEnabled(next) {
      if (next === enabled) return;
      enabled = next;
      if (suspendTimer !== undefined) {
        clearTimeout(suspendTimer);
        suspendTimer = undefined;
      }
      if (next) {
        activate();
      } else if (ctx) {
        rampMaster(0);
        const c = ctx;
        suspendTimer = setTimeout(() => {
          suspendTimer = undefined;
          if (!enabled) suspend(c);
        }, SUSPEND_AFTER_MS);
      }
      notify();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (target) {
        for (const name of GESTURES) target.removeEventListener(name, onGesture, listen);
        target.removeEventListener('visibilitychange', onVisibility);
      }
      if (suspendTimer !== undefined) clearTimeout(suspendTimer);
      listeners.clear();
      const c = ctx;
      ctx = null;
      master = null;
      current = null;
      if (c) {
        try {
          Promise.resolve(c.close()).catch(() => {});
        } catch {
          // Already closed.
        }
      }
    },
  };
}

let shared: AudioEngine | undefined;

/** The one engine the running game uses, made on first use. */
export function getAudioEngine(): AudioEngine {
  shared ??= createAudioEngine();
  return shared;
}
