// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANGE_LOOK_LABEL, showTrailPanel } from '../../src/game/screens/trail-panel';
import { buttonByText, flush, makeHost, maybeButton } from '../ui/helpers';

let host: HTMLElement;
beforeEach(() => {
  host = makeHost();
});

const view = { state: 'empty' as const, items: [] };

describe('trail panel: Change my look', () => {
  it('has no such button unless the app wires it', () => {
    void showTrailPanel(host, { level: 'grade2', view });
    expect(maybeButton(host, CHANGE_LOOK_LABEL)).toBeNull();
  });

  it('adds a Change my look button that calls onEditAvatar, and leaves the panel open', async () => {
    const onEditAvatar = vi.fn();
    let settled = false;
    const result = showTrailPanel(host, { level: 'grade2', view, onEditAvatar });
    void result.then(() => (settled = true));
    expect(CHANGE_LOOK_LABEL).toBe('Change my look');
    const look = buttonByText(host, 'Change my look');
    expect(look.classList.contains('tq-btn')).toBe(true);
    look.click();
    expect(onEditAvatar).toHaveBeenCalledTimes(1);
    await flush();
    expect(settled).toBe(false);
    expect(host.querySelector('.tq-trail-panel')).not.toBeNull();
    buttonByText(host, 'Close').click();
    await expect(result).resolves.toBe('close');
  });

  it('sits with the other buttons, next to Switch Scout and Parent', () => {
    void showTrailPanel(host, { level: 'grade5', view, onEditAvatar: () => {} });
    const actions = Array.from(host.querySelector('.tq-actions')!.querySelectorAll('button')).map((b) => b.textContent);
    expect(actions.some((t) => t!.includes('Change my look'))).toBe(true);
    expect(actions.some((t) => t!.includes('Switch Scout'))).toBe(true);
    expect(actions.some((t) => t!.includes('Parent'))).toBe(true);
    expect(actions.some((t) => t!.includes('Close'))).toBe(true);
  });

  it('waits for an async editor, so a double tap opens one editor, then works again', async () => {
    let finish: () => void = () => {};
    const onEditAvatar = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    void showTrailPanel(host, { level: 'grade2', view, onEditAvatar });
    const look = buttonByText(host, 'Change my look');
    look.click();
    look.click();
    expect(onEditAvatar).toHaveBeenCalledTimes(1);
    expect(look.disabled).toBe(true);
    finish();
    await flush();
    expect(look.disabled).toBe(false);
    look.click();
    expect(onEditAvatar).toHaveBeenCalledTimes(2);
  });

  it('survives an editor that throws or rejects, and the button comes back', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onEditAvatar = vi
      .fn<() => Promise<void> | void>()
      .mockImplementationOnce(() => {
        throw new Error('boom');
      })
      .mockImplementationOnce(() => Promise.reject(new Error('later')));
    void showTrailPanel(host, { level: 'grade2', view, onEditAvatar });
    const look = buttonByText(host, 'Change my look');
    look.click();
    expect(look.disabled).toBe(false);
    look.click();
    await flush();
    expect(look.disabled).toBe(false);
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it('still resolves switch, parent, start and travel as before', async () => {
    let result = showTrailPanel(host, { level: 'grade2', view, onEditAvatar: () => {} });
    buttonByText(host, 'Switch Scout').click();
    await expect(result).resolves.toBe('switch');
    result = showTrailPanel(host, { level: 'grade2', view, onEditAvatar: () => {}, start: { label: 'Start' } });
    buttonByText(host, 'Start').click();
    await expect(result).resolves.toBe('start');
  });
});
