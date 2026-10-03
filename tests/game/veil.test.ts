// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVeil, VEIL_FADE_MS } from '../../src/game/veil';
import { makeHost } from '../ui/helpers';

afterEach(() => {
  vi.useRealTimers();
});

describe('veil', () => {
  it('is a clear, aria-hidden layer in #ui until it is asked to cover the screen', () => {
    const host = makeHost();
    const veil = createVeil(host);
    expect(host.contains(veil.root)).toBe(true);
    expect(veil.root.classList.contains('tq-veil')).toBe(true);
    expect(veil.root.getAttribute('aria-hidden')).toBe('true');
    expect(veil.root.classList.contains('is-up')).toBe(false);
  });

  it('fades out over 300 ms and back in over 300 ms', async () => {
    vi.useFakeTimers();
    const veil = createVeil(makeHost(), { reducedMotion: () => false });
    expect(VEIL_FADE_MS).toBe(300);

    let covered = false;
    const out = veil.fadeOut().then(() => (covered = true));
    expect(veil.root.classList.contains('is-up')).toBe(true);
    expect(veil.root.style.transitionDuration).toBe('300ms');
    await vi.advanceTimersByTimeAsync(299);
    expect(covered).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await out;
    expect(covered).toBe(true);

    let clear = false;
    const back = veil.fadeIn().then(() => (clear = true));
    expect(veil.root.classList.contains('is-up')).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    await back;
    expect(clear).toBe(true);
  });

  it('cuts instantly under reduced motion: no waiting and no transition', async () => {
    vi.useFakeTimers();
    const veil = createVeil(makeHost(), { reducedMotion: () => true });
    await veil.fadeOut(); // resolves without any timer running
    expect(veil.root.classList.contains('is-up')).toBe(true);
    expect(veil.root.style.transitionDuration).toBe('0ms');
    await veil.fadeIn();
    expect(veil.root.classList.contains('is-up')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reads prefers-reduced-motion from the browser by default', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query }) as MediaQueryList) as typeof window.matchMedia;
    try {
      const veil = createVeil(makeHost());
      await veil.fadeOut();
      expect(veil.root.style.transitionDuration).toBe('0ms');
    } finally {
      window.matchMedia = original;
    }
  });
});
