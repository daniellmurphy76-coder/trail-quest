/**
 * Synthetic rank content for logic tests. Everything here is invented: the names, the
 * text and the URLs are obviously fake and are not Scouting America material. The rank
 * id is 'wolf' only because RankId is a closed set.
 *
 * Content order is deliberately NOT play order: Test Trek (outdoors) is listed before
 * Test Camp (bobcat), so tests can prove that Bobcat comes first.
 *
 * Adventures:
 *   wolf.test-trek   outdoors   required  collect, navigate, craft, fieldMission+quiz practice
 *   wolf.test-camp   bobcat     required  quiz, fieldMission+sequence practice, fieldMission, sort
 *   wolf.test-pick   fitness    required  rhythm, then choose 2 of: quiz, sequence, craft
 *   wolf.test-extra  elective   optional  quiz
 */
import type { ActivitySpec } from '../../src/activities/types';
import type { Adventure, RankContent, Requirement } from '../../src/content/types';

const SOURCE = 'https://example.invalid/test-content';
const FETCHED = '2026-01-01';

const quiz = (prompt: string): ActivitySpec => ({
  type: 'quiz',
  params: { questions: [{ prompt, choices: ['Alpha', 'Beta'], answer: 0 }] },
});
const sequence = (prompt: string): ActivitySpec => ({
  type: 'sequence',
  params: { prompt, steps: ['First test step', 'Second test step', 'Third test step'] },
});
const sort = (prompt: string): ActivitySpec => ({
  type: 'sort',
  params: {
    prompt,
    bins: [
      { id: 'left', label: 'Left bin' },
      { id: 'right', label: 'Right bin' },
    ],
    items: [
      { label: 'Test item one', bin: 'left' },
      { label: 'Test item two', bin: 'right' },
    ],
  },
});
const collect: ActivitySpec = {
  type: 'collect',
  params: {
    prompt: 'Collect the test tokens.',
    zone: 'nature-trail',
    targets: [{ id: 'token', label: 'Test token', count: 2 }],
  },
};
const navigate: ActivitySpec = {
  type: 'navigate',
  params: {
    prompt: 'Visit the test posts.',
    zone: 'nature-trail',
    waypoints: [
      { id: 'post-a', label: 'Test post A' },
      { id: 'post-b', label: 'Test post B' },
    ],
  },
};
const rhythm: ActivitySpec = {
  type: 'rhythm',
  params: { prompt: 'Tap along.', exercise: 'test claps', reps: 5 },
};
const craft: ActivitySpec = {
  type: 'craft',
  params: {
    prompt: 'Make a test gadget.',
    result: 'Test gadget',
    ingredients: [
      { id: 'part-a', label: 'Test part A' },
      { id: 'part-b', label: 'Test part B' },
    ],
    distractors: [{ id: 'junk', label: 'Test junk' }],
  },
};
const fieldMission = (title: string): ActivitySpec => ({
  type: 'fieldMission',
  params: { title, kidSteps: ['Do test step one.', 'Do test step two.'], evidence: 'none' },
});

function req(
  adventureId: string,
  n: number,
  activity: ActivitySpec,
  extras: Partial<Requirement> = {},
): Requirement {
  return {
    id: `${adventureId}.${n}`,
    number: String(n),
    adultText: `Synthetic test requirement ${adventureId} number ${n}.`,
    kidText: `Test step ${n} of ${adventureId}. This second sentence is extra.`,
    digital: activity.type !== 'fieldMission',
    activity,
    ...extras,
  };
}

const trek: Adventure = {
  id: 'wolf.test-trek',
  name: 'Test Trek',
  category: 'outdoors',
  required: true,
  sourceUrl: SOURCE,
  fetchedOn: FETCHED,
  summary: 'A fake outdoors adventure for tests.',
  requirements: [
    req('wolf.test-trek', 1, collect),
    req('wolf.test-trek', 2, navigate),
    req('wolf.test-trek', 3, craft),
    req('wolf.test-trek', 4, fieldMission('Test trek chore'), {
      practice: quiz('Which test trek word is first?'),
    }),
  ],
};

const camp: Adventure = {
  id: 'wolf.test-camp',
  name: 'Test Camp',
  category: 'bobcat',
  required: true,
  sourceUrl: SOURCE,
  fetchedOn: FETCHED,
  summary: 'A fake bobcat adventure for tests.',
  requirements: [
    req('wolf.test-camp', 1, quiz('Which camp word is first?')),
    req('wolf.test-camp', 2, fieldMission('Test camp chore'), {
      practice: sequence('Put the test steps in order.'),
    }),
    req('wolf.test-camp', 3, fieldMission('Test camp errand')),
    req('wolf.test-camp', 4, sort('Sort the test items.')),
  ],
};

const pick: Adventure = {
  id: 'wolf.test-pick',
  name: 'Test Pick',
  category: 'fitness',
  required: true,
  sourceUrl: SOURCE,
  fetchedOn: FETCHED,
  summary: 'A fake choose-two adventure for tests.',
  choose: { count: 2, from: ['wolf.test-pick.2', 'wolf.test-pick.3', 'wolf.test-pick.4'] },
  requirements: [
    req('wolf.test-pick', 1, rhythm),
    req('wolf.test-pick', 2, quiz('Which pick word is first?'), { optional: true }),
    req('wolf.test-pick', 3, sequence('Order the pick steps.'), { optional: true }),
    req('wolf.test-pick', 4, craft, { optional: true }),
  ],
};

const extra: Adventure = {
  id: 'wolf.test-extra',
  name: 'Test Extra',
  category: 'elective',
  required: false,
  sourceUrl: SOURCE,
  fetchedOn: FETCHED,
  summary: 'A fake elective that is never required.',
  requirements: [req('wolf.test-extra', 1, quiz('Which extra word is first?'))],
};

export const fixtureRank: RankContent = {
  rank: 'wolf',
  label: 'Test Wolf',
  grade: 2,
  ageRange: '7-8',
  readingLevel: 'grade2',
  program: {
    name: 'Synthetic Test Program',
    year: 2026,
    indexUrl: SOURCE,
    fetchedOn: FETCHED,
  },
  adventures: [trek, camp, pick, extra],
};

/** Requirement ids, named by what they are, so tests read clearly. */
export const ID = {
  trekCollect: 'wolf.test-trek.1',
  trekNavigate: 'wolf.test-trek.2',
  trekCraft: 'wolf.test-trek.3',
  trekChore: 'wolf.test-trek.4', // field mission, quiz practice
  campQuiz: 'wolf.test-camp.1',
  campChore: 'wolf.test-camp.2', // field mission, sequence practice
  campErrand: 'wolf.test-camp.3', // field mission, no practice
  campSort: 'wolf.test-camp.4',
  pickRhythm: 'wolf.test-pick.1',
  pickQuiz: 'wolf.test-pick.2', // choose set
  pickSequence: 'wolf.test-pick.3', // choose set
  pickCraft: 'wolf.test-pick.4', // choose set
  extraQuiz: 'wolf.test-extra.1',
} as const;

export const ADVENTURE = {
  trek: 'wolf.test-trek',
  camp: 'wolf.test-camp',
  pick: 'wolf.test-pick',
  extra: 'wolf.test-extra',
} as const;
