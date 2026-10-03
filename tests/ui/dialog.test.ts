// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showDialog } from '../../src/ui/dialog';
import { TYPEWRITER_MS_PER_CHAR } from '../../src/ui/typewriter';
import { buttonByText, makeHost, press, tap } from './helpers';

let host: HTMLElement;
beforeEach(() => {
  host = makeHost();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const MS = TYPEWRITER_MS_PER_CHAR;
const LINE = 'Hello there, trail friend!';

/** The words a sighted player can see right now. */
const shown = (): string => host.querySelector('.tq-dialog__shown')?.textContent ?? '';
const textEl = (): HTMLElement => host.querySelector('.tq-dialog__text')!;
const isOpen = (): boolean => host.querySelector('.tq-overlay') !== null;

function stubReducedMotion(reduced: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('showDialog basics', () => {
  it('shows the speaker on the tab, the text, and a Next button, and resolves 0 on Next', async () => {
    const result = showDialog(host, { speaker: 'Zip', text: 'Hello there!' });
    expect(host.querySelector('.tq-nameplate')?.textContent).toBe('Zip');
    expect(host.textContent).toContain('Hello there!');
    expect(host.querySelector('.tq-overlay--dialog')).not.toBeNull();
    buttonByText(host, 'Next').click();
    await expect(result).resolves.toBe(0);
    expect(isOpen()).toBe(false);
  });

  it('has no Read button, no speaker icon and no speech calls', async () => {
    const synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: vi.fn(() => []) };
    vi.stubGlobal('speechSynthesis', synth);
    const result = showDialog(host, { speaker: 'Zip', text: 'Hello there!' });
    expect(host.textContent).not.toMatch(/read/i);
    expect(host.textContent).not.toContain('\u{1F50A}');
    expect(Array.from(host.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Next']);
    buttonByText(host, 'Next').click();
    await result;
    expect(synth.speak).not.toHaveBeenCalled();
    expect(synth.cancel).not.toHaveBeenCalled();
  });

  it('resolves with the index of the clicked choice', async () => {
    const result = showDialog(host, { speaker: 'Zip', text: 'Pick one.', choices: ['Red', 'Green', 'Blue'] });
    expect(isOpen()).toBe(true);
    expect(host.textContent).not.toContain('Next');
    buttonByText(host, 'Blue').click();
    await expect(result).resolves.toBe(2);
    expect(isOpen()).toBe(false);
  });

  it('resolves only once even if keys and clicks pile up', async () => {
    const result = showDialog(host, { speaker: 'Zip', text: 'One.' });
    const next = buttonByText(host, 'Next');
    next.click();
    next.click();
    press(document, 'Enter');
    await expect(result).resolves.toBe(0);
  });

  it('picks a choice with a number key', async () => {
    const result = showDialog(host, { speaker: 'Zip', text: 'Pick.', choices: ['A', 'B'] });
    press(document, '2');
    await expect(result).resolves.toBe(1);
  });

  it('gives screen readers the whole text at once and hides the typing from them', async () => {
    const result = showDialog(host, { speaker: 'Zip', text: LINE });
    expect(host.querySelector('.tq-dialog__text > .tq-sr')?.textContent).toBe(LINE);
    expect(host.querySelector('.tq-dialog__type')?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-describedby')).toBe(textEl().id);
    buttonByText(host, 'Next').click();
    await result;
  });
});

describe('showDialog typewriter reveal', () => {
  it('starts with a little of the text and adds a character every step', async () => {
    vi.useFakeTimers();
    const result = showDialog(host, { speaker: 'Zip', text: LINE });
    expect(shown()).toBe('H');
    vi.advanceTimersByTime(MS);
    expect(shown()).toBe('He');
    vi.advanceTimersByTime(MS * 3);
    expect(shown()).toBe('Hello');
    vi.advanceTimersByTime(MS * LINE.length);
    expect(shown()).toBe(LINE);
    buttonByText(host, 'Next').click();
    await result;
  });

  it('keeps the untyped words in the layout, hidden, so the box does not jump', async () => {
    vi.useFakeTimers();
    const result = showDialog(host, { speaker: 'Zip', text: LINE });
    expect(host.querySelector('.tq-dialog__rest')?.textContent).toBe(LINE.slice(1));
    vi.advanceTimersByTime(MS * 4);
    expect(shown() + host.querySelector('.tq-dialog__rest')!.textContent).toBe(LINE);
    buttonByText(host, 'Next').click();
    await result;
  });

  it('stops its timer once the dialog closes', async () => {
    vi.useFakeTimers();
    const result = showDialog(host, { speaker: 'Zip', text: LINE });
    buttonByText(host, 'Next').click(); // a scripted or assistive click is not held back by the reveal
    await expect(result).resolves.toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows everything at once under prefers-reduced-motion', async () => {
    stubReducedMotion(true);
    vi.useFakeTimers();
    const result = showDialog(host, { speaker: 'Zip', text: LINE });
    expect(shown()).toBe(LINE);
    expect(host.querySelector('.tq-dialog__rest')?.textContent).toBe('');
    expect(vi.getTimerCount()).toBe(0);
    // With nothing to skip, the very first Enter presses Next.
    press(document, 'Enter');
    await expect(result).resolves.toBe(0);
  });

  it('types normally when reduced motion is not requested', async () => {
    stubReducedMotion(false);
    const result = showDialog(host, { speaker: 'Zip', text: LINE });
    expect(shown()).toBe('H');
    buttonByText(host, 'Next').click();
    await result;
  });

  it('does not leave a timer behind when the host is cleared out from under it', () => {
    vi.useFakeTimers();
    void showDialog(host, { speaker: 'Zip', text: LINE });
    host.replaceChildren();
    vi.advanceTimersByTime(MS * 3);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('showDialog skip and advance', () => {
  it('a tap on the box completes the reveal, and a second tap presses Next', async () => {
    vi.useFakeTimers();
    const result = showDialog(host, { speaker: 'Zip', text: LINE });
    expect(shown()).toBe('H');

    tap(textEl());
    expect(shown()).toBe(LINE);
    expect(isOpen()).toBe(true); // the first tap only skipped
    expect(vi.getTimerCount()).toBe(0);

    tap(textEl());
    await expect(result).resolves.toBe(0);
    expect(isOpen()).toBe(false);
  });

  it('a tap anywhere on the card works, including the name tab and the card itself', async () => {
    vi.useFakeTimers();
    const result = showDialog(host, { speaker: 'Zip', text: LINE });
    tap(host.querySelector('.tq-nameplate')!);
    expect(shown()).toBe(LINE);
    tap(host.querySelector('.tq-bubble')!);
    await expect(result).resolves.toBe(0);
  });

  it('a tap on the Next button itself finishes the reveal first, then a second tap presses it', async () => {
    vi.useFakeTimers();
    const result = showDialog(host, { speaker: 'Zip', text: LINE });
    tap(buttonByText(host, 'Next'));
    expect(shown()).toBe(LINE);
    expect(isOpen()).toBe(true);
    tap(buttonByText(host, 'Next'));
    await expect(result).resolves.toBe(0);
  });

  it('Enter completes the reveal, and a second Enter presses Next', async () => {
    vi.useFakeTimers();
    const result = showDialog(host, { speaker: 'Zip', text: LINE });
    press(document, 'Enter');
    expect(shown()).toBe(LINE);
    expect(isOpen()).toBe(true);
    press(document, 'Enter');
    await expect(result).resolves.toBe(0);
  });

  it('Space does the same as Enter', async () => {
    vi.useFakeTimers();
    const result = showDialog(host, { speaker: 'Zip', text: LINE });
    (document.activeElement as HTMLElement | null)?.blur();
    press(document.body, ' ');
    expect(shown()).toBe(LINE);
    press(document.body, ' ');
    await expect(result).resolves.toBe(0);
  });

  it('a held-down Enter finishes the words but does not also press Next', async () => {
    vi.useFakeTimers();
    const result = showDialog(host, { speaker: 'Zip', text: LINE });
    const down = (repeat: boolean): void => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, repeat }));
    };
    down(false);
    down(true);
    down(true);
    expect(shown()).toBe(LINE);
    expect(isOpen()).toBe(true);
    buttonByText(host, 'Next').click();
    await result;
  });

  it('with choices, a tap finishes the reveal without picking anything, and the text is not a button', async () => {
    vi.useFakeTimers();
    const result = showDialog(host, { speaker: 'Zip', text: LINE, choices: ['Red', 'Green'] });
    tap(buttonByText(host, 'Green'));
    expect(shown()).toBe(LINE);
    expect(isOpen()).toBe(true);

    tap(textEl()); // the words are out: tapping them does nothing, only a button picks
    expect(isOpen()).toBe(true);

    tap(buttonByText(host, 'Green'));
    await expect(result).resolves.toBe(1);
  });

  it('with choices, Enter skips first and then presses the focused choice', async () => {
    vi.useFakeTimers();
    const result = showDialog(host, { speaker: 'Zip', text: LINE, choices: ['Red', 'Green', 'Blue'] });
    const green = buttonByText(host, 'Green');
    green.focus();
    press(green, 'Enter');
    expect(shown()).toBe(LINE);
    press(green, 'Enter');
    await expect(result).resolves.toBe(1);
  });

  it('presses Next on Enter or Space when nothing else is focused', async () => {
    vi.useFakeTimers();
    const first = showDialog(host, { speaker: 'Zip', text: 'One, and a bit more.' });
    press(document, 'Enter'); // skip
    press(document, 'Enter'); // Next
    await expect(first).resolves.toBe(0);

    const second = showDialog(host, { speaker: 'Zip', text: 'Two, and a bit more.' });
    (document.activeElement as HTMLElement | null)?.blur();
    press(document.body, ' ');
    press(document.body, ' ');
    await expect(second).resolves.toBe(0);
    expect(isOpen()).toBe(false);
  });

  it('a tap after the reveal has run its course presses Next straight away', async () => {
    vi.useFakeTimers();
    const result = showDialog(host, { speaker: 'Zip', text: LINE });
    vi.advanceTimersByTime(MS * LINE.length);
    expect(shown()).toBe(LINE);
    tap(textEl());
    await expect(result).resolves.toBe(0);
  });
});
