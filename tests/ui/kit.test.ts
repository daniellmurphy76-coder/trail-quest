// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clear, h } from '../../src/ui/dom';
import { showResultBanner } from '../../src/ui/feedback';
import { createSpeaker, prepareSpeechOnFirstGesture } from '../../src/ui/speech';
import { showToast } from '../../src/ui/toast';
import { makeHost } from './helpers';

let host: HTMLElement;
beforeEach(() => {
  host = makeHost();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('h and clear', () => {
  it('builds elements with classes, attributes, handlers and nested children', () => {
    let clicked = 0;
    const el = h(
      'button',
      { class: 'a b', type: 'button', disabled: false, attrs: { 'aria-label': 'Go', 'data-x': 1 }, on: { click: () => clicked++ } },
      'Hi ',
      3,
      null,
      false,
      [h('span', null, 'x'), 'y'],
    );
    expect(el.className).toBe('a b');
    expect(el.getAttribute('type')).toBe('button');
    expect(el.hasAttribute('disabled')).toBe(false);
    expect(el.getAttribute('aria-label')).toBe('Go');
    expect(el.getAttribute('data-x')).toBe('1');
    expect(el.textContent).toBe('Hi 3xy');
    el.click();
    expect(clicked).toBe(1);
    clear(el);
    expect(el.childNodes).toHaveLength(0);
  });

  it('sets disabled and checked', () => {
    expect(h('button', { disabled: true }).disabled).toBe(true);
    expect(h('input', { type: 'checkbox', checked: true }).checked).toBe(true);
  });
});

describe('showToast', () => {
  it('shows text and removes itself after the delay', () => {
    vi.useFakeTimers();
    showToast(host, 'Saved!', 1000);
    expect(host.textContent).toContain('Saved!');
    expect(host.querySelector('.tq-toast')?.getAttribute('role')).toBe('status');
    vi.advanceTimersByTime(999);
    expect(host.querySelector('.tq-toast')).not.toBeNull();
    vi.advanceTimersByTime(2);
    expect(host.querySelector('.tq-toast')).toBeNull();
  });

  it('defaults to 2.5 seconds and can be tapped away', () => {
    vi.useFakeTimers();
    showToast(host, 'One');
    vi.advanceTimersByTime(2400);
    expect(host.querySelector('.tq-toast')).not.toBeNull();
    vi.advanceTimersByTime(200);
    expect(host.querySelector('.tq-toast')).toBeNull();

    showToast(host, 'Two');
    (host.querySelector('.tq-toast') as HTMLElement).click();
    expect(host.querySelector('.tq-toast')).toBeNull();
  });
});

describe('showResultBanner', () => {
  it('pairs an icon and a word with the color for Yes and Not yet', () => {
    showResultBanner(host, 'yes', 'Nice work.');
    const yes = host.querySelector('.tq-banner--yes')!;
    expect(yes.textContent).toContain('Yes!');
    expect(yes.textContent).toContain('Nice work.');
    expect(yes.querySelector('.tq-banner__icon')?.textContent).toBeTruthy();

    showResultBanner(host, 'notyet', 'Try again.');
    expect(host.querySelectorAll('.tq-banner')).toHaveLength(1); // replaces the old one
    const no = host.querySelector('.tq-banner--notyet')!;
    expect(no.textContent).toContain('Not yet');
    expect(no.querySelector('.tq-banner__icon')?.textContent).toBeTruthy();
  });

  it('can fade away by itself', () => {
    vi.useFakeTimers();
    showResultBanner(host, 'yes', '', { autoHideMs: 500 });
    vi.advanceTimersByTime(1000);
    expect(host.querySelector('.tq-banner')).toBeNull();
  });

  it('can carry a Read button that speaks the word and text', () => {
    const speak = vi.fn();
    showResultBanner(host, 'notyet', 'Try again.', { speak });
    (host.querySelector('button') as HTMLButtonElement).click();
    expect(speak).toHaveBeenCalledWith('Not yet Try again.', { force: true });
  });
});

describe('createSpeaker', () => {
  it('does nothing when speech is unavailable', () => {
    vi.stubGlobal('speechSynthesis', undefined);
    expect(() => createSpeaker(() => true)('Hello')).not.toThrow();
  });

  function stubSpeech() {
    const spoken: { text: string; rate: number; lang: string; voice: unknown }[] = [];
    const calls: string[] = [];
    const voices = [
      { lang: 'fr-FR', name: 'Fr' },
      { lang: 'en-GB', name: 'Gb' },
      { lang: 'en-US', name: 'Us' },
    ];
    vi.stubGlobal('SpeechSynthesisUtterance', function (this: Record<string, unknown>, text: string) {
      this.text = text;
    });
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => voices,
      cancel: () => calls.push('cancel'),
      speak: (u: { text: string; rate: number; lang: string; voice: unknown }) => {
        calls.push('speak');
        spoken.push(u);
      },
    });
    return { spoken, calls, voices };
  }

  it('cancels first, speaks at rate 0.95 with an en-US voice', () => {
    const { spoken, calls, voices } = stubSpeech();
    createSpeaker(() => true)('Hello there');
    expect(calls).toEqual(['cancel', 'speak']);
    expect(spoken[0]?.text).toBe('Hello there');
    expect(spoken[0]?.rate).toBe(0.95);
    expect(spoken[0]?.lang).toBe('en-US');
    expect(spoken[0]?.voice).toBe(voices[2]);
  });

  it('stays quiet when disabled, unless forced', () => {
    const { spoken } = stubSpeech();
    const speak = createSpeaker(() => false);
    speak('Hello');
    expect(spoken).toHaveLength(0);
    speak('Hello', { force: true });
    expect(spoken).toHaveLength(1);
  });

  it('warms speech on the first pointerdown only', () => {
    const { spoken } = stubSpeech();
    prepareSpeechOnFirstGesture();
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(spoken).toHaveLength(1);
  });
});
