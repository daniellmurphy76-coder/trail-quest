import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { InputState } from '../../src/engine/input';
import { Player, PLAYER_SPEED } from '../../src/player/controller';
import { squareBounds } from '../../src/world/bounds';
import { boxCollider, circleCollider, isClear, PLAYER_RADIUS, type Collider } from '../../src/world/collide';
import { createNatureTrail, natureTrailLayout } from '../../src/world/nature-trail';
import type { Zone } from '../../src/world/zone';

const DT = 1 / 60;
const still: InputState = { move: { x: 0, z: 0 }, action: false, actionPressed: false };
const push = (x: number, z: number): InputState => ({ move: { x, z }, action: false, actionPressed: false });

/** A zone with a square of 25 and the given colliders. With viewYaw = PI, stick (x, z) walks the ground along (x, z). */
function zoneWith(colliders: Collider[] | undefined, half = 25): Pick<Zone, 'bounds' | 'colliders'> {
  return colliders ? { bounds: squareBounds(half), colliders } : { bounds: squareBounds(half) };
}

function playerAt(x: number, z: number): Player {
  const player = new Player();
  player.viewYaw = Math.PI;
  player.setPosition(new THREE.Vector3(x, 0, z), Math.PI);
  return player;
}

/** Run `seconds` of fixed steps with the stick held, calling `each` after every step. */
function walk(
  player: Player,
  input: InputState,
  zone: Pick<Zone, 'bounds' | 'colliders'>,
  seconds: number,
  each: (p: Player) => void = () => {},
): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    player.update(DT, input, zone);
    each(player);
  }
}

describe('Player and colliders', () => {
  it('walks exactly as before in a zone with no colliders, or with colliders far away', () => {
    const run = (colliders: Collider[] | undefined): number[] => {
      const player = playerAt(0, 0);
      walk(player, push(0.6, -0.8), zoneWith(colliders), 2);
      return [player.position.x, player.position.z, player.facing];
    };
    const bare = run(undefined);
    expect(run([])).toEqual(bare);
    expect(run([circleCollider(20, 20, 0.5), boxCollider(-20, -20, 2, 2)])).toEqual(bare);
    expect(Math.hypot(bare[0]!, bare[1]!)).toBeCloseTo(PLAYER_SPEED * 2, 5); // full speed, one unit of stick
  });

  it('cannot enter a box: walking straight at a wall stops at its face, one body-radius off', () => {
    const wall = boxCollider(0, -5, 6, 1); // face at z = -4
    const zone = zoneWith([wall]);
    const player = playerAt(0, 0);
    walk(player, push(0, -1), zone, 3, (p) => {
      expect(isClear(p.position.x, p.position.z, PLAYER_RADIUS - 1e-3, [wall])).toBe(true);
    });
    expect(player.position.z).toBeCloseTo(-4 + PLAYER_RADIUS, 3);
    expect(player.position.x).toBeCloseTo(0, 5);
    expect(player.isMoving).toBe(true); // still pushing, so still walking in place
  });

  it('cannot enter a turned box either, from any side', () => {
    const house = boxCollider(2, -2, 3, 2, 0.7);
    const zone = zoneWith([house]);
    for (const [sx, sz, dx, dz] of [
      [-8, -2, 1, 0],
      [12, -2, -1, 0],
      [2, 8, 0, -1],
      [2, -12, 0, 1],
      [-6, 6, 0.7, -0.7],
      [9, -9, -0.7, 0.7],
    ] as const) {
      const player = playerAt(sx, sz);
      walk(player, push(dx, dz), zone, 5, (p) => {
        expect(isClear(p.position.x, p.position.z, PLAYER_RADIUS - 1e-3, [house])).toBe(true);
      });
    }
  });

  it('glides along a wall instead of sticking: the part of the walk along it is kept at full speed', () => {
    const wall = boxCollider(0, -5, 30, 1); // runs along x, face at z = -4
    const zone = zoneWith([wall], 30);
    const player = playerAt(0, 0);
    const s = Math.SQRT1_2;
    const xAt: number[] = [];
    walk(player, push(s, -s), zone, 3, (p) => xAt.push(p.position.x));
    // Never slower along x than the stick says, before or after meeting the wall.
    const along = PLAYER_SPEED * s;
    expect(player.position.x).toBeCloseTo(along * 3, 1);
    expect(player.position.z).toBeCloseTo(-4 + PLAYER_RADIUS, 3);
    // And evenly: the last second moves as far along x as the first.
    const per = (a: number, b: number): number => xAt[b]! - xAt[a]!;
    expect(per(120, 179)).toBeCloseTo(per(0, 59), 1);
  });

  it('slides along a turned wall too, and ends up past its end', () => {
    const wall = boxCollider(0, 0, 4, 0.3, 0.5); // 8 long, turned about 29 degrees
    const zone = zoneWith([wall]);
    const player = playerAt(-3, 3);
    walk(player, push(0.3, -0.95), zone, 8);
    expect(isClear(player.position.x, player.position.z, PLAYER_RADIUS - 1e-3, [wall])).toBe(true);
    expect(player.position.z).toBeLessThan(-1); // got to the far side
  });

  it('goes around a trunk when it meets it off-center, and sticks only when it walks dead at the middle', () => {
    const trunk = circleCollider(0, -3, 0.45);
    const zone = zoneWith([trunk]);

    const off = playerAt(0.25, 0);
    walk(off, push(0, -1), zone, 4);
    expect(off.position.z).toBeLessThan(-4.5); // past it
    expect(isClear(off.position.x, off.position.z, PLAYER_RADIUS - 1e-3, [trunk])).toBe(true);

    const centered = playerAt(0, 0);
    walk(centered, push(0, -1), zone, 4);
    expect(centered.position.z).toBeCloseTo(-3 + PLAYER_RADIUS + 0.45, 3); // stopped at the trunk
  });

  it('never tunnels through a thin fence, even on one very long step', () => {
    const fence = boxCollider(0, -3, 6, 0.15);
    const zone = zoneWith([fence]);
    const player = playerAt(0.5, 0);
    for (let i = 0; i < 6; i++) player.update(0.5, push(0, -1), zone); // 2 units per step
    expect(player.position.z).toBeGreaterThan(-3 + 0.15);
    expect(isClear(player.position.x, player.position.z, PLAYER_RADIUS - 1e-3, [fence])).toBe(true);
  });

  it('still keeps the player inside the zone bounds when a prop pushes them outward', () => {
    const half = 5;
    const trunk = circleCollider(4.9, 0, 0.45);
    const zone = zoneWith([trunk], half);
    const player = playerAt(4.95, 0.1); // east of the trunk, so its push goes east, out of bounds
    walk(player, push(1, 0), zone, 1);
    expect(player.position.x).toBeLessThanOrEqual(half);
    expect(player.position.x).toBeGreaterThanOrEqual(-half);
    expect(Math.abs(player.position.z)).toBeLessThanOrEqual(half);
  });

  it('nudges a standing Scout out of a prop that appears on top of them (a model swapping in)', () => {
    const colliders: Collider[] = [];
    const zone = zoneWith(colliders);
    const player = playerAt(3, 3);
    walk(player, still, zone, 0.5);
    expect(player.position.x).toBe(3); // nothing there: nothing moves
    colliders.push(boxCollider(3, 3, 1, 1));
    player.update(DT, still, zone);
    expect(isClear(player.position.x, player.position.z, PLAYER_RADIUS, colliders)).toBe(true);
    expect(player.isMoving).toBe(false);
  });

  it('leaves a standing Scout who is clear exactly where they are', () => {
    const player = playerAt(1, 1);
    walk(player, still, zoneWith([boxCollider(5, 5, 1, 1)]), 1);
    expect(player.position.toArray()).toEqual([1, 0, 1]);
  });
});

describe('Player in the real Nature Trail', () => {
  const deps = { onTalkToDenChief: vi.fn<() => void>(), onReturnToBaseCamp: vi.fn<() => void>() };
  const zone = createNatureTrail(deps);
  const bridge = zone.landmarks!.footbridge!;

  it('crosses the stream on the bridge', () => {
    const player = playerAt(bridge.x, bridge.z + 3); // on the path, just south of the bridge
    walk(player, push(0, -1), zone, 1.5);
    expect(player.position.z).toBeLessThan(bridge.z - 2.5); // all the way over
    expect(Math.abs(player.position.x - bridge.x)).toBeLessThan(0.1);
  });

  it('cannot wade the stream anywhere else: it stops at the bank, on its own side, at every point along it', () => {
    const { stream, streamHalf } = natureTrailLayout();
    for (const x of [-14, -9, -6, -3.5, 3.5, 6, 9, 14]) {
      const zc = stream.pointAt(stream.nearest(x, -1.5).s).z;
      const south = playerAt(x, zc + 6);
      walk(south, push(0, -1), zone, 4);
      const north = playerAt(x, zc - 6);
      walk(north, push(0, 1), zone, 4);
      for (const [side, p] of [
        ['south', south],
        ['north', north],
      ] as const) {
        const near = stream.nearest(p.position.x, p.position.z);
        expect(near.dist, `${side} bank at x=${x}`).toBeGreaterThan(streamHalf + PLAYER_RADIUS - 0.1);
      }
      expect(south.position.z, `south bank at x=${x}`).toBeGreaterThan(zc);
      expect(north.position.z, `north bank at x=${x}`).toBeLessThan(zc);
    }
  });

  it('starts the walk in the clear: the spawn needs no push', () => {
    const player = playerAt(zone.spawn.x, zone.spawn.z);
    walk(player, still, zone, 0.5);
    expect(player.position.x).toBe(zone.spawn.x);
    expect(player.position.z).toBe(zone.spawn.z);
  });
});
