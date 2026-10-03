import './poster.css';
import { append, h, type Child } from './dom';
import { mountOverlay } from './overlay';
import { button } from './widgets';

/** The text of a poster: a title and every line, shown whole. */
export interface PosterText {
  title: string;
  lines: readonly string[];
}

export interface PosterPageOptions extends PosterText {
  /** A short Den Chief line under the title, for example "Here is the whole thing." */
  hint?: string;
  /** The words on the one big button. Default "Next". */
  buttonLabel?: string;
}

/**
 * The poster's lines as a clean list. Every line is in the document at once: no typewriter, no
 * cut-off. The caller puts it in a card (or in the Scout Book).
 */
export function posterLines(lines: readonly string[]): HTMLUListElement {
  return h(
    'ul',
    { class: 'tq-poster__lines' },
    ...lines.map((text) => h('li', { class: 'tq-poster__line' }, text)),
  );
}

/** The title, the optional hint and the list of lines, in the order they sit on the card. */
function posterContent(content: PosterText, hint?: string): Child[] {
  return [
    content.title.trim() === '' ? null : h('h2', { class: 'tq-poster__title' }, content.title),
    hint ? h('p', { class: 'tq-poster__hint' }, hint) : null,
    posterLines(content.lines),
  ];
}

interface MountOptions {
  hint?: string;
  label: string;
  icon?: string;
  variant: 'primary' | 'secondary';
  /** Escape closes it. Only the peek allows that; the lesson poster waits for Next. */
  escape: boolean;
}

function mountPoster(host: HTMLElement, content: PosterText, options: MountOptions): Promise<void> {
  return new Promise<void>((resolve) => {
    let finished = false;
    const done = (): void => {
      if (finished) return;
      finished = true;
      overlay.close();
      resolve();
    };
    const overlay = mountOverlay(host, {
      label: content.title.trim() === '' ? 'Poster' : content.title,
      cardClass: 'tq-poster',
      onEscape: options.escape ? done : undefined,
    });
    const action = button(options.label, { variant: options.variant, icon: options.icon, onClick: done });
    append(overlay.card, [
      ...posterContent(content, options.hint),
      h('div', { class: 'tq-actions tq-poster__actions' }, action),
    ]);
    overlay.setDefault(action);
    overlay.focus(action);
  });
}

/**
 * A poster page: one card with the title and every line visible at once in big type, and a single
 * big Next button (Enter or Space presses it). The card scrolls only when the screen is very
 * short. Resolves when the Scout taps Next. Nothing here is spoken.
 */
export function showPoster(host: HTMLElement, options: PosterPageOptions): Promise<void> {
  return mountPoster(host, options, {
    hint: options.hint,
    label: options.buttonLabel ?? 'Next',
    variant: 'primary',
    escape: false,
  });
}

/**
 * A peek: the same card with a "Back" button, drawn above whatever is on screen (an activity) without
 * ending it. Resolves when it closes (Back, Enter, Space or Escape); the screen underneath is exactly
 * as it was, and focus returns to the button that opened it.
 */
export function posterOverlay(host: HTMLElement, content: PosterText): Promise<void> {
  return mountPoster(host, content, { label: 'Back', icon: '←', variant: 'primary', escape: true });
}
