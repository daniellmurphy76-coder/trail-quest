/**
 * Pure beat math for the rhythm activity. Nothing here reads a clock or sets a timer: callers
 * pass `now` and `startTime` in milliseconds (from `performance.now()`), so every function can
 * be tested with plain numbers.
 *
 * The beat grid: beat 0 lands at `startTime`, beat k at `startTime + k * interval`.
 */

export const DEFAULT_BPM = 80;
export const MIN_BPM = 40;
export const MAX_BPM = 180;
/** A tap this close to a beat (in ms, either side) counts as "On beat!". */
export const ON_BEAT_WINDOW_MS = 180;
/** The window never grows past this share of one beat, so fast tempos stay meaningful. */
const MAX_WINDOW_SHARE = 0.45;
/** Beats counted in (3, 2, 1) before beat 0. */
export const COUNT_IN_BEATS = 3;

const EPSILON = 1e-6;

/** Fills in the default and keeps a tempo a kid can follow. */
export function normalizeBpm(bpm: number | undefined): number {
  if (bpm === undefined || !Number.isFinite(bpm) || bpm <= 0) return DEFAULT_BPM;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));
}

/** Milliseconds from one beat to the next. 60 bpm is 1000 ms, 120 bpm is 500 ms. */
export function bpmToIntervalMs(bpm: number): number {
  return 60000 / (Number.isFinite(bpm) && bpm > 0 ? bpm : DEFAULT_BPM);
}

/** Half-width of the "On beat!" window: 180 ms, or less when a beat is very short. */
export function onBeatWindowMs(bpm: number): number {
  return Math.min(ON_BEAT_WINDOW_MS, bpmToIntervalMs(bpm) * MAX_WINDOW_SHARE);
}

/** Index of the beat closest to `now`. Taps before `startTime` belong to beat 0. */
export function nearestBeatIndex(now: number, startTime: number, bpm: number): number {
  const interval = bpmToIntervalMs(bpm);
  return Math.max(0, Math.round((now - startTime) / interval));
}

/**
 * Signed distance in ms from `now` to the nearest beat. Negative means early, positive means
 * late, 0 means right on it.
 */
export function nearestBeatOffset(now: number, startTime: number, bpm: number): number {
  const interval = bpmToIntervalMs(bpm);
  return now - startTime - nearestBeatIndex(now, startTime, bpm) * interval;
}

export interface TapJudgement {
  /** True when the tap is inside the on-beat window. */
  onBeat: boolean;
  /** Signed ms from the nearest beat (negative is early). */
  offsetMs: number;
  beatIndex: number;
  timing: 'early' | 'late' | 'exact';
}

/** Judges one tap. Every tap still counts toward the reps; this only decides the wording. */
export function judgeTap(now: number, startTime: number, bpm: number): TapJudgement {
  const offsetMs = nearestBeatOffset(now, startTime, bpm);
  return {
    onBeat: Math.abs(offsetMs) <= onBeatWindowMs(bpm) + EPSILON,
    offsetMs,
    beatIndex: nearestBeatIndex(now, startTime, bpm),
    timing: Math.abs(offsetMs) <= EPSILON ? 'exact' : offsetMs < 0 ? 'early' : 'late',
  };
}

/**
 * Where `now` sits inside the current beat, from 0 (a beat just landed) up to just under 1
 * (the next beat is about to land). Works before `startTime` too, so the count-in pulses on
 * the same grid.
 */
export function beatPhase(now: number, startTime: number, bpm: number): number {
  const interval = bpmToIntervalMs(bpm);
  const within = (((now - startTime) % interval) + interval) % interval;
  return within / interval;
}

/** Beat number at `now`: -1 during the last count-in beat, 0 from the first beat on. Can be negative. */
export function beatIndexAt(now: number, startTime: number, bpm: number): number {
  return Math.floor((now - startTime) / bpmToIntervalMs(bpm) + EPSILON);
}

/** The count-in number to show: 3, then 2, then 1, changing exactly on the beat grid. */
export function countInNumber(now: number, startTime: number, bpm: number, beats = COUNT_IN_BEATS): number {
  const remaining = Math.ceil((startTime - now) / bpmToIntervalMs(bpm) - EPSILON);
  return Math.min(beats, Math.max(1, remaining));
}

/** Ring size for a beat phase: biggest right on the beat, easing back to 1 by 40% of the beat. */
export function pulseScale(phase: number): number {
  const fade = Math.max(0, 1 - phase / 0.4);
  return 1 + 0.2 * fade * fade;
}
