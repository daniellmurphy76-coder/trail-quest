/**
 * A frame loop that prefers `requestAnimationFrame` and falls back to `setInterval` when it is
 * not available. `stop()` cancels whichever one is running; it is safe to call more than once.
 */
export interface Ticker {
  start(): void;
  stop(): void;
  readonly running: boolean;
}

/** About 25 frames a second: plenty for a pulse when there is no animation clock. */
const FALLBACK_MS = 40;

export function createTicker(onFrame: () => void, fallbackMs = FALLBACK_MS): Ticker {
  let running = false;
  let frameId: number | undefined;
  let intervalId: ReturnType<typeof setInterval> | undefined;

  const loop = (): void => {
    frameId = undefined;
    if (!running) return;
    onFrame();
    if (running) frameId = globalThis.requestAnimationFrame(loop);
  };

  return {
    get running() {
      return running;
    },
    start() {
      if (running) return;
      running = true;
      if (typeof globalThis.requestAnimationFrame === 'function') {
        frameId = globalThis.requestAnimationFrame(loop);
      } else {
        intervalId = setInterval(onFrame, fallbackMs);
      }
    },
    stop() {
      running = false;
      if (frameId !== undefined) {
        if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(frameId);
        frameId = undefined;
      }
      if (intervalId !== undefined) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
    },
  };
}
