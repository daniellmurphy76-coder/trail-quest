/** Pure zone-bounds helpers. No Three.js. */

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface XZ {
  x: number;
  z: number;
}

/** Keep a point inside the zone rectangle. */
export function clampToBounds(x: number, z: number, bounds: Bounds): XZ {
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, x)),
    z: Math.min(bounds.maxZ, Math.max(bounds.minZ, z)),
  };
}

/** A square of half-size `half` centered on the origin: `{ -half..half }` on both axes. */
export function squareBounds(half: number): Bounds {
  return { minX: -half, maxX: half, minZ: -half, maxZ: half };
}

/**
 * Walk once around the edge of a square of half-size `half`. `u` in [0, 1) is how far around
 * (0 = north-west corner, going clockwise seen from above). Used to place a ring of trees.
 */
export function perimeterPoint(u: number, half: number): XZ {
  const side = half * 2;
  const d = (((u % 1) + 1) % 1) * side * 4;
  const edge = Math.min(3, Math.floor(d / side));
  const t = d - edge * side;
  switch (edge) {
    case 0:
      return { x: -half + t, z: -half };
    case 1:
      return { x: half, z: -half + t };
    case 2:
      return { x: half - t, z: half };
    default:
      return { x: -half, z: half - t };
  }
}
