import { h } from './dom';
import { readButton } from './widgets';
import type { Speak } from './speech';

export type ResultKind = 'yes' | 'notyet';

export interface ResultBannerOptions {
  /** Fade the banner away after this many milliseconds. Omit to keep it until replaced. */
  autoHideMs?: number;
  /** When given, the banner carries a Read button that reads the word and the text. */
  speak?: Speak;
}

export interface ResultBanner {
  el: HTMLElement;
  remove(): void;
}

const WORDS: Record<ResultKind, { word: string; icon: string }> = {
  yes: { word: 'Yes!', icon: '✔' }, // heavy check mark
  notyet: { word: 'Not yet', icon: '↻' }, // clockwise arrow: try again
};

/**
 * Shows a short result banner inside `host`, replacing any earlier banner there. Status is never
 * color-only: an icon and a word ("Yes!" or "Not yet") come with the color. The pop and shake
 * animations are plain CSS and switch off under `prefers-reduced-motion`.
 */
export function showResultBanner(
  host: HTMLElement,
  kind: ResultKind,
  text: string,
  options: ResultBannerOptions = {},
): ResultBanner {
  const { word, icon: iconChar } = WORDS[kind];
  host.replaceChildren();
  // The host acts as a polite live region so screen readers announce the new banner.
  if (!host.hasAttribute('aria-live')) host.setAttribute('aria-live', 'polite');

  const spoken = text ? `${word} ${text}` : word;
  const el = h(
    'div',
    { class: `tq-banner tq-banner--${kind}`, role: 'status' },
    h('span', { class: 'tq-banner__icon', attrs: { 'aria-hidden': 'true' } }, iconChar),
    h(
      'div',
      { class: 'tq-banner__body' },
      h('p', { class: 'tq-banner__word' }, word),
      text ? h('p', { class: 'tq-banner__text' }, text) : null,
    ),
    options.speak ? readButton(spoken, options.speak) : null,
  );
  host.appendChild(el);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const remove = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    el.remove();
  };
  if (options.autoHideMs !== undefined) {
    timer = setTimeout(() => {
      el.classList.add('is-leaving');
      timer = setTimeout(remove, 260);
    }, options.autoHideMs);
  }
  return { el, remove };
}
