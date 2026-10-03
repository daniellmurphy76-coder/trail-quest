import { h } from '../../ui/dom';
import { showResultBanner } from '../../ui/feedback';
import { mountOverlay } from '../../ui/overlay';
import { button, srOnly } from '../../ui/widgets';
import { cardHeader, feedbackSlot, peekButton } from '../shared';
import type { ActivityContext, ActivityController, ActivityResult, SequenceParams } from '../types';
import { shuffleSteps } from './shuffle';

interface Tile {
  text: string;
  li: HTMLLIElement;
  btn: HTMLButtonElement;
}

/**
 * Steps appear shuffled as big tap tiles. Tapping the right next step moves it into the numbered
 * "Your order" lane; a wrong one shakes and stays. No fail: tap again as often as you like.
 * Completes when every step is placed. score = 1 - wrongTaps / steps, clamped to 0..1.
 * When the context carries a poster, a "Show me" button peeks at it without touching the score.
 */
function runSequence(host: HTMLElement, params: SequenceParams, ctx: ActivityContext): Promise<ActivityResult> {
  const steps = params.steps;
  if (steps.length === 0) return Promise.resolve({ completed: false, attempts: 0 });

  return new Promise<ActivityResult>((resolve) => {
    let attempts = 0;
    let wrongTaps = 0;
    let placed = 0;
    let finished = false;

    const overlay = mountOverlay(host, { label: 'Put the steps in order' });
    const slot = feedbackSlot();
    const actions = h('div', { class: 'tq-actions' });

    function finish(completed: boolean): void {
      if (finished) return;
      finished = true;
      overlay.close();
      resolve(
        completed
          ? { completed, attempts, score: Math.min(1, Math.max(0, 1 - wrongTaps / steps.length)) }
          : { completed, attempts },
      );
    }

    // The numbered lane: one slot per step, filled in order.
    const laneSlots = steps.map((_, i) => {
      const num = h('span', { class: 'tq-lane__num', attrs: { 'aria-hidden': 'true' } }, String(i + 1));
      const label = h('span', { class: 'tq-lane__text' }, srOnly(`Step ${i + 1}, empty`));
      const li = h('li', { class: 'tq-lane__slot' }, num, label);
      return { li, label };
    });
    const lane = h('ol', { class: 'tq-lane', attrs: { 'aria-label': 'Your order' } }, ...laneSlots.map((s) => s.li));

    // The tiles to tap, in a stable shuffled order.
    const tiles: Tile[] = shuffleSteps(steps).map((text) => {
      const btn = button(text, { variant: 'secondary', class: 'tq-tile', onClick: () => tap(tile) });
      const li = h('li', null, btn);
      const tile: Tile = { text, li, btn };
      return tile;
    });
    const tileList = h('ul', { class: 'tq-tiles', attrs: { 'aria-label': 'Steps to place' } }, ...tiles.map((t) => t.li));

    function shake(el: HTMLElement): void {
      el.classList.remove('is-shaking');
      void el.offsetWidth; // restart the animation if it is already running
      el.classList.add('is-shaking');
      setTimeout(() => el.classList.remove('is-shaking'), 450);
    }

    function tap(tile: Tile): void {
      if (finished || placed >= steps.length) return;
      attempts += 1;
      if (tile.text === steps[placed]) {
        const target = laneSlots[placed]!;
        target.li.classList.add('is-filled');
        target.label.replaceChildren(tile.text);
        placed += 1;
        const at = tiles.indexOf(tile);
        tiles.splice(at, 1);
        tile.li.remove();
        if (placed === steps.length) {
          showResultBanner(slot, 'yes', 'All the steps are in order.');
          const next = button('Next', { variant: 'primary', onClick: () => finish(true) });
          actions.append(next);
          overlay.setDefault(next);
          overlay.focus(next);
        } else {
          showResultBanner(slot, 'yes', '', { autoHideMs: 1100 });
          overlay.focus(tiles[Math.min(at, tiles.length - 1)]?.btn);
        }
      } else {
        wrongTaps += 1;
        shake(tile.btn);
        showResultBanner(slot, 'notyet', 'Try a different step.', { autoHideMs: 1600 });
      }
    }

    overlay.card.append(
      cardHeader('Put the steps in order', () => finish(false)),
      h('div', { class: 'tq-prompt' }, h('h2', null, params.prompt), peekButton(host, ctx.poster)),
      h('p', { class: 'tq-hint' }, 'Tap the step that comes next.'),
      tileList,
      slot,
      h('p', { class: 'tq-lane__title' }, 'Your order'),
      lane,
      actions,
    );
    overlay.focus(tiles[0]?.btn);
  });
}

export const sequenceActivity: ActivityController<'sequence'> = {
  type: 'sequence',
  run: runSequence,
};
