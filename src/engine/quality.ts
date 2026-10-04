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
 * Under the tiers sits the render scale: the pixel ratio the picture is drawn at. A screen asks for
 * up to 2x; when frames run slow the game lowers the ratio a step at a time (2, 1.75, 1.5, 1.25)
 * before it takes any effect away, because fill rate is what a tablet runs out of first.
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

// ---- render scale -------------------------------------------------------------------------------

/** The most the pixel ratio ever is, whatever the screen offers. A 3x phone draws at 2. */
export const MAX_PIXEL_RATIO = 2;

/** The pixel ratios dynamic resolution steps down through, below the screen's own. The last is the floor. */
export const RENDER_SCALE_STEPS: readonly number[] = [1.75, 1.5, 1.25];

/** A step smaller than this is not worth rebuilding every buffer for, so a screen at 1.3x gets no step. */
const MIN_SCALE_STEP = 0.2;

/** The lowest ratio `?scale=` accepts. */
const MIN_SCALE_OVERRIDE = 0.5;

/**
 * The pixel ratios to draw at on a screen, sharpest first. The first is the screen's own ratio
 * (at most 2). A 2x screen gets 2, 1.75, 1.5, 1.25. A 1x screen gets just 1: there is nothing to
 * lower, so a slow game goes straight to dropping a tier.
 */
export function renderScaleLadder(devicePixelRatio: number): number[] {
  const top = Math.min(devicePixelRatio > 0 ? devicePixelRatio : 1, MAX_PIXEL_RATIO);
  const ladder = [top];
  for (const step of RENDER_SCALE_STEPS) {
    if (step <= ladder[ladder.length - 1]! - MIN_SCALE_STEP) ladder.push(step);
  }
  return ladder;
}

/**
 * A pixel ratio capped from the address bar, for example `?scale=1.25`, to see how the picture
 * looks that soft. Kept between 0.5 and 2. Anything that is not a number returns null.
 */
export function parseScaleOverride(search: string): number | null {
  const value = new URLSearchParams(search).get('scale');
  if (value === null || value.trim() === '') return null;
  const scale = Number(value);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return Math.min(Math.max(scale, MIN_SCALE_OVERRIDE), MAX_PIXEL_RATIO);
}

// ---- automatic downgrade ------------------------------------------------------------------------

/** The next cheaper tier, or null when there is none. */
export function lowerTier(tier: QualityTier): QualityTier | null {
  const i = QUALITY_TIERS.indexOf(tier);
  return QUALITY_TIERS[i + 1] ?? null;
}

/** What the monitor asks for: a new pixel ratio (lower, or sharper again after a step back up), or a cheaper tier. */
export type AutoChange = { kind: 'resolution'; pixelRatio: number } | { kind: 'tier'; tier: QualityTier };

export interface AutoDowngradeOptions {
  /** Length of one measuring window, in seconds of frame time. Default 3. */
  windowSeconds?: number;
  /** Average frame time above which the game gets cheaper, in milliseconds. Default 22 (a bit under 45 fps). */
  thresholdMs?: number;
  /** Seconds ignored at the start and after every change: shaders compile and buffers fill. Default 2. */
  warmupSeconds?: number;
  /** One frame counts for at most this many milliseconds, so a single stall cannot trip it. Default 100. */
  maxFrameMs?: number;
  /**
   * The screen's pixel ratio. It sets the resolution steps (see `renderScaleLadder`): a 2x screen has
   * three before the first tier drop, a 1x screen has none. Default 1.
   */
  pixelRatio?: number;
  /** Seconds of comfortable windows in a row before the resolution steps back up one. 0 never steps up. Default 10. */
  recoverSeconds?: number;
  /** A window averaging at or under this counts as comfortable, in milliseconds. Default 17.2 (58 fps or better). */
  comfortMs?: number;
}

export const AUTO_DOWNGRADE_DEFAULTS = {
  windowSeconds: 3,
  thresholdMs: 22,
  warmupSeconds: 2,
  maxFrameMs: 100,
  pixelRatio: 1,
  recoverSeconds: 10,
  comfortMs: 17.2,
} as const;

/**
 * Watches frame times and says how to make the game cheaper. Feed it every frame's duration; it
 * averages over fixed windows of `windowSeconds` and, when a whole window averaged slower than
 * `thresholdMs`, returns one change:
 *
 * 1. While the pixel ratio is above its floor, the next step down (2, 1.75, 1.5, 1.25 on a 2x
 *    screen). The picture gets a little softer and nothing else changes.
 * 2. At the floor, the next cheaper tier, which takes effects away.
 *
 * The tier never goes back up: a Scout whose game got cheaper should not watch it flip around. The
 * resolution can, but only while no tier has been dropped: after `recoverSeconds` of comfortable
 * windows in a row (58 fps or better) it steps back up one rung. A rung that is stepped back up to
 * and then fails is closed for the rest of the session, so it cannot flip back and forth: every
 * rung is retried at most once. A device stuck at 30 fps by a power-saving mode walks all the way
 * down to `low`, which is the right call for that device anyway.
 */
export class AutoDowngrade {
  private current: QualityTier;
  private readonly windowSeconds: number;
  private readonly thresholdMs: number;
  private readonly warmupSeconds: number;
  private readonly maxFrameMs: number;
  private readonly recoverSeconds: number;
  private readonly comfortMs: number;
  /** Pixel ratios, sharpest first. */
  private readonly ladder: number[];
  /** Index into `ladder` of the ratio in use. */
  private rung = 0;
  /** The sharpest rung still allowed. A rung that failed after being stepped back up to is closed. */
  private ceiling = 0;
  /** The rung in use was reached by stepping up, not down. */
  private steppedUp = false;
  /** A tier was dropped: the device is struggling, so the resolution stays where it is. */
  private tierDropped = false;
  /** Seconds of comfortable windows in a row. */
  private comfortable = 0;
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
    this.recoverSeconds = options.recoverSeconds ?? AUTO_DOWNGRADE_DEFAULTS.recoverSeconds;
    this.comfortMs = options.comfortMs ?? AUTO_DOWNGRADE_DEFAULTS.comfortMs;
    this.ladder = renderScaleLadder(options.pixelRatio ?? AUTO_DOWNGRADE_DEFAULTS.pixelRatio);
    this.warmupLeft = this.warmupSeconds;
  }

  get tier(): QualityTier {
    return this.current;
  }

  /** The pixel ratio the monitor has settled on. */
  get pixelRatio(): number {
    return this.ladder[this.rung]!;
  }

  /** The tier was changed from outside (the developer panel): start measuring again from here. */
  setTier(tier: QualityTier): void {
    this.current = tier;
    this.tierDropped = false;
    this.restart();
  }

  /**
   * One frame took `frameSeconds`. Returns the change to make when this frame closes a window that
   * asks for one, otherwise null.
   */
  sample(frameSeconds: number): AutoChange | null {
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
    const windowSeconds = this.elapsed;
    this.elapsed = 0;
    this.totalMs = 0;
    this.frames = 0;
    if (average > this.thresholdMs) {
      this.comfortable = 0;
      return this.stepDown();
    }
    // Between comfortable and slow nothing changes, but the run of comfortable windows is broken.
    if (average > this.comfortMs || !this.canStepUp()) {
      this.comfortable = 0;
      return null;
    }
    this.comfortable += windowSeconds;
    return this.comfortable >= this.recoverSeconds ? this.stepUp() : null;
  }

  private canStepUp(): boolean {
    return this.recoverSeconds > 0 && !this.tierDropped && this.rung > this.ceiling;
  }

  private stepDown(): AutoChange | null {
    if (this.rung < this.ladder.length - 1) {
      // Stepped back up and failed at once: this rung is too heavy for the device, close it.
      if (this.steppedUp) this.ceiling = this.rung + 1;
      this.rung++;
      this.steppedUp = false;
      this.warmupLeft = this.warmupSeconds;
      return { kind: 'resolution', pixelRatio: this.pixelRatio };
    }
    const next = lowerTier(this.current);
    if (next === null) return null;
    this.current = next;
    this.tierDropped = true;
    this.warmupLeft = this.warmupSeconds;
    return { kind: 'tier', tier: next };
  }

  private stepUp(): AutoChange {
    this.rung--;
    this.steppedUp = true;
    this.comfortable = 0;
    this.warmupLeft = this.warmupSeconds;
    return { kind: 'resolution', pixelRatio: this.pixelRatio };
  }

  private restart(): void {
    this.warmupLeft = this.warmupSeconds;
    this.elapsed = 0;
    this.totalMs = 0;
    this.frames = 0;
    this.comfortable = 0;
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
