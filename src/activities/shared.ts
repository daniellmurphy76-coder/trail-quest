import { h } from '../ui/dom';
import { button } from '../ui/widgets';

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
