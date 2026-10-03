// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAudioEngine, type AudioEngine } from '../../src/audio/engine';
import { SFX_NAMES, createSfx, type Sfx, type SfxName } from '../../src/audio/sfx';
import { SFX_PEAK, dbToGain, midiToHz } from '../../src/audio/synth';
import { StubAudioContext, gesture, lastContext, resetStubs, stubContext } from './stub-audio';

let engine: AudioEngine;
let sfx: Sfx;

beforeEach(() => {
  resetStubs();
  engine = createAudioEngine({ createContext: stubContext });
  sfx = createSfx(engine);
});

afterEach(() => {
  engine.dispose();
});

/** Gain nodes that carry a note or whoosh envelope (they ramp up to a peak). */
function envelopes(ctx: StubAudioContext) {
  return ctx.gains.filter((g) => g.gain.calls.some((c) => c.fn === 'exponentialRampToValueAtTime'));
}

function peakOf(env: ReturnType<typeof envelopes>[number]): number {
  return Math.max(...env.gain.calls.filter((c) => c.fn === 'exponentialRampToValueAtTime').map((c) => c.args[0]!));
}

describe('sound effects', () => {
  it('make no sound and touch no context before a gesture', () => {
    for (const name of SFX_NAMES) expect(() => sfx[name]()).not.toThrow();
    expect(StubAudioContext.instances).toHaveLength(0);
  });

  it('lists every effect the game asks for', () => {
    expect([...SFX_NAMES].sort()).toEqual(
      [
        'tap',
        'right',
        'wrong',
        'advance',
        'stopComplete',
        'trailComplete',
        'badge',
        'unlock',
        'pickup',
        'waypoint',
        'travel',
        'approved',
      ].sort(),
    );
  });

  it.each(SFX_NAMES.map((name) => [name] as const))('%s schedules nodes without throwing', (name) => {
    gesture();
    const ctx = lastContext();
    const before = ctx.nodeCount();
    expect(() => sfx[name]()).not.toThrow();
    expect(ctx.nodeCount()).toBeGreaterThan(before);
    // Everything that starts also stops, later.
    for (const source of [...ctx.oscillators, ...ctx.sources]) {
      expect(source.startedAt.length).toBe(1);
      expect(source.stoppedAt[0]!).toBeGreaterThan(source.startedAt[0]!);
    }
  });

  it('stay gentle: soft waveforms only, and peaks around -12 dB', () => {
    gesture();
    const ctx = lastContext();
    for (const name of SFX_NAMES) {
      ctx.currentTime += 5; // clear of the tap limiter
      sfx[name]();
    }
    for (const osc of ctx.oscillators) expect(['sine', 'triangle']).toContain(osc.type);
    const peaks = envelopes(ctx).map(peakOf);
    expect(peaks.length).toBeGreaterThan(20);
    for (const peak of peaks) expect(peak).toBeLessThanOrEqual(SFX_PEAK * 1.25);
    expect(SFX_PEAK).toBeCloseTo(dbToGain(-12), 6);
    // Every note goes through a low-pass.
    expect(ctx.filters.length).toBeGreaterThanOrEqual(ctx.oscillators.length / 2);
  });

  it('play the right number of notes', () => {
    gesture();
    const ctx = lastContext();
    const notes: Partial<Record<SfxName, number>> = {
      right: 2,
      wrong: 1,
      advance: 1,
      stopComplete: 3,
      approved: 2,
      unlock: 4,
      pickup: 1,
      waypoint: 1,
      tap: 1,
    };
    for (const [name, count] of Object.entries(notes) as [SfxName, number][]) {
      ctx.currentTime += 5;
      const before = envelopes(ctx).length;
      sfx[name]();
      expect(envelopes(ctx).length - before, name).toBe(count);
    }
    // The two fanfares are four or five notes.
    for (const name of ['trailComplete', 'badge'] as const) {
      ctx.currentTime += 5;
      const before = envelopes(ctx).length;
      sfx[name]();
      const count = envelopes(ctx).length - before;
      expect(count, name).toBeGreaterThanOrEqual(4);
      expect(count, name).toBeLessThanOrEqual(5);
    }
  });

  it('rises on a right answer and is one low note for a wrong one', () => {
    gesture();
    const ctx = lastContext();
    sfx.right();
    const [first, second] = ctx.oscillators.filter((_, i) => i % 2 === 0); // skip the bell overtones
    expect(second!.frequency.calls[0]!.args[0]!).toBeGreaterThan(first!.frequency.calls[0]!.args[0]!);

    ctx.currentTime += 5;
    const before = ctx.oscillators.length;
    sfx.wrong();
    expect(ctx.oscillators.length - before).toBe(1);
    expect(ctx.oscillators[before]!.frequency.calls[0]!.args[0]!).toBeLessThan(midiToHz(60)); // lower than middle C
  });

  it('travel is filtered noise, not an oscillator', () => {
    gesture();
    const ctx = lastContext();
    sfx.travel();
    expect(ctx.oscillators).toHaveLength(0);
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.filters.some((f) => f.type === 'bandpass')).toBe(true);
  });

  it('limits rapid taps so they do not stack', () => {
    gesture();
    const ctx = lastContext();
    sfx.tap();
    sfx.tap();
    sfx.tap();
    expect(ctx.oscillators).toHaveLength(1);
    ctx.currentTime += 0.2;
    sfx.tap();
    expect(ctx.oscillators).toHaveLength(2);
  });

  it('are silent while muted', () => {
    gesture();
    const ctx = lastContext();
    engine.setEnabled(false);
    const before = ctx.nodeCount();
    for (const name of SFX_NAMES) sfx[name]();
    expect(ctx.nodeCount()).toBe(before);
  });

  it('never let an audio error reach the game', () => {
    gesture();
    const ctx = lastContext();
    ctx.createOscillator = () => {
      throw new Error('boom');
    };
    expect(() => sfx.right()).not.toThrow();
  });
});
