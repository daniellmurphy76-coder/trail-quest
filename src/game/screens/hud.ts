import { h } from '../../ui/dom';
import { button } from '../../ui/widgets';
import { line } from '../lines';
import type { TrailView } from '../session';

/** Today's trail has three stops. Used when the trail is done and the stops are not in memory. */
export const TRAIL_STOPS = 3;

export interface TrailProgress {
  /** Stops finished today. */
  done: number;
  /** Stops on today's trail. */
  total: number;
  /** Today's trail is finished: show the check mark. */
  complete: boolean;
}

/**
 * The three progress dots under the Today's Trail button. Null when there is nothing to track
 * (no stops today). A finished trail reads as all dots filled, even after a reload when the
 * stops themselves are no longer in memory.
 */
export function trailProgress(view: TrailView): TrailProgress | null {
  if (view.state === 'empty') return null;
  if (view.state === 'done-today') {
    const total = view.items.length > 0 ? view.items.length : TRAIL_STOPS;
    return { done: total, total, complete: true };
  }
  return {
    done: view.items.filter((item) => item.status === 'done').length,
    total: view.items.length,
    complete: false,
  };
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
 * The top-left status card: name and rank, XP, the campfire streak (flame icon, "Day N" and the
 * word "streak"), the Today's Trail button, and three dots under it that fill as stops are done.
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
