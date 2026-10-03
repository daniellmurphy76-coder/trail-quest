import { append, h } from './dom';
import { mountOverlay } from './overlay';
import { button } from './widgets';

const PIN_LENGTH = 4;

export interface PinOptions {
  title: string;
  subtitle?: string;
  /** Checks the finished 4-digit PIN. Resolve true to accept it. A rejected promise counts as "not right". */
  verify: (pin: string) => Promise<boolean>;
  /** Show a Cancel button (and let Escape cancel). Default true, so nobody is ever stuck. */
  allowCancel?: boolean;
}

export interface NewPinOptions {
  title: string;
  subtitle?: string;
  confirmTitle?: string;
  confirmSubtitle?: string;
  /** Default true. */
  allowCancel?: boolean;
}

interface PadOptions {
  title: string;
  subtitle?: string;
  check: (pin: string) => Promise<boolean>;
  failText?: string;
  cancelLabel?: string | null;
  backLabel?: string | null;
}

type PadOutcome = { kind: 'ok'; pin: string } | { kind: 'cancel' } | { kind: 'back' };

/** One PIN pad screen. Resolves when the PIN is accepted, or the player cancels or goes back. */
function runPad(host: HTMLElement, options: PadOptions): Promise<PadOutcome> {
  return new Promise<PadOutcome>((resolve) => {
    let digits = '';
    let busy = false;
    let finished = false;
    let shakeTimer: ReturnType<typeof setTimeout> | undefined;

    const overlay = mountOverlay(host, {
      label: options.title,
      cardClass: 'tq-pin',
      onEscape: options.cancelLabel ? () => finish({ kind: 'cancel' }) : undefined,
      onKey: (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return false;
        if (/^[0-9]$/.test(event.key)) {
          if (!event.repeat) press(event.key);
          return true;
        }
        if (event.key === 'Backspace') {
          if (!event.repeat) backspace();
          return true;
        }
        return false;
      },
    });

    function finish(outcome: PadOutcome): void {
      if (finished) return;
      finished = true;
      if (shakeTimer !== undefined) clearTimeout(shakeTimer);
      overlay.close();
      resolve(outcome);
    }

    const heading = h('h2', { tabIndex: -1 }, options.title);
    const dots = h('div', { class: 'tq-pin__dots', role: 'img' });
    const message = h('p', { class: 'tq-pin__msg', role: 'alert' });
    const dotEls = Array.from({ length: PIN_LENGTH }, () => h('span', { class: 'tq-pin__dot' }));
    dots.append(...dotEls);

    function renderDots(): void {
      dotEls.forEach((el, i) => el.classList.toggle('is-filled', i < digits.length));
      dots.setAttribute('aria-label', `${digits.length} of ${PIN_LENGTH} digits entered`);
    }

    function press(digit: string): void {
      if (busy || finished || digits.length >= PIN_LENGTH) return;
      message.textContent = '';
      digits += digit;
      renderDots();
      if (digits.length === PIN_LENGTH) void submit();
    }

    function backspace(): void {
      if (busy || finished || digits.length === 0) return;
      digits = digits.slice(0, -1);
      renderDots();
    }

    async function submit(): Promise<void> {
      const pin = digits;
      busy = true;
      overlay.root.setAttribute('aria-busy', 'true');
      let ok = false;
      try {
        ok = await options.check(pin);
      } catch {
        ok = false;
      }
      if (finished) return;
      busy = false;
      overlay.root.removeAttribute('aria-busy');
      if (ok) {
        finish({ kind: 'ok', pin });
        return;
      }
      digits = '';
      renderDots();
      message.textContent = `✖ ${options.failText ?? 'Not right, try again'}`;
      dots.classList.add('is-shaking');
      shakeTimer = setTimeout(() => dots.classList.remove('is-shaking'), 420);
    }

    const keyButton = (label: string, onClick: () => void, aria?: string): HTMLButtonElement => {
      const key = button(label, { variant: 'secondary', class: 'tq-pin__key', onClick });
      if (aria) key.setAttribute('aria-label', aria);
      return key;
    };
    const pad = h(
      'div',
      { class: 'tq-pin__pad', role: 'group', attrs: { 'aria-label': 'Number pad' } },
      ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => keyButton(d, () => press(d))),
      h('span', { attrs: { 'aria-hidden': 'true' } }),
      keyButton('0', () => press('0')),
      keyButton('⌫', backspace, 'Delete'),
    );

    const extras: HTMLButtonElement[] = [];
    if (options.backLabel) {
      extras.push(button(options.backLabel, { variant: 'secondary', onClick: () => finish({ kind: 'back' }) }));
    }
    if (options.cancelLabel) {
      extras.push(
        button(options.cancelLabel, {
          variant: 'secondary',
          icon: '✕',
          onClick: () => finish({ kind: 'cancel' }),
        }),
      );
    }

    append(overlay.card, [
      heading,
      options.subtitle ? h('p', { class: 'tq-hint' }, options.subtitle) : null,
      dots,
      message,
      pad,
      extras.length > 0 ? h('div', { class: 'tq-actions', style: 'justify-content:center' }, ...extras) : null,
    ]);
    renderDots();
    overlay.focus(heading);
  });
}

/** Asks for a 4-digit PIN and resolves true if `verify` accepts it, false if the player cancels. */
export async function askPin(host: HTMLElement, options: PinOptions): Promise<boolean> {
  const outcome = await runPad(host, {
    title: options.title,
    subtitle: options.subtitle,
    check: options.verify,
    cancelLabel: options.allowCancel === false ? null : 'Cancel',
  });
  return outcome.kind === 'ok';
}

/** Asks for a new PIN twice. Resolves with the PIN, or null if the player cancels. */
export async function askNewPin(host: HTMLElement, options: NewPinOptions): Promise<string | null> {
  const cancelLabel = options.allowCancel === false ? null : 'Cancel';
  for (;;) {
    const first = await runPad(host, {
      title: options.title,
      subtitle: options.subtitle,
      check: () => Promise.resolve(true),
      cancelLabel,
    });
    if (first.kind !== 'ok') return null;
    const second = await runPad(host, {
      title: options.confirmTitle ?? 'Type it one more time',
      subtitle: options.confirmSubtitle,
      check: (pin) => Promise.resolve(pin === first.pin),
      failText: 'Not the same, try again',
      cancelLabel,
      backLabel: 'Start over',
    });
    if (second.kind === 'ok') return second.pin;
    if (second.kind === 'cancel') return null;
    // 'back': loop to the first screen.
  }
}
