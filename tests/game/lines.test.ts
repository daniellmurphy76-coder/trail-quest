import { describe, expect, it } from 'vitest';
import {
  fillLine,
  line,
  LINE_VARS,
  LINES,
  lineLevelOf,
  PARENT_TEXT,
  STOP_KIND_LABELS,
  ZONE_LABELS,
  type LineKey,
  type LineLevel,
} from '../../src/game/lines';

/** Sentences end at . ! ? or an ellipsis. A {placeholder} counts as one word. */
function sentences(text: string): string[] {
  return text
    .split(/[.!?…]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function wordCount(sentence: string): number {
  return sentence.split(/\s+/).filter((w) => /[A-Za-z0-9{]/.test(w)).length;
}

const LIMIT: Record<LineLevel, number> = { grade2: 10, grade5: 15 };
const KEYS = Object.keys(LINES) as LineKey[];

describe('Den Chief lines', () => {
  it('has a line for every key at both reading levels', () => {
    expect(KEYS.length).toBeGreaterThan(20);
    for (const key of KEYS) {
      for (const level of ['grade2', 'grade5'] as const) {
        expect(LINES[key][level].trim(), `${key}.${level}`).not.toBe('');
      }
    }
  });

  for (const level of ['grade2', 'grade5'] as const) {
    it(`keeps every ${level} sentence to ${LIMIT[level]} words or fewer`, () => {
      const tooLong: string[] = [];
      for (const key of KEYS) {
        for (const sentence of sentences(LINES[key][level])) {
          const words = wordCount(sentence);
          if (words > LIMIT[level]) tooLong.push(`${key}.${level} (${words}): ${sentence}`);
        }
      }
      expect(tooLong).toEqual([]);
    });
  }

  it('measures sentences the way the limits mean them', () => {
    // A guard for the helper itself: two short sentences are not one long one.
    expect(sentences('Hi {name}! I am {guide}. Go.').map(wordCount)).toEqual([2, 3, 1]);
    expect(wordCount('Walking to the {zone}')).toBe(4);
  });

  it('only uses the documented placeholders', () => {
    const allowed = new Set<string>(LINE_VARS);
    for (const key of KEYS) {
      for (const level of ['grade2', 'grade5'] as const) {
        for (const match of LINES[key][level].matchAll(/\{(\w+)\}/g)) {
          expect(allowed.has(match[1]!), `${key}.${level} uses {${match[1]}}`).toBe(true);
        }
      }
    }
    for (const name of ['name', 'guide', 'streak', 'xp']) expect(allowed.has(name)).toBe(true);
  });

  it('fills every placeholder and leaves none behind', () => {
    const vars = { name: 'Rowan', guide: 'Den Chief', streak: 4, xp: 30, title: 'A test title', adventure: 'Test Camp', zone: 'Nature Trail' };
    for (const key of KEYS) {
      for (const level of ['grade2', 'grade5'] as const) {
        expect(line(key, level, vars), `${key}.${level}`).not.toMatch(/[{}]/);
      }
    }
  });

  it('fills what it is given and leaves unknown values visible', () => {
    expect(fillLine('Hi {name}, day {streak}.', { name: 'Rowan', streak: 3 })).toBe('Hi Rowan, day 3.');
    expect(fillLine('Hi {name}.')).toBe('Hi {name}.');
    expect(line('greetStreak', 'grade2', { name: 'Rowan', streak: 1 })).toContain('Day 1');
  });

  it('says the campfire and badge sentences the way the brief words them', () => {
    expect(line('campfireLit', 'grade2', { streak: 6 })).toBe('Your campfire is lit: Day 6.');
    expect(line('badgeEarned', 'grade5', { adventure: 'Test Camp' })).toBe('You earned the Test Camp badge!');
    expect(line('approvalTitle', 'grade2', { title: 'Test chore' })).toBe('Ask your parent to approve: Test chore');
    expect(line('travel', 'grade2', { zone: ZONE_LABELS['nature-trail'] })).toBe('Walking to the Nature Trail…');
  });

  it('maps reading levels to the two wordings', () => {
    expect(lineLevelOf('grade1')).toBe('grade2');
    expect(lineLevelOf('grade2')).toBe('grade2');
    expect(lineLevelOf('grade3')).toBe('grade2');
    expect(lineLevelOf('grade4')).toBe('grade5');
    expect(lineLevelOf('grade5')).toBe('grade5');
  });

  it('has a label for every zone and every kind of stop', () => {
    expect(Object.keys(ZONE_LABELS).sort()).toEqual(
      ['base-camp', 'campfire-circle', 'fitness-field', 'nature-trail', 'safety-station', 'town-square'],
    );
    expect(Object.keys(STOP_KIND_LABELS).sort()).toEqual(['bonus', 'field-check', 'new-step', 'warm-up']);
  });

  it('tells the parent what the PIN is for, in the parent text', () => {
    expect(PARENT_TEXT.newPinSubtitle).toMatch(/accidental/i);
    expect(PARENT_TEXT.newPinSubtitle).toMatch(/not a security/i);
  });
});
