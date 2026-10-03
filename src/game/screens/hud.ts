import { h } from '../../ui/dom';
import { button } from '../../ui/widgets';

export interface HudInfo {
  name: string;
  /** For example "Wolf". */
  rankLabel: string;
  xp: number;
  /** The streak to show (see activeStreak). */
  streak: number;
}

export interface Hud {
  root: HTMLElement;
  /** Show the Scout's numbers, or hide the HUD when there is no active Scout. */
  update(info: HudInfo | null): void;
  /** The Trail button, so the app can return focus to it. */
  trailButton: HTMLButtonElement;
}

/**
 * The top-left status card, replacing the old Phase pill: name and rank, XP, the campfire streak
 * (flame icon, "Day N" and the word "streak") and the Trail button.
 */
export function createHud(host: HTMLElement, onTrail: () => void): Hud {
  const who = h('p', { class: 'tq-hud__who' });
  const xp = h('span', { class: 'tq-hud__xp' });
  const streakIcon = h('span', { class: 'tq-icon', attrs: { 'aria-hidden': 'true' } }, '\u{1F525}');
  const streakText = h('span', null);
  const trail = button('Trail', { icon: '\u{1F5FA}', class: 'tq-hud__trail', onClick: onTrail });
  trail.setAttribute('aria-label', "Open Today's Trail");

  const root = h(
    'div',
    { class: 'tq-hud', role: 'group', attrs: { 'aria-label': 'Scout status' }, hidden: true },
    who,
    h('p', { class: 'tq-hud__stats' }, xp, h('span', { class: 'tq-hud__streak' }, streakIcon, streakText)),
    trail,
  );
  host.appendChild(root);

  return {
    root,
    trailButton: trail,
    update(info) {
      root.hidden = info === null;
      if (!info) return;
      who.replaceChildren(h('strong', null, info.name), ` · ${info.rankLabel}`);
      xp.textContent = `${info.xp} XP`;
      streakText.textContent = `Day ${info.streak} streak`;
    },
  };
}
