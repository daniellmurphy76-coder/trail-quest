/**
 * The look of the world, in one place. Every rendering module reads these numbers instead of
 * keeping its own: the environment (sun, sky light, fog, environment map), the renderer (exposure)
 * and the post pipeline (ambient occlusion, bloom, color grade). The developer panel (devtools.ts)
 * edits them live through a `LookStore`.
 *
 * Units, so the numbers mean something:
 * - Light intensities are Three's physically based units (r155 and later). A diffuse surface that
 *   faces the sun reflects `albedo * sunIntensity * cos(angle) / PI`, so a "full" sun is about 3.
 *   The hemisphere light is the same: `albedo * intensity * color / PI`. The environment map adds
 *   `albedo * radiance * envIntensity`, with no PI, so it is easiest to think of as "how bright
 *   the sky is".
 * - Colors are '#rrggbb' strings, as scene colors before tone mapping (ACES squeezes bright and
 *   saturated values, so a sky color reads paler on screen than its hex).
 * - Angles are degrees. `sunAzimuth` turns from +z toward +x; `sunElevation` is up from the
 *   horizon.
 *
 * This file is pure (no Three.js, no DOM), so it runs in node and in the tests.
 */

export interface LookSettings {
  /** Tone mapping exposure. 1 leaves the scene as lit. */
  exposure: number;

  /** Sun color, a warm white. */
  sunColor: string;
  /** Physically based units; about 3 is a full sun. */
  sunIntensity: number;
  /** Degrees, 0 = from +z, 90 = from +x. */
  sunAzimuth: number;
  /** Degrees above the horizon. Lower is a longer shadow and a warmer afternoon. */
  sunElevation: number;
  /**
   * A soft, cool light that rides with the camera and shines on whatever the camera sees, so faces
   * turned toward the player are not left to the ambient light alone. No shadow. Same units as
   * the sun; 0 turns it off (the light stays in the scene, so shaders never recompile).
   */
  fillIntensity: number;

  /** Hemisphere light from above. A small fill: the environment map does most of the ambient work. */
  hemiSkyColor: string;
  /** Hemisphere light from below: the grass bouncing light up into shadows. */
  hemiGroundColor: string;
  hemiIntensity: number;

  /** Scale of the sky-and-ground environment map every lit material receives. */
  envIntensity: number;

  /** Sky color straight up. */
  skyZenithColor: string;
  /** Fog color. It is also the sky's color at the horizon, so distant trees melt into the haze. */
  fogColor: string;
  /** Distance where fog starts, in world units. */
  fogNear: number;
  /** Distance where things are fully fogged. */
  fogFar: number;

  /** Ambient occlusion reach in world units. Small, so only contacts darken. */
  aoRadius: number;
  /** Strength: the occlusion is raised to this power, so bigger is darker. */
  aoIntensity: number;
  /** Compute the occlusion at half resolution. The medium tier always does; this forces it on high. */
  aoHalfRes: boolean;

  /** Linear luminance where glow starts. Sunlit surfaces stay under 1, so only fire and lanterns bloom. */
  bloomThreshold: number;
  bloomIntensity: number;
  /** Spread of the glow, 0 to 1. */
  bloomRadius: number;

  /** Color grade after tone mapping. -1 to 1, 0 changes nothing. */
  saturation: number;
  /** -1 to 1, 0 changes nothing. */
  contrast: number;
  /** -1 (cool) to 1 (warm), 0 changes nothing. */
  warmth: number;
}

export type LookKey = keyof LookSettings;

/** Warm afternoon light. See the notes in environment.ts and post.ts for how these were reasoned. */
export const DEFAULT_LOOK: Readonly<LookSettings> = Object.freeze({
  exposure: 1.05,

  sunColor: '#ffdba6',
  sunIntensity: 3.3,
  sunAzimuth: 70,
  sunElevation: 38,
  fillIntensity: 0.6,

  hemiSkyColor: '#cfe0f2',
  hemiGroundColor: '#6b8a3d',
  hemiIntensity: 0.2,

  envIntensity: 1.3,

  skyZenithColor: '#3a6cd0',
  fogColor: '#b0d6ff',
  fogNear: 26,
  fogFar: 115,

  aoRadius: 1.1,
  aoIntensity: 2.2,
  aoHalfRes: false,

  bloomThreshold: 1.0,
  bloomIntensity: 0.8,
  bloomRadius: 0.7,

  saturation: 0.1,
  contrast: 0.06,
  warmth: 0.35,
});

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** The keys of the defaults, which are the only keys a look has. */
export const LOOK_KEYS = Object.freeze(Object.keys(DEFAULT_LOOK) as LookKey[]);

function accepts(base: unknown, value: unknown): boolean {
  if (typeof base === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (typeof base === 'boolean') return typeof value === 'boolean';
  if (typeof base === 'string') return typeof value === 'string' && HEX_COLOR.test(value);
  return false;
}

/**
 * A new look: `base` with every valid value in `partial` laid over it. Unknown keys, `undefined`,
 * numbers that are not finite, colors that are not '#rrggbb' and values of the wrong type are
 * ignored, so a half-typed panel field or an old pasted settings blob can never break the scene.
 * Colors are returned in lower case. Neither argument is changed.
 */
export function mergeLook(base: LookSettings, partial: Partial<LookSettings> | null | undefined = {}): LookSettings {
  const next: Record<string, number | string | boolean> = { ...base };
  if (partial) {
    const source = partial as Record<string, unknown>;
    for (const key of LOOK_KEYS) {
      const value = source[key];
      if (value === undefined || !accepts(base[key], value)) continue;
      next[key] = typeof value === 'string' ? value.toLowerCase() : (value as number | boolean);
    }
  }
  return next as unknown as LookSettings;
}

/** The values in `current` that differ from `base`: what "Copy settings" puts on the clipboard. */
export function diffLook(base: LookSettings, current: LookSettings): Partial<LookSettings> {
  const changed: Record<string, number | string | boolean> = {};
  for (const key of LOOK_KEYS) {
    if (base[key] !== current[key]) changed[key] = current[key];
  }
  return changed as Partial<LookSettings>;
}

/** Unit vector from the ground toward the sun (x, y, z), from the azimuth and elevation. */
export function sunDirection(look: Pick<LookSettings, 'sunAzimuth' | 'sunElevation'>): [number, number, number] {
  const az = (look.sunAzimuth * Math.PI) / 180;
  const el = (look.sunElevation * Math.PI) / 180;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}

export type LookListener = (look: LookSettings, changed: Partial<LookSettings>) => void;

/**
 * The live look. One store per world: the panel and the console call `set`, and the environment,
 * renderer and post pipeline subscribe. `set` and `reset` only notify when something changed.
 */
export interface LookStore {
  get(): LookSettings;
  /** Merge a partial look in (invalid values are ignored) and tell the listeners what changed. */
  set(partial: Partial<LookSettings>): LookSettings;
  /** Back to the defaults. */
  reset(): LookSettings;
  /** Hear about every change. Returns a stop function. */
  subscribe(listener: LookListener): () => void;
}

export function createLookStore(initial: Partial<LookSettings> = {}): LookStore {
  let current = mergeLook(DEFAULT_LOOK, initial);
  const listeners = new Set<LookListener>();

  const apply = (next: LookSettings): LookSettings => {
    const changed = diffLook(current, next);
    if (Object.keys(changed).length === 0) return current;
    current = next;
    for (const listener of [...listeners]) listener(current, changed);
    return current;
  };

  return {
    get: () => current,
    set: (partial) => apply(mergeLook(current, partial)),
    reset: () => apply({ ...DEFAULT_LOOK }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
