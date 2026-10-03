// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectActivity } from '../../src/activities/collect';
import { craftActivity } from '../../src/activities/craft';
import { fieldMissionActivity } from '../../src/activities/fieldMission';
import { navigateActivity } from '../../src/activities/navigate';
import { quizActivity } from '../../src/activities/quiz';
import { rhythmActivity } from '../../src/activities/rhythm';
import { sequenceActivity } from '../../src/activities/sequence';
import { sortActivity } from '../../src/activities/sort';
import type {
  CollectParams,
  CraftParams,
  FieldMissionParams,
  NavigateParams,
  QuizParams,
  RhythmParams,
  SequenceParams,
  SortParams,
} from '../../src/activities/types';
import { createFakeWorldHost } from '../../src/activities/world-fake';
import { events, type GameEvent } from '../../src/game/events';
import { buttonByText, makeCtx, makeHost } from './helpers';

let host: HTMLElement;
let seen: GameEvent[];
let off: () => void;

beforeEach(() => {
  host = makeHost();
  seen = [];
  off = events.on((event) => seen.push(event));
});
afterEach(() => {
  off();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Event types so far; `clear` forgets them so a test can look at one step at a time. */
const types = (): string[] => seen.map((e) => e.type);
const clear = (): void => {
  seen.length = 0;
};

describe('quiz events', () => {
  const PARAMS: QuizParams = {
    questions: [
      { prompt: 'Which is a color?', choices: ['Blue', 'Hop', 'Soup'], answer: 0 },
      { prompt: 'Which one flies?', choices: ['A rock', 'A kite'], answer: 1 },
    ],
  };
  const choice = (text: string): HTMLButtonElement =>
    Array.from(host.querySelectorAll<HTMLButtonElement>('.tq-btn--choice')).find((b) => b.textContent?.includes(text))!;

  it('says ui-tap then answer-wrong for a wrong choice, and ui-tap then answer-right for the right one', async () => {
    const result = quizActivity.run(host, PARAMS, makeCtx());
    expect(types()).toEqual([]); // opening a question says nothing
    choice('Hop').click();
    expect(types()).toEqual(['ui-tap', 'answer-wrong']);
    clear();
    choice('Blue').click();
    expect(types()).toEqual(['ui-tap', 'answer-right']);
    buttonByText(host, 'Back').click();
    await result;
  });

  it('says nothing for a choice that has already been tried, or after the answer is found', async () => {
    const result = quizActivity.run(host, PARAMS, makeCtx());
    choice('Hop').click();
    clear();
    choice('Hop').click(); // tried already
    expect(types()).toEqual([]);
    choice('Blue').click();
    clear();
    choice('Soup').click(); // the question is solved
    expect(types()).toEqual([]);
    buttonByText(host, 'Back').click();
    await result;
  });

  it('says activity-complete with its type only when the quiz is finished, not when the Scout backs out', async () => {
    const out = quizActivity.run(host, PARAMS, makeCtx());
    buttonByText(host, 'Back').click();
    await out;
    expect(types()).not.toContain('activity-complete');

    const result = quizActivity.run(host, PARAMS, makeCtx());
    choice('Blue').click();
    buttonByText(host, 'Next').click();
    choice('A kite').click();
    expect(types()).not.toContain('activity-complete'); // not until Finish
    buttonByText(host, 'Finish').click();
    await result;
    expect(seen.filter((e) => e.type === 'activity-complete')).toEqual([{ type: 'activity-complete', activityType: 'quiz' }]);
    expect(types().at(-1)).toBe('activity-complete');
  });
});

describe('sequence events', () => {
  const PARAMS: SequenceParams = { prompt: 'Make a pretend sandwich.', steps: ['Get bread', 'Add cheese', 'Take a bite'] };
  const tile = (text: string): HTMLButtonElement =>
    Array.from(host.querySelectorAll<HTMLButtonElement>('.tq-tile')).find((b) => b.textContent === text)!;

  it('says ui-tap and answer-wrong for a wrong tile, ui-tap and answer-right for the next step, then activity-complete', async () => {
    const result = sequenceActivity.run(host, PARAMS, makeCtx());
    tile('Take a bite').click();
    expect(types()).toEqual(['ui-tap', 'answer-wrong']);
    clear();
    for (const step of PARAMS.steps) tile(step).click();
    expect(types()).toEqual(['ui-tap', 'answer-right', 'ui-tap', 'answer-right', 'ui-tap', 'answer-right']);
    clear();
    buttonByText(host, 'Next').click();
    await result;
    expect(seen).toEqual([{ type: 'activity-complete', activityType: 'sequence' }]);
  });
});

describe('sort events', () => {
  const PARAMS: SortParams = {
    prompt: 'Pack the pretend bag.',
    bins: [
      { id: 'pack', label: 'Pack it' },
      { id: 'leave', label: 'Leave it' },
    ],
    items: [
      { label: 'Pretend tent', bin: 'pack' },
      { label: 'Toy dragon', bin: 'leave' },
    ],
  };
  const chip = (label: string): HTMLButtonElement =>
    Array.from(host.querySelectorAll<HTMLButtonElement>('.tq-chip')).find((b) => b.textContent?.includes(label))!;
  const bin = (label: string): HTMLButtonElement =>
    Array.from(host.querySelectorAll<HTMLButtonElement>('.tq-bin__btn')).find((b) => b.firstChild?.textContent === label)!;

  it('says ui-tap when a chip is picked, then ui-tap with the answer when it goes in a bin', async () => {
    const result = sortActivity.run(host, PARAMS, makeCtx());
    chip('Pretend tent').click();
    expect(types()).toEqual(['ui-tap']);
    clear();
    bin('Leave it').click(); // wrong
    expect(types()).toEqual(['ui-tap', 'answer-wrong']);
    clear();
    bin('Pack it').click(); // right
    expect(types()).toEqual(['ui-tap', 'answer-right']);
    clear();
    chip('Toy dragon').click();
    bin('Leave it').click();
    expect(types()).toEqual(['ui-tap', 'ui-tap', 'answer-right']);
    clear();
    buttonByText(host, 'Finish').click();
    await result;
    expect(seen).toEqual([{ type: 'activity-complete', activityType: 'sort' }]);
  });

  it('says nothing for a bin tapped with no item picked', async () => {
    const result = sortActivity.run(host, PARAMS, makeCtx());
    bin('Pack it').click();
    expect(types()).toEqual([]);
    buttonByText(host, 'Back').click();
    await result;
  });
});

describe('craft events', () => {
  const PARAMS: CraftParams = {
    prompt: 'Pack a day bag.',
    result: 'day bag',
    ingredients: [
      { id: 'water', label: 'Water bottle' },
      { id: 'snack', label: 'Trail snack' },
    ],
    distractors: [{ id: 'sofa', label: 'Big sofa' }],
  };
  const chip = (label: string): HTMLButtonElement =>
    Array.from(host.querySelectorAll<HTMLButtonElement>('.tq-chip')).find((b) => b.textContent === label)!;

  it('says ui-tap and answer-wrong for something that does not belong, and answer-right for what does', async () => {
    const result = craftActivity.run(host, PARAMS, makeCtx());
    chip('Big sofa').click();
    expect(types()).toEqual(['ui-tap', 'answer-wrong']);
    clear();
    chip('Water bottle').click();
    chip('Trail snack').click();
    expect(types()).toEqual(['ui-tap', 'answer-right', 'ui-tap', 'answer-right']);
    clear();
    buttonByText(host, 'Finish').click();
    await result;
    expect(seen).toEqual([{ type: 'activity-complete', activityType: 'craft' }]);
  });
});

describe('rhythm events', () => {
  const PARAMS: RhythmParams = { prompt: 'Tap along.', exercise: 'test claps', reps: 2, bpm: 80 };
  const pad = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.tq-rhythm__pad')!;

  it('says ui-tap for the tap that starts it and for each rep, nothing while it waits out the count-in', async () => {
    vi.useFakeTimers();
    let clock = 5000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    vi.stubGlobal('requestAnimationFrame', undefined);
    vi.stubGlobal('cancelAnimationFrame', undefined);

    const result = rhythmActivity.run(host, PARAMS, makeCtx());
    pad().click(); // starts the count-in
    expect(types()).toEqual(['ui-tap']);
    clear();
    clock += 100;
    pad().click(); // far too early: the count-in is still going, so this is not a rep
    expect(types()).toEqual([]);
    clock = 5000 + 3 * 750;
    pad().click();
    clock += 750;
    pad().click();
    expect(types()).toEqual(['ui-tap', 'ui-tap']);
    expect(types()).not.toContain('activity-complete'); // not until Finish
    buttonByText(host, 'Finish').click();
    await result;
    expect(types().at(-1)).toBe('activity-complete');
    expect(seen.at(-1)).toEqual({ type: 'activity-complete', activityType: 'rhythm' });
  });
});

describe('collect events', () => {
  const PARAMS: CollectParams = {
    prompt: 'Find the pretend things.',
    zone: 'nature-trail',
    targets: [
      { id: 'alpha', label: 'Alpha', count: 1 },
      { id: 'beta', label: 'Beta', count: 2 },
    ],
  };

  it('says pickup for each thing found, and activity-complete when the Scout finishes', async () => {
    const world = createFakeWorldHost();
    const result = collectActivity.run(host, PARAMS, makeCtx({ world }));
    expect(types()).toEqual([]);
    world.walkToNext();
    expect(types()).toEqual(['pickup']);
    world.walkToNext();
    world.walkToNext();
    expect(types()).toEqual(['pickup', 'pickup', 'pickup']);
    expect(types()).not.toContain('activity-complete');
    buttonByText(host, 'Finish').click();
    await result;
    expect(types()).toEqual(['pickup', 'pickup', 'pickup', 'activity-complete']);
    expect(seen.at(-1)).toEqual({ type: 'activity-complete', activityType: 'collect' });
  });

  it('does not say activity-complete when the Scout leaves early', async () => {
    const world = createFakeWorldHost();
    const result = collectActivity.run(host, PARAMS, makeCtx({ world }));
    world.walkToNext();
    buttonByText(host, 'Back').click();
    await result;
    expect(types()).toEqual(['pickup']);
  });
});

describe('navigate events', () => {
  const PARAMS: NavigateParams = {
    prompt: 'Walk to the pretend places.',
    zone: 'nature-trail',
    waypoints: [
      { id: 'alpha', label: 'Alpha place' },
      { id: 'beta', label: 'Beta place' },
    ],
  };

  it('says waypoint at each place reached (the last one too), and activity-complete on Finish', async () => {
    const world = createFakeWorldHost({
      landmarks: { alpha: { x: -8, y: 0, z: 2 }, beta: { x: 4, y: 0, z: -9 } },
    });
    const result = navigateActivity.run(host, PARAMS, makeCtx({ world }));
    expect(types()).toEqual([]);
    world.walkToNext();
    expect(types()).toEqual(['waypoint']);
    world.walkToNext();
    expect(types()).toEqual(['waypoint', 'waypoint']);
    buttonByText(host, 'Finish').click();
    await result;
    expect(types()).toEqual(['waypoint', 'waypoint', 'activity-complete']);
    expect(seen.at(-1)).toEqual({ type: 'activity-complete', activityType: 'navigate' });
  });
});

describe('field mission events', () => {
  const PARAMS: FieldMissionParams = {
    title: 'Pretend picnic',
    kidSteps: ['Pick a spot.', 'Draw it.'],
    evidence: 'none',
  };

  it('says activity-complete when the Scout says "I did it!"', async () => {
    const result = fieldMissionActivity.run(host, PARAMS, makeCtx({ stage: 'check-in' }));
    buttonByText(host, 'I did it!').click();
    await result;
    expect(seen).toEqual([{ type: 'activity-complete', activityType: 'fieldMission' }]);
  });

  it('says nothing for "Not yet", or for a handout that only shows the card', async () => {
    const notYet = fieldMissionActivity.run(host, PARAMS, makeCtx({ stage: 'check-in' }));
    buttonByText(host, 'Not yet').click();
    await notYet;
    const handout = fieldMissionActivity.run(host, PARAMS, makeCtx({ stage: 'handout' }));
    buttonByText(host, 'Got it!').click();
    await handout;
    expect(types()).toEqual([]);
  });
});
