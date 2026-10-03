import { h } from './dom';
import { mountOverlay } from './overlay';
import { isFullyRevealed, TYPEWRITER_MS_PER_CHAR, visibleText } from './typewriter';
import { button, srOnly, uid } from './widgets';

export interface DialogOptions {
  speaker: string;
  text: string;
  /** One button per choice. Omit for a single big "Next" button. */
  choices?: string[];
}

/**
 * A dialogue box: the speaker's name on a tab, the words revealed like a typewriter, and either
 * a big "Next" button or one button per choice. Resolves with the index chosen (0 for Next) and
 * removes itself.
 *
 * The reveal runs at `TYPEWRITER_MS_PER_CHAR` per character, or all at once under
 * `prefers-reduced-motion`. While it runs, a tap anywhere on the box (even on a button) or
 * Enter or Space completes it. After that, Enter or Space presses the focused button (or the
 * default one), and a tap on the box away from the buttons presses Next. Screen readers get the
 * whole text up front, and a click that does not come from a pointer (assistive tech) is never
 * held back by the reveal.
 */
export function showDialog(host: HTMLElement, options: DialogOptions): Promise<number> {
  return new Promise<number>((resolve) => {
    const choices = options.choices && options.choices.length > 0 ? options.choices : null;
    const text = options.text;
    const overlay = mountOverlay(host, {
      label: options.speaker,
      variant: 'dialog',
      onConfirmKey: () => {
        // The first Enter or Space finishes the words; the next one presses the button.
        if (revealing) {
          completeReveal();
          return true;
        }
        return false;
      },
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
    let revealing = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function done(index: number): void {
      if (finished) return;
      finished = true;
      if (timer !== undefined) clearTimeout(timer);
      overlay.close();
      resolve(index);
    }

    const textId = uid('tq-dialog-text');
    const shown = h('span', { class: 'tq-dialog__shown' });
    const rest = h('span', { class: 'tq-dialog__rest' });
    const draw = (elapsedMs: number): void => {
      const now = visibleText(text, elapsedMs);
      shown.textContent = now;
      rest.textContent = text.slice(now.length); // hidden, but it holds the lines in place
    };

    function completeReveal(): void {
      if (!revealing) return;
      revealing = false;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      draw(Number.POSITIVE_INFINITY);
    }

    const buttons: HTMLButtonElement[] = choices
      ? choices.map((label, i) => button(label, { variant: 'choice', onClick: () => done(i) }))
      : [button('Next', { variant: 'primary', onClick: () => done(0) })];

    overlay.card.classList.add('tq-bubble');
    overlay.card.append(
      h('p', { class: 'tq-nameplate' }, options.speaker),
      h(
        'p',
        { class: 'tq-dialog__text', id: textId },
        srOnly(text),
        h('span', { class: 'tq-dialog__type', attrs: { 'aria-hidden': 'true' } }, shown, rest),
      ),
      choices ? h('div', { class: 'tq-dialog__choices' }, ...buttons) : h('div', { class: 'tq-actions' }, ...buttons),
    );
    overlay.root.setAttribute('aria-describedby', textId);

    // Taps are caught on the way down so a tap on a button can finish the reveal without also
    // pressing the button. detail is 0 for keyboard, screen reader and scripted clicks.
    overlay.card.addEventListener(
      'click',
      (event) => {
        if (finished) return;
        const onButton = event.target instanceof Element && event.target.closest('button') !== null;
        if (revealing) {
          if (event.detail > 0 || !onButton) {
            event.stopPropagation();
            event.preventDefault();
            completeReveal();
          }
          return;
        }
        if (!onButton && !choices && event.detail > 0) {
          event.stopPropagation();
          done(0);
        }
      },
      true,
    );

    overlay.setDefault(buttons[0] ?? null);
    overlay.focus(buttons[0]);

    const reduced =
      typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
    revealing = !reduced && !isFullyRevealed(text, 0);
    if (!revealing) {
      draw(Number.POSITIVE_INFINITY);
    } else {
      const start = performance.now();
      draw(0);
      const tick = (): void => {
        if (finished || !revealing) return;
        if (!overlay.root.isConnected) {
          // Someone cleared the host without calling close(): do not leave a timer behind.
          revealing = false;
          return;
        }
        const elapsed = performance.now() - start;
        draw(elapsed);
        if (isFullyRevealed(text, elapsed)) {
          revealing = false;
          return;
        }
        timer = setTimeout(tick, TYPEWRITER_MS_PER_CHAR);
      };
      timer = setTimeout(tick, TYPEWRITER_MS_PER_CHAR);
    }
  });
}
