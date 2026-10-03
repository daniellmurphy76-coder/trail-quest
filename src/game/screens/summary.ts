import { append, h } from '../../ui/dom';
import { mountOverlay } from '../../ui/overlay';
import { button } from '../../ui/widgets';
import '../rewards.css';
import { line, type LineLevel, type LineVars } from '../lines';
import type { SummaryChoice, SummaryInfo } from '../session';

export interface SummaryScreenOptions {
  info: SummaryInfo;
  level: LineLevel;
  vars: LineVars;
}

/**
 * The end-of-trail card: the Scout's trail title under the heading, stops done, XP earned today,
 * the campfire streak, badges and cosmetics earned, and a goodbye. Offers "Keep going!" (when there is more to do) and "Explore camp". When the trail is
 * finished and nothing is left, the Den Chief says everything is done for now instead.
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
      row('XP earned', `${info.xpEarned} XP`),
    );

    // The trail title sits right under the heading. A title earned on this trail gets its own line.
    const titleLine = info.title
      ? h(
          'p',
          { class: 'tq-summary__title' },
          h('span', { class: 'tq-icon', attrs: { 'aria-hidden': 'true' } }, '★'),
          h('span', null, line('summaryTrailTitle', level, { ...vars, trailTitle: info.title })),
        )
      : null;
    const newTitleLine = info.newTitle
      ? h('p', { class: 'tq-summary__newtitle' }, line('summaryNewTitle', level, { ...vars, trailTitle: info.newTitle }))
      : null;

    const unlockList =
      info.unlocks && info.unlocks.length > 0
        ? h(
            'ul',
            { class: 'tq-summary__unlocks' },
            ...info.unlocks.map((name) =>
              h(
                'li',
                null,
                h('span', { class: 'tq-icon', attrs: { 'aria-hidden': 'true' } }, '✦'),
                line('summaryUnlock', level, { ...vars, unlock: name }),
              ),
            ),
          )
        : null;

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
      variant: info.keepGoingAvailable ? 'secondary' : 'primary',
      onClick: () => finish('explore'),
    });
    const keepGoing = info.keepGoingAvailable
      ? button(line('choiceKeepGoing', level, vars), { variant: 'primary', icon: '▶', onClick: () => finish('keep-going') })
      : null;
    const everythingDone = !info.keepGoingAvailable && info.stopsDone === info.stopsTotal;

    append(overlay.card, [
      h('div', { class: 'tq-prompt' }, h('h2', null, title)),
      titleLine,
      newTitleLine,
      rows,
      h(
        'p',
        { class: `tq-campfire${info.streakLit ? ' is-lit' : ''}` },
        h('span', { class: 'tq-icon', attrs: { 'aria-hidden': 'true' } }, info.streakLit ? '\u{1F525}' : '\u{1F3D5}'),
        h('span', null, campfire),
      ),
      badgeList,
      unlockList,
      h('p', null, line(everythingDone ? 'allDone' : 'summaryBye', level, vars)),
      h('div', { class: 'tq-actions' }, keepGoing, explore),
    ]);
    const primary = keepGoing ?? explore;
    overlay.setDefault(primary);
    overlay.focus(primary);
  });
}
