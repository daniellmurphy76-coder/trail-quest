import { describe, expect, it } from 'vitest';
import { MAX_STEPS_PER_FRAME, STEP, advanceAccumulator } from '../../src/engine/loop-math';

describe('advanceAccumulator', () => {
  it('runs one step per 1/60 s and carries the remainder', () => {
    const r = advanceAccumulator(0, STEP * 1.5);
    expect(r.steps).toBe(1);
    expect(r.accumulator).toBeCloseTo(STEP * 0.5, 12);
  });

  it('skips steps on a frame faster than one step (120 Hz display), then catches up', () => {
    let acc = 0;
    let total = 0;
    for (let i = 0; i < 120; i++) {
      const r = advanceAccumulator(acc, 1 / 120);
      acc = r.accumulator;
      total += r.steps;
    }
    expect(total).toBeGreaterThanOrEqual(59);
    expect(total).toBeLessThanOrEqual(60);
  });

  it('caps a long frame at 5 steps and drops the backlog', () => {
    const r = advanceAccumulator(0, 0.2);
    expect(r.steps).toBe(MAX_STEPS_PER_FRAME);
    expect(r.accumulator).toBeGreaterThanOrEqual(0);
    expect(r.accumulator).toBeLessThan(STEP);
  });

  it('treats a huge pause (backgrounded tab) as a 0.25 s frame at most', () => {
    expect(advanceAccumulator(0, 30).steps).toBe(MAX_STEPS_PER_FRAME);
  });

  it('ignores negative time', () => {
    expect(advanceAccumulator(0, -1)).toEqual({ steps: 0, accumulator: 0 });
  });
});
