import { describe, expect, it } from 'vitest';
import {
  ActionEdge,
  applyDeadzone,
  clampToUnit,
  isInJoystickZone,
  joystickVector,
  keyboardAxis,
  mergeMoves,
} from '../../src/engine/input-math';

const none = { up: false, down: false, left: false, right: false };

describe('clampToUnit', () => {
  it('leaves short vectors alone', () => {
    expect(clampToUnit(0.3, -0.4)).toEqual({ x: 0.3, z: -0.4 });
  });

  it('shrinks long vectors to length 1, keeping direction', () => {
    const v = clampToUnit(3, 4);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(1, 10);
    expect(v.x).toBeCloseTo(0.6, 10);
    expect(v.z).toBeCloseTo(0.8, 10);
  });

  it('clamps to a custom max (used for the joystick knob in pixels)', () => {
    expect(clampToUnit(100, 0, 50)).toEqual({ x: 50, z: 0 });
  });

  it('handles zero and never returns negative zero', () => {
    expect(clampToUnit(0, 0)).toEqual({ x: 0, z: 0 });
    expect(Object.is(clampToUnit(-0, 0).x, 0)).toBe(true);
  });
});

describe('applyDeadzone', () => {
  it('zeroes anything inside the deadzone', () => {
    expect(applyDeadzone(0.1, 0.1, 0.2)).toEqual({ x: 0, z: 0 });
    expect(applyDeadzone(0.2, 0, 0.2)).toEqual({ x: 0, z: 0 });
  });

  it('ramps from 0 at the edge to 1 at full tilt, with no jump', () => {
    const justOut = applyDeadzone(0.21, 0, 0.2);
    expect(justOut.x).toBeGreaterThan(0);
    expect(justOut.x).toBeLessThan(0.02);
    expect(applyDeadzone(1, 0, 0.2).x).toBeCloseTo(1, 10);
  });

  it('is radial, so a diagonal at the corner clamps to length 1', () => {
    const v = applyDeadzone(1, 1, 0.2);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(1, 10);
  });

  it('keeps direction', () => {
    const v = applyDeadzone(-0.6, 0.6, 0.2);
    expect(v.x).toBeLessThan(0);
    expect(v.z).toBeGreaterThan(0);
    expect(v.x).toBeCloseTo(-v.z, 10);
  });
});

describe('keyboardAxis', () => {
  it('gives zero with no keys', () => {
    expect(keyboardAxis(none)).toEqual({ x: 0, z: 0 });
  });

  it('maps up to negative z (away from the viewer) and right to positive x', () => {
    expect(keyboardAxis({ ...none, up: true })).toEqual({ x: 0, z: -1 });
    expect(keyboardAxis({ ...none, down: true })).toEqual({ x: 0, z: 1 });
    expect(keyboardAxis({ ...none, right: true })).toEqual({ x: 1, z: 0 });
    expect(keyboardAxis({ ...none, left: true })).toEqual({ x: -1, z: 0 });
  });

  it('normalizes diagonals to length 1', () => {
    const v = keyboardAxis({ ...none, up: true, right: true });
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(1, 10);
    expect(v.x).toBeCloseTo(Math.SQRT1_2, 10);
    expect(v.z).toBeCloseTo(-Math.SQRT1_2, 10);
  });

  it('cancels opposite keys', () => {
    expect(keyboardAxis({ up: true, down: true, left: false, right: false })).toEqual({ x: 0, z: 0 });
    expect(keyboardAxis({ up: true, down: true, left: true, right: false })).toEqual({ x: -1, z: 0 });
  });
});

describe('joystickVector', () => {
  it('is zero for tiny finger jitter', () => {
    expect(joystickVector(2, 2, 50)).toEqual({ x: 0, z: 0 });
  });

  it('reaches full speed at the radius and never exceeds 1 beyond it', () => {
    expect(joystickVector(50, 0, 50).x).toBeCloseTo(1, 10);
    const far = joystickVector(400, 300, 50);
    expect(Math.hypot(far.x, far.z)).toBeCloseTo(1, 10);
  });

  it('maps dragging up the screen to negative z', () => {
    expect(joystickVector(0, -50, 50).z).toBeCloseTo(-1, 10);
  });
});

describe('mergeMoves', () => {
  it('stays unit length when sources agree', () => {
    expect(mergeMoves({ x: 1, z: 0 }, { x: 1, z: 0 }, { x: 0.5, z: 0 })).toEqual({ x: 1, z: 0 });
  });

  it('lets opposite sources cancel', () => {
    expect(mergeMoves({ x: 1, z: 0 }, { x: -1, z: 0 })).toEqual({ x: 0, z: 0 });
  });
});

describe('isInJoystickZone', () => {
  it('covers the left 60% of the screen only', () => {
    expect(isInJoystickZone(0, 1000)).toBe(true);
    expect(isInJoystickZone(599, 1000)).toBe(true);
    expect(isInJoystickZone(600, 1000)).toBe(false);
    expect(isInJoystickZone(950, 1000)).toBe(false);
  });
});

describe('ActionEdge', () => {
  it('reports pressed for exactly one step per press', () => {
    const edge = new ActionEdge();
    expect(edge.step()).toEqual({ down: false, pressed: false });
    edge.set(true);
    expect(edge.step()).toEqual({ down: true, pressed: true });
    edge.set(true); // key repeat, or another source still holding it
    expect(edge.step()).toEqual({ down: true, pressed: false });
    expect(edge.step()).toEqual({ down: true, pressed: false });
    edge.set(false);
    expect(edge.step()).toEqual({ down: false, pressed: false });
    edge.set(true);
    expect(edge.step()).toEqual({ down: true, pressed: true });
  });

  it('does not lose a tap that starts and ends between two steps', () => {
    const edge = new ActionEdge();
    edge.set(true);
    edge.set(false);
    expect(edge.step()).toEqual({ down: true, pressed: true });
    expect(edge.step()).toEqual({ down: false, pressed: false });
  });

  it('reset clears a pending press', () => {
    const edge = new ActionEdge();
    edge.set(true);
    edge.reset();
    expect(edge.step()).toEqual({ down: false, pressed: false });
  });
});
