import { h } from '../../ui/dom';
import { showResultBanner } from '../../ui/feedback';
import { button } from '../../ui/widgets';
import { feedbackSlot } from '../shared';
import type {
  ActivityContext,
  ActivityController,
  ActivityResult,
  CollectParams,
  WorldActivityHost,
  WorldPlacedHandle,
  WorldPoint,
} from '../types';
import { mountWorldPanel, showNeedsCampCard } from '../world-panel';
import { groundDistance, placeAt, seededOrder, seedFrom } from '../world-spots';

/** How often the compass re-picks the nearest pickup while the Scout walks, in milliseconds. */
export const COMPASS_REFRESH_MS = 300;
/** The compass keeps its current pickup unless another one is closer by more than this many units. */
const SWITCH_MARGIN = 1.5;
const FOUND_BANNER_MS = 2200;

export const COLLECT_TEXT = {
  title: 'Collect',
  all: 'You found them all!',
  finish: 'Finish',
  back: 'Back',
  hideList: 'Hide list',
  showList: 'Show list',
} as const;

interface Pickup {
  targetId: string;
  position: WorldPoint;
  handle: WorldPlacedHandle;
  reached: boolean;
}

interface Row {
  li: HTMLElement;
  toggle: HTMLButtonElement;
  mark: HTMLElement;
  count: HTMLElement;
  hint: HTMLElement | null;
}

/**
 * The Scout walks around the zone and finds the targets. `count` pickups per target are placed at
 * the zone's open spots (a seeded shuffle, so the same stop always looks the same). The compass
 * points at the nearest one left. A non-modal panel lists the targets with "0 of N" counts and a
 * hint for each, and never stops the Scout from walking. Back leaves at any time.
 */
function runCollect(host: HTMLElement, params: CollectParams, ctx: ActivityContext): Promise<ActivityResult> {
  if (!ctx.world) return showNeedsCampCard(host, COLLECT_TEXT.title);
  return playCollect(host, params, ctx.world);
}

function playCollect(host: HTMLElement, params: CollectParams, world: WorldActivityHost): Promise<ActivityResult> {
  const targets = params.targets.filter((t) => t.count > 0);
  if (targets.length === 0) return Promise.resolve({ completed: false, attempts: 0 });
  const total = targets.reduce((sum, t) => sum + t.count, 0);

  return new Promise<ActivityResult>((resolve) => {
    let finished = false;
    let foundTotal = 0;
    const found = new Map<string, number>(targets.map((t) => [t.id, 0]));
    const pickups: Pickup[] = [];
    let compassOn: Pickup | null = null;

    // ---- the world: place every pickup -------------------------------------------------------
    const spots = world.openSpots();
    const order = seededOrder(spots.length, seedFrom(targets.map((t) => t.id)));
    const origin = world.playerPosition();
    let index = 0;
    for (const target of targets) {
      for (let n = 0; n < target.count; n++) {
        const position = placeAt(spots, order, index++, origin);
        const pickup: Pickup = { targetId: target.id, position, handle: { remove() {} }, reached: false };
        pickup.handle = world.spawnPickup({
          id: target.id,
          label: target.label,
          position,
          onReach: () => onFound(pickup),
        });
        pickups.push(pickup);
      }
    }

    // ---- the panel ---------------------------------------------------------------------------
    const panel = mountWorldPanel(host, COLLECT_TEXT.title);
    const eyebrow = h('p', { class: 'tq-eyebrow' });
    const slot = feedbackSlot();
    const actions = h('div', { class: 'tq-world-panel__actions' });
    const list = h('ul', { class: 'tq-check-list' });
    let listShown = true;
    const listToggle = button(COLLECT_TEXT.hideList, { onClick: () => setListShown(!listShown) });
    listToggle.setAttribute('aria-expanded', 'true');

    const expanded = new Set<string>([targets[0]!.id]);
    const rows = new Map<string, Row>();
    for (const target of targets) {
      const mark = h('span', { class: 'tq-check-row__mark', attrs: { 'aria-hidden': 'true' } });
      const count = h('span', { class: 'tq-check-row__count' });
      const toggle = h(
        'button',
        { class: 'tq-check-row', type: 'button', attrs: { 'aria-expanded': 'false' } },
        mark,
        h('span', { class: 'tq-check-row__label' }, target.label),
        count,
      );
      const hint = target.hint ? h('p', { class: 'tq-check-item__hint', hidden: true }, target.hint) : null;
      toggle.addEventListener('click', () => {
        if (!hint) return;
        if (expanded.has(target.id)) expanded.delete(target.id);
        else expanded.add(target.id);
        paintRow(target.id);
      });
      const li = h('li', { class: 'tq-check-item' }, toggle, hint);
      list.append(li);
      rows.set(target.id, { li, toggle, mark, count, hint });
    }

    function setListShown(shown: boolean): void {
      listShown = shown;
      list.hidden = !shown;
      listToggle.textContent = shown ? COLLECT_TEXT.hideList : COLLECT_TEXT.showList;
      listToggle.setAttribute('aria-expanded', String(shown));
    }

    function paintRow(id: string): void {
      const row = rows.get(id);
      const target = targets.find((t) => t.id === id);
      if (!row || !target) return;
      const have = found.get(id) ?? 0;
      const done = have >= target.count;
      row.li.classList.toggle('is-done', done);
      row.mark.textContent = done ? '✔' : '☐';
      row.count.textContent = `${have} of ${target.count}`;
      row.toggle.setAttribute('aria-label', `${target.label}, ${have} of ${target.count}${done ? ', found' : ''}`);
      const open = row.hint !== null && expanded.has(id);
      if (row.hint) row.hint.hidden = !open;
      row.toggle.setAttribute('aria-expanded', String(open));
    }

    function paintAll(): void {
      for (const target of targets) paintRow(target.id);
      eyebrow.textContent = `Found ${foundTotal} of ${total}`;
    }

    panel.root.append(
      h('div', { class: 'tq-header' }, eyebrow, button(COLLECT_TEXT.back, { icon: '←', onClick: () => leave(false) })),
      h('p', { class: 'tq-world-panel__prompt' }, params.prompt),
      listToggle,
      list,
      slot,
      actions,
    );
    paintAll();

    // ---- the compass: nearest pickup left, with a little stickiness so it does not flicker ------
    function pointCompass(): void {
      const left = pickups.filter((p) => !p.reached);
      if (left.length === 0) {
        compassOn = null;
        world.setCompassTarget(null);
        return;
      }
      const me = world.playerPosition();
      let nearest = left[0]!;
      for (const p of left) {
        if (groundDistance(me, p.position) < groundDistance(me, nearest.position)) nearest = p;
      }
      const keep =
        compassOn !== null &&
        !compassOn.reached &&
        groundDistance(me, compassOn.position) <= groundDistance(me, nearest.position) + SWITCH_MARGIN;
      if (keep) return;
      compassOn = nearest;
      world.setCompassTarget(nearest.position);
    }
    pointCompass();
    const timer = setInterval(pointCompass, COMPASS_REFRESH_MS);

    // ---- events ------------------------------------------------------------------------------
    function onFound(pickup: Pickup): void {
      if (finished || pickup.reached) return;
      pickup.reached = true;
      foundTotal += 1;
      const target = targets.find((t) => t.id === pickup.targetId)!;
      found.set(target.id, (found.get(target.id) ?? 0) + 1);
      // Show the next hint: put away this target's once it is done, open the first one still left.
      if ((found.get(target.id) ?? 0) >= target.count) expanded.delete(target.id);
      const nextLeft = targets.find((t) => (found.get(t.id) ?? 0) < t.count);
      if (nextLeft) expanded.add(nextLeft.id);
      paintAll();

      if (foundTotal >= total) {
        clearInterval(timer);
        compassOn = null;
        world.setCompassTarget(null);
        showResultBanner(slot, 'yes', COLLECT_TEXT.all);
        const done = button(COLLECT_TEXT.finish, { variant: 'primary', onClick: () => leave(true) });
        actions.append(done);
        done.focus({ preventScroll: true });
        return;
      }
      showResultBanner(slot, 'yes', `Found: ${target.label}`, { autoHideMs: FOUND_BANNER_MS });
      pointCompass();
    }

    function leave(completed: boolean): void {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      panel.close();
      world.clear();
      resolve(completed ? { completed: true, attempts: total, score: 1 } : { completed: false, attempts: foundTotal });
    }
  });
}

export const collectActivity: ActivityController<'collect'> = {
  type: 'collect',
  run: runCollect,
};
