import { h } from '../../ui/dom';
import { mountOverlay } from '../../ui/overlay';
import { button } from '../../ui/widgets';

export interface ConfirmOptions {
  title: string;
  text: string;
  yes: string;
  no: string;
}

/**
 * A plain two-button question. Resolves true on the "yes" button, false on "no" or Escape.
 * "No" has focus and is the default, so a stray Enter never destroys anything.
 */
export function askConfirm(host: HTMLElement, options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let finished = false;
    const finish = (value: boolean): void => {
      if (finished) return;
      finished = true;
      overlay.close();
      resolve(value);
    };
    const overlay = mountOverlay(host, {
      label: options.title,
      cardClass: 'tq-confirm',
      onEscape: () => finish(false),
    });
    const no = button(options.no, { variant: 'primary', onClick: () => finish(false) });
    const yes = button(options.yes, { variant: 'secondary', onClick: () => finish(true) });
    overlay.card.append(
      h('h2', null, options.title),
      h('p', null, options.text),
      h('div', { class: 'tq-actions' }, no, yes),
    );
    overlay.setDefault(no);
    overlay.focus(no);
  });
}
