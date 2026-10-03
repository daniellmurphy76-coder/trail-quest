/**
 * A tiny stand-in for the Web Audio API, enough for the engine, effects and ambience to run in
 * happy-dom. It records what was scheduled and throws where a real browser would throw (an
 * exponential ramp to zero or a negative time), so a bad envelope fails a test.
 */
import { vi } from 'vitest';

export class StubParam {
  value: number;
  calls: { fn: string; args: number[] }[] = [];

  constructor(value = 0) {
    this.value = value;
  }

  private record(fn: string, args: number[]): this {
    if (args.some((n) => !Number.isFinite(n))) throw new RangeError(`${fn}: non-finite argument`);
    this.calls.push({ fn, args });
    return this;
  }

  setValueAtTime(value: number, time: number): this {
    if (time < 0) throw new RangeError('setValueAtTime: negative time');
    this.value = value;
    return this.record('setValueAtTime', [value, time]);
  }

  linearRampToValueAtTime(value: number, time: number): this {
    return this.record('linearRampToValueAtTime', [value, time]);
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    if (value <= 0) throw new RangeError('exponentialRampToValueAtTime: value must be positive');
    return this.record('exponentialRampToValueAtTime', [value, time]);
  }

  setTargetAtTime(target: number, time: number, constant: number): this {
    this.value = target;
    return this.record('setTargetAtTime', [target, time, constant]);
  }

  cancelScheduledValues(time: number): this {
    return this.record('cancelScheduledValues', [time]);
  }
}

export class StubNode {
  connections: unknown[] = [];
  disconnected = false;

  connect<T>(destination: T): T {
    this.connections.push(destination);
    return destination;
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

export class StubGain extends StubNode {
  gain = new StubParam(1);
}

export class StubFilter extends StubNode {
  type = 'lowpass';
  frequency = new StubParam(350);
  Q = new StubParam(1);
}

class StubSource extends StubNode {
  startedAt: number[] = [];
  stoppedAt: number[] = [];
  onended: (() => void) | null = null;

  start(when = 0): void {
    this.startedAt.push(when);
  }

  stop(when = 0): void {
    this.stoppedAt.push(when);
  }
}

export class StubOscillator extends StubSource {
  type = 'sine';
  frequency = new StubParam(440);
}

export class StubBufferSource extends StubSource {
  buffer: unknown = null;
  loop = false;
}

export class StubAudioContext {
  static instances: StubAudioContext[] = [];

  /** Starts suspended, like Safari: it needs resume() from a gesture. */
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  sampleRate = 8000;
  destination = new StubNode();
  onstatechange: (() => void) | null = null;

  oscillators: StubOscillator[] = [];
  gains: StubGain[] = [];
  filters: StubFilter[] = [];
  sources: StubBufferSource[] = [];

  resume = vi.fn(async () => {
    this.setState('running');
  });
  suspend = vi.fn(async () => {
    this.setState('suspended');
  });
  close = vi.fn(async () => {
    this.setState('closed');
  });

  constructor() {
    StubAudioContext.instances.push(this);
  }

  private setState(state: 'suspended' | 'running' | 'closed'): void {
    this.state = state;
    this.onstatechange?.();
  }

  createGain(): StubGain {
    const node = new StubGain();
    this.gains.push(node);
    return node;
  }

  createOscillator(): StubOscillator {
    const node = new StubOscillator();
    this.oscillators.push(node);
    return node;
  }

  createBiquadFilter(): StubFilter {
    const node = new StubFilter();
    this.filters.push(node);
    return node;
  }

  createBufferSource(): StubBufferSource {
    const node = new StubBufferSource();
    this.sources.push(node);
    return node;
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    return { numberOfChannels: channels, length, sampleRate, getChannelData: () => new Float32Array(length) };
  }

  /** How many nodes of every kind exist. A rough "did it schedule anything" measure. */
  nodeCount(): number {
    return this.oscillators.length + this.gains.length + this.filters.length + this.sources.length;
  }
}

export function stubContext(): AudioContext {
  return new StubAudioContext() as unknown as AudioContext;
}

/** The context the engine made (the last one created). */
export function lastContext(): StubAudioContext {
  const found = StubAudioContext.instances[StubAudioContext.instances.length - 1];
  if (!found) throw new Error('No AudioContext was created');
  return found;
}

export function resetStubs(): void {
  StubAudioContext.instances = [];
}

/** A pointer-down on the page, which is a user gesture. */
export function gesture(kind: 'pointerdown' | 'keydown' = 'pointerdown'): void {
  document.dispatchEvent(kind === 'keydown' ? new KeyboardEvent('keydown', { key: 'a' }) : new Event('pointerdown'));
}
