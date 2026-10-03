import { describe, expect, it } from 'vitest';
import { isFullyRevealed, revealDurationMs, TYPEWRITER_MS_PER_CHAR, visibleText } from '../../src/ui/typewriter';

describe('TYPEWRITER_MS_PER_CHAR', () => {
  it('is about 28 ms per character', () => {
    expect(TYPEWRITER_MS_PER_CHAR).toBe(28);
  });
});

describe('visibleText', () => {
  const text = 'Hello there!';
  const ms = TYPEWRITER_MS_PER_CHAR;

  it('shows the first character at 0 ms, so a box is never empty', () => {
    expect(visibleText(text, 0)).toBe('H');
  });

  it('adds one character every step', () => {
    expect(visibleText(text, ms - 1)).toBe('H');
    expect(visibleText(text, ms)).toBe('He');
    expect(visibleText(text, ms * 4)).toBe('Hello');
    expect(visibleText(text, ms * 4 + 5)).toBe('Hello');
  });

  it('always returns a prefix of the text and never gets shorter as time passes', () => {
    let previous = '';
    for (let t = 0; t < ms * (text.length + 3); t += 7) {
      const now = visibleText(text, t);
      expect(text.startsWith(now)).toBe(true);
      expect(now.length).toBeGreaterThanOrEqual(previous.length);
      previous = now;
    }
  });

  it('stops at the whole text', () => {
    expect(visibleText(text, ms * (text.length - 1))).toBe(text);
    expect(visibleText(text, 60_000)).toBe(text);
    expect(visibleText(text, Number.POSITIVE_INFINITY)).toBe(text);
  });

  it('treats negative or non-numeric time as the start', () => {
    expect(visibleText(text, -500)).toBe('H');
    expect(visibleText(text, Number.NaN)).toBe('H');
  });

  it('handles empty text', () => {
    expect(visibleText('', 0)).toBe('');
    expect(visibleText('', 1000)).toBe('');
  });

  it('takes a custom speed', () => {
    expect(visibleText('abcdef', 100, 50)).toBe('abc');
  });

  it('never splits an emoji in half', () => {
    const star = 'A\u{1F31F}B';
    expect(visibleText(star, 0)).toBe('A');
    expect(visibleText(star, ms)).toBe('A\u{1F31F}');
    expect(visibleText(star, ms * 2)).toBe(star);
  });
});

describe('revealDurationMs and isFullyRevealed', () => {
  it('is the time the last character lands', () => {
    expect(revealDurationMs('')).toBe(0);
    expect(revealDurationMs('A')).toBe(0);
    expect(revealDurationMs('ABC')).toBe(2 * TYPEWRITER_MS_PER_CHAR);
  });

  it('agrees with visibleText', () => {
    const text = 'Time to walk.';
    const end = revealDurationMs(text);
    expect(isFullyRevealed(text, end - 1)).toBe(false);
    expect(visibleText(text, end - 1)).not.toBe(text);
    expect(isFullyRevealed(text, end)).toBe(true);
    expect(visibleText(text, end)).toBe(text);
  });
});
