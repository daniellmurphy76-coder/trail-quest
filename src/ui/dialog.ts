import { h } from './dom';
import { mountOverlay } from './overlay';
import type { Speak } from './speech';
import { button, readButton, uid } from './widgets';

export interface DialogOptions {
  speaker: string;
  text: string;
  /** One button per choice. Omit for a single big "Next" button. */
  choices?: string[];
  /** Usually `ctx.speak` or the result of `createSpeaker`. */
  speak: Speak;
  /** Read the text aloud as soon as the dialog opens. */
  autoSpeak?: boolean;
}

/**
 * A speech-bubble card: speaker name, text, a Read button, and either a big "Next" button or one
 * button per choice. Resolves with the index chosen (0 for Next) and removes itself.
 * Enter and Space press the focused button; with nothing focused they press the default one.
 */
export function showDialog(host: HTMLElement, options: DialogOptions): Promise<number> {
  return new Promise<number>((resolve) => {
    const choices = options.choices && options.choices.length > 0 ? options.choices : null;
    const overlay = mountOverlay(host, {
      label: options.speaker,
      variant: 'dialog',
      onKey: (event) => {
        // Number keys pick a choice on a laptop: 1 is the first button.
        if (!choices || event.ctrlKey || event.metaKey || event.altKey) return false;
        const n = Number(event.key);
        if (Number.isInteger(n) && n >= 1 && n <= choices.length) {
          done(n - 1);
          return true;
        }
        return false;
      },
    });

    let finished = false;
    function done(index: number): void {
      if (finished) return;
      finished = true;
      overlay.close();
      resolve(index);
    }

    const textId = uid('tq-dialog-text');
    const buttons: HTMLButtonElement[] = choices
      ? choices.map((label, i) => button(label, { variant: 'choice', onClick: () => done(i) }))
      : [button('Next', { variant: 'primary', onClick: () => done(0) })];

    overlay.card.classList.add('tq-bubble');
    overlay.card.append(
      h('p', { class: 'tq-nameplate' }, options.speaker),
      h('p', { class: 'tq-dialog__text', id: textId }, options.text),
      h('div', { class: 'tq-actions' }, readButton(options.text, options.speak)),
      choices ? h('div', { class: 'tq-dialog__choices' }, ...buttons) : h('div', { class: 'tq-actions' }, ...buttons),
    );
    overlay.root.setAttribute('aria-describedby', textId);

    overlay.setDefault(buttons[0] ?? null);
    overlay.focus(buttons[0]);
    if (options.autoSpeak) options.speak(options.text);
  });
}
