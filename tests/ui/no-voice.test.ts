// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { comingSoonActivity } from '../../src/activities/comingSoon';
import { craftActivity } from '../../src/activities/craft';
import { SAMPLE_CRAFT } from '../../src/activities/craft/sample';
import { fieldMissionActivity } from '../../src/activities/fieldMission';
import { quizActivity } from '../../src/activities/quiz';
import { rhythmActivity } from '../../src/activities/rhythm';
import { SAMPLE_RHYTHM } from '../../src/activities/rhythm/sample';
import { sequenceActivity } from '../../src/activities/sequence';
import { sortActivity } from '../../src/activities/sort';
import { SAMPLE_SORT } from '../../src/activities/sort/sample';
import type { ActivityContext, ActivityResult } from '../../src/activities/types';
import { showResultBanner } from '../../src/ui/feedback';
import { askPin } from '../../src/ui/pinpad';
import { buttonByText, makeCtx, makeHost } from './helpers';

/** The game has no voice. These checks run every activity and kit piece and look for any sign of one. */

let host: HTMLElement;
let synth: { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; getVoices: ReturnType<typeof vi.fn> };

beforeEach(() => {
  host = makeHost();
  synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: vi.fn(() => []) };
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', function Utterance() {});
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const noVoiceUi = (): void => {
  const buttons = Array.from(host.querySelectorAll('button')).map((b) => `${b.textContent ?? ''} ${b.getAttribute('aria-label') ?? ''}`);
  for (const label of buttons) expect(label).not.toMatch(/\bread\b|aloud|speak|listen/i);
  expect(host.textContent).not.toContain('\u{1F50A}');
  expect(host.querySelector('.tq-btn--read')).toBeNull();
};

const cases: { name: string; start: (ctx: ActivityContext) => Promise<ActivityResult> }[] = [
  {
    name: 'quiz',
    start: (ctx) =>
      quizActivity.run(host, { questions: [{ prompt: 'Which can fly?', choices: ['A rock', 'A kite'], answer: 1 }] }, ctx),
  },
  { name: 'sequence', start: (ctx) => sequenceActivity.run(host, { prompt: 'Put it in order.', steps: ['One', 'Two', 'Three'] }, ctx) },
  { name: 'sort', start: (ctx) => sortActivity.run(host, SAMPLE_SORT, ctx) },
  { name: 'craft', start: (ctx) => craftActivity.run(host, SAMPLE_CRAFT, ctx) },
  { name: 'rhythm', start: (ctx) => rhythmActivity.run(host, SAMPLE_RHYTHM, ctx) },
  {
    name: 'fieldMission handout',
    start: (ctx) =>
      fieldMissionActivity.run(host, { title: 'Sample mission', kidSteps: ['Do a pretend thing.'], parentNote: 'Sample.' }, { ...ctx, stage: 'handout' }),
  },
  {
    name: 'fieldMission check-in',
    start: (ctx) =>
      fieldMissionActivity.run(host, { title: 'Sample mission', kidSteps: ['Do a pretend thing.'], parentNote: 'Sample.' }, { ...ctx, stage: 'check-in' }),
  },
  { name: 'coming soon', start: (ctx) => comingSoonActivity('collect').run(host, { prompt: 'x', zone: 'nature-trail', targets: [] }, ctx) },
];

describe('no voice, ever', () => {
  for (const { name, start } of cases) {
    it(`${name}: no Read button, no speaker icon, no call to ctx.speak or speechSynthesis`, async () => {
      const ctx = makeCtx();
      const result = start(ctx);
      noVoiceUi();
      // Every activity has a way out; back out so the promise settles.
      const out = Array.from(host.querySelectorAll('button')).find((b) => /^(.*)(back|got it|next|not yet)/i.test(b.textContent ?? ''));
      expect(out).toBeDefined();
      out!.click();
      await result;
      expect(ctx.speak).not.toHaveBeenCalled();
      expect(synth.speak).not.toHaveBeenCalled();
      expect(synth.cancel).not.toHaveBeenCalled();
    });
  }

  it('result banners are plain words and an icon', () => {
    showResultBanner(host, 'yes', 'Nice work.');
    showResultBanner(host, 'notyet', 'Try again.');
    noVoiceUi();
    expect(host.querySelector('button')).toBeNull();
  });

  it('the PIN pad has no Read button', async () => {
    const result = askPin(host, { title: 'Grown-up PIN', verify: async () => true });
    noVoiceUi();
    buttonByText(host, 'Cancel').click();
    await result;
  });
});
