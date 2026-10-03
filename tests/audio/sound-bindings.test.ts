// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Ambience } from '../../src/audio/ambience';
import { createAudioEngine, type AudioEngine } from '../../src/audio/engine';
import { SFX_NAMES, type Sfx, type SfxName } from '../../src/audio/sfx';
import { createEventBus, type EventBus, type GameEvent } from '../../src/game/events';
import { SFX_FOR_EVENT, applySoundSetting, initSound, type SoundHandle } from '../../src/game/sound-bindings';
import { gesture, lastContext, resetStubs, stubContext } from './stub-audio';

type SfxSpies = Record<SfxName, Mock<() => void>>;

interface Rig {
  bus: EventBus;
  sfx: SfxSpies;
  ambience: { [K in keyof Ambience]: Mock };
  engine: AudioEngine & { setEnabled: Mock };
  state: { enabled: boolean };
  onToggle: Mock<(enabled: boolean) => void>;
  handle: SoundHandle;
}

let rig: Rig;

function makeRig(enabled = true): Rig {
  const state = { enabled };
  const bus = createEventBus();
  const sfx = Object.fromEntries(SFX_NAMES.map((name) => [name, vi.fn()])) as SfxSpies;
  const ambience = {
    start: vi.fn(),
    stop: vi.fn(),
    setZone: vi.fn(),
    zone: vi.fn(),
    mix: vi.fn(),
    dispose: vi.fn(),
  };
  let engineOn = true;
  const engine = {
    graph: () => null,
    isEnabled: () => engineOn,
    setEnabled: vi.fn((on: boolean) => {
      engineOn = on;
    }),
    onChange: () => () => {},
    dispose: vi.fn(),
  };
  const onToggle = vi.fn((on: boolean) => {
    state.enabled = on;
  });
  const handle = initSound({
    isEnabled: () => state.enabled,
    onToggle,
    currentZone: () => 'campfire-circle',
    bus,
    engine,
    sfx: sfx as unknown as Sfx,
    ambience: ambience as unknown as Ambience,
  });
  return { bus, sfx, ambience, engine, state, onToggle, handle };
}

function played(): SfxName[] {
  return SFX_NAMES.filter((name) => rig.sfx[name].mock.calls.length > 0);
}

beforeEach(() => {
  rig = makeRig();
});

afterEach(() => {
  rig.handle.dispose();
});

const EVENT_TO_EFFECT: [GameEvent, SfxName][] = [
  [{ type: 'ui-tap' }, 'tap'],
  [{ type: 'answer-right' }, 'right'],
  [{ type: 'answer-wrong' }, 'wrong'],
  [{ type: 'dialog-advance' }, 'advance'],
  [{ type: 'stop-complete', kind: 'warm-up', xp: 10 }, 'stopComplete'],
  [{ type: 'trail-complete', stops: 3 }, 'trailComplete'],
  [{ type: 'badge-earned', adventureId: 'a1' }, 'badge'],
  [{ type: 'cosmetic-unlocked', id: 'hat-1' }, 'unlock'],
  [{ type: 'title-earned', title: 'Trail Blazer' }, 'unlock'],
  [{ type: 'mission-approved', requirementId: 'r1' }, 'approved'],
  [{ type: 'pickup' }, 'pickup'],
  [{ type: 'waypoint' }, 'waypoint'],
  [{ type: 'travel', zone: 'nature-trail' }, 'travel'],
];

describe('sound bindings', () => {
  it.each(EVENT_TO_EFFECT)('maps %j to the right effect and no other', (event, name) => {
    rig.bus.emit(event);
    expect(played()).toEqual([name]);
    expect(rig.sfx[name]).toHaveBeenCalledTimes(1);
  });

  it('covers every mapped event exactly', () => {
    expect(Object.keys(SFX_FOR_EVENT).sort()).toEqual([...new Set(EVENT_TO_EFFECT.map(([e]) => e.type))].sort());
  });

  it('makes no sound for events that are not sounds', () => {
    for (const event of [
      { type: 'dialog-open' },
      { type: 'activity-complete', activityType: 'quiz' },
      { type: 'session-start' },
      { type: 'session-end' },
    ] as const) {
      rig.bus.emit(event);
    }
    expect(played()).toEqual([]);
    expect(rig.ambience.start).not.toHaveBeenCalled();
    expect(rig.ambience.stop).not.toHaveBeenCalled();
  });

  it('plays nothing while the Scout has sound off, and keeps the engine muted', () => {
    rig.state.enabled = false;
    for (const [event] of EVENT_TO_EFFECT) rig.bus.emit(event);
    expect(played()).toEqual([]);
    expect(rig.engine.setEnabled).toHaveBeenLastCalledWith(false);
  });

  it('plays again as soon as the setting says so', () => {
    rig.state.enabled = false;
    rig.bus.emit({ type: 'ui-tap' });
    rig.state.enabled = true;
    rig.bus.emit({ type: 'ui-tap' });
    expect(rig.sfx.tap).toHaveBeenCalledTimes(1);
    expect(rig.engine.setEnabled).toHaveBeenLastCalledWith(true);
  });

  it('moves the ambience on travel, and remembers the zone even when muted', () => {
    rig.bus.emit({ type: 'travel', zone: 'town-square' });
    expect(rig.ambience.setZone).toHaveBeenLastCalledWith('town-square');
    rig.state.enabled = false;
    rig.bus.emit({ type: 'travel', zone: 'safety-station' });
    expect(rig.ambience.setZone).toHaveBeenLastCalledWith('safety-station');
    expect(rig.sfx.travel).toHaveBeenCalledTimes(1); // only the first, unmuted, whoosh
  });

  it('applies the active Scout setting and starts the ambience on profile-active', () => {
    rig.state.enabled = false;
    rig.bus.emit({ type: 'profile-active', profileId: 'p1' });
    expect(rig.engine.setEnabled).toHaveBeenLastCalledWith(false);
    expect(rig.ambience.setZone).toHaveBeenLastCalledWith('campfire-circle');
    expect(rig.ambience.start).toHaveBeenCalledTimes(1);
    expect(played()).toEqual([]);

    rig.state.enabled = true;
    rig.bus.emit({ type: 'profile-active', profileId: 'p2' });
    expect(rig.engine.setEnabled).toHaveBeenLastCalledWith(true);
    expect(rig.ambience.start).toHaveBeenCalledTimes(2);
  });

  it('toggle flips the setting, tells onToggle, and confirms with a tap when turning on', () => {
    expect(rig.handle.toggle()).toBe(false);
    expect(rig.onToggle).toHaveBeenLastCalledWith(false);
    expect(rig.engine.setEnabled).toHaveBeenLastCalledWith(false);
    expect(rig.sfx.tap).not.toHaveBeenCalled();

    expect(rig.handle.toggle()).toBe(true);
    expect(rig.onToggle).toHaveBeenLastCalledWith(true);
    expect(rig.engine.setEnabled).toHaveBeenLastCalledWith(true);
    expect(rig.sfx.tap).toHaveBeenCalledTimes(1);
  });

  it('setEnabled applies and reports the choice', () => {
    rig.handle.setEnabled(false);
    expect(rig.onToggle).toHaveBeenCalledWith(false);
    expect(rig.engine.setEnabled).toHaveBeenLastCalledWith(false);
  });

  it('stops listening and stops the ambience on dispose', () => {
    rig.handle.dispose();
    rig.bus.emit({ type: 'answer-right' });
    expect(played()).toEqual([]);
    expect(rig.ambience.stop).toHaveBeenCalledTimes(1);
  });
});

describe('applySoundSetting', () => {
  it('treats a missing setting, or no Scout yet, as on', () => {
    expect(applySoundSetting(undefined)).toBe(true);
    expect(applySoundSetting(null)).toBe(true);
    expect(applySoundSetting({})).toBe(true);
    expect(applySoundSetting({ sound: true })).toBe(true);
    expect(applySoundSetting({ sound: false })).toBe(false);
  });
});

describe('sound bindings with the real engine', () => {
  let engine: AudioEngine;
  let bus: EventBus;
  let handle: SoundHandle;
  let enabled: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    resetStubs();
    enabled = true;
    engine = createAudioEngine({ createContext: stubContext });
    bus = createEventBus();
    handle = initSound({
      isEnabled: () => enabled,
      onToggle: (on) => {
        enabled = on;
      },
      currentZone: () => 'base-camp',
      bus,
      engine,
    });
  });

  afterEach(() => {
    handle.dispose();
    engine.dispose();
    vi.useRealTimers();
  });

  it('is silent until a gesture, then plays', () => {
    bus.emit({ type: 'answer-right' });
    bus.emit({ type: 'profile-active', profileId: 'p1' });
    expect(() => lastContext()).toThrow(); // no context yet: nothing started on its own

    gesture();
    const ctx = lastContext();
    const before = ctx.oscillators.length;
    bus.emit({ type: 'answer-right' });
    expect(ctx.oscillators.length).toBeGreaterThan(before);
  });

  it('starts the ambience for the Scout once sound unlocks, and mutes everything from the button', () => {
    bus.emit({ type: 'profile-active', profileId: 'p1' });
    gesture();
    const ctx = lastContext();
    expect(ctx.sources).toHaveLength(1);

    handle.toggle();
    expect(enabled).toBe(false);
    expect(engine.isEnabled()).toBe(false);
    const nodes = ctx.nodeCount();
    bus.emit({ type: 'answer-right' });
    bus.emit({ type: 'travel', zone: 'nature-trail' });
    expect(ctx.nodeCount()).toBe(nodes);
    vi.advanceTimersByTime(300);
    expect(ctx.suspend).toHaveBeenCalled();

    handle.toggle();
    expect(engine.isEnabled()).toBe(true);
    bus.emit({ type: 'answer-right' });
    expect(ctx.nodeCount()).toBeGreaterThan(nodes);
  });
});
