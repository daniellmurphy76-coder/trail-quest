/**
 * Dev-only query flags, read by src/main.ts. They do nothing in a production build.
 *
 *   ?today=YYYY-MM-DD  pins the date, so streaks can be tested without waiting a day.
 *   ?reset=1           clears the save and reloads without the flag (other flags are kept).
 */
import { isYmd } from '../quests/dates';
import { UNREADABLE_KEY } from '../save/store';
import { STORAGE_KEY } from '../save/types';

export interface DevFlags {
  /** The pinned date, when one was given and is a real YYYY-MM-DD. */
  today?: string;
  /** True when the save should be cleared before the game starts. */
  reset: boolean;
}

/** Read the flags from a query string such as "?today=2026-10-03&reset=1". Everything is off outside dev. */
export function parseDevFlags(search: string, dev: boolean): DevFlags {
  if (!dev) return { reset: false };
  const params = new URLSearchParams(search);
  const today = params.get('today');
  return {
    today: today !== null && isYmd(today) ? today : undefined,
    reset: params.get('reset') === '1',
  };
}

/** The same address with one query parameter removed (the rest of the query is kept). */
export function withoutParam(href: string, name: string): string {
  const url = new URL(href);
  url.searchParams.delete(name);
  return url.toString();
}

/** Remove the saved game (and any unreadable copy of it) from browser storage. Never throws. */
export function clearSavedGame(storage: Pick<Storage, 'removeItem'>): void {
  for (const key of [STORAGE_KEY, UNREADABLE_KEY]) {
    try {
      storage.removeItem(key);
    } catch {
      // Blocked storage: there is nothing to clear.
    }
  }
}
