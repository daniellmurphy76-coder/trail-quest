import { h } from './dom';

/**
 * A small message at the top of the screen that goes away by itself. Tap it to dismiss early.
 * Returns a function that removes it right away.
 */
export function showToast(host: HTMLElement, text: string, ms = 2500): () => void {
  const toast = h('div', { class: 'tq-toast', role: 'status', attrs: { 'aria-live': 'polite' } }, text);
  const remove = (): void => {
    clearTimeout(timer);
    toast.remove();
  };
  const timer = setTimeout(remove, ms);
  toast.addEventListener('click', remove);
  host.appendChild(toast);
  return remove;
}
