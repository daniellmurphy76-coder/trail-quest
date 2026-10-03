import { h } from '../../ui/dom';
import { showResultBanner } from '../../ui/feedback';
import { mountOverlay } from '../../ui/overlay';
import { button, srOnly } from '../../ui/widgets';
import { shuffleSteps } from '../sequence/shuffle';
import { cardHeader, feedbackSlot } from '../shared';
import type { ActivityController, ActivityResult, SortParams } from '../types';
import './sort.css';

type SortItem = SortParams['items'][number];

interface Chip {
  item: SortItem;
  li: HTMLLIElement;
  btn: HTMLButtonElement;
  mark: HTMLSpanElement;
}

interface BinView {
  id: string;
  label: string;
  el: HTMLDivElement;
  btn: HTMLButtonElement;
  note: HTMLSpanElement;
  list: HTMLUListElement;
  count: number;
}

const IDLE_HINT = 'Tap an item. Then tap its bin.';
/** How far a pointer must travel before a press on a chip turns into a drag. */
const DRAG_THRESHOLD_PX = 8;

/** Shuffles the items with the shared seeded helper, keyed on the labels, so the order is stable. */
function orderItems(items: readonly SortItem[]): SortItem[] {
  const pool = [...items];
  return shuffleSteps(items.map((item) => item.label)).map((label) => {
    const at = pool.findIndex((item) => item.label === label);
    return pool.splice(at, 1)[0]!;
  });
}

/**
 * Items appear as big chips below 2 to 4 labeled bins. Tap a chip, then tap a bin (or drag the
 * chip onto a bin). The right bin says "Yes!" and the chip moves in; the wrong bin shakes and says
 * "Not yet", and the chip stays put. No lives, no fail. Completes when every item is placed.
 * score = 1 - wrongPlacements / items, clamped to 0..1. attempts = every placement tried.
 * Items that point at a bin id that does not exist are skipped, so a content slip cannot trap a kid.
 */
function runSort(host: HTMLElement, params: SortParams): Promise<ActivityResult> {
  const binIds = new Set(params.bins.map((b) => b.id));
  const items = params.items.filter((item) => binIds.has(item.bin));
  if (params.bins.length === 0 || items.length === 0) return Promise.resolve({ completed: false, attempts: 0 });

  return new Promise<ActivityResult>((resolve) => {
    let attempts = 0;
    let wrongPlacements = 0;
    let finished = false;
    let selected: Chip | null = null;
    let suppressClick = false;

    const overlay = mountOverlay(host, {
      label: 'Sort the items',
      cardClass: 'tq-sort',
      onKey: (event) => {
        // 1 to 4 drop the picked item into that bin on a laptop.
        if (finished || event.ctrlKey || event.metaKey || event.altKey) return false;
        const n = Number(event.key);
        const bin = Number.isInteger(n) ? bins[n - 1] : undefined;
        if (!bin) return false;
        chooseBin(bin, selected);
        return true;
      },
    });
    const slot = feedbackSlot();

    function finish(completed: boolean): void {
      if (finished) return;
      finished = true;
      overlay.close();
      resolve(
        completed
          ? { completed, attempts, score: Math.min(1, Math.max(0, 1 - wrongPlacements / items.length)) }
          : { completed, attempts },
      );
    }

    // Bins: a large labeled drop zone each. The button inside is the keyboard target.
    const bins: BinView[] = params.bins.map((bin) => {
      const cta = h('span', { class: 'tq-bin__cta', attrs: { 'aria-hidden': 'true' } }, 'Put it here');
      const note = srOnly(' (empty)');
      const list = h('ul', { class: 'tq-bin__items', attrs: { 'aria-label': `In ${bin.label}` } });
      const btn = button(bin.label, { variant: 'primary', class: 'tq-bin__btn' });
      btn.append(note, cta);
      const el = h('div', { class: 'tq-bin' }, btn, list);
      const view: BinView = { id: bin.id, label: bin.label, el, btn, note, list, count: 0 };
      // One handler on the whole zone: a click on the inner button bubbles up to here.
      el.addEventListener('click', () => chooseBin(view, selected));
      return view;
    });
    const binsEl = h(
      'div',
      { class: 'tq-bins', role: 'group', style: `--tq-bin-count: ${bins.length}`, attrs: { 'aria-label': 'Bins' } },
      ...bins.map((b) => b.el),
    );

    // Chips: stable shuffled order.
    const pool: Chip[] = orderItems(items).map((item) => {
      const mark = h('span', { class: 'tq-chip__mark', attrs: { 'aria-hidden': 'true' } });
      const btn = button(item.label, { variant: 'secondary', class: 'tq-chip' });
      btn.prepend(mark);
      btn.setAttribute('aria-pressed', 'false');
      const chip: Chip = { item, li: h('li', null, btn), btn, mark };
      btn.addEventListener('click', (event) => onChipClick(chip, event));
      wireDrag(chip);
      return chip;
    });
    const chipList = h('ul', { class: 'tq-chips', attrs: { 'aria-label': 'Items to sort' } }, ...pool.map((c) => c.li));

    const header = cardHeader('', () => finish(false));
    const eyebrow = header.querySelector('.tq-eyebrow')!;
    const hint = h('p', { class: 'tq-hint', attrs: { 'aria-live': 'polite' } }, IDLE_HINT);
    const hintRow = h('div', { class: 'tq-prompt' }, hint);

    function updateProgress(): void {
      eyebrow.textContent = `Sorted ${items.length - pool.length} of ${items.length}`;
    }

    function select(chip: Chip | null): void {
      if (selected) {
        selected.btn.classList.remove('is-selected');
        selected.btn.setAttribute('aria-pressed', 'false');
        selected.mark.textContent = '';
      }
      selected = chip;
      if (chip) {
        chip.btn.classList.add('is-selected');
        chip.btn.setAttribute('aria-pressed', 'true');
        chip.mark.textContent = '▶';
        hint.textContent = `Now tap the bin for ${chip.item.label}.`;
      } else {
        hint.textContent = IDLE_HINT;
      }
      binsEl.classList.toggle('is-picking', chip !== null);
    }

    function shake(el: HTMLElement): void {
      el.classList.remove('is-shaking');
      void el.offsetWidth; // restart the animation if it is already running
      el.classList.add('is-shaking');
      setTimeout(() => el.classList.remove('is-shaking'), 450);
    }

    function onChipClick(chip: Chip, event: MouseEvent): void {
      if (suppressClick) {
        suppressClick = false; // this click is the tail end of a drag
        return;
      }
      if (finished || !pool.includes(chip)) return;
      if (selected === chip) {
        select(null);
        return;
      }
      select(chip);
      // A keyboard press has detail 0: carry focus to the bins so Enter or Space can finish the move.
      if (event.detail === 0) overlay.focus(bins[0]?.btn);
    }

    function chooseBin(bin: BinView, chip: Chip | null): void {
      if (finished || pool.length === 0) return;
      if (!chip || !pool.includes(chip)) {
        hint.textContent = 'Tap an item first.';
        return;
      }
      attempts += 1;
      if (chip.item.bin !== bin.id) {
        wrongPlacements += 1;
        select(chip); // stays picked: tap another bin right away
        shake(chip.btn);
        showResultBanner(slot, 'notyet', 'Try a different bin.', { autoHideMs: 1600 });
        return;
      }

      // Right bin: the chip moves in as a checked, non-interactive entry.
      const at = pool.indexOf(chip);
      pool.splice(at, 1);
      chip.li.remove();
      select(null);
      bin.list.append(
        h(
          'li',
          { class: 'tq-placed' },
          h('span', { class: 'tq-placed__mark', attrs: { 'aria-hidden': 'true' } }, '✔'),
          chip.item.label,
        ),
      );
      bin.count += 1;
      bin.note.textContent = ` (${bin.count} in it)`;
      updateProgress();

      if (pool.length === 0) {
        hintRow.hidden = true;
        showResultBanner(slot, 'yes', 'Everything is in its bin.');
        const done = button('Finish', { variant: 'primary', onClick: () => finish(true) });
        overlay.card.append(h('div', { class: 'tq-actions' }, done));
        overlay.setDefault(done);
        overlay.focus(done);
      } else {
        showResultBanner(slot, 'yes', `${chip.item.label} goes in ${bin.label}.`, { autoHideMs: 1100 });
        overlay.focus(pool[Math.min(at, pool.length - 1)]?.btn);
      }
    }

    /** The bin under a screen point, ignoring the chip being dragged. */
    function binAt(x: number, y: number, dragged: HTMLElement): BinView | null {
      const before = dragged.style.pointerEvents;
      dragged.style.pointerEvents = 'none';
      const hit = document.elementFromPoint(x, y);
      dragged.style.pointerEvents = before;
      const zone = hit?.closest('.tq-bin');
      return bins.find((b) => b.el === zone) ?? null;
    }

    /** Pointer drag: capture the pointer, follow it, and drop on whichever bin is underneath. */
    function wireDrag(chip: Chip): void {
      const el = chip.btn;
      let start: { id: number; x: number; y: number } | null = null;
      let dragging = false;
      let over: BinView | null = null;

      el.addEventListener('pointerdown', (event) => {
        if (finished || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
        start = { id: event.pointerId, x: event.clientX, y: event.clientY };
        dragging = false;
        try {
          el.setPointerCapture(event.pointerId);
        } catch {
          // Capture is a nicety; the tap path does not need it.
        }
      });

      el.addEventListener('pointermove', (event) => {
        if (!start || event.pointerId !== start.id) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (!dragging) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          dragging = true;
          el.classList.add('is-dragging');
          select(chip);
        }
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        const target = binAt(event.clientX, event.clientY, el);
        if (target !== over) {
          over?.el.classList.remove('is-over');
          over = target;
          over?.el.classList.add('is-over');
        }
      });

      const end = (event: PointerEvent, drop: boolean): void => {
        if (!start || event.pointerId !== start.id) return;
        const wasDragging = dragging;
        start = null;
        dragging = false;
        try {
          el.releasePointerCapture(event.pointerId);
        } catch {
          // Already released.
        }
        if (!wasDragging) return; // a plain tap: the click handler takes it from here
        const target = drop ? binAt(event.clientX, event.clientY, el) : null;
        over?.el.classList.remove('is-over');
        over = null;
        el.classList.remove('is-dragging');
        el.style.transform = '';
        suppressClick = true;
        setTimeout(() => {
          suppressClick = false; // in case no click followed the drag
        }, 0);
        if (target) chooseBin(target, chip);
      };
      el.addEventListener('pointerup', (event) => end(event, true));
      el.addEventListener('pointercancel', (event) => end(event, false));
    }

    updateProgress();
    overlay.card.append(
      header,
      h('div', { class: 'tq-prompt' }, h('h2', null, params.prompt)),
      hintRow,
      binsEl,
      chipList,
      slot,
    );
    overlay.focus(pool[0]?.btn);
  });
}

export const sortActivity: ActivityController<'sort'> = {
  type: 'sort',
  run: runSort,
};
