// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sortActivity } from '../../src/activities/sort';
import { SAMPLE_SORT } from '../../src/activities/sort/sample';
import type { SortParams } from '../../src/activities/types';
import { buttonByText, flush, makeCtx, makeHost, press } from './helpers';

const PARAMS: SortParams = {
  prompt: 'Help Zip pack the pretend bag.',
  bins: [
    { id: 'pack', label: 'Pack it' },
    { id: 'leave', label: 'Leave it' },
  ],
  items: [
    { label: 'Pretend tent', bin: 'pack' },
    { label: 'Fake flashlight', bin: 'pack' },
    { label: 'Toy dragon', bin: 'leave' },
    { label: 'Pretend TV', bin: 'leave' },
  ],
};

let host: HTMLElement;
beforeEach(() => {
  host = makeHost();
});

/** A chip still waiting in the item pool. */
const chip = (label: string): HTMLButtonElement | undefined =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('.tq-chip')).find((b) => b.textContent?.includes(label));
const bin = (label: string): HTMLElement => {
  const found = Array.from(host.querySelectorAll<HTMLElement>('.tq-bin')).find(
    (el) => el.querySelector('.tq-bin__btn')?.firstChild?.textContent === label,
  );
  if (!found) throw new Error(`No bin named ${label}`);
  return found;
};
const binButton = (label: string): HTMLButtonElement => bin(label).querySelector<HTMLButtonElement>('.tq-bin__btn')!;
const inBin = (label: string): string[] =>
  Array.from(bin(label).querySelectorAll('.tq-placed')).map((li) => li.textContent ?? '');
const chipCount = (): number => host.querySelectorAll('.tq-chip').length;

/** Taps a chip, then a bin, the way a kid does. */
function sortItem(label: string, binLabel: string): void {
  chip(label)!.click();
  binButton(binLabel).click();
}

describe('sortActivity', () => {
  it('shows the prompt, a labeled drop zone per bin, and a chip per item', async () => {
    const ctx = makeCtx();
    const result = sortActivity.run(host, PARAMS, ctx);
    expect(host.textContent).toContain(PARAMS.prompt);
    expect(ctx.speak).not.toHaveBeenCalled();
    expect(host.querySelectorAll('.tq-bin')).toHaveLength(2);
    expect(host.querySelector('.tq-bins')?.getAttribute('style')).toContain('--tq-bin-count: 2');
    expect(host.textContent).toContain('Pack it');
    expect(host.textContent).toContain('Leave it');
    expect(chipCount()).toBe(4);
    const shown = Array.from(host.querySelectorAll('.tq-chip')).map((b) => b.textContent);
    expect(shown).not.toEqual(PARAMS.items.map((i) => i.label)); // shuffled
    expect(host.querySelector('.tq-sort')).not.toBeNull();
    buttonByText(host, 'Back').click();
    await result;
  });

  it('shuffles the same way every time', async () => {
    const order = async (): Promise<string[]> => {
      host = makeHost();
      const result = sortActivity.run(host, PARAMS, makeCtx());
      const labels = Array.from(host.querySelectorAll('.tq-chip')).map((b) => b.textContent ?? '');
      buttonByText(host, 'Back').click();
      await result;
      return labels;
    };
    expect(await order()).toEqual(await order());
  });

  it('marks a tapped chip as picked, with a marker and not just a color, and un-picks on a second tap', async () => {
    const ctx = makeCtx();
    const result = sortActivity.run(host, PARAMS, ctx);
    const tent = chip('Pretend tent')!;
    expect(tent.getAttribute('aria-pressed')).toBe('false');

    tent.click();
    expect(tent.classList.contains('is-selected')).toBe(true);
    expect(tent.getAttribute('aria-pressed')).toBe('true');
    expect(tent.querySelector('.tq-chip__mark')?.textContent).toBeTruthy();
    expect(host.querySelector('.tq-hint')?.textContent).toContain('Pretend tent');
    expect(ctx.speak).not.toHaveBeenCalled();

    tent.click();
    expect(tent.classList.contains('is-selected')).toBe(false);
    expect(tent.getAttribute('aria-pressed')).toBe('false');
    expect(tent.querySelector('.tq-chip__mark')?.textContent).toBe('');

    buttonByText(host, 'Back').click();
    await result;
  });

  it('moves a chip into its bin with a "Yes!" flash when the bin is right', async () => {
    const result = sortActivity.run(host, PARAMS, makeCtx());
    sortItem('Pretend tent', 'Pack it');
    expect(host.querySelector('.tq-banner--yes')).not.toBeNull();
    expect(host.textContent).toContain('Yes!');
    expect(chip('Pretend tent')).toBeUndefined(); // gone from the pool
    expect(chipCount()).toBe(3);
    expect(inBin('Pack it')).toHaveLength(1);
    expect(inBin('Pack it')[0]).toContain('Pretend tent');
    expect(inBin('Leave it')).toHaveLength(0);
    expect(host.querySelector('.tq-eyebrow')?.textContent).toBe('Sorted 1 of 4');
    // The move is announced to screen readers too.
    expect(binButton('Pack it').textContent).toContain('1 in it');
    buttonByText(host, 'Back').click();
    await expect(result).resolves.toEqual({ completed: false, attempts: 1 });
  });

  it('shakes and says "Not yet" for the wrong bin, keeps the chip, counts the attempt and lowers the score', async () => {
    const result = sortActivity.run(host, PARAMS, makeCtx());
    const wrong = chip('Toy dragon')!;
    wrong.click();
    binButton('Pack it').click();
    expect(host.querySelector('.tq-banner--notyet')).not.toBeNull();
    expect(host.textContent).toContain('Not yet');
    expect(wrong.classList.contains('is-shaking')).toBe(true);
    expect(chip('Toy dragon')).toBe(wrong); // still available
    expect(wrong.isConnected).toBe(true);
    expect(wrong.classList.contains('is-selected')).toBe(true); // ready to try another bin
    expect(chipCount()).toBe(4);
    expect(inBin('Pack it')).toHaveLength(0);

    // Retry is free: pick the right bin straight away, then finish the rest.
    binButton('Leave it').click();
    expect(inBin('Leave it')).toEqual([expect.stringContaining('Toy dragon')]);
    sortItem('Pretend TV', 'Leave it');
    sortItem('Pretend tent', 'Pack it');
    sortItem('Fake flashlight', 'Pack it');
    buttonByText(host, 'Finish').click();
    const outcome = await result;
    expect(outcome.completed).toBe(true);
    expect(outcome.attempts).toBe(5); // 4 items + 1 wrong placement
    expect(outcome.score).toBeCloseTo(1 - 1 / 4);
  });

  it('does nothing but nudge when a bin is tapped before any item is picked', async () => {
    const result = sortActivity.run(host, PARAMS, makeCtx());
    binButton('Pack it').click();
    expect(host.querySelector('.tq-hint')?.textContent).toContain('Tap an item first');
    expect(host.querySelector('.tq-banner')).toBeNull();
    expect(chipCount()).toBe(4);
    buttonByText(host, 'Back').click();
    await expect(result).resolves.toEqual({ completed: false, attempts: 0 });
  });

  it('completes when every item is placed, shows the last "Yes!", and waits for Finish', async () => {
    const result = sortActivity.run(host, PARAMS, makeCtx());
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    PARAMS.items.forEach((item) => sortItem(item.label, item.bin === 'pack' ? 'Pack it' : 'Leave it'));
    expect(chipCount()).toBe(0);
    expect(host.querySelector('.tq-banner--yes')).not.toBeNull();
    expect(host.textContent).toContain('Yes!');
    expect(host.querySelector('.tq-eyebrow')?.textContent).toBe('Sorted 4 of 4');
    await flush();
    expect(settled).toBe(false); // the kid sees the last "Yes!" before Finish
    expect(host.querySelector('.tq-overlay')).not.toBeNull();

    buttonByText(host, 'Finish').click();
    await expect(result).resolves.toEqual({ completed: true, attempts: 4, score: 1 });
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('clamps the score at 0 when there are many wrong placements', async () => {
    const params: SortParams = {
      prompt: 'Two things.',
      bins: PARAMS.bins,
      items: [
        { label: 'Fake rope', bin: 'pack' },
        { label: 'Fake bell', bin: 'leave' },
      ],
    };
    const result = sortActivity.run(host, params, makeCtx());
    chip('Fake rope')!.click(); // a wrong try leaves the chip picked, so the bins can be tapped again
    for (let i = 0; i < 5; i++) binButton('Leave it').click();
    binButton('Pack it').click();
    sortItem('Fake bell', 'Leave it');
    buttonByText(host, 'Finish').click();
    const outcome = await result;
    expect(outcome.attempts).toBe(7);
    expect(outcome.score).toBe(0);
  });

  it('lets the player back out without completing', async () => {
    const result = sortActivity.run(host, PARAMS, makeCtx());
    sortItem('Pretend tent', 'Pack it');
    sortItem('Toy dragon', 'Pack it'); // a wrong try also counts as an attempt
    buttonByText(host, 'Back').click();
    await expect(result).resolves.toEqual({ completed: false, attempts: 2 });
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('works from the keyboard: Enter picks a chip, focus moves to the bins, Enter drops it', async () => {
    const result = sortActivity.run(host, PARAMS, makeCtx());
    const tent = chip('Pretend tent')!;
    tent.focus();
    press(tent, 'Enter');
    expect(tent.classList.contains('is-selected')).toBe(true);
    expect(document.activeElement).toBe(binButton('Pack it'));

    press(document.activeElement!, ' ');
    expect(inBin('Pack it')).toEqual([expect.stringContaining('Pretend tent')]);
    expect(chip('Pretend tent')).toBeUndefined();
    // Focus lands on another chip so the next pick is one keypress away.
    expect(document.activeElement?.classList.contains('tq-chip')).toBe(true);

    // Number keys are a shortcut for the bins once a chip is picked.
    const dragon = chip('Toy dragon')!;
    press(dragon, 'Enter');
    press(document.activeElement!, '2');
    expect(inBin('Leave it')).toEqual([expect.stringContaining('Toy dragon')]);

    // Space on a chip also picks it (Space and Enter both press the focused button).
    const flashlight = chip('Fake flashlight')!;
    flashlight.focus();
    press(flashlight, ' ');
    press(flashlight, '1');
    expect(inBin('Pack it')).toHaveLength(2);

    buttonByText(host, 'Back').click();
    await expect(result).resolves.toEqual({ completed: false, attempts: 3 });
  });

  it('drags a chip onto a bin with pointer events', async () => {
    const result = sortActivity.run(host, PARAMS, makeCtx());
    const dragon = chip('Toy dragon')!;
    const leave = bin('Leave it');
    const original = document.elementFromPoint;
    let under: Element | null = binButton('Pack it'); // first over the wrong bin
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => under });
    try {
      const fire = (type: string, x: number, y: number): void => {
        dragon.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 7,
            isPrimary: true,
            pointerType: 'mouse',
            button: 0,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      };

      fire('pointerdown', 10, 10);
      fire('pointermove', 12, 12); // under the threshold: still a tap
      expect(dragon.classList.contains('is-dragging')).toBe(false);
      fire('pointermove', 80, 90);
      expect(dragon.classList.contains('is-dragging')).toBe(true);
      expect(dragon.classList.contains('is-selected')).toBe(true);
      expect(bin('Pack it').classList.contains('is-over')).toBe(true);

      // Dropped on the wrong bin: it springs back and stays available.
      fire('pointerup', 80, 90);
      expect(dragon.classList.contains('is-dragging')).toBe(false);
      expect(dragon.style.transform).toBe('');
      expect(chip('Toy dragon')).toBe(dragon);
      expect(host.querySelector('.tq-banner--notyet')).not.toBeNull();
      expect(bin('Pack it').classList.contains('is-over')).toBe(false);
      await flush(); // the click that trails a drag is swallowed, then the guard resets

      // Drag again, drop on the right bin.
      under = leave.querySelector('.tq-bin__btn');
      fire('pointerdown', 10, 10);
      fire('pointermove', 90, 90);
      expect(leave.classList.contains('is-over')).toBe(true);
      fire('pointerup', 90, 90);
      expect(chip('Toy dragon')).toBeUndefined();
      expect(inBin('Leave it')).toEqual([expect.stringContaining('Toy dragon')]);
      expect(host.querySelector('.tq-banner--yes')).not.toBeNull();
    } finally {
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: original });
    }
    buttonByText(host, 'Back').click();
    await expect(result).resolves.toEqual({ completed: false, attempts: 2 });
  });

  it('lays out up to four bins', async () => {
    const params: SortParams = {
      prompt: 'Four bins.',
      bins: [
        { id: 'a', label: 'Alpha' },
        { id: 'b', label: 'Beta' },
        { id: 'c', label: 'Gamma' },
        { id: 'd', label: 'Delta' },
      ],
      items: [
        { label: 'Fake one', bin: 'a' },
        { label: 'Fake four', bin: 'd' },
      ],
    };
    const result = sortActivity.run(host, params, makeCtx());
    expect(host.querySelectorAll('.tq-bin')).toHaveLength(4);
    expect(host.querySelector('.tq-bins')?.getAttribute('style')).toContain('--tq-bin-count: 4');
    sortItem('Fake one', 'Alpha');
    sortItem('Fake four', 'Delta');
    buttonByText(host, 'Finish').click();
    await expect(result).resolves.toEqual({ completed: true, attempts: 2, score: 1 });
  });

  it('skips items that name a bin that does not exist, so nothing can trap the player', async () => {
    const params: SortParams = {
      ...PARAMS,
      items: [...PARAMS.items.slice(0, 1), { label: 'Lost item', bin: 'nowhere' }],
    };
    const result = sortActivity.run(host, params, makeCtx());
    expect(chipCount()).toBe(1);
    sortItem('Pretend tent', 'Pack it');
    buttonByText(host, 'Finish').click();
    await expect(result).resolves.toEqual({ completed: true, attempts: 1, score: 1 });
  });

  it('resolves right away with nothing to sort', async () => {
    await expect(sortActivity.run(host, { ...PARAMS, items: [] }, makeCtx())).resolves.toEqual({
      completed: false,
      attempts: 0,
    });
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('plays the sample content from start to finish', async () => {
    const result = sortActivity.run(host, SAMPLE_SORT, makeCtx());
    expect(chipCount()).toBe(SAMPLE_SORT.items.length);
    SAMPLE_SORT.items.forEach((item) => {
      const target = SAMPLE_SORT.bins.find((b) => b.id === item.bin)!;
      sortItem(item.label, target.label);
    });
    buttonByText(host, 'Finish').click();
    await expect(result).resolves.toEqual({ completed: true, attempts: SAMPLE_SORT.items.length, score: 1 });
  });
});

afterEach(() => {
  document.body.replaceChildren();
});
