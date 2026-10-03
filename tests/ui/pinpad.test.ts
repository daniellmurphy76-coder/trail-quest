// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { askNewPin, askPin } from '../../src/ui/pinpad';
import { buttonByText, flush, makeHost, maybeButton, press } from './helpers';

let host: HTMLElement;
beforeEach(() => {
  host = makeHost();
});

const key = (digit: string): HTMLButtonElement =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('.tq-pin__key')).find((b) => b.textContent === digit)!;
const type = (pin: string): void => pin.split('').forEach((d) => key(d).click());
const filled = (): number => host.querySelectorAll('.tq-pin__dot.is-filled').length;

describe('askPin', () => {
  it('has keys 0 to 9 and a delete key', async () => {
    const result = askPin(host, { title: 'Grown-up PIN', verify: async () => true });
    expect(host.textContent).toContain('Grown-up PIN');
    for (const d of '0123456789') expect(key(d)).toBeDefined();
    expect(host.querySelector('[aria-label="Delete"]')).not.toBeNull();
    buttonByText(host, 'Cancel').click();
    await result;
  });

  it('fills a dot per digit, deletes with backspace, and resolves true when verify accepts', async () => {
    const result = askPin(host, { title: 'PIN', verify: async (pin) => pin === '1234' });
    type('12');
    expect(filled()).toBe(2);
    (host.querySelector('[aria-label="Delete"]') as HTMLButtonElement).click();
    expect(filled()).toBe(1);
    type('234');
    expect(filled()).toBe(4);
    await expect(result).resolves.toBe(true);
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('says "Not right, try again" with an icon, clears the dots, and lets the player try again', async () => {
    const result = askPin(host, { title: 'PIN', verify: async (pin) => pin === '1234' });
    type('0000');
    await flush();
    expect(host.querySelector('.tq-pin__msg')?.textContent).toContain('Not right, try again');
    expect(host.querySelector('.tq-pin__msg')?.textContent).toContain('✖');
    expect(filled()).toBe(0);
    expect(host.querySelector('.tq-overlay')).not.toBeNull();
    type('1234');
    await expect(result).resolves.toBe(true);
  });

  it('treats a verify that throws as a wrong PIN', async () => {
    let calls = 0;
    const result = askPin(host, {
      title: 'PIN',
      verify: async () => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
        return true;
      },
    });
    type('1111');
    await flush();
    expect(host.querySelector('.tq-pin__msg')?.textContent).toContain('Not right');
    type('1111');
    await expect(result).resolves.toBe(true);
  });

  it('accepts typed digits and Backspace from the keyboard', async () => {
    const result = askPin(host, { title: 'PIN', verify: async (pin) => pin === '4821' });
    press(document, '4');
    press(document, '9');
    press(document, 'Backspace');
    press(document, '8');
    press(document, '2');
    press(document, '1');
    await expect(result).resolves.toBe(true);
  });

  it('resolves false on Cancel, and hides Cancel when allowCancel is false', async () => {
    const cancelled = askPin(host, { title: 'PIN', verify: async () => true });
    buttonByText(host, 'Cancel').click();
    await expect(cancelled).resolves.toBe(false);
    expect(host.querySelector('.tq-overlay')).toBeNull();

    const locked = askPin(host, { title: 'PIN', verify: async () => true, allowCancel: false });
    expect(maybeButton(host, 'Cancel')).toBeNull();
    type('0000');
    await expect(locked).resolves.toBe(true);
  });

  it('never prints the digits in the page', async () => {
    const result = askPin(host, { title: 'PIN', verify: async () => false });
    type('7351');
    expect(host.textContent).not.toContain('7351');
    expect(host.querySelector('.tq-pin__dots')?.textContent).toBe('');
    await flush();
    buttonByText(host, 'Cancel').click();
    await result;
  });
});

describe('askNewPin', () => {
  it('asks twice and resolves with the PIN', async () => {
    const result = askNewPin(host, { title: 'Make a PIN' });
    expect(host.textContent).toContain('Make a PIN');
    type('2468');
    await flush();
    expect(host.textContent).toContain('one more time');
    type('2468');
    await expect(result).resolves.toBe('2468');
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('says "Not the same" when the second entry differs, then accepts a match', async () => {
    const result = askNewPin(host, { title: 'Make a PIN' });
    type('1357');
    await flush();
    type('1358');
    await flush();
    expect(host.querySelector('.tq-pin__msg')?.textContent).toContain('Not the same, try again');
    type('1357');
    await expect(result).resolves.toBe('1357');
  });

  it('"Start over" goes back to the first entry', async () => {
    const result = askNewPin(host, { title: 'Make a PIN' });
    type('1111');
    await flush();
    buttonByText(host, 'Start over').click();
    await flush();
    expect(host.textContent).toContain('Make a PIN');
    type('2222');
    await flush();
    type('2222');
    await expect(result).resolves.toBe('2222');
  });

  it('resolves null when cancelled', async () => {
    const first = askNewPin(host, { title: 'Make a PIN' });
    buttonByText(host, 'Cancel').click();
    await expect(first).resolves.toBeNull();

    const second = askNewPin(host, { title: 'Make a PIN' });
    type('1234');
    await flush();
    buttonByText(host, 'Cancel').click();
    await expect(second).resolves.toBeNull();
  });
});
