// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Input } from '../../src/engine/input';

/** A coarse-pointer device is one where `(pointer: coarse)` matches, like an iPad. */
function stubPointer(coarse: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: coarse && query.includes('coarse'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  window.matchMedia = globalThis.matchMedia;
}

let ui: HTMLElement;
let canvas: HTMLElement;
let input: Input | undefined;

beforeEach(() => {
  document.body.replaceChildren();
  canvas = document.createElement('canvas');
  ui = document.createElement('div');
  document.body.append(canvas, ui);
  // happy-dom has no pointer capture; the joystick only needs the calls to exist.
  const held = new Set<number>();
  Object.assign(canvas, {
    setPointerCapture: (id: number) => held.add(id),
    releasePointerCapture: (id: number) => held.delete(id),
    hasPointerCapture: (id: number) => held.has(id),
  });
  Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
});

afterEach(() => {
  input?.dispose();
  input = undefined;
  vi.unstubAllGlobals();
});

function make(coarse: boolean): { input: Input; joy: HTMLElement; knob: HTMLElement } {
  stubPointer(coarse);
  input = new Input({ target: canvas, ui });
  return {
    input,
    joy: ui.querySelector<HTMLElement>('.tq-joy')!,
    knob: ui.querySelector<HTMLElement>('.tq-joy-knob')!,
  };
}

function touch(type: string, x: number, y: number, pointerId = 1): void {
  canvas.dispatchEvent(
    new PointerEvent(type, { pointerId, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }),
  );
}

describe('touch joystick at rest', () => {
  it('shows the joystick ring at rest on a coarse-pointer device before anyone touches the screen', () => {
    const { joy } = make(true);
    expect(joy.classList.contains('is-rest')).toBe(true);
    expect(joy.classList.contains('is-on')).toBe(false);
    expect(joy.style.transform).toBe(''); // CSS places it bottom-left
  });

  it('stays hidden on a laptop', () => {
    const { joy } = make(false);
    expect(joy.classList.contains('is-rest')).toBe(false);
    expect(joy.classList.contains('is-on')).toBe(false);
  });

  it('still moves the ring to the finger when a drag starts anywhere in the left 60%, and rests again after', () => {
    const { input: stick, joy } = make(true);
    touch('pointerdown', 300, 500);
    expect(joy.classList.contains('is-on')).toBe(true);
    expect(joy.classList.contains('is-rest')).toBe(false);
    expect(joy.style.transform).toBe('translate(240px, 440px)'); // centred on the finger (120px ring)

    touch('pointermove', 350, 500);
    const state = stick.update();
    expect(state.move.x).toBeGreaterThan(0.9); // 50px right of the start is full speed

    touch('pointerup', 350, 500);
    expect(joy.classList.contains('is-on')).toBe(false);
    expect(joy.classList.contains('is-rest')).toBe(true);
    expect(joy.style.transform).toBe('');
    expect(stick.update().move).toEqual({ x: 0, z: 0 });
  });

  it('ignores a touch that starts in the right 40% (that is for the action button)', () => {
    const { joy } = make(true);
    touch('pointerdown', 900, 500);
    expect(joy.classList.contains('is-on')).toBe(false);
    expect(joy.classList.contains('is-rest')).toBe(true);
  });

  it('hides the resting ring while a dialog or screen has game input switched off', () => {
    const { input: stick, joy } = make(true);
    stick.setEnabled(false);
    expect(stick.isEnabled).toBe(false);
    expect(joy.classList.contains('is-rest')).toBe(false);
    stick.setEnabled(true);
    expect(joy.classList.contains('is-rest')).toBe(true);
  });

  it('puts the ring back at rest if input is switched off mid-drag', () => {
    const { input: stick, joy } = make(true);
    touch('pointerdown', 300, 500);
    expect(joy.classList.contains('is-on')).toBe(true);
    stick.setEnabled(false);
    expect(joy.classList.contains('is-on')).toBe(false);
    expect(joy.classList.contains('is-rest')).toBe(false);
    expect(joy.style.transform).toBe('');
    stick.setEnabled(true);
    expect(joy.classList.contains('is-rest')).toBe(true);
  });

  it('shows the ring after the first touch even on a device that did not report a coarse pointer', () => {
    const { joy } = make(false);
    expect(joy.classList.contains('is-rest')).toBe(false);
    window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', pointerId: 7 }));
    expect(joy.classList.contains('is-rest')).toBe(true);
  });
});

describe('Input.lastDevice', () => {
  it('starts as touch on a coarse-pointer device and as keyboard otherwise', () => {
    expect(make(true).input.lastDevice).toBe('touch');
    input?.dispose();
    expect(make(false).input.lastDevice).toBe('keyboard');
  });
});
