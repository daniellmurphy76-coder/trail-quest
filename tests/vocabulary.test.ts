import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALLOWLIST,
  BLOCKLIST,
  checkSentences,
  checkVocabulary,
  collectKidStrings,
  syllables,
} from '../scripts/vocabulary.mjs';
import { validateRankFiles } from '../scripts/validate-content.mjs';

const words = (text: string, grade: number) => checkVocabulary(text, grade).map((f) => f.word);

describe('syllables', () => {
  it.each([
    ['benefit', 3],
    ['method', 2],
    ['together', 3],
    ['adventure', 3],
    ['little', 2],
    ['fire', 1],
    ['supervision', 4],
    ['game', 1],
    ['walked', 1],
    ['wanted', 2],
    ['tables', 2],
    ['rules', 1],
    ['going', 2],
    ['careful', 2],
    ['celebrate', 3],
    ['individual', 5],
    ['participate', 4],
    ['quiet', 2],
    ['radio', 3],
    ['fireplace', 2],
  ])('%s has %i syllables', (word, expected) => {
    expect(syllables(word)).toBe(expected);
  });

  it('accepts 2 or 3 for "every"', () => {
    expect([2, 3]).toContain(syllables('every'));
  });

  it('ignores case and punctuation, and returns 0 for no letters', () => {
    expect(syllables('Adventure!')).toBe(3);
    expect(syllables('123')).toBe(0);
  });
});

describe('checkVocabulary', () => {
  it('flags school-report words at grade 5 but not the allowlisted patrol', () => {
    expect(words('Which is a benefit of the patrol method?', 5)).toEqual(['benefit', 'method']);
  });

  it('flags the same two words at grade 2 (patrol is allowlisted)', () => {
    expect(words('Which is a benefit of the patrol method?', 2)).toEqual(['benefit', 'method']);
    expect(ALLOWLIST).toContain('patrol');
  });

  it('passes plain text at grade 2', () => {
    expect(checkVocabulary('Do your best.', 2)).toEqual([]);
  });

  it('gives a reason for every flag', () => {
    const [flag] = checkVocabulary('Pick one benefit.', 5);
    expect(flag).toEqual({ word: 'benefit', reason: 'school-report word' });
  });

  it('flags 3-syllable words at grade 2 but not at grade 5', () => {
    expect(words('See the elephant.', 2)).toEqual(['elephant']);
    expect(words('See the elephant.', 5)).toEqual([]);
  });

  it('flags 4-syllable words at grade 5 unless allowlisted', () => {
    expect(words('Share your understanding.', 5)).toEqual(['understanding']);
    expect(words('Say the Scout Law with the community.', 5)).toEqual([]);
  });

  it('flags long 2-syllable words at grade 2 only', () => {
    expect(words('Pack your knowledge.', 2)).toEqual(['knowledge']);
    expect(words('Pack your knowledge.', 5)).toEqual([]);
    // plural -s does not push an 8-letter word over the limit
    expect(words('Zip your backpacks.', 2)).toEqual([]);
  });

  it('allows describe, discuss and physical at grade 5 only', () => {
    expect(words('Describe it. Discuss it.', 2)).toEqual(['describe', 'discuss']);
    expect(words('Describe it. Discuss it.', 5)).toEqual([]);
    // "physically" is the Scout Oath's own word, so it is allowlisted at every grade; plain "physical" is not.
    expect(words('Keep yourself physically strong.', 2)).toEqual([]);
    expect(words('Get a physical check.', 2)).toContain('physical');
    expect(words('Keep yourself physically strong.', 5)).toEqual([]);
  });

  it('treats grades 0-1 like 2 and grades 3-4 like 5', () => {
    expect(words('See the elephant.', 1)).toEqual(['elephant']);
    expect(words('See the elephant.', 3)).toEqual([]);
    expect(words('Describe it.', 4)).toEqual([]);
  });

  it('matches inflections of blocked and allowed words', () => {
    expect(words('You are participating. Scouts benefited.', 5)).toEqual(['participating', 'benefited']);
    expect(words('He celebrated the campfires.', 5)).toEqual([]);
  });

  it('ignores numbers, possessives and repeats', () => {
    expect(checkVocabulary('The Scout Law has 12 points. 3rd, 4th.', 2)).toEqual([]);
    expect(words("Scout's benefit and the benefit.", 5)).toEqual(['benefit']);
  });

  it('keeps the lists as lowercase arrays, with requirement left off the allowlist', () => {
    for (const w of [...BLOCKLIST, ...ALLOWLIST]) expect(w).toBe(w.toLowerCase());
    expect(ALLOWLIST).not.toContain('requirement');
    expect(BLOCKLIST).toContain('benefit');
  });
});

describe('checkSentences', () => {
  const sentence = (n: number) => `${Array.from({ length: n }, (_, i) => `word${i}`).join(' ')}.`;

  it('fails a 16-word sentence at grade 5 and passes a 15-word one', () => {
    expect(checkSentences(sentence(16), 5)).toMatchObject([{ words: 16, limit: 15 }]);
    expect(checkSentences(sentence(15), 5)).toEqual([]);
  });

  it('uses 10 words at grade 2 or lower', () => {
    expect(checkSentences(sentence(11), 2)).toMatchObject([{ words: 11, limit: 10 }]);
    expect(checkSentences(sentence(10), 2)).toEqual([]);
    expect(checkSentences(sentence(11), 1)).toHaveLength(1);
    expect(checkSentences(sentence(11), 3)).toEqual([]);
  });

  it('splits on . ! ? and line breaks, so several short sentences pass', () => {
    expect(checkSentences('Stop now! Look left. Look right? Go.\nWalk on.', 2)).toEqual([]);
    expect(checkSentences(`${sentence(8)} ${sentence(8)}`, 2)).toEqual([]);
  });

  it('does not split decimals', () => {
    expect(checkSentences('Walk 1.5 miles to the lake and back again today please.', 2)).toHaveLength(1);
    expect(checkSentences('Walk 1.5 miles to the lake.', 2)).toEqual([]);
  });
});

describe('collectKidStrings', () => {
  const rank = {
    grade: 2,
    adventures: [
      {
        summary: 'adv summary',
        requirements: [
          {
            kidText: 'kid text',
            adultText: 'ADULT TEXT',
            notes: 'NOTES',
            lesson: { lines: ['lesson one', 'lesson two'] },
            activity: {
              type: 'fieldMission',
              params: { title: 'mission title', kidSteps: ['step one', 'step two'], parentNote: 'PARENT NOTE' },
            },
            practice: {
              type: 'quiz',
              params: {
                questions: [{ prompt: 'q prompt', choices: ['c1', 'c2'], answer: 0, explain: 'q explain' }],
                parentNote: 'PARENT NOTE 2',
              },
            },
          },
        ],
      },
    ],
    electives: [{ id: 'x', name: 'Elective', summary: 'elective summary' }],
  };

  it('finds strings under activity and practice params and ignores adult text', () => {
    const found = [...collectKidStrings(rank)];
    expect(found.map((f) => f.text)).toEqual([
      'adv summary',
      'kid text',
      'lesson one',
      'lesson two',
      'mission title',
      'step one',
      'step two',
      'q prompt',
      'c1',
      'c2',
      'q explain',
      'elective summary',
    ]);
    const text = found.map((f) => f.text).join(' ');
    expect(text).not.toMatch(/ADULT|NOTES|PARENT/);
  });

  it('reports JSON paths', () => {
    const paths = [...collectKidStrings(rank)].map((f) => f.path);
    expect(paths).toContain('$.adventures[0].requirements[0].kidText');
    expect(paths).toContain('$.adventures[0].requirements[0].lesson.lines[1]');
    expect(paths).toContain('$.adventures[0].requirements[0].activity.params.kidSteps[1]');
    expect(paths).toContain('$.adventures[0].requirements[0].practice.params.questions[0].choices[1]');
    expect(paths).toContain('$.electives[0].summary');
  });

  it('covers the other activity types', () => {
    const texts = (type: string, params: object) =>
      [...collectKidStrings({ adventures: [{ requirements: [{ activity: { type, params } }] }] })].map((f) => f.text);
    expect(texts('sequence', { prompt: 'p', steps: ['s1', 's2'] })).toEqual(['p', 's1', 's2']);
    expect(
      texts('sort', { prompt: 'p', bins: [{ id: 'a', label: 'bin' }], items: [{ label: 'item', bin: 'a' }] }),
    ).toEqual(['p', 'bin', 'item']);
    expect(
      texts('collect', { prompt: 'p', zone: 'z', targets: [{ id: 't', label: 'tl', count: 1, hint: 'th' }] }),
    ).toEqual(['p', 'tl', 'th']);
    expect(texts('navigate', { prompt: 'p', zone: 'z', waypoints: [{ id: 'w', label: 'wl' }] })).toEqual(['p', 'wl']);
    expect(texts('rhythm', { prompt: 'p', exercise: 'jumping jacks', reps: 5 })).toEqual(['p', 'jumping jacks']);
    expect(
      texts('craft', {
        prompt: 'p',
        result: 'r',
        ingredients: [{ id: 'i', label: 'il' }],
        distractors: [{ id: 'd', label: 'dl' }],
      }),
    ).toEqual(['p', 'r', 'il', 'dl']);
  });

  it('survives malformed input', () => {
    expect([...collectKidStrings(null)]).toEqual([]);
    const odd = { adventures: [null, { requirements: [{ activity: { type: 'constructor' } }] }] };
    expect([...collectKidStrings(odd)]).toEqual([]);
  });
});

describe('validateRankFiles vocabulary rule', () => {
  const rank = (grade: number, kidText: string, lines?: string[]) => ({
    rank: 'wolf',
    label: 'Wolf',
    grade,
    ageRange: '7-8',
    readingLevel: 'grade2',
    program: { name: 'p', year: 2024, indexUrl: 'https://example.com/', fetchedOn: '2026-01-01' },
    adventures: [
      {
        id: 'wolf.test',
        name: 'Test',
        category: 'bobcat',
        required: true,
        sourceUrl: 'https://example.com/',
        fetchedOn: '2026-01-01',
        summary: 'Do your best.',
        requirements: [
          {
            id: 'wolf.test.1',
            number: '1',
            adultText: 'Adults may use the word benefit freely.',
            kidText,
            digital: false,
            ...(lines ? { lesson: { lines } } : {}),
            activity: { type: 'fieldMission', params: { title: 'Go', kidSteps: ['Say hi.'] } },
          },
        ],
      },
    ],
  });

  const dirWith = (data: object) => {
    const dir = mkdtempSync(join(tmpdir(), 'tq-vocab-'));
    writeFileSync(join(dir, 'wolf.json'), JSON.stringify(data));
    return dir;
  };

  it('reports flagged words and long sentences with the file, path and a snippet', () => {
    const long = 'we go to the lake and we hike up the hill now';
    const { errors, vocabulary } = validateRankFiles(dirWith(rank(2, `Which is a benefit? ${long}.`)));
    expect(vocabulary.errors).toHaveLength(2);
    expect(errors).toEqual(vocabulary.errors);
    expect(errors[0]).toBe(
      'wolf.json $.adventures[0].requirements[0].kidText: "benefit" (school-report word) in: "Which is a benefit? we go to the lake and we hike up the hil..."',
    );
    expect(errors[1]).toContain('sentence has 12 words, grade 2 limit is 10');
  });

  it('checks lesson lines like kidText', () => {
    const { errors } = validateRankFiles(dirWith(rank(2, 'Say hi.', ['Meet the elephant.'])));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('$.adventures[0].requirements[0].lesson.lines[0]: "elephant"');
  });

  it('uses the grade in the file and can be switched off', () => {
    expect(validateRankFiles(dirWith(rank(5, 'Pick an elephant.'))).errors).toEqual([]);
    const bad = dirWith(rank(2, 'Pick an elephant.'));
    expect(validateRankFiles(bad).errors).toHaveLength(1);
    expect(validateRankFiles(bad, { vocabulary: false }).errors).toEqual([]);
  });

  it('never checks adult-only text', () => {
    expect(validateRankFiles(dirWith(rank(2, 'Say hi.'))).errors).toEqual([]);
  });
});
