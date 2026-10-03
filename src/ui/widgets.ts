import { h, type Child } from './dom';
import type { Speak } from './speech';

/** Decorative icon character. Hidden from screen readers; the label next to it carries the meaning. */
export function icon(char: string): HTMLSpanElement {
  return h('span', { class: 'tq-icon', attrs: { 'aria-hidden': 'true' } }, char);
}

/** Text that only screen readers see. */
export function srOnly(text: string): HTMLSpanElement {
  return h('span', { class: 'tq-sr' }, text);
}

export interface ButtonOptions {
  variant?: 'primary' | 'secondary' | 'choice';
  /** Icon character shown before the label. */
  icon?: string;
  onClick?: (event: MouseEvent) => void;
  class?: string;
  disabled?: boolean;
}

/** A chunky button. Always at least 44px tall; primary is 56px. */
export function button(label: Child, options: ButtonOptions = {}): HTMLButtonElement {
  const variant = options.variant ?? 'secondary';
  const classes = ['tq-btn', `tq-btn--${variant}`];
  if (options.class) classes.push(options.class);
  return h(
    'button',
    {
      class: classes.join(' '),
      type: 'button',
      disabled: options.disabled,
      on: options.onClick ? { click: options.onClick } : undefined,
    },
    options.icon ? icon(options.icon) : null,
    label,
  );
}

/**
 * The read-aloud button every text box gets: a speaker icon plus the word "Read". It always
 * speaks when tapped, even if automatic read-aloud is off for the profile.
 */
export function readButton(
  getText: string | (() => string),
  speak: Speak,
  label = 'Read',
): HTMLButtonElement {
  const btn = button(label, {
    variant: 'secondary',
    icon: '\u{1F50A}',
    class: 'tq-btn--read',
    onClick: () => speak(typeof getText === 'function' ? getText() : getText, { force: true }),
  });
  if (label === 'Read') btn.setAttribute('aria-label', 'Read aloud');
  return btn;
}

let idCounter = 0;
/** A page-unique id for aria wiring. */
export function uid(prefix = 'tq'): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}
