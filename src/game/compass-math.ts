/**
 * Pure math for the HUD compass. No DOM, no Three.js, so it is unit-tested in node.
 *
 * Headings follow the engine convention (src/engine/camera.ts): a heading `h` looks along
 * (sin h, cos h) on the ground, so 0 looks down +z and PI looks down -z. The arrow angle is
 * clockwise from straight up on the screen, which is what CSS `rotate()` wants.
 */
import { wrapAngle } from '../engine/damp';

export interface GroundPoint {
  x: number;
  z: number;
}

/** One step is one world unit, about one real step for a scout. */
export const STEP_UNITS = 1;
/** Closer than this the target is within reach, so the compass hides. Matches the Den Chief's radius. */
export const COMPASS_REACH = 2;
/** Farther than this the compass also says how many steps away. */
export const COMPASS_STEPS_FROM = 3;

/** Heading from `from` to `to`, in radians. */
export function bearingTo(from: GroundPoint, to: GroundPoint): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export function groundDistance(a: GroundPoint, b: GroundPoint): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/**
 * Which way the arrow points on screen, in radians clockwise from straight up, in (-PI, PI].
 * Straight ahead of the camera is 0, to its right is PI/2, behind it is PI.
 */
export function arrowAngle(from: GroundPoint, to: GroundPoint, cameraYaw: number): number {
  return wrapAngle(cameraYaw - bearingTo(from, to)) + 0; // "+ 0" turns -0 into 0
}

/** A ground distance as a whole number of steps. */
export function stepsFor(distance: number): number {
  return Math.round(distance / STEP_UNITS);
}

export interface CompassView {
  visible: boolean;
  /** Radians clockwise from straight up. */
  angle: number;
  /** Steps away, or null when the target is too close to bother counting. */
  steps: number | null;
}

const HIDDEN: CompassView = { visible: false, angle: 0, steps: null };

/** Everything the compass shows for one frame. */
export function compassView(player: GroundPoint, target: GroundPoint | null, cameraYaw: number): CompassView {
  if (!target) return HIDDEN;
  const distance = groundDistance(player, target);
  if (distance <= COMPASS_REACH) return HIDDEN;
  return {
    visible: true,
    angle: arrowAngle(player, target, cameraYaw),
    steps: distance > COMPASS_STEPS_FROM ? stepsFor(distance) : null,
  };
}

export function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}
