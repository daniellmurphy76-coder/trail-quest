// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { craftActivity } from '../../src/activities/craft';
import { SAMPLE_CRAFT } from '../../src/activities/craft/sample';
import type { CraftParams } from '../../src/activities/types';
import { buttonByText, makeCtx, makeHost, press } from './helpers';

const PARAMS: CraftParams = {
  prompt: 'Help Zip pack a day bag.',
  result: 'day bag',
  ingredients: [
    { id: 'water', label: 'Water bottle' },
    { id: 'snack', label: 'Trail snack' },
    { id: 'light', label: 'Flashlight' },
    { id: 'hat', label: 'Sun hat' },
  ],
  distractors: [
    { id: 'ball', label: 'Bowling ball' },
    { id: 'fish', label: 'Goldfish bowl' },
    { id: 'sofa', label: 'Big sofa' },
  ],
};

let host: HTMLElement;
beforeEach(() => {
  host = makeHost();
});

const chip = (label: string): HTMLButtonElement | undefined =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('.tq-chip')).find((b) => b.textContent === label);
const chipLabels = (): (string | null)[] => Array.from(host.querySelectorAll('.tq-chip')).map((b) => b.textContent);
const filled = (): number => host.querySelectorAll('.tq-slot.is-filled').length;
const pickAll = (): void => PARAMS.ingredients.forEach((i) => chip(i.label)!.click());

describe('craftActivity', () => {
  it('shows the prompt, the result, an empty slot per ingredient, and every chip', async () => {
    const ctx = makeCtx();
    const result = craftActivity.run(host, PARAMS, ctx);
    expect(host.textContent).toContain(PARAMS.prompt);
    expect(host.querySelector('.tq-bench')?.textContent).toContain('day bag');
    expect(host.querySelectorAll('.tq-slot')).toHaveLength(4);
    expect(filled()).toBe(0);
    expect(host.querySelector('.tq-bench__count')?.textContent).toBe('0 of 4 packed');
    expect(host.querySelectorAll('.tq-chip')).toHaveLength(7);
    for (const item of [...PARAMS.ingredients, ...PARAMS.distractors!]) expect(chip(item.label)).toBeDefined();
    expect(ctx.speak).not.toHaveBeenCalled();
    buttonByText(host, 'Back').click();
    await result;
  });

  it('mixes ingredients and distractors in a stable shuffled order', async () => {
    const first = craftActivity.run(host, PARAMS, makeCtx());
    const order = chipLabels();
    const sourceOrder = [...PARAMS.ingredients, ...PARAMS.distractors!].map((i) => i.label);
    expect(order).not.toEqual(sourceOrder);
    expect([...order].sort()).toEqual([...sourceOrder].sort());
    buttonByText(host, 'Back').click();
    await first;

    host = makeHost();
    const second = craftActivity.run(host, PARAMS, makeCtx());
    expect(chipLabels()).toEqual(order);
    buttonByText(host, 'Back').click();
    await second;
  });

  it('moves a picked ingredient into the next slot with a "Yes!" flash', async () => {
    const result = craftActivity.run(host, PARAMS, makeCtx());
    chip('Flashlight')!.click();
    expect(filled()).toBe(1);
    expect(host.querySelector('.tq-slot.is-filled')?.textContent).toContain('Flashlight');
    expect(host.querySelector('.tq-bench__count')?.textContent).toBe('1 of 4 packed');
    expect(chip('Flashlight')).toBeUndefined(); // moved out of the grid
    expect(host.querySelector('.tq-banner--yes')?.textContent).toContain('Yes!');

    chip('Sun hat')!.click();
    expect(filled()).toBe(2);
    const slots = Array.from(host.querySelectorAll('.tq-slot'));
    expect(slots[1]!.textContent).toContain('Sun hat'); // next slot, in tap order
    buttonByText(host, 'Back').click();
    await result;
  });

  it('shakes a distractor, says "Not yet" with a reason, and keeps the chip', async () => {
    const ctx = makeCtx();
    const result = craftActivity.run(host, PARAMS, ctx);
    const wrong = chip('Bowling ball')!;
    wrong.click();
    expect(host.querySelector('.tq-banner--notyet')?.textContent).toContain('Not yet');
    expect(host.textContent).toContain('That does not belong in the day bag.');
    expect(wrong.classList.contains('is-shaking')).toBe(true);
    expect(chip('Bowling ball')).toBe(wrong); // still there
    expect(filled()).toBe(0);
    expect(host.querySelector('.tq-bench__count')?.textContent).toBe('0 of 4 packed');
    buttonByText(host, 'Back').click();
    await result;
  });

  it('completes with the right result, counting every tap and lowering the score for wrong ones', async () => {
    const result = craftActivity.run(host, PARAMS, makeCtx());
    chip('Bowling ball')!.click();
    chip('Big sofa')!.click();
    pickAll();
    expect(filled()).toBe(4);
    expect(host.querySelector('.tq-bench__count')?.textContent).toBe('4 of 4 packed');
    expect(host.textContent).toContain('You made the day bag!');
    expect(host.querySelector('.tq-banner--yes')?.textContent).toContain('Yes!');
    buttonByText(host, 'Finish').click();
    const outcome = await result;
    expect(outcome.completed).toBe(true);
    expect(outcome.attempts).toBe(6);
    expect(outcome.score).toBeCloseTo(1 - 2 / 4);
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('gives a perfect score when there are no wrong taps', async () => {
    const result = craftActivity.run(host, PARAMS, makeCtx());
    pickAll();
    buttonByText(host, 'Finish').click();
    await expect(result).resolves.toEqual({ completed: true, attempts: 4, score: 1 });
  });

  it('clamps the score at 0 when there are many wrong taps', async () => {
    const result = craftActivity.run(host, PARAMS, makeCtx());
    for (let i = 0; i < 6; i++) chip('Goldfish bowl')!.click();
    pickAll();
    buttonByText(host, 'Finish').click();
    const outcome = await result;
    expect(outcome.attempts).toBe(10);
    expect(outcome.score).toBe(0);
  });

  it('lets the player back out without completing', async () => {
    const result = craftActivity.run(host, PARAMS, makeCtx());
    chip('Sun hat')!.click();
    chip('Big sofa')!.click();
    buttonByText(host, 'Back').click();
    await expect(result).resolves.toEqual({ completed: false, attempts: 2 });
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('works from the keyboard: focus lands on a chip, Enter and Space pick, Enter finishes', async () => {
    const result = craftActivity.run(host, PARAMS, makeCtx());
    const focused = document.activeElement as HTMLElement;
    expect(focused.classList.contains('tq-chip')).toBe(true);

    press(chip('Bowling ball')!, 'Enter'); // a distractor: shakes and stays
    expect(chip('Bowling ball')).toBeDefined();
    expect(filled()).toBe(0);

    press(chip('Water bottle')!, 'Enter');
    press(chip('Trail snack')!, ' ');
    expect(filled()).toBe(2);
    // Focus moved on to another chip, so the next key press still works.
    expect((document.activeElement as HTMLElement).classList.contains('tq-chip')).toBe(true);

    press(chip('Flashlight')!, 'Enter');
    press(chip('Sun hat')!, 'Enter');
    expect(filled()).toBe(4);
    expect(document.activeElement).toBe(buttonByText(host, 'Finish'));
    press(document.activeElement!, 'Enter');
    await expect(result).resolves.toEqual({ completed: true, attempts: 5, score: 0.75 });
  });

  it('works with no distractors', async () => {
    const params: CraftParams = { prompt: 'Make a snack.', result: 'snack', ingredients: PARAMS.ingredients.slice(0, 2) };
    const result = craftActivity.run(host, params, makeCtx());
    expect(host.querySelectorAll('.tq-chip')).toHaveLength(2);
    expect(host.querySelectorAll('.tq-slot')).toHaveLength(2);
    chip('Water bottle')!.click();
    chip('Trail snack')!.click();
    expect(host.textContent).toContain('You made the snack!');
    buttonByText(host, 'Finish').click();
    await expect(result).resolves.toEqual({ completed: true, attempts: 2, score: 1 });
  });

  it('resolves not completed when there are no ingredients', async () => {
    const result = craftActivity.run(host, { prompt: 'Nothing.', result: 'nothing', ingredients: [] }, makeCtx());
    await expect(result).resolves.toEqual({ completed: false, attempts: 0 });
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('runs end to end with the sample content', async () => {
    const result = craftActivity.run(host, SAMPLE_CRAFT, makeCtx());
    expect(host.querySelectorAll('.tq-chip')).toHaveLength(
      SAMPLE_CRAFT.ingredients.length + (SAMPLE_CRAFT.distractors?.length ?? 0),
    );
    SAMPLE_CRAFT.ingredients.forEach((i) => chip(i.label)!.click());
    buttonByText(host, 'Finish').click();
    await expect(result).resolves.toMatchObject({ completed: true, score: 1 });
  });
});
