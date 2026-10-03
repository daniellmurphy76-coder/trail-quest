import { h } from '../../ui/dom';
import { showResultBanner } from '../../ui/feedback';
import { button } from '../../ui/widgets';
import { feedbackSlot } from '../shared';
import type {
  ActivityContext,
  ActivityController,
  ActivityResult,
  NavigateParams,
  WorldActivityHost,
  WorldPlacedHandle,
  WorldPoint,
} from '../types';
import { mountWorldPanel, showNeedsCampCard } from '../world-panel';
import { groundDistance, placeAt } from '../world-spots';

/** How close counts as "there" for a waypoint. Same as a marker's default. */
export const NAVIGATE_REACH_RADIUS = 2;
/** In compass-only mode nothing is placed in the world, so the Scout's position is checked this often (ms). */
export const REACH_POLL_MS = 100;
const FOUND_BANNER_MS = 2400;

export const NAVIGATE_TEXT = {
  title: 'Navigate',
  done: 'You made it!',
  finish: 'Finish',
  back: 'Back',
} as const;

const MARKS = { done: '✔', current: '→', later: '·' } as const;

/**
 * The Scout walks to each waypoint in order. A waypoint stands at the zone's landmark with that
 * id, or, when the zone has none, at the next open spot in order. With `useCompass` false a tall
 * beacon marks the current waypoint and the compass points at it too; with `useCompass` true there
 * is only the compass. The panel says "Go to: {label}" and "k of N", never blocks walking, and Back
 * leaves at any time.
 */
function runNavigate(host: HTMLElement, params: NavigateParams, ctx: ActivityContext): Promise<ActivityResult> {
  if (!ctx.world) return showNeedsCampCard(host, NAVIGATE_TEXT.title);
  return playNavigate(host, params, ctx.world);
}

function playNavigate(host: HTMLElement, params: NavigateParams, world: WorldActivityHost): Promise<ActivityResult> {
  const waypoints = params.waypoints;
  if (waypoints.length === 0) return Promise.resolve({ completed: false, attempts: 0 });
  const total = waypoints.length;
  const compassOnly = params.useCompass === true;

  return new Promise<ActivityResult>((resolve) => {
    let finished = false;
    let celebrating = false;
    let index = 0;
    let visited = 0;
    let marker: WorldPlacedHandle | null = null;

    // Where each waypoint stands: its landmark, else the next open spot in order.
    const spots = world.openSpots();
    const inOrder = spots.map((_, i) => i);
    const origin = world.playerPosition();
    let nextSpot = 0;
    const positions: WorldPoint[] = waypoints.map((w) => world.landmark(w.id) ?? placeAt(spots, inOrder, nextSpot++, origin));

    // ---- the panel ---------------------------------------------------------------------------
    const panel = mountWorldPanel(host, NAVIGATE_TEXT.title);
    const eyebrow = h('p', { class: 'tq-eyebrow' });
    const goal = h('h2', { class: 'tq-world-panel__goal' });
    const slot = feedbackSlot();
    const actions = h('div', { class: 'tq-world-panel__actions' });
    const rows = waypoints.map((w) => {
      const mark = h('span', { class: 'tq-way__mark', attrs: { 'aria-hidden': 'true' } });
      const status = h('span', { class: 'tq-sr' });
      const li = h('li', { class: 'tq-way' }, mark, h('span', null, w.label), status);
      return { li, mark, status };
    });

    function paint(): void {
      eyebrow.textContent = `${celebrating ? total : index + 1} of ${total}`;
      goal.textContent = celebrating ? NAVIGATE_TEXT.done : `Go to: ${waypoints[index]!.label}`;
      rows.forEach((row, i) => {
        const state = celebrating || i < index ? 'done' : i === index ? 'current' : 'later';
        row.li.classList.toggle('is-done', state === 'done');
        row.li.classList.toggle('is-current', state === 'current');
        row.mark.textContent = MARKS[state];
        row.status.textContent = state === 'done' ? ' (done)' : state === 'current' ? ' (go here)' : ' (later)';
        if (state === 'current') row.li.setAttribute('aria-current', 'step');
        else row.li.removeAttribute('aria-current');
      });
    }

    panel.root.append(
      h('div', { class: 'tq-header' }, eyebrow, button(NAVIGATE_TEXT.back, { icon: '←', onClick: () => leave(false) })),
      goal,
      h('p', { class: 'tq-world-panel__prompt' }, params.prompt),
      h('ol', { class: 'tq-way-list' }, ...rows.map((r) => r.li)),
      slot,
      actions,
    );

    // ---- walking to waypoints ----------------------------------------------------------------
    function goTo(i: number): void {
      index = i;
      paint();
      const waypoint = waypoints[i]!;
      const position = positions[i]!;
      // Marker first: the host names the compass after whatever stands at its target.
      if (!compassOnly) {
        marker = world.spawnMarker({
          id: waypoint.id,
          label: waypoint.label,
          position,
          radius: NAVIGATE_REACH_RADIUS,
          onReach: () => reached(i),
        });
      }
      world.setCompassTarget(position);
    }

    function reached(i: number): void {
      if (finished || celebrating || i !== index) return;
      marker?.remove();
      marker = null;
      visited += 1;
      const label = waypoints[i]!.label;
      if (i >= total - 1) {
        celebrating = true;
        world.setCompassTarget(null);
        paint();
        showResultBanner(slot, 'yes', `You found the ${label}!`);
        const done = button(NAVIGATE_TEXT.finish, { variant: 'primary', onClick: () => leave(true) });
        actions.append(done);
        done.focus({ preventScroll: true });
        return;
      }
      showResultBanner(slot, 'yes', `You found the ${label}!`, { autoHideMs: FOUND_BANNER_MS });
      goTo(i + 1);
    }

    // Compass only: there is no marker to do the reach check, so look at where the Scout stands.
    const timer = compassOnly
      ? setInterval(() => {
          if (finished || celebrating) return;
          if (groundDistance(world.playerPosition(), positions[index]!) <= NAVIGATE_REACH_RADIUS) reached(index);
        }, REACH_POLL_MS)
      : null;

    function leave(completed: boolean): void {
      if (finished) return;
      finished = true;
      if (timer !== null) clearInterval(timer);
      panel.close();
      world.clear();
      resolve(completed ? { completed: true, attempts: total, score: 1 } : { completed: false, attempts: visited });
    }

    goTo(0);
  });
}

export const navigateActivity: ActivityController<'navigate'> = {
  type: 'navigate',
  run: runNavigate,
};
