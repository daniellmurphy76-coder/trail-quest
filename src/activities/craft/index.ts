import { h } from '../../ui/dom';
import { showResultBanner } from '../../ui/feedback';
import { mountOverlay } from '../../ui/overlay';
import { button, srOnly } from '../../ui/widgets';
import { shuffleSteps } from '../sequence/shuffle';
import { cardHeader, feedbackSlot } from '../shared';
import type { ActivityController, ActivityResult, CraftParams } from '../types';
import './craft.css';

interface Item {
  id: string;
  label: string;
  /** True for a needed ingredient, false for a distractor. */
  needed: boolean;
}

interface Chip {
  item: Item;
  li: HTMLLIElement;
  btn: HTMLButtonElement;
}

/**
 * Ingredients and distractors mixed in one stable shuffled order. The shuffle helper works on
 * text, so it is seeded from the labels; labels are mapped back to items one for one, so two
 * items that share a label still each appear once.
 */
function mixItems(items: readonly Item[]): Item[] {
  const pool = [...items];
  return shuffleSteps(items.map((item) => item.label)).map((label) => {
    const at = pool.findIndex((item) => item.label === label);
    return pool.splice(at, 1)[0]!;
  });
}

/**
 * A bench with one empty slot per ingredient, and big chips below for ingredients and distractors
 * mixed together. Tapping an ingredient moves it into the next slot with a "Yes!" flash. Tapping a
 * distractor shakes it and says "Not yet"; the chip stays. No fail: tap as often as you like.
 * Completes when every ingredient is packed. score = 1 - wrongTaps / ingredients, clamped to 0..1.
 */
function runCraft(host: HTMLElement, params: CraftParams): Promise<ActivityResult> {
  const total = params.ingredients.length;
  if (total === 0) return Promise.resolve({ completed: false, attempts: 0 });

  return new Promise<ActivityResult>((resolve) => {
    let attempts = 0; // every tap on a chip
    let wrongTaps = 0;
    let packed = 0;
    let done = false;
    let finished = false;

    const overlay = mountOverlay(host, { label: 'Make something at the bench' });
    const slot = feedbackSlot();
    const actions = h('div', { class: 'tq-actions' });

    function finish(completed: boolean): void {
      if (finished) return;
      finished = true;
      overlay.close();
      resolve(
        completed
          ? { completed, attempts, score: Math.min(1, Math.max(0, 1 - wrongTaps / total)) }
          : { completed, attempts },
      );
    }

    // The bench: the result, a count, and one slot per ingredient, filled in tap order.
    const count = h('p', { class: 'tq-bench__count' });
    const updateCount = (): void => {
      count.textContent = `${packed} of ${total} packed`;
    };
    updateCount();

    const benchSlots = params.ingredients.map((_, i) => {
      const mark = h('span', { class: 'tq-slot__mark', attrs: { 'aria-hidden': 'true' } }, String(i + 1));
      const text = h('span', { class: 'tq-slot__text' }, srOnly(`Slot ${i + 1}, empty`));
      const li = h('li', { class: 'tq-slot' }, mark, text);
      return { li, mark, text };
    });
    const bench = h(
      'section',
      { class: 'tq-bench', attrs: { 'aria-label': 'Bench' } },
      h(
        'div',
        { class: 'tq-bench__head' },
        h('p', { class: 'tq-bench__result' }, 'Making: ', h('strong', null, params.result)),
        count,
      ),
      h('ol', { class: 'tq-slots', attrs: { 'aria-label': 'Packed items' } }, ...benchSlots.map((s) => s.li)),
    );

    // The chips to tap, in a stable shuffled order.
    const items: Item[] = [
      ...params.ingredients.map((i) => ({ id: i.id, label: i.label, needed: true })),
      ...(params.distractors ?? []).map((d) => ({ id: d.id, label: d.label, needed: false })),
    ];
    const chips: Chip[] = mixItems(items).map((item) => {
      const btn = button(item.label, {
        variant: 'secondary',
        class: 'tq-chip',
        onClick: () => tap(chip),
      });
      btn.dataset.itemId = item.id;
      const li = h('li', null, btn);
      const chip: Chip = { item, li, btn };
      return chip;
    });
    const chipList = h('ul', { class: 'tq-chips', attrs: { 'aria-label': 'Things to pick' } }, ...chips.map((c) => c.li));

    function shake(el: HTMLElement): void {
      el.classList.remove('is-shaking');
      void el.offsetWidth; // restart the animation if it is already running
      el.classList.add('is-shaking');
      setTimeout(() => el.classList.remove('is-shaking'), 450);
    }

    function tap(chip: Chip): void {
      if (finished || done) return;
      attempts += 1;
      if (chip.item.needed) {
        const target = benchSlots[packed]!;
        target.li.classList.add('is-filled');
        target.mark.textContent = '✔'; // heavy check mark; the label next to it carries the meaning
        target.text.replaceChildren(chip.item.label);
        packed += 1;
        updateCount();
        const at = chips.indexOf(chip);
        chips.splice(at, 1);
        chip.li.remove();
        if (packed >= total) {
          done = true;
          bench.classList.add('is-done');
          chipList.hidden = true;
          hint.hidden = true;
          showResultBanner(slot, 'yes', `You made the ${params.result}!`);
          const next = button('Finish', { variant: 'primary', onClick: () => finish(true) });
          actions.append(next);
          overlay.setDefault(next);
          overlay.focus(next);
        } else {
          showResultBanner(slot, 'yes', '', { autoHideMs: 1100 });
          overlay.focus(chips[Math.min(at, chips.length - 1)]?.btn);
        }
      } else {
        wrongTaps += 1;
        shake(chip.btn);
        showResultBanner(slot, 'notyet', `That does not belong in the ${params.result}.`);
      }
    }

    const hint = h('p', { class: 'tq-hint' }, `Tap what goes in the ${params.result}.`);

    overlay.card.append(
      cardHeader('Make it at the bench', () => finish(false)),
      h('div', { class: 'tq-prompt' }, h('h2', null, params.prompt)),
      bench,
      hint,
      chipList,
      slot,
      actions,
    );
    overlay.focus(chips[0]?.btn);
  });
}

export const craftActivity: ActivityController<'craft'> = {
  type: 'craft',
  run: runCraft,
};
