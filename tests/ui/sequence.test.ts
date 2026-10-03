// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { sequenceActivity } from '../../src/activities/sequence';
import { shuffleSteps } from '../../src/activities/sequence/shuffle';
import type { SequenceParams } from '../../src/activities/types';
import { buttonByText, makeCtx, makeHost } from './helpers';

const PARAMS: SequenceParams = {
  prompt: 'Help Zip make a pretend sandwich.',
  steps: ['Get bread', 'Spread jam', 'Add cheese', 'Close it', 'Take a bite'],
};

let host: HTMLElement;
beforeEach(() => {
  host = makeHost();
});

const tile = (text: string): HTMLButtonElement | undefined =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('.tq-tile')).find((b) => b.textContent === text);
const placed = (): number => host.querySelectorAll('.tq-lane__slot.is-filled').length;

describe('shuffleSteps', () => {
  it('is deterministic, keeps every step, and is never the correct order', () => {
    const a = shuffleSteps(PARAMS.steps);
    expect(shuffleSteps(PARAMS.steps)).toEqual(a);
    expect([...a].sort()).toEqual([...PARAMS.steps].sort());
    expect(a).not.toEqual(PARAMS.steps);
  });

  it('handles tiny inputs', () => {
    expect(shuffleSteps([])).toEqual([]);
    expect(shuffleSteps(['only'])).toEqual(['only']);
    expect(shuffleSteps(['a', 'b'])).toEqual(['b', 'a']);
  });
});

describe('sequenceActivity', () => {
  it('shows the prompt, every step as a tile, and an empty numbered lane', async () => {
    const ctx = makeCtx();
    const result = sequenceActivity.run(host, PARAMS, ctx);
    expect(host.textContent).toContain(PARAMS.prompt);
    expect(host.textContent).toContain('Your order');
    expect(host.querySelectorAll('.tq-tile')).toHaveLength(5);
    expect(host.querySelectorAll('.tq-lane__slot')).toHaveLength(5);
    expect(placed()).toBe(0);
    expect(ctx.speak).not.toHaveBeenCalled();
    // The tiles are shuffled, not in the answer order.
    const shown = Array.from(host.querySelectorAll('.tq-tile')).map((b) => b.textContent);
    expect(shown).not.toEqual(PARAMS.steps);
    buttonByText(host, 'Back').click();
    await result;
  });

  it('completes when every step is placed in order, with a perfect score', async () => {
    const result = sequenceActivity.run(host, PARAMS, makeCtx());
    PARAMS.steps.forEach((step, i) => {
      tile(step)!.click();
      expect(placed()).toBe(i + 1);
      expect(tile(step)).toBeUndefined(); // moved out of the pool
    });
    expect(host.textContent).toContain('Yes!');
    buttonByText(host, 'Next').click();
    await expect(result).resolves.toEqual({ completed: true, attempts: 5, score: 1 });
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('shows a "Yes!" flash when the right step is tapped', async () => {
    const result = sequenceActivity.run(host, PARAMS, makeCtx());
    tile('Get bread')!.click();
    expect(host.querySelector('.tq-banner--yes')).not.toBeNull();
    expect(host.querySelector('.tq-lane__slot.is-filled')?.textContent).toContain('Get bread');
    buttonByText(host, 'Back').click();
    await result;
  });

  it('shakes and says "Not yet" for a wrong tap, keeps the tile, and counts the wrong tap', async () => {
    const result = sequenceActivity.run(host, PARAMS, makeCtx());
    const wrong = tile('Close it')!;
    wrong.click();
    expect(host.textContent).toContain('Not yet');
    expect(host.querySelector('.tq-banner--notyet')).not.toBeNull();
    expect(wrong.classList.contains('is-shaking')).toBe(true);
    expect(tile('Close it')).toBe(wrong); // still there
    expect(placed()).toBe(0);

    PARAMS.steps.forEach((step) => tile(step)!.click());
    buttonByText(host, 'Next').click();
    const outcome = await result;
    expect(outcome.completed).toBe(true);
    expect(outcome.attempts).toBe(6);
    expect(outcome.score).toBeCloseTo(1 - 1 / 5);
  });

  it('clamps the score at 0 when there are many wrong taps', async () => {
    const result = sequenceActivity.run(host, { prompt: 'Two steps.', steps: ['First', 'Second'] }, makeCtx());
    for (let i = 0; i < 5; i++) tile('Second')?.click();
    tile('First')!.click();
    tile('Second')!.click();
    buttonByText(host, 'Next').click();
    const outcome = await result;
    expect(outcome.attempts).toBe(7);
    expect(outcome.score).toBe(0);
  });

  it('lets the player back out without completing', async () => {
    const result = sequenceActivity.run(host, PARAMS, makeCtx());
    tile('Get bread')!.click();
    buttonByText(host, 'Back').click();
    await expect(result).resolves.toEqual({ completed: false, attempts: 1 });
  });
});
