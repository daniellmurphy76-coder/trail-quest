import { describe, expect, it } from 'vitest';
import {
  GREETING_DELAY_MS,
  GUIDED_START_DISTANCE,
  guidedStartPose,
  shouldAutoGreet,
} from '../../src/game/guided-start';
import { squareBounds } from '../../src/world/bounds';

const guide = { x: 3.4, z: -1.8 }; // where Base Camp puts the Den Chief
const spawn = { x: 0, z: 9 };

describe('guidedStartPose', () => {
  it('stands inside the Den Chief\'s reach, on the spawn side, so the Talk prompt is already showing', () => {
    const pose = guidedStartPose(guide, spawn, 2);
    const distance = Math.hypot(pose.x - guide.x, pose.z - guide.z);
    expect(distance).toBeLessThanOrEqual(2);
    expect(distance).toBeGreaterThan(1.5);
    // Toward the spawn side of the guide, not past them.
    expect(Math.hypot(pose.x - spawn.x, pose.z - spawn.z)).toBeLessThan(Math.hypot(guide.x - spawn.x, guide.z - spawn.z));
  });

  it('is two units away when the Den Chief\'s reach has room for it', () => {
    const pose = guidedStartPose(guide, spawn, 5);
    expect(Math.hypot(pose.x - guide.x, pose.z - guide.z)).toBeCloseTo(GUIDED_START_DISTANCE, 10);
  });

  it('faces the Den Chief: forward (sin, cos) of the facing points at the guide', () => {
    const pose = guidedStartPose(guide, spawn, 2);
    const forward = { x: Math.sin(pose.facing), z: Math.cos(pose.facing) };
    const toGuide = { x: guide.x - pose.x, z: guide.z - pose.z };
    const length = Math.hypot(toGuide.x, toGuide.z);
    expect(forward.x).toBeCloseTo(toGuide.x / length, 10);
    expect(forward.z).toBeCloseTo(toGuide.z / length, 10);
  });

  it('keeps the spot inside the walkable bounds', () => {
    const edgeGuide = { x: 24.5, z: 0 };
    const pose = guidedStartPose(edgeGuide, { x: 40, z: 0 }, 5, squareBounds(25));
    expect(pose.x).toBeLessThanOrEqual(25);
    expect(pose.x).toBeGreaterThan(edgeGuide.x - 0.001);
  });

  it('has a sensible answer when the spawn is on top of the guide', () => {
    const pose = guidedStartPose(guide, guide, 5);
    expect(Number.isFinite(pose.x) && Number.isFinite(pose.z) && Number.isFinite(pose.facing)).toBe(true);
    expect(pose.z).toBeGreaterThan(guide.z); // the +z side, where the default camera looks from
  });
});

describe('shouldAutoGreet', () => {
  const ready = { viewState: 'ready' as const, busy: false, overlayOpen: false };

  it('opens the greeting by itself only when the trail still has stops to play', () => {
    expect(shouldAutoGreet(ready)).toBe(true);
    expect(shouldAutoGreet({ ...ready, viewState: 'done-today' })).toBe(false);
    expect(shouldAutoGreet({ ...ready, viewState: 'empty' })).toBe(false);
    expect(shouldAutoGreet({ ...ready, viewState: null })).toBe(false);
  });

  it('never talks over something the Scout already opened or started', () => {
    expect(shouldAutoGreet({ ...ready, busy: true })).toBe(false);
    expect(shouldAutoGreet({ ...ready, overlayOpen: true })).toBe(false);
  });

  it('waits about a second', () => {
    expect(GREETING_DELAY_MS).toBe(1000);
  });
});
