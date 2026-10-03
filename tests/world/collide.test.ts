import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/engine/seed';
import {
  boxCollider,
  circleCollider,
  circlesAt,
  isClear,
  PLAYER_RADIUS,
  resolveCollisions,
  type BoxCollider,
  type Collider,
} from '../../src/world/collide';

const R = PLAYER_RADIUS;

/** The point (x, z) in the box's own frame, by the Three.js rule: undo the box's position, then its yaw. */
function toLocal(box: BoxCollider, x: number, z: number): { lx: number; lz: number } {
  const holder = new THREE.Object3D();
  holder.position.set(box.x, 0, box.z);
  holder.rotation.y = box.yaw ?? 0;
  holder.updateMatrixWorld(true);
  const p = new THREE.Vector3(x, 0, z).applyMatrix4(holder.matrixWorld.clone().invert());
  return { lx: p.x, lz: p.z };
}

/** The shortest distance from (x, z) to the edge of the box, measured in its own frame (inside or out). */
function distanceToEdge(box: BoxCollider, x: number, z: number): number {
  const { lx, lz } = toLocal(box, x, z);
  const ex = Math.max(Math.abs(lx) - box.hw, 0);
  const ez = Math.max(Math.abs(lz) - box.hd, 0);
  if (ex > 0 || ez > 0) return Math.hypot(ex, ez);
  return Math.min(box.hw - Math.abs(lx), box.hd - Math.abs(lz));
}

describe('collider builders', () => {
  it('makes plain circles and boxes (a box with no turn has yaw 0)', () => {
    expect(circleCollider(1, 2, 0.5)).toEqual({ kind: 'circle', x: 1, z: 2, r: 0.5 });
    expect(boxCollider(1, 2, 3, 4)).toEqual({ kind: 'box', x: 1, z: 2, hw: 3, hd: 4, yaw: 0 });
    expect(boxCollider(1, 2, 3, 4, 0.7).yaw).toBe(0.7);
  });

  it('puts one circle on every spot of a list, in order', () => {
    const spots = [
      { x: 1, z: 2 },
      { x: -3, z: 4 },
    ];
    expect(circlesAt(spots, 0.45)).toEqual([circleCollider(1, 2, 0.45), circleCollider(-3, 4, 0.45)]);
    expect(circlesAt([], 0.45)).toEqual([]);
  });

  it('uses a Scout 0.45 wide from the middle', () => {
    expect(PLAYER_RADIUS).toBe(0.45);
  });
});

describe('circles', () => {
  const trunk = circleCollider(0, 0, 0.45);

  it('leaves a player who is clear exactly where they are', () => {
    expect(resolveCollisions(3, 4, R, [trunk])).toEqual({ x: 3, z: 4 });
    expect(resolveCollisions(3, 4, R, [])).toEqual({ x: 3, z: 4 });
  });

  it('pushes an overlapping player straight out along the line from the center, to exactly touching', () => {
    const out = resolveCollisions(0.3, 0, R, [trunk]);
    expect(out.x).toBeCloseTo(0.9, 9);
    expect(out.z).toBeCloseTo(0, 9);

    const diagonal = resolveCollisions(0.3, 0.3, R, [trunk]);
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(0.9, 9);
    expect(diagonal.x).toBeCloseTo(diagonal.z, 9); // along the diagonal, not toward an axis
    expect(diagonal.x).toBeGreaterThan(0);
  });

  it('keeps the part of the move that goes around: sliding along a trunk', () => {
    // Walking in -x along z = 0.5, just past a trunk: pushed up (+z) only, x untouched.
    const out = resolveCollisions(0, 0.5, R, [trunk]);
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.z).toBeCloseTo(0.9, 9);
  });

  it('calls touching clear, and a hair closer an overlap', () => {
    expect(isClear(0.9, 0, R, [trunk])).toBe(true);
    expect(isClear(0.9 - 1e-4, 0, R, [trunk])).toBe(false);
    expect(resolveCollisions(0.9, 0, R, [trunk])).toEqual({ x: 0.9, z: 0 });
  });

  it('gets a player standing exactly on the center out the same way every time', () => {
    const a = resolveCollisions(0, 0, R, [trunk]);
    const b = resolveCollisions(0, 0, R, [trunk]);
    expect(a).toEqual(b);
    expect(Math.hypot(a.x, a.z)).toBeCloseTo(0.9, 9);
  });

  it('handles two overlapping circles in sequence, ending clear of both', () => {
    const pair = [circleCollider(0, 0, 0.5), circleCollider(1.2, 0, 0.5)];
    const out = resolveCollisions(0.6, 0.1, R, pair);
    expect(isClear(out.x, out.z, R, pair)).toBe(true);
  });
});

describe('axis-aligned boxes', () => {
  // A wall 4 wide (x -2..2) and 2 deep (z -1..1).
  const wall = boxCollider(0, 0, 2, 1);

  it('pushes out through each face along its normal, keeping the other coordinate', () => {
    const north = resolveCollisions(0.5, 1 + R - 0.2, R, [wall]);
    expect(north.x).toBeCloseTo(0.5, 9);
    expect(north.z).toBeCloseTo(1 + R, 9);
    const south = resolveCollisions(0.5, -(1 + R - 0.2), R, [wall]);
    expect(south.x).toBeCloseTo(0.5, 9);
    expect(south.z).toBeCloseTo(-(1 + R), 9);
    const east = resolveCollisions(2 + R - 0.2, 0.4, R, [wall]);
    expect(east.x).toBeCloseTo(2 + R, 9);
    expect(east.z).toBeCloseTo(0.4, 9);
    const west = resolveCollisions(-(2 + R - 0.2), -0.4, R, [wall]);
    expect(west.x).toBeCloseTo(-(2 + R), 9);
    expect(west.z).toBeCloseTo(-0.4, 9);
  });

  it('leaves a player who is clear of it, even right beside it', () => {
    expect(resolveCollisions(0, 1 + R + 0.01, R, [wall])).toEqual({ x: 0, z: 1 + R + 0.01 });
    expect(isClear(0, 1 + R, R, [wall])).toBe(true);
    expect(isClear(0, 1 + R - 0.05, R, [wall])).toBe(false);
  });

  it('rounds a corner: a player diagonal to it is pushed away from the corner point, not out of a face', () => {
    // 0.2 out of the corner at (2, 1) on both axes: closer than R, so pushed along the diagonal.
    const out = resolveCollisions(2.2, 1.2, R, [wall]);
    expect(Math.hypot(out.x - 2, out.z - 1)).toBeCloseTo(R, 9);
    expect(out.x - 2).toBeCloseTo(out.z - 1, 9);
    // And a player level with the end of a face (so the nearest point is on the face) goes straight out.
    const level = resolveCollisions(1.9, 1.2, R, [wall]);
    expect(level.x).toBeCloseTo(1.9, 9);
    expect(level.z).toBeCloseTo(1 + R, 9);
  });

  it('does not touch a player past the corner by more than the radius', () => {
    expect(resolveCollisions(2 + R * 0.8, 1 + R * 0.8, R, [wall])).toEqual({ x: 2 + R * 0.8, z: 1 + R * 0.8 });
  });

  it('sends a player already deep inside out through the nearest face', () => {
    // Near the east end: out the east face.
    const east = resolveCollisions(1.7, 0.1, R, [wall]);
    expect(east.x).toBeCloseTo(2 + R, 9);
    expect(east.z).toBeCloseTo(0.1, 9);
    // Near the west end: out the west face.
    const west = resolveCollisions(-1.8, -0.2, R, [wall]);
    expect(west.x).toBeCloseTo(-(2 + R), 9);
    // The wall is thin (2 deep) and long (4 wide), so near the middle the nearest face is a long one.
    const north = resolveCollisions(0.2, 0.7, R, [wall]);
    expect(north.z).toBeCloseTo(1 + R, 9);
    expect(north.x).toBeCloseTo(0.2, 9);
    const south = resolveCollisions(-0.2, -0.6, R, [wall]);
    expect(south.z).toBeCloseTo(-(1 + R), 9);
    // Dead center goes out a long face, the nearer way, always the same one.
    const middle = resolveCollisions(0, 0, R, [wall]);
    expect(Math.abs(middle.z)).toBeCloseTo(1 + R, 9);
    expect(middle.x).toBeCloseTo(0, 9);
    expect(resolveCollisions(0, 0, R, [wall])).toEqual(middle);
  });

  it('is clear everywhere beyond a face once pushed there, however deep the start (idempotent)', () => {
    for (const [x, z] of [
      [0, 0],
      [1.9, 0.9],
      [-1.9, -0.9],
      [0.1, 0.99],
      [1.99, 0],
    ] as const) {
      const out = resolveCollisions(x, z, R, [wall]);
      expect(isClear(out.x, out.z, R, [wall])).toBe(true);
      expect(resolveCollisions(out.x, out.z, R, [wall])).toEqual(out);
    }
  });

  it('lets a player stand on a face line (center on the edge) only by pushing them out', () => {
    const out = resolveCollisions(2, 0, R, [wall]);
    expect(out.x).toBeCloseTo(2 + R, 9);
  });

  it('keeps a thin fence between the two sides: approached from either side, the player stays on that side', () => {
    const fence = boxCollider(0, 0, 2, 0.15);
    const fromNorth = resolveCollisions(0.5, 0.2, R, [fence]);
    expect(fromNorth.z).toBeCloseTo(0.15 + R, 9);
    const fromSouth = resolveCollisions(0.5, -0.2, R, [fence]);
    expect(fromSouth.z).toBeCloseTo(-(0.15 + R), 9);
  });
});

describe('rotated boxes', () => {
  it('turns like Object3D.rotation.y: a point is inside exactly when the Three.js inverse transform says so', () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 400; i++) {
      const box = boxCollider((rng() - 0.5) * 10, (rng() - 0.5) * 10, 0.5 + rng() * 3, 0.3 + rng() * 2, (rng() - 0.5) * 7);
      const x = box.x + (rng() - 0.5) * 9;
      const z = box.z + (rng() - 0.5) * 9;
      const { lx, lz } = toLocal(box, x, z);
      const inside = Math.abs(lx) < box.hw - 1e-6 && Math.abs(lz) < box.hd - 1e-6;
      const outside = Math.abs(lx) > box.hw + 1e-6 || Math.abs(lz) > box.hd + 1e-6;
      if (inside) expect(isClear(x, z, 0, [box])).toBe(false);
      else if (outside) expect(isClear(x, z, 0, [box])).toBe(true);
    }
  });

  it('swaps width and depth at a quarter turn: width runs along z, and the front (local +z) faces +x', () => {
    const plank = boxCollider(0, 0, 3, 0.5, Math.PI / 2);
    expect(isClear(0, 2.5, 0, [plank])).toBe(false); // the width now runs along z
    expect(isClear(2.5, 0, 0, [plank])).toBe(true);
    expect(isClear(0.4, 0, 0, [plank])).toBe(false);
    const faceOut = resolveCollisions(0.3, 0.2, R, [plank]);
    expect(faceOut.x).toBeCloseTo(0.5 + R, 9); // out the +x face (its front)
    expect(faceOut.z).toBeCloseTo(0.2, 9);
  });

  it('pushes out along the turned normal at 45 degrees', () => {
    const yaw = Math.PI / 4;
    const diamond = boxCollider(5, -3, 1, 1, yaw);
    const nx = Math.sin(yaw); // the front face normal, local +z in the world
    const nz = Math.cos(yaw);
    const out = resolveCollisions(5 + nx * (1 + R - 0.25), -3 + nz * (1 + R - 0.25), R, [diamond]);
    expect(out.x).toBeCloseTo(5 + nx * (1 + R), 9);
    expect(out.z).toBeCloseTo(-3 + nz * (1 + R), 9);
  });

  it('rounds the corner of a turned box too (the push from a corner is radial)', () => {
    const yaw = 0.6;
    const box = boxCollider(0, 0, 2, 1, yaw);
    // The corner at local (2, 1), in the world.
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const corner = { x: 2 * cos + 1 * sin, z: -2 * sin + 1 * cos };
    // Step off the corner diagonally (in the box's frame) by less than R.
    const probe = { x: corner.x + (cos + sin) * 0.2, z: corner.z + (cos - sin) * 0.2 };
    const out = resolveCollisions(probe.x, probe.z, R, [box]);
    expect(Math.hypot(out.x - corner.x, out.z - corner.z)).toBeCloseTo(R, 9);
  });

  it('sends a point deep inside a turned box out the nearest face, by the shortest way', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 300; i++) {
      const box = boxCollider(rng() * 4 - 2, rng() * 4 - 2, 0.6 + rng() * 2.5, 0.4 + rng() * 1.5, (rng() - 0.5) * 6);
      // A point well inside, in the box's own frame, put back into the world.
      const lx = (rng() * 2 - 1) * box.hw * 0.95;
      const lz = (rng() * 2 - 1) * box.hd * 0.95;
      const cos = Math.cos(box.yaw ?? 0);
      const sin = Math.sin(box.yaw ?? 0);
      const x = box.x + lx * cos + lz * sin;
      const z = box.z - lx * sin + lz * cos;
      const out = resolveCollisions(x, z, R, [box]);
      const moved = Math.hypot(out.x - x, out.z - z);
      const nearestFace = Math.min(box.hw - Math.abs(lx), box.hd - Math.abs(lz));
      expect(moved).toBeCloseTo(nearestFace + R, 7);
      expect(isClear(out.x, out.z, R, [box])).toBe(true);
    }
  });

  it('always ends on the boundary of the grown shape when it starts outside the box (never moves further than needed)', () => {
    const rng = mulberry32(21);
    for (let i = 0; i < 400; i++) {
      const box = boxCollider(rng() * 6 - 3, rng() * 6 - 3, 0.4 + rng() * 2, 0.2 + rng() * 2, (rng() - 0.5) * 7);
      const x = box.x + (rng() - 0.5) * 8;
      const z = box.z + (rng() - 0.5) * 8;
      const { lx, lz } = toLocal(box, x, z);
      if (Math.abs(lx) <= box.hw && Math.abs(lz) <= box.hd) continue; // inside: covered above
      const gap = distanceToEdge(box, x, z);
      const out = resolveCollisions(x, z, R, [box]);
      if (gap >= R) {
        expect(out).toEqual({ x, z });
      } else {
        expect(distanceToEdge(box, out.x, out.z)).toBeCloseTo(R, 7);
        expect(Math.hypot(out.x - x, out.z - z)).toBeCloseTo(R - gap, 7);
      }
    }
  });
});

describe('several overlaps', () => {
  /** Clear of everything, give or take a hair: after a few passes a tight pocket may keep a sliver of overlap. */
  const nearlyClear = (x: number, z: number, list: readonly Collider[]): boolean => isClear(x, z, R - 0.01, list);

  it('sorts out a push out of a wall that lands in a trunk', () => {
    const wall = boxCollider(0, 0, 4, 0.5);
    const trunk = circleCollider(2.2, 1.0, 0.3);
    // Inside the wall near its top face: out the top lands in the trunk, whose push lands back in the wall.
    const out = resolveCollisions(1.7, 0.3, R, [wall, trunk]);
    expect(nearlyClear(out.x, out.z, [wall, trunk])).toBe(true);
    expect(out.z).toBeGreaterThan(0.5); // on the top side of the wall
  });

  it('gets out of two boxes that meet at a corner, whichever way they are listed', () => {
    const floor = boxCollider(0, 0, 4, 0.5);
    const post = boxCollider(4.5, -2, 0.5, 2.5);
    for (const list of [[floor, post], [post, floor]]) {
      const out = resolveCollisions(3.7, 0.1, R, list);
      expect(nearlyClear(out.x, out.z, list)).toBe(true);
    }
  });

  it('fits a player through a slot just wider than they are, and leaves them as they were', () => {
    const slot: Collider[] = [boxCollider(0, 1, 5, 0.5), boxCollider(0, -1, 5, 0.5)]; // 1 wide; the player is 0.9 wide
    expect(resolveCollisions(0, 0, R, slot)).toEqual({ x: 0, z: 0 });
    expect(isClear(0, 0, R, slot)).toBe(true);
  });

  it('returns finite numbers, and does not fling the player, from a slot too narrow to fit', () => {
    const slot: Collider[] = [boxCollider(0, 0.9, 5, 0.5), boxCollider(0, -0.9, 5, 0.5)]; // 0.8 wide
    const out = resolveCollisions(1, 0.1, R, slot);
    expect(Number.isFinite(out.x) && Number.isFinite(out.z)).toBe(true);
    expect(Math.hypot(out.x - 1, out.z - 0.1)).toBeLessThan(2);
  });
});

describe('isClear', () => {
  it('is true with nothing to hit, and false the moment any one collider overlaps', () => {
    expect(isClear(0, 0, R, [])).toBe(true);
    const list: Collider[] = [circleCollider(5, 5, 1), boxCollider(-5, 0, 1, 1), circleCollider(0, 0.6, 0.3)];
    expect(isClear(0, 0, R, list)).toBe(false);
    expect(isClear(0, -1, R, list)).toBe(true);
  });

  it('agrees with resolveCollisions: a point is clear exactly when resolving leaves it where it was', () => {
    const rng = mulberry32(3);
    const list: Collider[] = [
      circleCollider(0, 0, 0.7),
      boxCollider(3, 1, 1.5, 0.6, 0.4),
      boxCollider(-3, -2, 0.8, 2, -1.1),
      circleCollider(-1, 3, 0.3),
    ];
    for (let i = 0; i < 300; i++) {
      const x = (rng() - 0.5) * 12;
      const z = (rng() - 0.5) * 12;
      const out = resolveCollisions(x, z, R, list);
      expect(isClear(x, z, R, list)).toBe(out.x === x && out.z === z);
    }
  });
});
