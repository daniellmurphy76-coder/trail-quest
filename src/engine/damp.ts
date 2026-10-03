/**
 * Pure damping and angle helpers. No DOM, no Three.js.
 *
 * Exponential damping (`1 - exp(-k * dt)`) is frame-rate independent: ten steps of 0.1 s land
 * in the same place as one step of 1.0 s. Never use a fixed `lerp(a, b, 0.1)` per frame.
 */

/** Fraction of the remaining distance to cover this step. k is "per second"; larger is snappier. */
export function dampFactor(k: number, dt: number): number {
  return 1 - Math.exp(-k * dt);
}

/** Move `current` toward `target` with exponential damping. */
export function damp(current: number, target: number, k: number, dt: number): number {
  return current + (target - current) * dampFactor(k, dt);
}

/** Wrap an angle in radians into (-PI, PI]. */
export function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  let r = (a + Math.PI) % twoPi;
  if (r <= 0) r += twoPi;
  return r - Math.PI;
}

/** Signed shortest rotation from `from` to `to`, in (-PI, PI]. */
export function shortestAngle(from: number, to: number): number {
  return wrapAngle(to - from);
}

/** Damp an angle toward a target along the shortest arc. */
export function dampAngle(current: number, target: number, k: number, dt: number): number {
  return current + shortestAngle(current, target) * dampFactor(k, dt);
}
