/** How long each character takes to appear in a dialogue box. */
export const TYPEWRITER_MS_PER_CHAR = 28;

/**
 * The part of `text` that is on screen `elapsedMs` after the reveal began. The first character
 * is there at 0 ms, and one more arrives every `msPerChar`. Counts whole characters (not UTF-16
 * halves), so an emoji never appears broken. Pure: no timers, no DOM.
 */
export function visibleText(text: string, elapsedMs: number, msPerChar: number = TYPEWRITER_MS_PER_CHAR): string {
  const chars = Array.from(text);
  const step = msPerChar > 0 ? msPerChar : 1;
  const elapsed = Number.isNaN(elapsedMs) ? 0 : Math.max(0, elapsedMs); // Infinity means "all of it"
  const count = Math.min(chars.length, Math.floor(elapsed / step) + 1);
  return chars.slice(0, count).join('');
}

/** The elapsed time at which the whole text is visible. */
export function revealDurationMs(text: string, msPerChar: number = TYPEWRITER_MS_PER_CHAR): number {
  return Math.max(0, Array.from(text).length - 1) * (msPerChar > 0 ? msPerChar : 1);
}

/** True once `elapsedMs` has reached the end of the reveal. */
export function isFullyRevealed(text: string, elapsedMs: number, msPerChar: number = TYPEWRITER_MS_PER_CHAR): boolean {
  return elapsedMs >= revealDurationMs(text, msPerChar);
}
