import { describe, expect, it } from 'vitest';
import { LINE_VARS, line, type LineLevel } from '../../src/game/lines';
import { GUIDE_LINES, guideArrivalLine, guideLine, guideTalkPages, type GuideLineSet } from '../../src/npc/guide-lines';
import { GUIDES, guideById, type GuideId } from '../../src/npc/guide-types';
import { checkVocabulary } from '../../scripts/vocabulary.mjs';

/** Sentences end at . ! ? or an ellipsis. A {placeholder} counts as one word. (Same rule as lines.test.ts.) */
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
const LEVELS = ['grade2', 'grade5'] as const;
const IDS = GUIDES.map((g) => g.id);

/** Every line a guide has, named for the failure message. */
function allLines(id: GuideId): { name: string; pair: { grade2: string; grade5: string } }[] {
  const set: GuideLineSet = GUIDE_LINES[id];
  return [
    { name: 'greet', pair: set.greet },
    { name: 'greetFirst', pair: set.greetFirst },
    { name: 'about', pair: set.about },
    ...set.tips.map((pair, i) => ({ name: `tips[${i}]`, pair })),
    ...set.arrive.map((pair, i) => ({ name: `arrive[${i}]`, pair })),
    { name: 'trailWaiting', pair: set.trailWaiting },
    { name: 'bye', pair: set.bye },
  ];
}

describe('guide lines: shape', () => {
  it('has lines for every guide, in both reading levels', () => {
    expect(Object.keys(GUIDE_LINES).sort()).toEqual([...IDS].sort());
    for (const id of IDS) {
      for (const { name, pair } of allLines(id)) {
        for (const level of LEVELS) expect(pair[level].trim(), `${id}.${name}.${level}`).not.toBe('');
      }
    }
  });

  it('gives each guide two or three tips and one or two arrival lines to rotate', () => {
    for (const id of IDS) {
      expect(GUIDE_LINES[id].tips.length, `${id} tips`).toBeGreaterThanOrEqual(2);
      expect(GUIDE_LINES[id].tips.length, `${id} tips`).toBeLessThanOrEqual(3);
      expect(GUIDE_LINES[id].arrive.length, `${id} arrive`).toBeGreaterThanOrEqual(1);
    }
  });

  it('only uses the documented placeholders, and fills them all', () => {
    const allowed = new Set<string>(LINE_VARS);
    for (const id of IDS) {
      for (const { name, pair } of allLines(id)) {
        for (const level of LEVELS) {
          for (const match of pair[level].matchAll(/\{(\w+)\}/g)) {
            expect(allowed.has(match[1]!), `${id}.${name}.${level} uses {${match[1]}}`).toBe(true);
          }
          const filled = guideLine(id, pair, level, { name: 'Rowan', guide: 'Den Chief' });
          expect(filled, `${id}.${name}.${level}`).not.toMatch(/[{}]/);
        }
      }
    }
  });

  it('mentions the Den Chief the first time, and not on a plain greeting', () => {
    for (const id of IDS) {
      for (const level of LEVELS) {
        const first = guideLine(id, GUIDE_LINES[id].greetFirst, level, { name: 'Rowan', guide: 'Den Chief' });
        expect(first, `${id}.${level}`).toContain('Den Chief said you were coming');
        expect(GUIDE_LINES[id].greet[level]).not.toContain('{guide}');
      }
    }
  });

  it('introduces itself by role in the first greeting, and never by a personal name', () => {
    for (const { id, role } of GUIDES) {
      for (const level of LEVELS) expect(GUIDE_LINES[id].greetFirst[level]).toContain(`I am the ${role}`);
    }
  });
});

describe('guide lines: reading level', () => {
  for (const level of LEVELS) {
    it(`keeps every ${level} sentence to ${LIMIT[level]} words or fewer`, () => {
      const tooLong: string[] = [];
      for (const id of IDS) {
        for (const { name, pair } of allLines(id)) {
          for (const sentence of sentences(pair[level])) {
            const words = wordCount(sentence);
            if (words > LIMIT[level]) tooLong.push(`${id}.${name}.${level} (${words}): ${sentence}`);
          }
        }
      }
      expect(tooLong).toEqual([]);
    });
  }

  it('keeps every guide line to everyday words for its age', () => {
    const flagged: string[] = [];
    for (const id of IDS) {
      for (const { name, pair } of allLines(id)) {
        for (const [level, grade] of [['grade2', 2], ['grade5', 5]] as const) {
          // The role words (Coach, Ranger, Mayor, Firefighter, Camp Cook) are what the guides are called:
          // they appear in the lines themselves, so they are checked as written. Placeholders stand in for names.
          const text = pair[level].replace(/\{\w+\}/g, 'Sam');
          for (const miss of checkVocabulary(text, grade)) flagged.push(`${id}.${name}.${level}: ${miss.word} (${miss.reason})`);
        }
      }
    }
    expect(flagged).toEqual([]);
  });

  it('says each role the way a kid says it, with no school-report words', () => {
    for (const { role } of GUIDES) {
      for (const level of LEVELS) {
        const flagged = checkVocabulary(role, level === 'grade2' ? 2 : 5).map((m) => m.word);
        expect(flagged, `${role} at ${level}`).toEqual([]);
      }
    }
  });

  it('never lectures: no line is more than three short sentences', () => {
    for (const id of IDS) {
      for (const { name, pair } of allLines(id)) {
        for (const level of LEVELS) expect(sentences(pair[level]).length, `${id}.${name}.${level}`).toBeLessThanOrEqual(3);
      }
    }
  });

  it('never offers to read aloud or speak (the game has no voice)', () => {
    for (const id of IDS) {
      for (const { pair } of allLines(id)) {
        for (const level of LEVELS) expect(pair[level]).not.toMatch(/aloud|listen to me|hear me/i);
      }
    }
  });
});

describe('guide talk pages', () => {
  const vars = { name: 'Rowan', guide: 'Den Chief' };
  const base = { vars, firstToday: false, tipIndex: 0, trailWaiting: false };

  it('goes greeting, what the place is for, one tip, then a goodbye when nothing is waiting', () => {
    for (const { id } of GUIDES) {
      const pages = guideTalkPages(id, { ...base, level: 'grade2' });
      const set = GUIDE_LINES[id];
      expect(pages.map((p) => p.text)).toEqual([
        guideLine(id, set.greet, 'grade2', vars),
        guideLine(id, set.about, 'grade2', vars),
        guideLine(id, set.tips[0]!, 'grade2', vars),
        guideLine(id, set.bye, 'grade2', vars),
      ]);
      expect(pages.some((p) => p.choices)).toBe(false);
    }
  });

  it('uses the first-time greeting only when asked', () => {
    const first = guideTalkPages('ranger', { ...base, level: 'grade2', firstToday: true });
    expect(first[0]!.text).toContain('Den Chief said you were coming');
    const again = guideTalkPages('ranger', { ...base, level: 'grade2' });
    expect(again[0]!.text).not.toContain('said you were coming');
  });

  it('ends on the trail waiting with the two choices while the trail is open', () => {
    for (const { id } of GUIDES) {
      const pages = guideTalkPages(id, { ...base, level: 'grade5', trailWaiting: true });
      const last = pages.at(-1)!;
      expect(last.text).toBe(guideLine(id, GUIDE_LINES[id].trailWaiting, 'grade5', vars));
      expect(last.text).toContain('Den Chief');
      expect(last.choices).toEqual([line('choiceToCamp', 'grade5'), line('choiceLookAround', 'grade5')]);
      expect(last.choices![0]).toBe('Take me to camp');
      // Only the last page asks anything.
      expect(pages.slice(0, -1).some((p) => p.choices)).toBe(false);
    }
  });

  it('takes turns with the tips, and wraps around', () => {
    const tipAt = (tipIndex: number): string => guideTalkPages('coach', { ...base, level: 'grade2', tipIndex })[2]!.text;
    const count = GUIDE_LINES.coach.tips.length;
    const seen = new Set(Array.from({ length: count }, (_, i) => tipAt(i)));
    expect(seen.size).toBe(count);
    expect(tipAt(count)).toBe(tipAt(0));
    expect(tipAt(-1)).toBe(tipAt(count - 1));
  });

  it('picks the wording for the reading level', () => {
    const wolf = guideTalkPages('mayor', { ...base, level: 'grade2' });
    const arrow = guideTalkPages('mayor', { ...base, level: 'grade5' });
    expect(wolf[1]!.text).toBe(GUIDE_LINES.mayor.about.grade2);
    expect(arrow[1]!.text).toBe(GUIDE_LINES.mayor.about.grade5);
    expect(wolf[1]!.text).not.toBe(arrow[1]!.text);
  });

  it('says one short arrival line, and the lines take turns', () => {
    for (const { id } of GUIDES) {
      const first = guideArrivalLine(id, 'grade2', vars, 0);
      expect(first).toBe(guideLine(id, GUIDE_LINES[id].arrive[0]!, 'grade2', vars));
      expect(guideArrivalLine(id, 'grade5', vars, GUIDE_LINES[id].arrive.length)).toBe(guideArrivalLine(id, 'grade5', vars, 0));
    }
  });

  it('fills {role} from the guide, so a line can name its own job', () => {
    expect(guideLine('camp-cook', { grade2: 'I am the {role}.', grade5: 'I am the {role}.' }, 'grade2')).toBe('I am the Camp Cook.');
    expect(guideById('coach').role).toBe('Coach');
  });
});
