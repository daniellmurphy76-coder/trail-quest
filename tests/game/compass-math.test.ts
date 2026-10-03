import { describe, expect, it } from 'vitest';
import {
  arrowAngle,
  bearingTo,
  COMPASS_REACH,
  COMPASS_STEPS_FROM,
  compassView,
  groundDistance,
  radiansToDegrees,
  stepsFor,
} from '../../src/game/compass-math';

const origin = { x: 0, z: 0 };
const deg = (radians: number): number => Math.round(radiansToDegrees(radians));

// The default camera looks down -z, which is heading PI (forward is (sin h, cos h)).
const LOOKING_DOWN_NEG_Z = Math.PI;

describe('bearingTo', () => {
  it('uses the engine heading convention: 0 is +z, PI/2 is +x', () => {
    expect(bearingTo(origin, { x: 0, z: 5 })).toBeCloseTo(0, 10);
    expect(bearingTo(origin, { x: 5, z: 0 })).toBeCloseTo(Math.PI / 2, 10);
    expect(bearingTo(origin, { x: -5, z: 0 })).toBeCloseTo(-Math.PI / 2, 10);
    expect(Math.abs(bearingTo(origin, { x: 0, z: -5 }))).toBeCloseTo(Math.PI, 10);
  });
});

describe('arrowAngle', () => {
  it('points straight up for a target dead ahead of the camera', () => {
    expect(arrowAngle(origin, { x: 0, z: -10 }, LOOKING_DOWN_NEG_Z)).toBeCloseTo(0, 10);
    expect(arrowAngle(origin, { x: 0, z: 10 }, 0)).toBeCloseTo(0, 10);
  });

  it('turns clockwise for a target on the right and counter-clockwise for the left', () => {
    // Camera looks down -z, so +x is on its right.
    expect(deg(arrowAngle(origin, { x: 10, z: 0 }, LOOKING_DOWN_NEG_Z))).toBe(90);
    expect(deg(arrowAngle(origin, { x: -10, z: 0 }, LOOKING_DOWN_NEG_Z))).toBe(-90);
    // Halfway between ahead and right.
    expect(deg(arrowAngle(origin, { x: 10, z: -10 }, LOOKING_DOWN_NEG_Z))).toBe(45);
  });

  it('points down for a target behind the camera', () => {
    expect(Math.abs(deg(arrowAngle(origin, { x: 0, z: 10 }, LOOKING_DOWN_NEG_Z)))).toBe(180);
  });

  it('follows the camera as it turns, not the world', () => {
    const target = { x: 10, z: 0 };
    // Camera swung to look down +x (heading PI/2): the target is dead ahead.
    expect(arrowAngle(origin, target, Math.PI / 2)).toBeCloseTo(0, 10);
    // Camera looks down +z (heading 0): +x is on its LEFT, because the view is turned around.
    expect(deg(arrowAngle(origin, target, 0))).toBe(-90);
  });

  it('measures from the player, not from the world origin', () => {
    expect(deg(arrowAngle({ x: 5, z: 5 }, { x: 5, z: -5 }, LOOKING_DOWN_NEG_Z))).toBe(0);
    expect(deg(arrowAngle({ x: 5, z: 5 }, { x: 15, z: 5 }, LOOKING_DOWN_NEG_Z))).toBe(90);
  });

  it('stays inside (-PI, PI] and never returns negative zero', () => {
    for (let yaw = -7; yaw <= 7; yaw += 0.37) {
      const a = arrowAngle(origin, { x: 3, z: -4 }, yaw);
      expect(a).toBeGreaterThan(-Math.PI - 1e-9);
      expect(a).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
    expect(Object.is(arrowAngle(origin, { x: 0, z: -10 }, LOOKING_DOWN_NEG_Z) + 0, 0)).toBe(true);
  });
});

describe('steps', () => {
  it('counts one step per world unit, rounded', () => {
    expect(stepsFor(12)).toBe(12);
    expect(stepsFor(11.6)).toBe(12);
    expect(stepsFor(11.4)).toBe(11);
    expect(stepsFor(3.49)).toBe(3);
  });

  it('measures ground distance on x and z only', () => {
    expect(groundDistance(origin, { x: 3, z: 4 })).toBe(5);
    expect(groundDistance({ x: 1, z: 1 }, { x: 1, z: 1 })).toBe(0);
  });
});

describe('compassView', () => {
  const target = (distance: number) => ({ x: 0, z: -distance }); // straight ahead of the default camera

  it('is hidden with no target', () => {
    expect(compassView(origin, null, LOOKING_DOWN_NEG_Z)).toEqual({ visible: false, angle: 0, steps: null });
  });

  it('is hidden when the target is within reach', () => {
    expect(compassView(origin, target(0), LOOKING_DOWN_NEG_Z).visible).toBe(false);
    expect(compassView(origin, target(1.5), LOOKING_DOWN_NEG_Z).visible).toBe(false);
    expect(compassView(origin, target(COMPASS_REACH), LOOKING_DOWN_NEG_Z).visible).toBe(false);
  });

  it('shows the arrow but no number between reach and 3 units', () => {
    const view = compassView(origin, target(2.5), LOOKING_DOWN_NEG_Z);
    expect(view.visible).toBe(true);
    expect(view.steps).toBeNull();
    expect(compassView(origin, target(COMPASS_STEPS_FROM), LOOKING_DOWN_NEG_Z).steps).toBeNull();
  });

  it('adds a rounded step count when the target is farther than 3 units', () => {
    const near = compassView(origin, target(3.01), LOOKING_DOWN_NEG_Z);
    expect(near.visible).toBe(true);
    expect(near.steps).toBe(3);
    expect(compassView(origin, target(11.3), LOOKING_DOWN_NEG_Z).steps).toBe(11);
    expect(compassView(origin, target(12), LOOKING_DOWN_NEG_Z).steps).toBe(12);
  });

  it('carries the arrow angle along', () => {
    const view = compassView(origin, { x: 10, z: 0 }, LOOKING_DOWN_NEG_Z);
    expect(deg(view.angle)).toBe(90);
    expect(view.steps).toBe(10);
  });

  it('uses the same reach as the Den Chief so the arrow goes away exactly when Talk appears', () => {
    expect(COMPASS_REACH).toBe(2);
  });
});
