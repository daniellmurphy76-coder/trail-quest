import { h } from '../../ui/dom';
import { button } from '../../ui/widgets';
import { line } from '../lines';
import type { TrailView } from '../session';

/** A trail has three stops. Used when the trail is done and the stops are not in memory. */
export const TRAIL_STOPS = 3;

export interface TrailProgress {
  /** Stops finished on the current trail. */
  done: number;
  /** Stops on the current trail. */
  total: number;
  /** The trail is finished: show the check mark. */
  complete: boolean;
}

/**
 * The progress dots under the Today's Trail button: one per stop of the current trail (today's
 * first, or the one the Scout is keeping going with). Null when there is nothing to track (no
 * stops today). A finished trail reads as all dots filled and a check mark, even after a reload
 * when the stops themselves are no longer in memory. If the last trail was finished with a stop
 * skipped, the dots show how many were done and there is no check mark.
 */
export function trailProgress(view: TrailView): TrailProgress | null {
  if (view.state === 'empty') return null;
  const done = view.items.filter((item) => item.status === 'done').length;
  if (view.state === 'done-today') {
    if (view.items.length === 0) return { done: TRAIL_STOPS, total: TRAIL_STOPS, complete: true };
    return { done, total: view.items.length, complete: done === view.items.length };
  }
  return { done, total: view.items.length, complete: false };
}

export interface HudInfo {
  name: string;
  /** For example "Wolf". */
  rankLabel: string;
  xp: number;
  /** The streak to show (see activeStreak). */
  streak: number;
  /** Today's trail progress for the dots. Omit or null to hide them. */
  progress?: TrailProgress | null;
}

export interface Hud {
  root: HTMLElement;
  /** Show the Scout's numbers, or hide the HUD when there is no active Scout. */
  update(info: HudInfo | null): void;
  /** The Today's Trail button, so the app can return focus to it. */
  trailButton: HTMLButtonElement;
}

/**
 * The top-left status card: name and rank (the rank label comes from the content, so any of the
 * six ranks reads right), XP, the campfire streak (flame icon, "Day N" and the word "streak"), the
 * Today's Trail button, and dots under it, one per stop of the current trail, that fill as stops
 * are done.
 * The dots are always paired with words ("1 of 3", then a check mark and "Done"), so progress is
 * never colour alone.
 */
export function createHud(host: HTMLElement, onTrail: () => void): Hud {
  const who = h('p', { class: 'tq-hud__who' });
  const xp = h('span', { class: 'tq-hud__xp' });
  const streakIcon = h('span', { class: 'tq-icon', attrs: { 'aria-hidden': 'true' } }, '\u{1F525}');
  const streakText = h('span', null);
  const trail = button(line('hudTrail', 'grade2'), { icon: '\u{1F5FA}', class: 'tq-hud__trail', onClick: onTrail });
  const dots = h('span', { class: 'tq-hud__dots', attrs: { 'aria-hidden': 'true' } });
  const progressText = h('span', { class: 'tq-hud__progress-text' });
  const progress = h('p', { class: 'tq-hud__progress', hidden: true }, dots, progressText);

  const root = h(
    'div',
    { class: 'tq-hud', role: 'group', attrs: { 'aria-label': 'Scout status' }, hidden: true },
    who,
    h('p', { class: 'tq-hud__stats' }, xp, h('span', { class: 'tq-hud__streak' }, streakIcon, streakText)),
    trail,
    progress,
  );
  host.appendChild(root);

  function showProgress(info: TrailProgress | null | undefined): void {
    progress.hidden = !info;
    if (!info) return;
    if (dots.children.length !== info.total) {
      dots.replaceChildren(...Array.from({ length: info.total }, () => h('span', { class: 'tq-dot' })));
    }
    Array.from(dots.children).forEach((dot, i) => dot.classList.toggle('is-filled', i < info.done));
    progress.classList.toggle('is-complete', info.complete);
    progressText.textContent = info.complete
      ? line('hudProgressDone', 'grade2')
      : line('hudProgress', 'grade2', { done: info.done, total: info.total });
  }

  return {
    root,
    trailButton: trail,
    update(info) {
      root.hidden = info === null;
      if (!info) return;
      who.replaceChildren(h('strong', null, info.name), ` · ${info.rankLabel}`);
      xp.textContent = `${info.xp} XP`;
      streakText.textContent = `Day ${info.streak} streak`;
      showProgress(info.progress);
    },
  };
}
