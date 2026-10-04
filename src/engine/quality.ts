/**
 * Quality tiers. Three of them:
 *
 * - `high`: everything. Full-resolution ambient occlusion, bloom, SMAA, a 2048 shadow map.
 * - `medium`: the M1 iPad and anything weaker. Half-resolution ambient occlusion with fewer
 *   samples, bloom, SMAA, a 1024 shadow map with a shorter reach.
 * - `low`: plain rendering. No ambient occlusion, no bloom, no post pipeline at all, the
 *   renderer's own tone mapping. Nothing picks it at start: a game only lands here by being
 *   too slow (see `AutoDowngrade`) or by `?quality=low`.
 *
 * `detectQuality` and the auto-downgrade are pure so they can be tested; `getQuality` reads the
 * browser once and remembers the answer for the session.
 */

export type QualityTier = 'high' | 'medium' | 'low';

/** From best to cheapest. */
export const QUALITY_TIERS: readonly QualityTier[] = ['high', 'medium', 'low'];

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

/** The N8AO quality presets this game uses (samples per pixel and denoise work). */
export type AoQuality = 'Performance' | 'Medium';

/** Which post effects a tier turns on. See `postConfig` in post.ts for the full picture. */
export interface PostFeatures {
  /** False: no composer. The renderer draws straight to the screen with its own tone mapping. */
  enabled: boolean;
  ao: boolean;
  /** Compute the occlusion at half resolution. */
  aoHalfRes: boolean;
  /** `Performance` is 8 samples and 4 denoise taps; `Medium` is 16 and 8. */
  aoQuality: AoQuality;
  bloom: boolean;
  /** Mip levels of the bloom blur. Fewer is cheaper and tighter. */
  bloomLevels: number;
  smaa: boolean;
}

export interface QualitySettings {
  tier: QualityTier;
  /** Width and height of the sun's shadow map, in texels. */
  shadowMapSize: number;
  /** Width of the square the sun's shadow camera covers around the player, in world units. */
  shadowDistance: number;
  post: PostFeatures;
}

export const QUALITY_SETTINGS: Readonly<Record<QualityTier, QualitySettings>> = {
  high: {
    tier: 'high',
    shadowMapSize: 2048,
    shadowDistance: 45,
    post: { enabled: true, ao: true, aoHalfRes: false, aoQuality: 'Medium', bloom: true, bloomLevels: 7, smaa: true },
  },
  medium: {
    tier: 'medium',
    shadowMapSize: 1024,
    shadowDistance: 35,
    post: { enabled: true, ao: true, aoHalfRes: true, aoQuality: 'Performance', bloom: true, bloomLevels: 5, smaa: true },
  },
  low: {
    tier: 'low',
    shadowMapSize: 1024,
    shadowDistance: 30,
    post: { enabled: false, ao: false, aoHalfRes: false, aoQuality: 'Performance', bloom: false, bloomLevels: 5, smaa: false },
  },
};

/** Thresholds below which a device drops to `medium`. Kept as named numbers so tests and notes agree. */
const LOW_CORES = 4; // 4 or fewer logical cores
const LOW_MEMORY_GB = 4; // 4 GB or less (Chromium reports 0.25 to 8)
const DENSE_PIXEL_RATIO = 3; // phone-class screens: fill rate matters more than shadow detail

/** Pick a tier from device hints. Touch-first devices and weak hardware get `medium`. Never `low`. */
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
  return value === 'high' || value === 'medium' || value === 'low' ? value : null;
}

// ---- automatic downgrade ------------------------------------------------------------------------

/** The next cheaper tier, or null when there is none. */
export function lowerTier(tier: QualityTier): QualityTier | null {
  const i = QUALITY_TIERS.indexOf(tier);
  return QUALITY_TIERS[i + 1] ?? null;
}

export interface AutoDowngradeOptions {
  /** Length of one measuring window, in seconds of frame time. Default 3. */
  windowSeconds?: number;
  /** Average frame time above which the tier drops, in milliseconds. Default 22 (a bit under 45 fps). */
  thresholdMs?: number;
  /** Seconds ignored at the start and after every drop: shaders compile and buffers fill. Default 2. */
  warmupSeconds?: number;
  /** One frame counts for at most this many milliseconds, so a single stall cannot trip it. Default 100. */
  maxFrameMs?: number;
}

export const AUTO_DOWNGRADE_DEFAULTS = {
  windowSeconds: 3,
  thresholdMs: 22,
  warmupSeconds: 2,
  maxFrameMs: 100,
} as const;

/**
 * Watches frame times and says when to drop a tier. Feed it every frame's duration; it averages
 * over fixed windows of `windowSeconds` and, when a whole window averaged slower than
 * `thresholdMs`, returns the next cheaper tier. It never goes back up: a Scout whose game got
 * cheaper should not watch it flip around. A device stuck at 30 fps by a power-saving mode will
 * also walk down to `low`, which is the right call for that device anyway.
 */
export class AutoDowngrade {
  private current: QualityTier;
  private readonly windowSeconds: number;
  private readonly thresholdMs: number;
  private readonly warmupSeconds: number;
  private readonly maxFrameMs: number;
  private warmupLeft: number;
  private elapsed = 0;
  private totalMs = 0;
  private frames = 0;

  constructor(tier: QualityTier, options: AutoDowngradeOptions = {}) {
    this.current = tier;
    this.windowSeconds = options.windowSeconds ?? AUTO_DOWNGRADE_DEFAULTS.windowSeconds;
    this.thresholdMs = options.thresholdMs ?? AUTO_DOWNGRADE_DEFAULTS.thresholdMs;
    this.warmupSeconds = options.warmupSeconds ?? AUTO_DOWNGRADE_DEFAULTS.warmupSeconds;
    this.maxFrameMs = options.maxFrameMs ?? AUTO_DOWNGRADE_DEFAULTS.maxFrameMs;
    this.warmupLeft = this.warmupSeconds;
  }

  get tier(): QualityTier {
    return this.current;
  }

  /** The tier was changed from outside (the developer panel): start measuring again from here. */
  setTier(tier: QualityTier): void {
    this.current = tier;
    this.restart();
  }

  /**
   * One frame took `frameSeconds`. Returns the new, cheaper tier when this frame closes a slow
   * window, otherwise null.
   */
  sample(frameSeconds: number): QualityTier | null {
    if (!(frameSeconds > 0) || !Number.isFinite(frameSeconds)) return null;
    const seconds = Math.min(frameSeconds, this.maxFrameMs / 1000);
    if (this.warmupLeft > 0) {
      this.warmupLeft -= seconds;
      return null;
    }
    this.elapsed += seconds;
    this.totalMs += seconds * 1000;
    this.frames++;
    if (this.elapsed < this.windowSeconds) return null;

    const average = this.totalMs / this.frames;
    this.elapsed = 0;
    this.totalMs = 0;
    this.frames = 0;
    if (average <= this.thresholdMs) return null;
    const next = lowerTier(this.current);
    if (next === null) return null;
    this.current = next;
    this.warmupLeft = this.warmupSeconds;
    return next;
  }

  private restart(): void {
    this.warmupLeft = this.warmupSeconds;
    this.elapsed = 0;
    this.totalMs = 0;
    this.frames = 0;
  }
}

// ---- the session's tier ----------------------------------------------------------------------------

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

/** The tier changed during the session (an automatic downgrade, or the developer panel). */
export function setQuality(tier: QualityTier): void {
  cached = tier;
}
