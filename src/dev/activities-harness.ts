/**
 * Dev-only test page for the activity catalog and the overlay kit. Open /dev/activities.html
 * (add ?run=<id> to start a sample right away). Every text here is invented and clearly fake.
 */
import { getActivity } from '../activities/registry';
import type { ActivityContext, ActivitySpec, FieldMissionParams } from '../activities/types';
import { showDialog } from '../ui/dialog';
import { clear, h } from '../ui/dom';
import { askNewPin, askPin } from '../ui/pinpad';
import { createSpeaker, prepareSpeechOnFirstGesture } from '../ui/speech';
import { showToast } from '../ui/toast';
import { button } from '../ui/widgets';

const ui = document.getElementById('ui') as HTMLElement;
const listEl = document.getElementById('list') as HTMLElement;
const resultEl = document.getElementById('result') as HTMLElement;

let readAloud = true;
prepareSpeechOnFirstGesture();
const speak = createSpeaker(() => readAloud);

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
  activityEntry('coming-soon', 'Coming soon: sort (not built yet)', {
    type: 'sort',
    params: {
      prompt: 'Sample sort.',
      bins: [
        { id: 'a', label: 'Bin A' },
        { id: 'b', label: 'Bin B' },
      ],
      items: [{ label: 'Thing 1', bin: 'a' }],
    },
  }),
];

const kit: Entry[] = [
  {
    id: 'dialog-next',
    label: 'Dialog: Next',
    run: async () => ({
      chosen: await showDialog(ui, {
        speaker: 'Zip',
        text: 'Hi! I am Zip the Test Bunny. I am not a real guide.',
        speak,
        autoSpeak: true,
      }),
    }),
  },
  {
    id: 'dialog-choices',
    label: 'Dialog: choices',
    run: async () => {
      const choices = ['Yes, let us go!', 'Tell me more.', 'Maybe later.'];
      const chosen = await showDialog(ui, { speaker: 'Zip', text: 'Ready for the sample trail?', choices, speak });
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

const readToggle = h('input', { type: 'checkbox', checked: readAloud, id: 'read-aloud' });
readToggle.addEventListener('change', () => {
  readAloud = readToggle.checked;
});

listEl.append(
  h('h1', null, 'Activity harness'),
  h('label', null, readToggle, 'Read aloud on'),
  ...renderGroup('Activities', activities),
  ...renderGroup('UI kit', kit),
);

const wanted = new URLSearchParams(location.search).get('run');
const first = [...activities, ...kit].find((entry) => entry.id === wanted);
if (first) void start(first);
