// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  burstConfetti,
  CONFETTI_COLORS,
  CONFETTI_MS,
  CONFETTI_PIECES,
  installEffects,
  prefersReducedMotion,
} from '../../src/game/effects';
import { createEventBus } from '../../src/game/events';
import { mulberry32 } from '../../src/engine/seed';
import { makeHost } from '../ui/helpers';

/** A canvas context that only counts what is drawn. */
function fakeContext() {
  const fills: string[] = [];
  const ctx = {
    fillStyle: '' as string,
    globalAlpha: 1,
    scale: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    fillRect: vi.fn(function (this: { fillStyle: string }) {
      fills.push(this.fillStyle);
    }),
  };
  return { ctx, fills };
}

let host: HTMLElement;
let getContext: ReturnType<typeof vi.spyOn>;
let drawing: ReturnType<typeof fakeContext>;
let reduced = false;

const canvases = (): HTMLCanvasElement[] => Array.from(host.querySelectorAll('canvas'));

beforeEach(() => {
  host = makeHost();
  reduced = false;
  drawing = fakeContext();
  getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => drawing.ctx) as never);
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) => ({ matches: reduced && query.includes('prefers-reduced-motion'), media: query }) as MediaQueryList,
  );
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'],
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('burstConfetti', () => {
  it('draws about 80 pieces on a full-screen canvas inside the host, for 1.2 seconds', () => {
    expect(CONFETTI_MS).toBe(1200);
    expect(CONFETTI_PIECES).toBe(80);
    const end = burstConfetti(host, { random: mulberry32(3) });
    expect(end).toBeTypeOf('function');
    expect(canvases()).toHaveLength(1);
    const canvas = canvases()[0]!;
    expect(canvas.parentElement).toBe(host);
    expect(canvas.classList.contains('tq-confetti')).toBe(true);
    // The first frame is drawn at once: every piece, in the UI palette.
    expect(drawing.fills).toHaveLength(CONFETTI_PIECES);
    for (const color of new Set(drawing.fills)) expect(CONFETTI_COLORS as readonly string[]).toContain(color);

    vi.advanceTimersByTime(CONFETTI_MS - 100);
    expect(canvases()).toHaveLength(1); // still falling
    vi.advanceTimersByTime(300);
    expect(canvases()).toHaveLength(0); // gone
  });

  it('never takes a tap: pointer-events is none, inline, so #ui > * cannot turn it back on', () => {
    burstConfetti(host);
    const canvas = canvases()[0]!;
    expect(canvas.style.pointerEvents).toBe('none');
    expect(canvas.getAttribute('aria-hidden')).toBe('true'); // decoration only
  });

  it('keeps animating while it lasts, so the pieces move', () => {
    burstConfetti(host, { random: mulberry32(5) });
    const first = drawing.ctx.fillRect.mock.calls.length;
    vi.advanceTimersByTime(160);
    expect(drawing.ctx.fillRect.mock.calls.length).toBeGreaterThan(first);
    expect(drawing.ctx.clearRect).toHaveBeenCalled();
  });

  it('is skipped under prefers-reduced-motion: no canvas, nothing drawn', () => {
    reduced = true;
    expect(prefersReducedMotion()).toBe(true);
    expect(burstConfetti(host)).toBeNull();
    expect(canvases()).toHaveLength(0);
    expect(getContext).not.toHaveBeenCalled();
    expect(drawing.ctx.fillRect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CONFETTI_MS + 500);
    expect(canvases()).toHaveLength(0);
  });

  it('draws again as soon as reduced motion is off', () => {
    reduced = true;
    expect(burstConfetti(host)).toBeNull();
    reduced = false;
    expect(prefersReducedMotion()).toBe(false);
    expect(burstConfetti(host)).not.toBeNull();
    expect(canvases()).toHaveLength(1);
  });

  it('draws nothing, and does not throw, when the browser has no canvas drawing', () => {
    getContext.mockImplementation((() => null) as never);
    expect(burstConfetti(host)).toBeNull();
    expect(canvases()).toHaveLength(0);
  });

  it('can be ended early, and ending twice is harmless', () => {
    const end = burstConfetti(host)!;
    end();
    expect(canvases()).toHaveLength(0);
    expect(() => end()).not.toThrow();
    vi.advanceTimersByTime(CONFETTI_MS + 500);
    expect(canvases()).toHaveLength(0);
  });

  it('still clears itself when the frames stop coming', () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    try {
      burstConfetti(host);
      vi.advanceTimersByTime(CONFETTI_MS + 300);
      expect(canvases()).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('installEffects', () => {
  it.each([
    [{ type: 'badge-earned', adventureId: 'wolf.test-camp' } as const],
    [{ type: 'trail-complete', stops: 3 } as const],
    [{ type: 'cosmetic-unlocked', id: 'hat-scout' } as const],
  ])('fires confetti on %j', (event) => {
    const bus = createEventBus();
    installEffects(host, bus);
    bus.emit(event);
    expect(canvases()).toHaveLength(1);
  });

  it('stays quiet for every other event', () => {
    const bus = createEventBus();
    installEffects(host, bus);
    for (const event of [
      { type: 'ui-tap' },
      { type: 'answer-right' },
      { type: 'activity-complete', activityType: 'quiz' },
      { type: 'stop-complete', kind: 'warm-up', xp: 10 },
      { type: 'title-earned', title: 'Trail Walker' },
      { type: 'mission-approved', requirementId: 'x' },
      { type: 'session-start' },
      { type: 'session-end' },
    ] as const) {
      bus.emit(event);
    }
    expect(canvases()).toHaveLength(0);
  });

  it('replaces a burst that is still falling instead of stacking canvases', () => {
    const bus = createEventBus();
    installEffects(host, bus);
    bus.emit({ type: 'badge-earned', adventureId: 'a' });
    vi.advanceTimersByTime(200);
    bus.emit({ type: 'cosmetic-unlocked', id: 'hat-scout' });
    expect(canvases()).toHaveLength(1);
  });

  it('respects reduced motion on every event', () => {
    reduced = true;
    const bus = createEventBus();
    installEffects(host, bus);
    bus.emit({ type: 'badge-earned', adventureId: 'a' });
    bus.emit({ type: 'trail-complete', stops: 3 });
    expect(canvases()).toHaveLength(0);
  });

  it('stops listening when it is turned off', () => {
    const bus = createEventBus();
    const off = installEffects(host, bus);
    off();
    bus.emit({ type: 'trail-complete', stops: 3 });
    expect(canvases()).toHaveLength(0);
  });

  it('turning it off also takes down a burst that is still falling', () => {
    const bus = createEventBus();
    const off = installEffects(host, bus);
    bus.emit({ type: 'badge-earned', adventureId: 'a' });
    expect(canvases()).toHaveLength(1);
    off();
    expect(canvases()).toHaveLength(0);
    vi.advanceTimersByTime(CONFETTI_MS + 300); // its timers are gone too: nothing runs on
    expect(canvases()).toHaveLength(0);
  });
});
