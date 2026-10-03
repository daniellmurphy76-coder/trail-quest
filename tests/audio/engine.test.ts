// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioEngine, type AudioEngine } from '../../src/audio/engine';
import { StubAudioContext, gesture, lastContext, resetStubs, stubContext } from './stub-audio';

let engine: AudioEngine;

function makeEngine(): AudioEngine {
  engine = createAudioEngine({ createContext: stubContext });
  return engine;
}

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  resetStubs();
});

afterEach(() => {
  engine?.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'hidden');
});

describe('audio engine: unlock', () => {
  it('does nothing before a gesture: no context, no graph, no sound', () => {
    makeEngine();
    expect(StubAudioContext.instances).toHaveLength(0);
    expect(engine.graph()).toBeNull();
    engine.setEnabled(false);
    engine.setEnabled(true);
    expect(StubAudioContext.instances).toHaveLength(0);
    expect(engine.graph()).toBeNull();
  });

  it('makes and resumes the context on the first pointer-down, then has a graph', () => {
    makeEngine();
    gesture('pointerdown');
    expect(StubAudioContext.instances).toHaveLength(1);
    const ctx = lastContext();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    const graph = engine.graph();
    expect(graph).not.toBeNull();
    expect(graph!.ctx).toBe(ctx);
    // The master is wired to the speakers and ramps up from silence.
    expect(ctx.gains[0]!.connections).toContain(ctx.destination);
    expect(ctx.gains[0]!.gain.calls.some((c) => c.fn === 'linearRampToValueAtTime' && c.args[0] === 1)).toBe(true);
  });

  it('also unlocks on a key press, and on touch-end for iPad Safari', () => {
    makeEngine();
    gesture('keydown');
    expect(engine.graph()).not.toBeNull();
    engine.dispose();

    resetStubs();
    makeEngine();
    document.body.dispatchEvent(new Event('touchend', { bubbles: true }));
    expect(engine.graph()).not.toBeNull();
  });

  it('makes only one context however many gestures come', () => {
    makeEngine();
    gesture();
    gesture('keydown');
    gesture();
    expect(StubAudioContext.instances).toHaveLength(1);
    expect(lastContext().resume).toHaveBeenCalledTimes(1);
  });

  it('retries on the next gesture while the context stays suspended', async () => {
    const ctx = new StubAudioContext();
    ctx.resume.mockImplementationOnce(async () => {
      throw new Error('blocked until a real gesture');
    });
    engine = createAudioEngine({ createContext: () => ctx as unknown as AudioContext });

    gesture();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ctx.state).toBe('suspended');
    expect(engine.graph()).toBeNull();

    gesture();
    expect(ctx.resume).toHaveBeenCalledTimes(2);
    expect(ctx.state).toBe('running');
    expect(engine.graph()).not.toBeNull();
  });

  it('tells listeners when it unlocks, and stops when they unsubscribe', () => {
    makeEngine();
    const listener = vi.fn();
    const off = engine.onChange(listener);
    gesture();
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    off();
    engine.setEnabled(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('is a safe no-op when Web Audio does not exist', () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);
    engine = createAudioEngine();
    expect(() => {
      gesture();
      engine.setEnabled(false);
      engine.setEnabled(true);
    }).not.toThrow();
    expect(engine.graph()).toBeNull();

    engine.dispose();
    engine = createAudioEngine({ createContext: () => null });
    gesture();
    expect(engine.graph()).toBeNull();
  });

  it('stops listening after dispose', () => {
    makeEngine();
    engine.dispose();
    gesture();
    expect(StubAudioContext.instances).toHaveLength(0);
  });
});

describe('audio engine: mute', () => {
  it('ramps the master to silence, hands out no graph, then suspends; unmuting resumes', () => {
    vi.useFakeTimers();
    makeEngine();
    gesture();
    const ctx = lastContext();
    const master = ctx.gains[0]!;

    engine.setEnabled(false);
    expect(engine.isEnabled()).toBe(false);
    expect(engine.graph()).toBeNull();
    const ramps = master.gain.calls.filter((c) => c.fn === 'linearRampToValueAtTime');
    expect(ramps[ramps.length - 1]!.args[0]).toBe(0);
    expect(ctx.suspend).not.toHaveBeenCalled(); // not before the fade has finished

    vi.advanceTimersByTime(300);
    expect(ctx.suspend).toHaveBeenCalledTimes(1);
    expect(ctx.state).toBe('suspended');

    engine.setEnabled(true);
    expect(ctx.resume).toHaveBeenCalledTimes(2);
    expect(engine.graph()).not.toBeNull();
    const up = master.gain.calls.filter((c) => c.fn === 'linearRampToValueAtTime');
    expect(up[up.length - 1]!.args[0]).toBe(1);
  });

  it('does not suspend if sound came back before the fade ended', () => {
    vi.useFakeTimers();
    makeEngine();
    gesture();
    const ctx = lastContext();
    engine.setEnabled(false);
    engine.setEnabled(true);
    vi.advanceTimersByTime(500);
    expect(ctx.suspend).not.toHaveBeenCalled();
    expect(engine.graph()).not.toBeNull();
  });

  it('stays quiet while muted even when gestures keep coming', () => {
    makeEngine();
    engine.setEnabled(false);
    gesture();
    gesture('keydown');
    expect(StubAudioContext.instances).toHaveLength(0);
    expect(engine.graph()).toBeNull();
  });

  it('turns on later from a mute that began before any gesture', () => {
    makeEngine();
    engine.setEnabled(false);
    gesture();
    engine.setEnabled(true); // the Sound button press is itself a gesture
    expect(StubAudioContext.instances).toHaveLength(1);
    expect(engine.graph()).not.toBeNull();
  });

  it('suspends while the tab is hidden and resumes when it is back', () => {
    makeEngine();
    gesture();
    const ctx = lastContext();
    setHidden(true);
    expect(ctx.suspend).toHaveBeenCalledTimes(1);
    expect(engine.graph()).toBeNull();
    setHidden(false);
    expect(ctx.resume).toHaveBeenCalledTimes(2);
    expect(engine.graph()).not.toBeNull();
  });
});
