import { append, h } from '../../ui/dom';
import { mountOverlay } from '../../ui/overlay';
import type { Speak } from '../../ui/speech';
import { button, readButton } from '../../ui/widgets';
import { line, PARENT_TEXT, type LineLevel, type LineVars } from '../lines';
import type { ApprovalInfo } from '../session';

export interface ApprovalScreenOptions {
  info: ApprovalInfo;
  level: LineLevel;
  vars: LineVars;
  speak: Speak;
}

/**
 * "Ask your parent to approve: {mission}". Shows what the mission was and, for the parent, the
 * note about what to look for. Resolves true when the kid taps the button to hand the screen over
 * (the PIN pad comes next), false on "Not now".
 */
export function showApprovalScreen(host: HTMLElement, options: ApprovalScreenOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let finished = false;
    const finish = (value: boolean): void => {
      if (finished) return;
      finished = true;
      overlay.close();
      resolve(value);
    };
    const { info, level, speak } = options;
    const title = line('approvalTitle', level, { ...options.vars, title: info.title });
    const help = line('approvalHelp', level, options.vars);
    const overlay = mountOverlay(host, {
      label: title,
      cardClass: 'tq-approval',
      onEscape: () => finish(false),
    });

    const go = button('Parent: enter PIN', { variant: 'primary', icon: '✓', onClick: () => finish(true) });
    const notNow = button('Not now', { icon: '↻', onClick: () => finish(false) });

    append(overlay.card, [
      h('p', { class: 'tq-eyebrow' }, 'Field mission'),
      h('div', { class: 'tq-prompt' }, h('h2', null, title), readButton(`${title}. ${help}`, speak)),
      h('p', null, help),
      info.steps.length > 0 ? h('ol', { class: 'tq-steps' }, ...info.steps.map((step) => h('li', null, h('span', null, step)))) : null,
      h(
        'div',
        { class: 'tq-parent-box' },
        h('p', { class: 'tq-parent-box__title' }, 'For the parent'),
        info.parentNote ? h('p', { class: 'tq-parent-note' }, info.parentNote) : null,
        h('p', { class: 'tq-hint' }, PARENT_TEXT.approvalReminder),
      ),
      h('div', { class: 'tq-actions' }, go, notNow),
    ]);
    overlay.setDefault(go);
    overlay.focus(go);
    speak(title);
  });
}
