import { h } from '../ui/dom';
import { posterOverlay } from '../ui/poster';
import { button } from '../ui/widgets';
import type { ActivityContext } from './types';

/** Eyebrow line plus a "Back" button, the top row of an activity card. */
export function cardHeader(eyebrow: string, onBack?: () => void): HTMLElement {
  return h(
    'div',
    { class: 'tq-header' },
    h('p', { class: 'tq-eyebrow' }, eyebrow),
    onBack ? button('Back', { icon: '←', onClick: onBack }) : null,
  );
}

/** The live region banners are shown in. Empty slots are hidden by CSS. */
export function feedbackSlot(): HTMLDivElement {
  return h('div', { class: 'tq-feedback', attrs: { 'aria-live': 'polite' } });
}

/** The words on the peek button. */
export const PEEK_LABEL = 'Show me';

/**
 * The "Show me" button: opens the poster (the whole Scout Oath, say) over the activity and goes back
 * to it, exactly as it was, when the Scout taps Back. Peeking is never penalized: it touches no
 * score and no count. Returns null when the context has no poster, so an activity can drop the result
 * straight into its prompt row: `h('div', { class: 'tq-prompt' }, h('h2', null, prompt), peekButton(host, ctx.poster))`.
 */
export function peekButton(host: HTMLElement, poster: ActivityContext['poster']): HTMLButtonElement | null {
  if (!poster || poster.lines.length === 0) return null;
  let open = false;
  const btn = button(PEEK_LABEL, {
    icon: '\u{1F440}',
    class: 'tq-peek',
    onClick: () => {
      if (open) return;
      open = true;
      void posterOverlay(host, poster).finally(() => {
        open = false;
      });
    },
  });
  btn.setAttribute('aria-haspopup', 'dialog');
  return btn;
}
