import { describe, expect, it, vi } from 'vitest';
import { clearSavedGame, parseDevFlags, withoutParam } from '../../src/game/dev-flags';
import { STORAGE_KEY } from '../../src/save/types';

describe('parseDevFlags', () => {
  it('reads ?today= and ?reset=1 in dev', () => {
    expect(parseDevFlags('?today=2026-10-03', true)).toEqual({ today: '2026-10-03', reset: false });
    expect(parseDevFlags('?reset=1', true)).toEqual({ today: undefined, reset: true });
    expect(parseDevFlags('?reset=1&today=2026-10-03', true)).toEqual({ today: '2026-10-03', reset: true });
  });

  it('ignores a bad date and any value of reset other than 1', () => {
    expect(parseDevFlags('?today=tomorrow', true).today).toBeUndefined();
    expect(parseDevFlags('?today=2026-13-45', true).today).toBeUndefined();
    expect(parseDevFlags('?reset=yes', true).reset).toBe(false);
    expect(parseDevFlags('?reset', true).reset).toBe(false);
    expect(parseDevFlags('', true)).toEqual({ today: undefined, reset: false });
  });

  it('does nothing outside dev, so a shared production link can never wipe a save', () => {
    expect(parseDevFlags('?reset=1&today=2026-10-03', false)).toEqual({ reset: false });
  });
});

describe('withoutParam', () => {
  it('drops only the named parameter and keeps the rest of the address', () => {
    expect(withoutParam('http://127.0.0.1:5173/trail-quest/?reset=1', 'reset')).toBe('http://127.0.0.1:5173/trail-quest/');
    expect(withoutParam('http://127.0.0.1:5173/?today=2026-10-03&reset=1#camp', 'reset')).toBe(
      'http://127.0.0.1:5173/?today=2026-10-03#camp',
    );
  });
});

describe('clearSavedGame', () => {
  it('removes the save and the unreadable copy', () => {
    const removeItem = vi.fn();
    clearSavedGame({ removeItem });
    expect(removeItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect(removeItem).toHaveBeenCalledWith(`${STORAGE_KEY}.unreadable`);
  });

  it('does not throw when storage is blocked', () => {
    expect(() =>
      clearSavedGame({
        removeItem: () => {
          throw new Error('blocked');
        },
      }),
    ).not.toThrow();
  });
});
