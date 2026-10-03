// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showDialog } from '../../src/ui/dialog';
import { buttonByText, makeHost, press } from './helpers';

let host: HTMLElement;
beforeEach(() => {
  host = makeHost();
});

describe('showDialog', () => {
  it('shows the speaker, the text, a Read button and a Next button, and resolves 0 on Next', async () => {
    const speak = vi.fn();
    const result = showDialog(host, { speaker: 'Zip', text: 'Hello there!', speak });
    expect(host.textContent).toContain('Zip');
    expect(host.textContent).toContain('Hello there!');
    expect(buttonByText(host, 'Read').textContent).toContain('\u{1F50A}');
    buttonByText(host, 'Next').click();
    await expect(result).resolves.toBe(0);
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('resolves with the index of the clicked choice', async () => {
    const result = showDialog(host, {
      speaker: 'Zip',
      text: 'Pick one.',
      choices: ['Red', 'Green', 'Blue'],
      speak: vi.fn(),
    });
    expect(host.querySelector('.tq-overlay')).not.toBeNull();
    expect(host.textContent).not.toContain('Next');
    buttonByText(host, 'Blue').click();
    await expect(result).resolves.toBe(2);
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('activates the focused choice on Enter', async () => {
    const result = showDialog(host, {
      speaker: 'Zip',
      text: 'Pick one.',
      choices: ['Red', 'Green', 'Blue'],
      speak: vi.fn(),
    });
    const green = buttonByText(host, 'Green');
    green.focus();
    press(green, 'Enter');
    await expect(result).resolves.toBe(1);
  });

  it('presses Next on Enter or Space when nothing else is focused', async () => {
    const first = showDialog(host, { speaker: 'Zip', text: 'One.', speak: vi.fn() });
    press(document, 'Enter');
    await expect(first).resolves.toBe(0);

    const second = showDialog(host, { speaker: 'Zip', text: 'Two.', speak: vi.fn() });
    (document.activeElement as HTMLElement | null)?.blur();
    press(document.body, ' ');
    await expect(second).resolves.toBe(0);
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('resolves only once even if keys and clicks pile up', async () => {
    const result = showDialog(host, { speaker: 'Zip', text: 'One.', speak: vi.fn() });
    const next = buttonByText(host, 'Next');
    next.click();
    next.click();
    press(document, 'Enter');
    await expect(result).resolves.toBe(0);
  });

  it('reads aloud on the Read button, and on open when autoSpeak is set', async () => {
    const speak = vi.fn();
    const result = showDialog(host, { speaker: 'Zip', text: 'Hello there!', speak, autoSpeak: true });
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenLastCalledWith('Hello there!');
    buttonByText(host, 'Read').click();
    expect(speak).toHaveBeenCalledTimes(2);
    expect(speak.mock.calls[1]?.[0]).toBe('Hello there!');
    buttonByText(host, 'Next').click();
    await result;
  });

  it('does not auto-read unless asked', async () => {
    const speak = vi.fn();
    const result = showDialog(host, { speaker: 'Zip', text: 'Hello there!', speak });
    expect(speak).not.toHaveBeenCalled();
    buttonByText(host, 'Next').click();
    await result;
  });

  it('picks a choice with a number key', async () => {
    const result = showDialog(host, { speaker: 'Zip', text: 'Pick.', choices: ['A', 'B'], speak: vi.fn() });
    press(document, '2');
    await expect(result).resolves.toBe(1);
  });
});
