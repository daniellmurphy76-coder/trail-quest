import type { ZoneId } from '../activities/types';
import { mulberry32 } from '../engine/seed';

/**
 * The shape of the land beyond the walkable square: one pure height function that the ground plane
 * (ground.ts) and the ring of hills behind it (horizon.ts) both read, so the two always meet without
 * a seam. No Three.js, so it runs in node and in the tests.
 *
 * Distances are measured from the zone's center. `half` is the half-size of the walkable square, and
 * a point's "square distance" is `max(|x|, |z|)`.
 *
 * - Out to `half + FLAT_MARGIN` the land is dead flat (height exactly 0). That covers the walkable
 *   square and the wall of trees that stands just outside it, so no trunk floats.
 * - Beyond that it rises into low rolling hills, tallest around 45 to 55 units out, and eases back to 0 by
 *   `TERRAIN_OUTER`, where the flat grass apron takes over.
 * - Height is never negative, so a prop standing at y = 0 sinks into the hills a little at worst.
 */

/** Where the hills end, in square distance from the center. Beyond it the land is flat again. */
export const TERRAIN_OUTER = 70;
/** The land stays exactly flat this far beyond the walkable square (the tree wall stands in it). */
export const TERRAIN_FLAT_MARGIN = 3.5;
/** The hills reach full height by this distance (never nearer than 22 past the walkable square). */
const RAMP_END = 44;
/** The hills start to ease back down here, measured with a rounded square so the corners are soft. */
const FADE_START = 48;
/** Peak of the tallest hills, in world units, before the zone's own `hills` factor. */
const BASE_HEIGHT = 10;

export interface Terrain {
  /** Half-size of the walkable square the land is flat around. */
  readonly half: number;
  /** Ground height at (x, z). Exactly 0 out to `half + TERRAIN_FLAT_MARGIN`. Never negative. */
  height(x: number, z: number): number;
  /** Unit surface normal at (x, z), from the slope of `height`. Straight up where the land is flat. */
  normal(x: number, z: number): [number, number, number];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

interface Wave {
  kx: number;
  kz: number;
  phase: number;
  weight: number;
}

/** Wavelengths (world units) and weights of the rolling noise: broad swells first, small bumps last. */
const WAVES: ReadonlyArray<readonly [number, number]> = [
  [58, 1],
  [39, 0.8],
  [25, 0.6],
  [16, 0.35],
  [10, 0.2],
];

/**
 * How tall each zone's hills are, as a multiple of `BASE_HEIGHT`. The town zones sit on gentler
 * land, so their houses on the skyline are not buried; the open field is flatter than the forests.
 */
const ZONE_HILLS: Readonly<Record<ZoneId, number>> = {
  'base-camp': 1,
  'nature-trail': 1.15,
  'fitness-field': 0.75,
  'campfire-circle': 1,
  'town-square': 0.5,
  'safety-station': 0.55,
};

/**
 * The land around a zone. `seed` picks the wavelengths' directions and phases, so a zone always gets
 * the same hills. `hills` scales how tall they are (1 reaches about 10 units).
 */
export function createTerrain(half: number, seed: number, hills = 1): Terrain {
  const rng = mulberry32(seed);
  const waves: Wave[] = WAVES.map(([wavelength, weight]) => {
    const angle = rng() * Math.PI * 2;
    const k = (Math.PI * 2) / wavelength;
    return { kx: Math.cos(angle) * k, kz: Math.sin(angle) * k, phase: rng() * Math.PI * 2, weight };
  });
  const totalWeight = waves.reduce((sum, w) => sum + w.weight, 0);
  const flatTo = half + TERRAIN_FLAT_MARGIN;
  const rampEnd = Math.max(RAMP_END, half + 22);
  const amplitude = BASE_HEIGHT * hills;

  /** Smooth noise in [0, 1]. */
  const noise = (x: number, z: number): number => {
    let sum = 0;
    for (const w of waves) sum += w.weight * Math.sin(w.kx * x + w.kz * z + w.phase);
    return 0.5 + (0.5 * sum) / totalWeight;
  };

  const height = (x: number, z: number): number => {
    const square = Math.max(Math.abs(x), Math.abs(z));
    if (square <= flatTo) return 0;
    const rise = smoothstep(flatTo, rampEnd, square);
    // A rounded square (power 4) for the far fade, so the hills' outline is not a boxy frame.
    const rounded = Math.sqrt(Math.sqrt(x ** 4 + z ** 4));
    const fall = 1 - smoothstep(FADE_START, TERRAIN_OUTER, rounded);
    const envelope = rise * fall;
    if (envelope <= 0) return 0;
    return amplitude * envelope * (0.4 + 0.6 * noise(x, z));
  };

  const EPS = 0.5;
  return {
    half,
    height,
    normal(x, z) {
      const dx = (height(x + EPS, z) - height(x - EPS, z)) / (2 * EPS);
      const dz = (height(x, z + EPS) - height(x, z - EPS)) / (2 * EPS);
      const len = Math.hypot(dx, 1, dz);
      return [(0 - dx) / len, 1 / len, (0 - dz) / len]; // (0 - dx), so a flat spot gives +0 and not -0
    },
  };
}

/** The terrain for a zone: its own hill height, seeded by `seed`. Ground and horizon must share this. */
export function zoneTerrain(zoneId: ZoneId, half: number, seed: number): Terrain {
  return createTerrain(half, seed, ZONE_HILLS[zoneId]);
}
