/**
 * Walking collisions: pure ground-plane math, no Three.js, so the controller and the tests can use
 * it without a renderer.
 *
 * A zone lists its solid props as `Collider`s (see `Zone.colliders`). The player is a circle, and
 * `resolveCollisions` pushes that circle out of whatever it overlaps along the shortest way out.
 * Because only the part of the move that goes into the prop is removed, the part along it stays,
 * so the Scout glides along a wall or around a trunk instead of sticking to it.
 *
 * Colliders are footprints, not crowns: a tree's collider is its trunk, a lamp's is its post.
 */

/** A round footprint: a trunk, a post, a stone, the fire ring. */
export interface CircleCollider {
  kind: 'circle';
  x: number;
  z: number;
  r: number;
}

/**
 * A rectangular footprint centered on (x, z), `hw` half-wide along its own x axis and `hd`
 * half-deep along its own z axis (a building's door side, a fence's length). `yaw` turns it about
 * the up axis exactly like `Object3D.rotation.y`: its local +z faces (sin yaw, cos yaw). That is
 * the same yaw a zone gives the prop it draws, so a prop and its collider turn together.
 */
export interface BoxCollider {
  kind: 'box';
  x: number;
  z: number;
  hw: number;
  hd: number;
  yaw?: number;
}

export type Collider = CircleCollider | BoxCollider;

/** How far from its center the Scout's body reaches on the ground. */
export const PLAYER_RADIUS = 0.45;

/** A tree's trunk (its crown is overhead and never blocks). */
export const TREE_TRUNK_RADIUS = 0.45;

/** Overlaps shallower than this are touching, not overlapping (keeps float noise from flagging a clear spot). */
const EPSILON = 1e-6;
/** `resolveCollisions` walks the list this many times at most; a pocket tighter than that stays a little overlapped. */
const MAX_PASSES = 4;

// ---- builders -------------------------------------------------------------------------------------

export function circleCollider(x: number, z: number, r: number): CircleCollider {
  return { kind: 'circle', x, z, r };
}

export function boxCollider(x: number, z: number, hw: number, hd: number, yaw = 0): BoxCollider {
  return { kind: 'box', x, z, hw, hd, yaw };
}

/** One circle of radius `r` at every spot. Pass the same list that places the props. */
export function circlesAt(spots: readonly { x: number; z: number }[], r: number): CircleCollider[] {
  return spots.map((s) => circleCollider(s.x, s.z, r));
}

// ---- the math -------------------------------------------------------------------------------------

/** Where a circle of `radius` at (x, z) ends up when pushed out of `c`, or null when it is not overlapping. */
function pushOut(x: number, z: number, radius: number, c: Collider): { x: number; z: number } | null {
  if (c.kind === 'circle') {
    const dx = x - c.x;
    const dz = z - c.z;
    const reach = c.r + radius;
    const d = Math.hypot(dx, dz);
    if (d >= reach - EPSILON) return null;
    if (d < 1e-9) return { x: c.x + reach, z: c.z }; // dead center: any way out will do, so always the same one
    const k = reach / d;
    return { x: c.x + dx * k, z: c.z + dz * k };
  }

  // Box: work in its own frame (x along its width, z along its depth), then turn the answer back.
  const yaw = c.yaw ?? 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const dx = x - c.x;
  const dz = z - c.z;
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  const nearX = Math.min(c.hw, Math.max(-c.hw, lx));
  const nearZ = Math.min(c.hd, Math.max(-c.hd, lz));
  const ex = lx - nearX;
  const ez = lz - nearZ;

  let outX: number;
  let outZ: number;
  if (ex === 0 && ez === 0) {
    // The center is inside the box: leave through the nearest face, however deep it is.
    if (c.hw - Math.abs(lx) <= c.hd - Math.abs(lz)) {
      outX = (lx >= 0 ? 1 : -1) * (c.hw + radius);
      outZ = lz;
    } else {
      outX = lx;
      outZ = (lz >= 0 ? 1 : -1) * (c.hd + radius);
    }
  } else {
    // The center is outside: push along the line from the nearest point of the box (a face or a corner).
    const d = Math.hypot(ex, ez);
    if (d >= radius - EPSILON) return null;
    const k = radius / d;
    outX = nearX + ex * k;
    outZ = nearZ + ez * k;
  }
  return { x: c.x + outX * cos + outZ * sin, z: c.z - outX * sin + outZ * cos };
}

/**
 * Push a player circle of `radius` at (x, z) out of every collider it overlaps, each along its
 * shortest way out (the face normal of a box, the line from the center of a circle, the radial
 * line from a box corner). A point already inside a box leaves through the nearest face. The list
 * is walked a few times, so a push out of one prop that lands in another is sorted out too.
 */
export function resolveCollisions(
  x: number,
  z: number,
  radius: number,
  colliders: readonly Collider[],
): { x: number; z: number } {
  let px = x;
  let pz = z;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let moved = false;
    for (const c of colliders) {
      const out = pushOut(px, pz, radius, c);
      if (out) {
        px = out.x;
        pz = out.z;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x: px, z: pz };
}

/** True when a circle of `radius` at (x, z) overlaps nothing. Touching is clear. */
export function isClear(x: number, z: number, radius: number, colliders: readonly Collider[]): boolean {
  for (const c of colliders) {
    if (pushOut(x, z, radius, c)) return false;
  }
  return true;
}
