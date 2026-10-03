/**
 * Dev-only test page for the activity catalog and the overlay kit. Open /dev/activities.html
 * (add ?run=<id> to start a sample right away). Every text here is invented and clearly fake.
 */
import { SAMPLE_CRAFT } from '../activities/craft/sample';
import { getActivity } from '../activities/registry';
import { SAMPLE_RHYTHM } from '../activities/rhythm/sample';
import { SAMPLE_SORT } from '../activities/sort/sample';
import type { ActivityContext, ActivitySpec, FieldMissionParams } from '../activities/types';
import { createFakeWorldHost, type FakeWorldOptions } from '../activities/world-fake';
import { showDialog } from '../ui/dialog';
import { clear, h } from '../ui/dom';
import { askNewPin, askPin } from '../ui/pinpad';
import { showToast } from '../ui/toast';
import { button } from '../ui/widgets';

const ui = document.getElementById('ui') as HTMLElement;
const listEl = document.getElementById('list') as HTMLElement;
const resultEl = document.getElementById('result') as HTMLElement;

/** The game has no voice, so the activities get a `speak` that does nothing. */
const speak = (): void => {};

interface Entry {
  id: string;
  label: string;
  run: () => Promise<unknown>;
}

function activityEntry(id: string, label: string, spec: ActivitySpec, stage?: ActivityContext['stage']): Entry {
  return {
    id,
    label,
    run: () => {
      const ctx: ActivityContext = { profileId: 'dev', rank: 'wolf', readingLevel: 'grade2', speak, stage };
      // getActivity returns the matching controller; the spec carries its own params.
      return getActivity(spec.type).run(ui, spec.params, ctx);
    },
  };
}

/**
 * A collect or navigate sample on a fake world: no 3D, no game. A "Walk to next" button stands in
 * for walking up to the next pickup or waypoint; it goes away when the activity ends.
 */
function worldEntry(id: string, label: string, spec: ActivitySpec, world: FakeWorldOptions): Entry {
  return {
    id,
    label,
    run: () => {
      const fake = createFakeWorldHost({ zoneId: 'nature-trail', ...world });
      const status = h('span', { class: 'dev-walk__status' });
      const walk = button('Walk to next', {
        variant: 'primary',
        icon: '\u{1F6B6}',
        onClick: () => {
          const reached = fake.walkToNext();
          status.textContent = reached ? `Reached: ${reached}` : 'Walked to the compass target.';
        },
      });
      walk.dataset.dev = 'walk-next';
      const bar = h(
        'div',
        {
          class: 'dev-walk',
          style: 'position:absolute;left:12px;bottom:12px;z-index:7;display:flex;align-items:center;gap:12px;',
        },
        walk,
        status,
      );
      ui.append(bar);
      const ctx: ActivityContext = { profileId: 'dev', rank: 'wolf', readingLevel: 'grade2', speak, world: fake };
      return getActivity(spec.type)
        .run(ui, spec.params, ctx)
        .finally(() => bar.remove());
    },
  };
}

const MISSION: FieldMissionParams = {
  title: 'Sample mission: Zip the Test Bunny picnic',
  kidSteps: [
    'Pick a pretend picnic spot.',
    'Draw the spot on paper.',
    'Show your drawing to a grown-up.',
  ],
  parentNote: 'Sample note. Only shown in parent mode.',
  evidence: 'checklist',
};

const activities: Entry[] = [
  activityEntry('quiz-a', 'Quiz A: Zip the Test Bunny (2 questions)', {
    type: 'quiz',
    params: {
      questions: [
        {
          prompt: 'Zip has 3 pretend carrots. Zip eats 1. How many are left?',
          choices: ['1', '2', '3'],
          answer: 1,
          explain: '3 take away 1 is 2.',
        },
        {
          prompt: 'Which one can fly?',
          choices: ['A rock', 'A kite', 'A shoe'],
          answer: 1,
          explain: 'A kite flies in the wind.',
        },
      ],
    },
  }),
  activityEntry('quiz-b', 'Quiz B: Planet Zorp (pass 2 of 3, 4 choices)', {
    type: 'quiz',
    params: {
      passCount: 2,
      questions: [
        {
          prompt: 'Captain Fluffernutter packs a pretend bag for Planet Zorp. What goes in first?',
          choices: ['The heavy pretend rocks', 'The soft pretend socks', 'The pretend sandwich', 'The pretend map'],
          answer: 0,
          explain: 'Heavy things go at the bottom.',
        },
        {
          prompt: 'On Planet Zorp, the pretend sky is purple. What color is it?',
          choices: ['Red', 'Purple', 'Orange', 'Pink'],
          answer: 1,
        },
        {
          prompt: 'Which is a pretend moon-pie ingredient?',
          choices: ['Moon dust', 'Star jam'],
          answer: 1,
          explain: 'Star jam is sweet.',
        },
      ],
    },
  }),
  activityEntry('sequence', 'Sequence: pretend sandwich (5 steps)', {
    type: 'sequence',
    params: {
      prompt: 'Help Zip make a pretend sandwich. Put the steps in order.',
      steps: [
        'Get two slices of pretend bread.',
        'Spread pretend jam on one slice.',
        'Add a pretend cheese slice.',
        'Close the sandwich.',
        'Take a pretend bite.',
      ],
    },
  }),
  activityEntry('mission-handout', 'Field mission: handout', { type: 'fieldMission', params: MISSION }, 'handout'),
  activityEntry('mission-checkin', 'Field mission: check-in (checklist)', { type: 'fieldMission', params: MISSION }, 'check-in'),
  activityEntry('sort', 'Sort: pack it or leave it', { type: 'sort', params: SAMPLE_SORT }),
  activityEntry('rhythm', 'Rhythm: Zip bounces', { type: 'rhythm', params: SAMPLE_RHYTHM }),
  activityEntry('craft', "Craft: Zip's day bag", { type: 'craft', params: SAMPLE_CRAFT }),
  worldEntry(
    'collect-a',
    'Collect: Zip the Test Bunny (fake world)',
    {
      type: 'collect',
      params: {
        prompt: 'Help Zip find the pretend items.',
        zone: 'nature-trail',
        targets: [
          { id: 'bunny', label: 'Test bunny', count: 1, hint: 'Pretend bunnies hide in the grass.' },
          { id: 'acorn', label: 'Pretend acorn', count: 2, hint: 'Look under the pretend oak.' },
          { id: 'feather', label: 'Test feather', count: 1 },
        ],
      },
    },
    {},
  ),
  worldEntry(
    'collect-b',
    'Collect: six pretend items (long list)',
    {
      type: 'collect',
      params: {
        prompt: 'Find all six pretend things for the pretend picnic.',
        zone: 'nature-trail',
        targets: ['Blanket', 'Basket', 'Lemonade', 'Sandwich', 'Napkin', 'Kite'].map((name) => ({
          id: name.toLowerCase(),
          label: `Pretend ${name.toLowerCase()}`,
          count: 1,
          hint: `A pretend ${name.toLowerCase()} is hiding somewhere nearby.`,
        })),
      },
    },
    {},
  ),
  worldEntry(
    'navigate-marker',
    'Navigate: beacon and compass (fake world)',
    {
      type: 'navigate',
      params: {
        prompt: 'Follow the beacon to the pretend places.',
        zone: 'nature-trail',
        waypoints: [
          { id: 'test-bridge', label: 'Test bridge' },
          { id: 'test-tower', label: 'Test tower' },
          { id: 'test-cabin', label: 'Test cabin' },
        ],
      },
    },
    {
      landmarks: {
        'test-bridge': { x: -8, y: 0, z: 2 },
        'test-tower': { x: 4, y: 0, z: -9 },
        'test-cabin': { x: 9, y: 0, z: 5 },
      },
    },
  ),
  worldEntry(
    'navigate-compass',
    'Navigate: compass only (open spots)',
    {
      type: 'navigate',
      params: {
        prompt: 'Use the compass to find the pretend spots.',
        zone: 'nature-trail',
        waypoints: [
          { id: 'spot-one', label: 'First pretend spot' },
          { id: 'spot-two', label: 'Second pretend spot' },
        ],
        useCompass: true,
      },
    },
    {},
  ),
  {
    id: 'collect-no-world',
    label: 'Collect: no 3D world (shows the camp card)',
    run: () =>
      getActivity('collect').run(
        ui,
        { prompt: 'Sample.', zone: 'nature-trail', targets: [{ id: 'bunny', label: 'Test bunny', count: 1 }] },
        { profileId: 'dev', rank: 'wolf', readingLevel: 'grade2', speak },
      ),
  },
];

const kit: Entry[] = [
  {
    id: 'dialog-next',
    label: 'Dialog: Next',
    run: async () => ({
      chosen: await showDialog(ui, {
        speaker: 'Zip',
        text: 'Hi! I am Zip the Test Bunny. I am not a real guide.',
      }),
    }),
  },
  {
    id: 'dialog-choices',
    label: 'Dialog: choices',
    run: async () => {
      const choices = ['Yes, let us go!', 'Tell me more.', 'Maybe later.'];
      const chosen = await showDialog(ui, { speaker: 'Zip', text: 'Ready for the sample trail?', choices });
      return { chosen, label: choices[chosen] };
    },
  },
  {
    id: 'toast',
    label: 'Toast',
    run: async () => {
      showToast(ui, 'Sample toast: +5 pretend stars!');
      return { shown: true };
    },
  },
  {
    id: 'pin',
    label: 'PIN pad (demo PIN 1234)',
    run: async () => ({
      ok: await askPin(ui, {
        title: 'Grown-up PIN',
        subtitle: 'Demo only. The sample PIN is 1234.',
        verify: (pin) => Promise.resolve(pin === '1234'),
      }),
    }),
  },
  {
    id: 'new-pin',
    label: 'New PIN (asks twice)',
    run: async () => {
      const pin = await askNewPin(ui, { title: 'Make a grown-up PIN', subtitle: 'Pick 4 numbers.' });
      return { pinSet: pin !== null, length: pin?.length ?? 0 }; // never print the PIN itself
    },
  },
];

let runToken = 0;
const buttons = new Map<string, HTMLButtonElement>();

async function start(entry: Entry): Promise<void> {
  const token = ++runToken;
  clear(ui);
  buttons.forEach((btn, id) => btn.setAttribute('aria-current', String(id === entry.id)));
  resultEl.textContent = 'Running...';
  try {
    const result = await entry.run();
    if (token === runToken) resultEl.textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    if (token === runToken) resultEl.textContent = `Error: ${String(error)}`;
  }
}

function renderGroup(title: string, entries: Entry[]): HTMLElement[] {
  return [
    h('h2', null, title),
    ...entries.map((entry) => {
      const btn = button(entry.label, { variant: 'secondary', onClick: () => void start(entry) });
      btn.dataset.id = entry.id;
      buttons.set(entry.id, btn);
      return btn;
    }),
  ];
}

listEl.append(
  h('h1', null, 'Activity harness'),
  ...renderGroup('Activities', activities),
  ...renderGroup('UI kit', kit),
);

const wanted = new URLSearchParams(location.search).get('run');
const first = [...activities, ...kit].find((entry) => entry.id === wanted);
if (first) void start(first);
