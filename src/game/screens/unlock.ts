import { h } from '../../ui/dom';
import { mountOverlay } from '../../ui/overlay';
import { button } from '../../ui/widgets';
import '../rewards.css';
import { line, type LineLevel, type LineVars } from '../lines';
import { UNLOCK_LINE_BY_GROUP } from '../rewards';
import type { UnlockInfo } from '../session';

export interface UnlockCardOptions {
  info: UnlockInfo;
  level: LineLevel;
  vars: LineVars;
}

/** The Den Chief's line for a new cosmetic ("You earned a new hat! Try it on in Change my look."). */
export function unlockLine(info: UnlockInfo, level: LineLevel, vars: LineVars = {}): string {
  return line(UNLOCK_LINE_BY_GROUP[info.group], level, { ...vars, unlock: info.label });
}

/**
 * "You earned a new hat!" with the name of what was earned. Resolves when the kid taps Great.
 * Confetti is not drawn here: the cosmetic-unlocked event does that.
 */
export function showUnlockCard(host: HTMLElement, options: UnlockCardOptions): Promise<void> {
  return new Promise<void>((resolve) => {
    let finished = false;
    const text = unlockLine(options.info, options.level, options.vars);
    const overlay = mountOverlay(host, { label: text, cardClass: 'tq-unlock-card' });
    const done = button('Great!', {
      variant: 'primary',
      onClick: () => {
        if (finished) return;
        finished = true;
        overlay.close();
        resolve();
      },
    });
    overlay.card.append(
      h('div', { class: 'tq-unlock__emblem', attrs: { 'aria-hidden': 'true' } }, '★'),
      h('p', { class: 'tq-unlock__name' }, options.info.label),
      h('div', { class: 'tq-prompt' }, h('h2', null, text)),
      h('div', { class: 'tq-actions' }, done),
    );
    overlay.setDefault(done);
    overlay.focus(done);
  });
}
