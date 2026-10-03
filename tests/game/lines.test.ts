import { describe, expect, it } from 'vitest';
import type { RankId, ReadingLevel } from '../../src/activities/types';
import {
  fillLine,
  line,
  LINE_LEVEL_BY_READING_LEVEL,
  LINE_VARS,
  LINES,
  lineLevelOf,
  PARENT_TEXT,
  RANK_FALLBACK_LABELS,
  STOP_KIND_LABELS,
  ZONE_LABELS,
  type LineKey,
  type LineLevel,
} from '../../src/game/lines';
import { checkVocabulary } from '../../scripts/vocabulary.mjs';

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
    const vars = {
      name: 'Rowan',
      guide: 'Den Chief',
      streak: 4,
      xp: 30,
      title: 'A test title',
      adventure: 'Test Camp',
      zone: 'Nature Trail',
      done: 1,
      total: 3,
      steps: 12,
    };
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

  it('teaches the game in the first greeting: what a trail is, three stops, the campfire grows', () => {
    const wolf = line('greetFirst', 'grade2', { name: 'Rowan', guide: 'Den Chief' });
    expect(wolf).toBe('Hi Rowan, I am Den Chief! A trail is three quick stops. Do them all to grow your campfire!');
    const arrow = line('greetFirst', 'grade5', { name: 'Rowan', guide: 'Den Chief' });
    expect(arrow).toMatch(/trail is three quick stops/);
    expect(arrow).toMatch(/campfire grow/);
    // Two or three short sentences after the hello, never a lecture.
    expect(sentences(wolf)).toHaveLength(3);
    expect(sentences(arrow)).toHaveLength(3);
  });

  it('words the two choices, the Start button and the HUD the way the brief does', () => {
    for (const level of ['grade2', 'grade5'] as const) {
      expect(line('choiceGo', level)).toBe("Let's go!");
      expect(line('choiceLook', level)).toBe('Look around first');
      expect(line('startTrail', level)).toBe("Start today's trail");
      expect(line('startKeepGoing', level)).toBe('Keep going!');
      expect(line('hudTrail', level)).toBe("Today's Trail");
      expect(line('hudProgress', level, { done: 1, total: 3 })).toBe('1 of 3');
      expect(line('hudProgressDone', level)).toBe('\u2713 Done');
      expect(line('compassSteps', level, { steps: 12 })).toBe('12 steps');
      expect(line('compassStep', level)).toBe('1 step');
    }
  });

  it('writes the controls hint for keyboard and touch', () => {
    expect(LINES.hintWalkKeys.grade2).toBe('Walk: arrow keys or [W] [A] [S] [D].');
    expect(LINES.hintTalkKeys.grade2).toBe('Talk: [E]');
    expect(LINES.hintWalkTouch.grade2).toBe('Walk: drag the circle.');
    expect(LINES.hintTalkTouch.grade2).toBe('Talk: tap the big button.');
  });

  it('maps reading levels to the two wordings', () => {
    expect(lineLevelOf('grade1')).toBe('grade2');
    expect(lineLevelOf('grade2')).toBe('grade2');
    expect(lineLevelOf('grade3')).toBe('grade2');
    expect(lineLevelOf('grade4')).toBe('grade5');
    expect(lineLevelOf('grade5')).toBe('grade5');
  });

  it('places every reading level, and gives anything unexpected (a grade 0 file) the younger wording', () => {
    const levels: ReadingLevel[] = ['grade1', 'grade2', 'grade3', 'grade4', 'grade5'];
    expect(Object.keys(LINE_LEVEL_BY_READING_LEVEL).sort()).toEqual(levels);
    expect(lineLevelOf('grade0' as ReadingLevel)).toBe('grade2');
  });

  it('has a plain fallback name for all six ranks, so no rank is left out', () => {
    const ranks: RankId[] = ['lion', 'tiger', 'wolf', 'bear', 'webelos', 'arrow-of-light'];
    expect(Object.keys(RANK_FALLBACK_LABELS).sort()).toEqual([...ranks].sort());
    expect(RANK_FALLBACK_LABELS['arrow-of-light']).toBe('Arrow of Light');
  });

  it('teaches before testing: the lesson intro and the remind-me choices', () => {
    for (const level of ['grade2', 'grade5'] as const) {
      expect(line('lessonIntro', level)).toBe('Let me show you something first.');
      expect(line('remindMe', level)).toBe('Remind me');
      expect(line('iRemember', level)).toBe('I remember!');
      expect(line('remindAsk', level)).toMatch(/remember/);
    }
  });

  it('offers to keep going once the trail is done, and says everything is done for now when it is', () => {
    for (const level of ['grade2', 'grade5'] as const) {
      expect(line('choiceKeepGoing', level)).toBe('Keep going!');
      expect(line('choiceLookAround', level)).toBe('Look around');
      expect(line('greetDone', level)).toMatch(/keep going/);
      expect(line('allDone', level, { name: 'Rowan' })).toMatch(/done for now/);
      expect(line('allDone', level, { name: 'Rowan' })).toContain('Rowan');
    }
    // No bonus-stop wording is left in the done greeting or the Start button.
    for (const key of ['greetDone', 'startKeepGoing', 'allDone'] as const) {
      expect(LINES[key].grade2).not.toMatch(/bonus/i);
      expect(LINES[key].grade5).not.toMatch(/bonus/i);
    }
  });

  it('keeps every Den Chief line to everyday words for its age', () => {
    // grade2 lines at the grade 2 rules (one- and two-syllable words), grade5 lines at the grade 5 rules.
    const flagged: string[] = [];
    for (const key of KEYS) {
      for (const [level, grade] of [['grade2', 2], ['grade5', 5]] as const) {
        const text = LINES[key][level].replace(/\{\w+\}/g, 'Sam').replace(/\[(\w)\]/g, '$1');
        for (const miss of checkVocabulary(text, grade)) flagged.push(`${key}.${level}: ${miss.word} (${miss.reason})`);
      }
    }
    expect(flagged).toEqual([]);
  });

  it('words the field-check approval line in kid words, not "approval"', () => {
    expect(LINES.stopFieldApproval.grade2).not.toMatch(/approv/i);
    expect(LINES.stopFieldApproval.grade5).not.toMatch(/approv/i);
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
