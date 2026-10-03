/**
 * The full-screen veil that hides a zone swap: it fades to opaque, the game swaps the zone while
 * nothing can be seen, then it fades back. Under `prefers-reduced-motion` it cuts instantly.
 * A plain div in `#ui`; the look and the fade live in game.css (.tq-veil).
 */
import { h } from '../ui/dom';

export const VEIL_FADE_MS = 300;

export interface Veil {
  readonly root: HTMLElement;
  /** Fade to opaque. Resolves once the screen is covered. */
  fadeOut(): Promise<void>;
  /** Fade back to clear. Resolves once the screen is visible again. */
  fadeIn(): Promise<void>;
}

export interface VeilOptions {
  /** Fade length in milliseconds. Default 300. */
  ms?: number;
  /** True when motion should be skipped. Default: the `prefers-reduced-motion` media query. */
  reducedMotion?: () => boolean;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function createVeil(host: HTMLElement, options: VeilOptions = {}): Veil {
  const ms = options.ms ?? VEIL_FADE_MS;
  const reduced = options.reducedMotion ?? prefersReducedMotion;
  const root = h('div', { class: 'tq-veil', attrs: { 'aria-hidden': 'true' } });
  host.appendChild(root);

  function fade(up: boolean): Promise<void> {
    root.style.transitionDuration = reduced() ? '0ms' : `${ms}ms`;
    root.classList.toggle('is-up', up);
    if (reduced() || ms <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      // A timer, not transitionend: it also fires when the tab is hidden or the page never paints.
      setTimeout(resolve, ms);
    });
  }

  return {
    root,
    fadeOut: () => fade(true),
    fadeIn: () => fade(false),
  };
}
