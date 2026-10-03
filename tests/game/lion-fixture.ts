/**
 * Synthetic Lion-style content for tests: kindergarten reading level (grade1), three requirements
 * with lessons, invented names and text. Not Scouting America material. It proves nothing in the
 * game assumes Wolf and Arrow of Light are the only ranks.
 *
 * Adventures:
 *   lion.test-roar   bobcat   required  quiz (with lesson), fieldMission + sequence practice (with
 *                                       lesson), fieldMission with no practice
 *   lion.test-paws   outdoors required  quiz (with lesson)
 */
import type { ActivitySpec } from '../../src/activities/types';
import type { Adventure, RankContent, Requirement } from '../../src/content/types';

const SOURCE = 'https://example.invalid/test-lion';
const FETCHED = '2026-01-01';

const quiz = (prompt: string): ActivitySpec => ({
  type: 'quiz',
  params: { questions: [{ prompt, choices: ['Yes', 'No'], answer: 0 }] },
});
const sequence = (prompt: string): ActivitySpec => ({
  type: 'sequence',
  params: { prompt, steps: ['First lion step', 'Second lion step', 'Third lion step'] },
});
const mission = (title: string): ActivitySpec => ({
  type: 'fieldMission',
  params: { title, kidSteps: ['Do the lion thing.'], evidence: 'none' },
});

function req(adventureId: string, n: number, activity: ActivitySpec, extras: Partial<Requirement> = {}): Requirement {
  return {
    id: `${adventureId}.${n}`,
    number: String(n),
    adultText: `Synthetic lion requirement ${adventureId} number ${n}.`,
    kidText: `Lion step ${n}. This is extra.`,
    digital: activity.type !== 'fieldMission',
    activity,
    ...extras,
  };
}

const roar: Adventure = {
  id: 'lion.test-roar',
  name: 'Test Roar',
  category: 'bobcat',
  required: true,
  sourceUrl: SOURCE,
  fetchedOn: FETCHED,
  summary: 'A fake Lion adventure for tests.',
  requirements: [
    req('lion.test-roar', 1, quiz('Is a lion a cat?'), {
      lesson: { lines: ['A lion is a big cat.', 'Lions live in groups.', 'The group is a pride.'] },
    }),
    req('lion.test-roar', 2, mission('Lion chore'), {
      practice: sequence('Put the lion steps in order.'),
      lesson: { lines: ['Do the chore in three steps.', 'Go slow.'] },
    }),
    req('lion.test-roar', 3, mission('Lion errand')),
  ],
};

const paws: Adventure = {
  id: 'lion.test-paws',
  name: 'Test Paws',
  category: 'outdoors',
  required: true,
  sourceUrl: SOURCE,
  fetchedOn: FETCHED,
  summary: 'A second fake Lion adventure.',
  requirements: [
    req('lion.test-paws', 1, quiz('Do lions have paws?'), { lesson: { lines: ['Lions have big paws.'] } }),
  ],
};

export const lionRank: RankContent = {
  rank: 'lion',
  label: 'Test Lion',
  grade: 0,
  ageRange: '5-6',
  readingLevel: 'grade1',
  program: { name: 'Synthetic Test Program', year: 2026, indexUrl: SOURCE, fetchedOn: FETCHED },
  adventures: [roar, paws],
};

export const LION_ID = {
  roarQuiz: 'lion.test-roar.1',
  roarChore: 'lion.test-roar.2', // field mission, sequence practice
  roarErrand: 'lion.test-roar.3', // field mission, no practice
  pawsQuiz: 'lion.test-paws.1',
} as const;
