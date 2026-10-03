/**
 * Quality tiers. Two are enough: the M1 iPad (and anything weaker) gets a smaller shadow map and a
 * shorter shadow reach; everything else gets the full look. `detectQuality` is pure so it can be
 * tested; `getQuality` reads the browser once and remembers the answer.
 */

export type QualityTier = 'high' | 'medium';

/** Device hints. Everything except `coarsePointer` and `pixelRatio` is missing on some browsers. */
export interface QualityInfo {
  /** `matchMedia('(pointer: coarse)')`: a touch screen is the main pointer (iPad, phones). */
  coarsePointer: boolean;
  /** `navigator.hardwareConcurrency`. Safari reports it; some privacy modes hide it. */
  hardwareConcurrency?: number;
  /** `navigator.deviceMemory` in GB (Chromium only, rounded and capped at 8). Safari has none. */
  deviceMemory?: number;
  /** `window.devicePixelRatio`. */
  pixelRatio: number;
}

export interface QualitySettings {
  tier: QualityTier;
  /** Width and height of the sun's shadow map, in texels. */
  shadowMapSize: number;
  /** Width of the square the sun's shadow camera covers around the player, in world units. */
  shadowDistance: number;
}

export const QUALITY_SETTINGS: Readonly<Record<QualityTier, QualitySettings>> = {
  high: { tier: 'high', shadowMapSize: 2048, shadowDistance: 45 },
  medium: { tier: 'medium', shadowMapSize: 1024, shadowDistance: 35 },
};

/** Thresholds below which a device drops to `medium`. Kept as named numbers so tests and notes agree. */
const LOW_CORES = 4; // 4 or fewer logical cores
const LOW_MEMORY_GB = 4; // 4 GB or less (Chromium reports 0.25 to 8)
const DENSE_PIXEL_RATIO = 3; // phone-class screens: fill rate matters more than shadow detail

/** Pick a tier from device hints. Touch-first devices and weak hardware get `medium`. */
export function detectQuality(info: QualityInfo): QualityTier {
  if (info.coarsePointer) return 'medium';
  if (info.deviceMemory !== undefined && info.deviceMemory <= LOW_MEMORY_GB) return 'medium';
  if (info.hardwareConcurrency !== undefined && info.hardwareConcurrency <= LOW_CORES) return 'medium';
  if (info.pixelRatio >= DENSE_PIXEL_RATIO) return 'medium';
  return 'high';
}

export function qualitySettings(tier: QualityTier): QualitySettings {
  return QUALITY_SETTINGS[tier];
}

/**
 * A tier forced from the address bar, for example `?quality=medium`, so a laptop can preview what
 * the iPad gets. Anything else returns null.
 */
export function parseQualityOverride(search: string): QualityTier | null {
  const value = new URLSearchParams(search).get('quality');
  return value === 'high' || value === 'medium' ? value : null;
}

let cached: QualityTier | null = null;

/** Read the browser once (touch, cores, memory, pixel ratio) and keep the answer for the session. */
export function getQuality(): QualityTier {
  if (cached) return cached;
  const win = typeof window === 'undefined' ? undefined : window;
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number });
  const override = win ? parseQualityOverride(win.location?.search ?? '') : null;
  const info: QualityInfo = {
    coarsePointer: win?.matchMedia?.('(pointer: coarse)').matches ?? false,
    pixelRatio: win?.devicePixelRatio ?? 1,
  };
  if (nav?.hardwareConcurrency) info.hardwareConcurrency = nav.hardwareConcurrency;
  if (nav?.deviceMemory) info.deviceMemory = nav.deviceMemory;
  cached = override ?? detectQuality(info);
  return cached;
}
