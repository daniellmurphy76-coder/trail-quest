// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZoneId } from '../../src/activities/types';
import { ZONE_AMBIENCE, createAmbience, type Ambience } from '../../src/audio/ambience';
import { createAudioEngine, type AudioEngine } from '../../src/audio/engine';
import { AMBIENCE_LEVEL, dbToGain } from '../../src/audio/synth';
import { StubAudioContext, gesture, lastContext, resetStubs, stubContext } from './stub-audio';

let engine: AudioEngine;
let ambience: Ambience;

beforeEach(() => {
  vi.useFakeTimers();
  resetStubs();
  engine = createAudioEngine({ createContext: stubContext });
  ambience = createAmbience(engine, { random: () => 0.5 });
});

afterEach(() => {
  ambience.dispose();
  engine.dispose();
  vi.useRealTimers();
});

/** Every scheduled envelope ramp so far: a measure of "random events that happened". */
function eventCount(ctx: StubAudioContext): number {
  return ctx.gains.reduce((n, g) => n + g.gain.calls.filter((c) => c.fn === 'exponentialRampToValueAtTime').length, 0);
}

describe('zone ambience', () => {
  it('gives each zone its sound: crackle at the fires, birds outdoors, a hum in town', () => {
    const zones: ZoneId[] = ['base-camp', 'fitness-field', 'nature-trail', 'town-square', 'safety-station', 'campfire-circle'];
    expect(Object.keys(ZONE_AMBIENCE).sort()).toEqual([...zones].sort());
    expect(ZONE_AMBIENCE['base-camp']).toMatchObject({ crackle: true, birds: true, hum: false });
    expect(ZONE_AMBIENCE['campfire-circle']).toMatchObject({ crackle: true, hum: false });
    expect(ZONE_AMBIENCE['nature-trail']).toMatchObject({ crackle: false, birds: true, hum: false });
    expect(ZONE_AMBIENCE['fitness-field']).toMatchObject({ crackle: false, birds: true, hum: false });
    expect(ZONE_AMBIENCE['town-square']).toEqual({ crackle: false, birds: false, hum: true });
    expect(ZONE_AMBIENCE['safety-station']).toEqual({ crackle: false, birds: false, hum: true });
  });

  it('sits at about -24 dB', () => {
    expect(AMBIENCE_LEVEL).toBeCloseTo(dbToGain(-24), 6);
  });
});

describe('ambience', () => {
  it('waits for a gesture, then starts', () => {
    ambience.start();
    expect(StubAudioContext.instances).toHaveLength(0);

    gesture();
    const ctx = lastContext();
    expect(ctx.sources).toHaveLength(1); // the noise bed
    expect(ctx.sources[0]!.loop).toBe(true);
    expect(ctx.oscillators.length).toBeGreaterThan(0); // the hum's sines and swell
    expect(ctx.sources[0]!.startedAt).toHaveLength(1);
  });

  it('starts at the bus level of about -24 dB, fading in', () => {
    ambience.start();
    gesture();
    const ctx = lastContext();
    const targets = ctx.gains.flatMap((g) => g.gain.calls.filter((c) => c.fn === 'setTargetAtTime' && c.args[0]! > 0));
    expect(targets.some((c) => Math.abs(c.args[0]! - AMBIENCE_LEVEL) < 1e-9)).toBe(true);
  });

  it('remembers the zone while stopped or locked', () => {
    ambience.setZone('town-square');
    expect(ambience.zone()).toBe('town-square');
    expect(ambience.mix()).toEqual(ZONE_AMBIENCE['town-square']);
    expect(StubAudioContext.instances).toHaveLength(0);
  });

  it('plays crackle pops at Base Camp', () => {
    ambience.start();
    gesture();
    const ctx = lastContext();
    const before = eventCount(ctx);
    vi.advanceTimersByTime(3000);
    expect(eventCount(ctx)).toBeGreaterThan(before + 3);
  });

  it('plays occasional chirps on the Nature Trail, a few seconds apart', () => {
    ambience.setZone('nature-trail');
    ambience.start();
    gesture();
    const ctx = lastContext();
    const baseline = ctx.oscillators.length;
    vi.advanceTimersByTime(3600); // random 0.5 puts the first chirp at about 2.4 s
    const afterFirst = ctx.oscillators.length;
    expect(afterFirst).toBeGreaterThan(baseline);
    vi.advanceTimersByTime(2000); // the next is 4 to 10 s later: none yet
    expect(ctx.oscillators.length).toBe(afterFirst);
    vi.advanceTimersByTime(6000);
    expect(ctx.oscillators.length).toBeGreaterThan(afterFirst);
    // Birds are sine FM blips, never harsh.
    for (const osc of ctx.oscillators) expect(osc.type).toBe('sine');
  });

  it('crossfades to the hum on travel and stops the random events once the old layers fade', () => {
    ambience.start();
    gesture();
    const ctx = lastContext();
    vi.advanceTimersByTime(1000);

    ambience.setZone('town-square');
    expect(ambience.mix().hum).toBe(true);
    // The old layers fade out rather than cut off: their target gain goes to 0.
    const fades = ctx.gains.flatMap((g) => g.gain.calls.filter((c) => c.fn === 'setTargetAtTime' && c.args[0] === 0));
    expect(fades.length).toBeGreaterThanOrEqual(2);

    vi.advanceTimersByTime(4000); // past the fade
    const settled = eventCount(ctx);
    const oscillators = ctx.oscillators.length;
    vi.advanceTimersByTime(30000);
    expect(eventCount(ctx)).toBe(settled);
    expect(ctx.oscillators.length).toBe(oscillators);
  });

  it('brings the crackle back on returning to camp', () => {
    ambience.setZone('town-square');
    ambience.start();
    gesture();
    const ctx = lastContext();
    vi.advanceTimersByTime(5000);
    const quiet = eventCount(ctx);
    ambience.setZone('campfire-circle');
    vi.advanceTimersByTime(3000);
    expect(eventCount(ctx)).toBeGreaterThan(quiet);
  });

  it('stops cleanly: sources stopped, timers cleared, bus let go', () => {
    ambience.start();
    gesture();
    const ctx = lastContext();
    vi.advanceTimersByTime(2000);
    const sources = [...ctx.sources, ...ctx.oscillators.slice(0, 3)];

    ambience.stop();
    for (const source of sources) expect(source.stoppedAt.length).toBeGreaterThan(0);
    const events = eventCount(ctx);
    vi.advanceTimersByTime(20000);
    expect(eventCount(ctx)).toBe(events);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('can start again after a stop', () => {
    ambience.start();
    gesture();
    const ctx = lastContext();
    ambience.stop();
    vi.advanceTimersByTime(1000);
    const before = ctx.sources.length;
    ambience.start();
    expect(ctx.sources.length).toBe(before + 1);
  });

  it('goes quiet while muted and comes back when unmuted', () => {
    ambience.start();
    gesture();
    const ctx = lastContext();
    const first = ctx.sources[0]!;

    engine.setEnabled(false);
    expect(first.stoppedAt.length).toBeGreaterThan(0);
    const events = eventCount(ctx);
    vi.advanceTimersByTime(20000);
    expect(eventCount(ctx)).toBe(events);

    engine.setEnabled(true);
    expect(ctx.sources).toHaveLength(2); // a fresh noise bed
    vi.advanceTimersByTime(3000);
    expect(eventCount(ctx)).toBeGreaterThan(events);
  });

  it('does nothing when Web Audio is missing', () => {
    engine.dispose();
    engine = createAudioEngine({ createContext: () => null });
    ambience.dispose();
    ambience = createAmbience(engine);
    expect(() => {
      ambience.start();
      gesture();
      ambience.setZone('nature-trail');
      ambience.stop();
    }).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});
