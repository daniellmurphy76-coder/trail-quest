import { describe, expect, it } from 'vitest';
import { damp, dampAngle, dampFactor, shortestAngle, wrapAngle } from '../../src/engine/damp';

/** Run `total` seconds of damping in `steps` equal steps. */
function run(from: number, to: number, k: number, total: number, steps: number): number {
  let v = from;
  for (let i = 0; i < steps; i++) v = damp(v, to, k, total / steps);
  return v;
}

describe('damp', () => {
  it('is frame-rate independent: one 1.0 s step equals ten 0.1 s steps', () => {
    const one = run(0, 10, 6, 1, 1);
    expect(run(0, 10, 6, 1, 10)).toBeCloseTo(one, 9);
    expect(run(0, 10, 6, 1, 60)).toBeCloseTo(one, 9);
  });

  it('matches the closed form 1 - exp(-k t)', () => {
    expect(run(0, 1, 4, 0.5, 30)).toBeCloseTo(1 - Math.exp(-2), 9);
  });

  it('moves toward the target and never overshoots, even with a huge step', () => {
    const v = damp(0, 5, 10, 100);
    expect(v).toBeGreaterThan(4.99);
    expect(v).toBeLessThanOrEqual(5);
    expect(damp(5, 5, 10, 0.016)).toBe(5);
  });

  it('does nothing for a zero step', () => {
    expect(damp(1, 9, 6, 0)).toBe(1);
    expect(dampFactor(6, 0)).toBe(0);
  });
});

describe('angles', () => {
  it('wrapAngle lands in (-PI, PI]', () => {
    expect(wrapAngle(0)).toBeCloseTo(0, 12);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(Math.PI * 2 + 0.5)).toBeCloseTo(0.5, 12);
    expect(wrapAngle(-Math.PI * 2 - 0.5)).toBeCloseTo(-0.5, 12);
  });

  it('shortestAngle takes the short way around', () => {
    expect(shortestAngle(0.1, -0.1)).toBeCloseTo(-0.2, 12);
    expect(shortestAngle(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 12);
    expect(shortestAngle(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2, 12);
  });

  it('dampAngle is frame-rate independent across the wrap seam', () => {
    const from = Math.PI - 0.2;
    const to = -Math.PI + 0.2; // 0.4 rad away, through the seam
    const run1s = (n: number): number => {
      let a = from;
      for (let i = 0; i < n; i++) a = dampAngle(a, to, 5, 1 / n);
      return a;
    };
    const one = run1s(1);
    expect(wrapAngle(run1s(10) - one)).toBeCloseTo(0, 9);
    expect(wrapAngle(run1s(60) - one)).toBeCloseTo(0, 9);
  });
});
