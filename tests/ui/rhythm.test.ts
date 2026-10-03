// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rhythmActivity } from '../../src/activities/rhythm';
import {
  beatPhase,
  bpmToIntervalMs,
  countInNumber,
  judgeTap,
  nearestBeatIndex,
  nearestBeatOffset,
  normalizeBpm,
  onBeatWindowMs,
  pulseScale,
} from '../../src/activities/rhythm/beat';
import { SAMPLE_RHYTHM } from '../../src/activities/rhythm/sample';
import type { RhythmParams } from '../../src/activities/types';
import { buttonByText, makeCtx, makeHost, maybeButton, press } from './helpers';

// ---------- Beat math: plain numbers, no clock, no timers ----------

describe('beat math', () => {
  it('converts bpm to a beat interval and falls back to 80 bpm', () => {
    expect(bpmToIntervalMs(60)).toBe(1000);
    expect(bpmToIntervalMs(80)).toBe(750);
    expect(bpmToIntervalMs(120)).toBe(500);
    expect(bpmToIntervalMs(0)).toBe(750);
    expect(bpmToIntervalMs(Number.NaN)).toBe(750);
    expect(normalizeBpm(undefined)).toBe(80);
    expect(normalizeBpm(-5)).toBe(80);
    expect(normalizeBpm(100)).toBe(100);
    expect(normalizeBpm(500)).toBe(180);
    expect(normalizeBpm(5)).toBe(40);
  });

  it('finds the signed offset to the nearest beat', () => {
    const start = 1000; // 80 bpm: beats at 1000, 1750, 2500, ...
    expect(nearestBeatOffset(1000, start, 80)).toBe(0);
    expect(nearestBeatOffset(1100, start, 80)).toBe(100); // late
    expect(nearestBeatOffset(1650, start, 80)).toBe(-100); // early for the beat at 1750
    expect(nearestBeatOffset(2530, start, 80)).toBe(30);
    expect(nearestBeatIndex(1650, start, 80)).toBe(1);
    expect(nearestBeatIndex(2530, start, 80)).toBe(2);
  });

  it('gives taps before the first beat to beat 0', () => {
    expect(nearestBeatIndex(900, 1000, 80)).toBe(0);
    expect(nearestBeatOffset(900, 1000, 80)).toBe(-100);
    expect(nearestBeatOffset(-1000, 1000, 80)).toBe(-2000);
  });

  it('counts a tap within 180 ms of a beat as on beat, either side', () => {
    const start = 0;
    expect(judgeTap(0, start, 80)).toMatchObject({ onBeat: true, timing: 'exact', beatIndex: 0 });
    expect(judgeTap(180, start, 80)).toMatchObject({ onBeat: true, timing: 'late' });
    expect(judgeTap(181, start, 80)).toMatchObject({ onBeat: false, timing: 'late' });
    expect(judgeTap(750 - 180, start, 80)).toMatchObject({ onBeat: true, timing: 'early', beatIndex: 1 });
    expect(judgeTap(750 - 181, start, 80)).toMatchObject({ onBeat: false, timing: 'early', beatIndex: 1 });
    expect(judgeTap(375 + 1, start, 80).onBeat).toBe(false); // right between two beats
    expect(judgeTap(2 * 750 + 100, start, 80)).toMatchObject({ onBeat: true, offsetMs: 100, beatIndex: 2 });
  });

  it('keeps the window at 180 ms up to 133 bpm and shrinks it for faster beats', () => {
    expect(onBeatWindowMs(80)).toBe(180);
    expect(onBeatWindowMs(120)).toBe(180);
    expect(onBeatWindowMs(180)).toBeCloseTo(150);
    expect(judgeTap(160, 0, 180).onBeat).toBe(false); // would be "on beat" at 180 ms, but a beat is only 333 ms
  });

  it('reports the phase inside a beat, the count-in number and the pulse size', () => {
    const start = 10000;
    expect(beatPhase(start, start, 80)).toBe(0);
    expect(beatPhase(start + 375, start, 80)).toBeCloseTo(0.5);
    expect(beatPhase(start + 750, start, 80)).toBeCloseTo(0);
    expect(beatPhase(start - 375, start, 80)).toBeCloseTo(0.5); // the count-in uses the same grid
    expect(countInNumber(start - 2250, start, 80)).toBe(3);
    expect(countInNumber(start - 1500, start, 80)).toBe(2);
    expect(countInNumber(start - 750, start, 80)).toBe(1);
    expect(countInNumber(start - 1, start, 80)).toBe(1);
    expect(pulseScale(0)).toBeCloseTo(1.2);
    expect(pulseScale(0.4)).toBe(1);
    expect(pulseScale(0.9)).toBe(1);
  });
});

// ---------- The activity ----------

const PARAMS: RhythmParams = {
  prompt: 'Bounce with Zip. Tap on each beat!',
  exercise: 'Zip bounces',
  reps: 5,
  bpm: 80,
};
const BEAT = 750; // 80 bpm
const COUNT_IN = 3 * BEAT;

let host: HTMLElement;
let clock = 0;
let frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;

/** A clock and animation-frame queue the test drives by hand. */
function installClock(withRaf = true): void {
  vi.useFakeTimers();
  clock = 5000;
  frames = new Map();
  nextFrameId = 1;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  if (withRaf) {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
      const id = nextFrameId++;
      frames.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
      frames.delete(id);
    });
  } else {
    vi.stubGlobal('requestAnimationFrame', undefined);
    vi.stubGlobal('cancelAnimationFrame', undefined);
  }
}

function runFrames(): void {
  const pending = Array.from(frames.values());
  frames.clear();
  for (const cb of pending) cb(clock);
}

/** Moves the clock and lets one animation frame draw. */
function setTime(t: number): void {
  clock = t;
  runFrames();
}

const pad = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.tq-rhythm__pad')!;
const card = (): HTMLElement => host.querySelector<HTMLElement>('.tq-rhythm')!;
const center = (): string => host.querySelector('.tq-rhythm__center')?.textContent ?? '';
const ring = (): HTMLElement => host.querySelector<HTMLElement>('.tq-rhythm__ring')!;
const counter = (): string => host.querySelector('.tq-rhythm__count-num')?.textContent ?? '';
const feedback = (): string => host.querySelector('.tq-rhythm__feedback')?.textContent ?? '';

/** Mounts the activity and makes the first tap at the current clock. `beat0` is when beat 0 lands. */
function start(params: RhythmParams = PARAMS, interval = BEAT) {
  const ctx = makeCtx();
  const result = rhythmActivity.run(host, params, ctx);
  const t0 = clock;
  pad().click();
  return { ctx, result, t0, beat0: t0 + 3 * interval };
}

function tapAt(t: number): void {
  setTime(t);
  pad().click();
}

beforeEach(() => {
  host = makeHost();
  installClock();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('rhythmActivity: start state', () => {
  it('shows the prompt, the exercise name and a counter, and stays silent', async () => {
    const ctx = makeCtx();
    const result = rhythmActivity.run(host, PARAMS, ctx);
    expect(host.textContent).toContain(PARAMS.prompt);
    expect(host.textContent).toContain('Zip bounces');
    expect(counter()).toBe('0 of 5');
    expect(host.textContent).toContain('Ready? Tap to start');
    expect(card().dataset.phase).toBe('ready');
    expect(ctx.speak).not.toHaveBeenCalled();
    expect(frames.size).toBe(0); // nothing animates until the first tap
    buttonByText(host, 'Back').click();
    await result;
  });

  it('has one huge tap pad that is a real button and at least 120px tall', async () => {
    const result = rhythmActivity.run(host, PARAMS, makeCtx());
    expect(host.querySelectorAll('.tq-rhythm__pad')).toHaveLength(1);
    expect(pad().tagName).toBe('BUTTON');
    expect(Number.parseInt(pad().style.minHeight, 10)).toBeGreaterThanOrEqual(120);
    buttonByText(host, 'Back').click();
    await result;
  });

  it('resolves immediately when reps is not a positive number', async () => {
    await expect(rhythmActivity.run(host, { ...PARAMS, reps: 0 }, makeCtx())).resolves.toEqual({
      completed: false,
      attempts: 0,
    });
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });
});

describe('rhythmActivity: count-in', () => {
  it('starts a 3-2-1 count-in on the first tap, and that tap is not a rep', async () => {
    const { t0, beat0, result } = start();
    expect(card().dataset.phase).toBe('countin');
    expect(host.textContent).toContain('Get ready...');
    expect(counter()).toBe('0 of 5');
    expect(center()).toBe('3');
    setTime(t0 + BEAT);
    expect(center()).toBe('2');
    setTime(t0 + 2 * BEAT);
    expect(center()).toBe('1');
    setTime(beat0 - 1);
    expect(card().dataset.phase).toBe('countin');
    setTime(beat0);
    expect(card().dataset.phase).toBe('playing');
    expect(host.textContent).toContain('Tap!');
    expect(counter()).toBe('0 of 5');
    buttonByText(host, 'Back').click();
    await result;
  });

  it('ignores taps while the count-in is still going, so the kid can just wait for Go', async () => {
    const { t0, result } = start();
    tapAt(t0 + 900);
    tapAt(t0 + 1500);
    expect(counter()).toBe('0 of 5');
    expect(feedback()).toBe('');
    buttonByText(host, 'Back').click();
    await expect(result).resolves.toEqual({ completed: false, attempts: 0 });
  });

  it('counts a tap just before beat 0 as an early first tap', async () => {
    const { beat0, result } = start();
    tapAt(beat0 - 100);
    expect(counter()).toBe('1 of 5');
    expect(feedback()).toContain('On beat!');
    buttonByText(host, 'Back').click();
    await result;
  });

  it('starts the beat 3 intervals after the first tap at the default 80 bpm', async () => {
    const { bpm: _unused, ...noBpm } = PARAMS;
    const { t0, result } = start(noBpm);
    setTime(t0 + COUNT_IN - 1);
    expect(card().dataset.phase).toBe('countin');
    setTime(t0 + COUNT_IN);
    expect(card().dataset.phase).toBe('playing');
    tapAt(t0 + COUNT_IN + BEAT);
    expect(feedback()).toContain('On beat!');
    buttonByText(host, 'Back').click();
    await result;
  });

  it('uses the bpm from the params', async () => {
    const { beat0, result } = start({ ...PARAMS, bpm: 120 }, 500);
    tapAt(beat0 + 500); // on the second beat at 120 bpm
    expect(feedback()).toContain('On beat!');
    tapAt(beat0 + 500 + 250); // halfway between two beats
    expect(feedback()).toContain('Close!');
    buttonByText(host, 'Back').click();
    await result;
  });
});

describe('rhythmActivity: tapping', () => {
  it('advances the counter on every tap, on the beat or not', async () => {
    const { beat0, result } = start();
    tapAt(beat0);
    expect(counter()).toBe('1 of 5');
    tapAt(beat0 + 375); // between beats
    expect(counter()).toBe('2 of 5');
    tapAt(beat0 + 2 * BEAT);
    expect(counter()).toBe('3 of 5');
    buttonByText(host, 'Back').click();
    await result;
  });

  it('says "On beat!" with a check mark for a tap on the beat', async () => {
    const { beat0, result } = start();
    tapAt(beat0 + BEAT + 100);
    expect(feedback()).toContain('On beat!');
    expect(host.querySelector('.tq-rhythm__result.tq-banner--yes')).not.toBeNull();
    expect(host.querySelector('.tq-rhythm__result .tq-banner__icon')?.textContent).toBe('✔');
    buttonByText(host, 'Back').click();
    await result;
  });

  it('says "Close!" for a tap outside the window, with an icon and a word, and still counts it', async () => {
    const { beat0, result } = start();
    tapAt(beat0 + BEAT + 300); // 300 ms late
    expect(feedback()).toContain('Close!');
    expect(feedback()).toContain('A little late.');
    expect(host.querySelector('.tq-rhythm__result--close .tq-banner__icon')?.textContent).toBeTruthy();
    expect(counter()).toBe('1 of 5');
    tapAt(beat0 + 2 * BEAT - 300); // 300 ms early
    expect(feedback()).toContain('Close!');
    expect(feedback()).toContain('A little early.');
    expect(counter()).toBe('2 of 5');
    buttonByText(host, 'Back').click();
    await result;
  });

  it('never shows the word "miss" or any fail wording, even when every tap is off the beat', async () => {
    const { beat0, result } = start();
    const bad = /\b(miss|missed|fail|failed|wrong|lose|lost)\b/i;
    for (let i = 0; i < 4; i += 1) {
      tapAt(beat0 + i * BEAT + 375);
      expect(bad.test(host.textContent ?? '')).toBe(false);
    }
    expect(counter()).toBe('4 of 5');
    buttonByText(host, 'Back').click();
    await result;
  });

  it('counts a real pointer tap once, not again for its follow-up click', async () => {
    const result = rhythmActivity.run(host, PARAMS, makeCtx());
    pad().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    pad().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); // start: pointerdown only
    expect(card().dataset.phase).toBe('countin');
    const beat0 = clock + COUNT_IN;
    setTime(beat0);
    pad().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    pad().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(counter()).toBe('1 of 5');
    buttonByText(host, 'Back').click();
    await result;
  });

  it('taps with Space and Enter', async () => {
    const result = rhythmActivity.run(host, PARAMS, makeCtx());
    const t0 = clock;
    press(document, ' '); // starts the count-in
    expect(card().dataset.phase).toBe('countin');
    setTime(t0 + COUNT_IN);
    press(document, 'Enter');
    expect(counter()).toBe('1 of 5');
    setTime(t0 + COUNT_IN + BEAT);
    press(document, ' ');
    expect(counter()).toBe('2 of 5');
    expect(feedback()).toContain('On beat!');
    buttonByText(host, 'Back').click();
    await result;
  });
});

describe('rhythmActivity: finishing', () => {
  it('completes after reps taps with score = on-beat taps over reps', async () => {
    const { beat0, result } = start();
    tapAt(beat0); // on
    tapAt(beat0 + BEAT + 375); // off
    tapAt(beat0 + 2 * BEAT + 50); // on
    tapAt(beat0 + 3 * BEAT - 120); // on
    expect(maybeButton(host, 'Finish')).toBeNull(); // 4 of 5: not done yet
    tapAt(beat0 + 4 * BEAT + 375); // off, the last rep
    expect(counter()).toBe('5 of 5');
    expect(host.textContent).toContain('Great job!');
    expect(host.textContent).toContain('3 of 5 taps were on the beat.');
    buttonByText(host, 'Finish').click();
    const outcome = await result;
    expect(outcome).toEqual({ completed: true, attempts: 5, score: 0.6 });
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('scores 1 for a perfect run of the sample', async () => {
    const { beat0, result } = start(SAMPLE_RHYTHM);
    for (let i = 0; i < SAMPLE_RHYTHM.reps; i += 1) tapAt(beat0 + i * BEAT);
    buttonByText(host, 'Finish').click();
    await expect(result).resolves.toEqual({ completed: true, attempts: 8, score: 1 });
  });

  it('still completes with a friendly cheer when no tap lands on the beat', async () => {
    const { beat0, result } = start();
    for (let i = 0; i < 5; i += 1) tapAt(beat0 + i * BEAT + 375);
    expect(host.textContent).toContain('Great job!');
    expect(host.textContent).toContain('You kept going to the very end!');
    expect(host.textContent).not.toMatch(/\b(miss|fail)/i);
    buttonByText(host, 'Finish').click();
    await expect(result).resolves.toEqual({ completed: true, attempts: 5, score: 0 });
  });

  it('shows the cheer, reminds the kid it is practice, and drops Back so the result is not lost', async () => {
    const { beat0, result, ctx } = start();
    for (let i = 0; i < 5; i += 1) tapAt(beat0 + i * BEAT);
    expect(host.textContent).toContain('Great job!');
    expect(ctx.speak).not.toHaveBeenCalled();
    expect(host.textContent).toContain('This is just practice.');
    expect(maybeButton(host, 'Back')).toBeNull();
    expect(host.querySelector('.tq-rhythm__pad')).toBeNull();
    press(document, 'Enter'); // Finish is the default button
    await expect(result).resolves.toMatchObject({ completed: true, attempts: 5, score: 1 });
  });

  it('lets the player back out with completed false and the taps so far', async () => {
    const { beat0, result } = start();
    tapAt(beat0);
    tapAt(beat0 + BEAT);
    buttonByText(host, 'Back').click();
    await expect(result).resolves.toEqual({ completed: false, attempts: 2 });
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('lets the player back out before starting', async () => {
    const result = rhythmActivity.run(host, PARAMS, makeCtx());
    buttonByText(host, 'Back').click();
    await expect(result).resolves.toEqual({ completed: false, attempts: 0 });
  });
});

describe('rhythmActivity: the pulse', () => {
  it('pulses the ring on the beat and settles between beats', async () => {
    const { beat0, result } = start();
    setTime(beat0);
    expect(ring().style.transform).toBe('scale(1.200)');
    expect(ring().classList.contains('is-beat')).toBe(true);
    setTime(beat0 + 500);
    expect(ring().style.transform).toBe('scale(1.000)');
    expect(ring().classList.contains('is-beat')).toBe(false);
    setTime(beat0 + BEAT);
    expect(ring().style.transform).toBe('scale(1.200)');
    buttonByText(host, 'Back').click();
    await result;
  });

  it('under reduced motion shows "tap... tap..." instead of a pulse, and it still updates', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query }));
    const { beat0, result } = start();
    setTime(beat0);
    expect(center()).toBe('tap');
    expect(ring().style.transform).toBe('');
    expect(ring().classList.contains('is-beat')).toBe(false);
    setTime(beat0 + 500);
    expect(center()).toBe('...');
    setTime(beat0 + BEAT);
    expect(center()).toBe('tap');
    setTime(beat0 + BEAT + 500);
    expect(center()).toBe('...');
    expect(ring().style.transform).toBe('');
    buttonByText(host, 'Back').click();
    await result;
  });
});

describe('rhythmActivity: cleanup', () => {
  it('runs a frame loop while going and cancels it when the player backs out', async () => {
    const { beat0, result } = start();
    setTime(beat0);
    expect(frames.size).toBe(1);
    buttonByText(host, 'Back').click();
    await result;
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops the frame loop once the last rep is in', async () => {
    const { beat0, result } = start();
    for (let i = 0; i < 5; i += 1) tapAt(beat0 + i * BEAT);
    expect(frames.size).toBe(0);
    buttonByText(host, 'Finish').click();
    await result;
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('falls back to setInterval without requestAnimationFrame, and clears it at the end', async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    installClock(false);
    const { t0, beat0, result } = start();
    expect(vi.getTimerCount()).toBe(1);
    expect(center()).toBe('3');
    clock = t0 + BEAT;
    vi.advanceTimersByTime(40);
    expect(center()).toBe('2');
    clock = beat0;
    vi.advanceTimersByTime(40);
    expect(card().dataset.phase).toBe('playing');
    expect(ring().style.transform).toMatch(/^scale\(1\.2/);
    buttonByText(host, 'Back').click();
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not leave a frame loop behind if the host is cleared underneath it', async () => {
    const { beat0, result } = start();
    tapAt(beat0);
    host.replaceChildren();
    runFrames();
    await expect(result).resolves.toEqual({ completed: false, attempts: 1 });
    expect(frames.size).toBe(0);
  });
});

describe('SAMPLE_RHYTHM', () => {
  it('is valid rhythm params with invented content', () => {
    expect(SAMPLE_RHYTHM.reps).toBeGreaterThanOrEqual(5);
    expect(SAMPLE_RHYTHM.reps).toBeLessThanOrEqual(20);
    expect(SAMPLE_RHYTHM.bpm).toBe(80);
    expect(SAMPLE_RHYTHM.prompt.length).toBeGreaterThan(0);
    expect(SAMPLE_RHYTHM.exercise).toBe('Zip bounces');
  });
});
