import { append, h } from '../../ui/dom';
import { mountOverlay } from '../../ui/overlay';
import { button } from '../../ui/widgets';
import { line, type LineLevel, type LineVars } from '../lines';
import type { SummaryChoice, SummaryInfo } from '../session';

export interface SummaryScreenOptions {
  info: SummaryInfo;
  level: LineLevel;
  vars: LineVars;
}

/**
 * The end-of-trail card: stops done, XP earned today, the campfire streak, badges earned, and a
 * goodbye. Offers "Bonus stop" (when there is one) and "Explore camp".
 */
export function showSummary(host: HTMLElement, options: SummaryScreenOptions): Promise<SummaryChoice> {
  return new Promise<SummaryChoice>((resolve) => {
    let finished = false;
    const finish = (choice: SummaryChoice): void => {
      if (finished) return;
      finished = true;
      overlay.close();
      resolve(choice);
    };
    const { info, level, vars } = options;
    const title = line('summaryTitle', level, vars);
    const overlay = mountOverlay(host, {
      label: title,
      cardClass: 'tq-summary',
      onEscape: () => finish('explore'),
    });

    const row = (label: string, value: string): HTMLElement =>
      h('div', { class: 'tq-summary__row' }, h('dt', null, label), h('dd', null, value));

    const rows = h(
      'dl',
      { class: 'tq-summary__rows' },
      row('Stops done', `${info.stopsDone} of ${info.stopsTotal}`),
      row('XP earned today', `${info.xpEarned} XP`),
    );

    const campfire = info.streakLit
      ? line('campfireLit', level, { ...vars, streak: info.streak })
      : line('campfireNot', level, vars);

    const badgeList =
      info.badges.length > 0
        ? h(
            'ul',
            { class: 'tq-summary__badges' },
            ...info.badges.map((name) =>
              h('li', null, h('span', { class: 'tq-icon', attrs: { 'aria-hidden': 'true' } }, '★'), `Badge: ${name}`),
            ),
          )
        : null;

    const explore = button('Explore camp', {
      variant: info.bonusAvailable ? 'secondary' : 'primary',
      onClick: () => finish('explore'),
    });
    const bonus = info.bonusAvailable
      ? button('Bonus stop', { variant: 'primary', icon: '+', onClick: () => finish('bonus') })
      : null;

    append(overlay.card, [
      h('div', { class: 'tq-prompt' }, h('h2', null, title)),
      rows,
      h(
        'p',
        { class: `tq-campfire${info.streakLit ? ' is-lit' : ''}` },
        h('span', { class: 'tq-icon', attrs: { 'aria-hidden': 'true' } }, info.streakLit ? '\u{1F525}' : '\u{1F3D5}'),
        h('span', null, campfire),
      ),
      badgeList,
      h('p', null, line('summaryBye', level, vars)),
      h('div', { class: 'tq-actions' }, bonus, explore),
    ]);
    const primary = bonus ?? explore;
    overlay.setDefault(primary);
    overlay.focus(primary);
  });
}
