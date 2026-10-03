import { h } from '../../ui/dom';
import { mountOverlay } from '../../ui/overlay';

/**
 * The "trail sign" card shown while the Scout walks to another zone: a signpost with the text.
 * It has no buttons and goes away when the returned function is called. Screen readers hear the
 * text through the live region.
 */
export function showTrailSign(host: HTMLElement, text: string): () => void {
  const overlay = mountOverlay(host, { label: text, cardClass: 'tq-sign-card' });
  overlay.root.classList.add('tq-overlay--sign');
  const heading = h('h2', { class: 'tq-sign__text', tabIndex: -1, attrs: { 'aria-live': 'polite' } }, text);
  overlay.card.append(
    h('div', { class: 'tq-sign', attrs: { 'aria-hidden': 'true' } }, h('span', { class: 'tq-sign__arrow' }, '→')),
    heading,
  );
  overlay.focus(heading);
  return () => overlay.close();
}
