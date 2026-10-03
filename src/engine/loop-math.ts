/** Pure fixed-timestep accumulator math for the game loop. No DOM, no Three.js. */

export const STEP = 1 / 60;
export const MAX_STEPS_PER_FRAME = 5;
/** A single frame longer than this (tab was throttled, debugger paused) is treated as this long. */
export const MAX_FRAME_DT = 0.25;

export interface AccumulatorResult {
  /** How many fixed updates to run this frame. */
  steps: number;
  /** Leftover time to carry into the next frame. Always in [0, step). */
  accumulator: number;
}

/**
 * Add `frameDt` to the accumulator and work out how many fixed steps to run.
 * At most `maxSteps` run per frame; if the cap is hit the extra backlog is dropped so the game
 * slows down instead of spiraling.
 */
export function advanceAccumulator(
  accumulator: number,
  frameDt: number,
  step: number = STEP,
  maxSteps: number = MAX_STEPS_PER_FRAME,
): AccumulatorResult {
  let acc = accumulator + Math.min(Math.max(frameDt, 0), MAX_FRAME_DT);
  let steps = 0;
  while (acc >= step && steps < maxSteps) {
    acc -= step;
    steps++;
  }
  if (acc >= step) acc %= step; // cap hit: drop the backlog, keep the fractional phase
  return { steps, accumulator: acc };
}
