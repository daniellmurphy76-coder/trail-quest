import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assets } from '../../src/engine/assets';
import { createBaseCamp } from '../../src/world/base-camp';
import { isClear, PLAYER_RADIUS, TREE_TRUNK_RADIUS } from '../../src/world/collide';
import { horizonStats } from '../../src/world/horizon';
import { personPlaceholder } from '../../src/world/props';
import { findInteractableInRange } from '../../src/world/zone';
import { critterDrawCalls, fireflyPositions, runZone, wingBodies } from '../world/critter-helpers';

/** Draw calls for single-material meshes: one per visible Mesh or InstancedMesh. */
function countDrawCalls(root: THREE.Object3D): number {
  let n = 0;
  root.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh) n++;
  });
  return n;
}

describe('Base Camp zone', () => {
  const onTalk = vi.fn();
  const zone = createBaseCamp({ onTalkToDenChief: onTalk });

  it('matches the zone contract', () => {
    expect(zone.id).toBe('base-camp');
    expect(zone.bounds).toEqual({ minX: -25, maxX: 25, minZ: -25, maxZ: 25 });
    expect(Math.abs(zone.spawn.x)).toBeLessThanOrEqual(25);
    expect(Math.abs(zone.spawn.z)).toBeLessThanOrEqual(25);
  });

  it('has the Den Chief as a Talk interactable with radius 2', () => {
    expect(zone.interactables).toHaveLength(1);
    const chief = zone.interactables[0]!;
    expect(chief.nameTag).toBe('Den Chief');
    expect(chief.label).toBe('Talk');
    expect(chief.radius).toBe(2);
    chief.onInteract();
    expect(onTalk).toHaveBeenCalledOnce();
  });

  it('finds the Den Chief only when the player is within the radius', () => {
    const chief = zone.interactables[0]!;
    const { x, z } = chief.position;
    expect(findInteractableInRange(x + 1.9, z, zone.interactables)).toBe(chief);
    expect(findInteractableInRange(x + 2.1, z, zone.interactables)).toBeNull();
    expect(findInteractableInRange(zone.spawn.x, zone.spawn.z, zone.interactables)).toBeNull();
  });

  it('places the same trees every load (seeded)', () => {
    const matrices = (): number[] => {
      const z = createBaseCamp({ onTalkToDenChief: () => {} });
      const trees = z.root.getObjectByName('trees')!.children[0] as THREE.InstancedMesh;
      return Array.from(trees.instanceMatrix.array);
    };
    expect(matrices()).toEqual(matrices());
  });

  it('puts about 40 trees outside the walkable square', () => {
    const trees = zone.root.getObjectByName('trees')!.children[0] as THREE.InstancedMesh;
    expect(trees.count).toBeGreaterThanOrEqual(36);
    expect(trees.count).toBeLessThanOrEqual(44);
    const m = new THREE.Matrix4();
    for (let i = 0; i < trees.count; i++) {
      trees.getMatrixAt(i, m);
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      expect(Math.max(Math.abs(p.x), Math.abs(p.z))).toBeGreaterThan(25);
    }
  });

  it('blocks the player at the trees, rocks, fire, flagpole and cabin, but never at the spawn or the Den Chief', () => {
    const colliders = zone.colliders!;
    expect(colliders.length).toBeGreaterThanOrEqual(40);
    expect(isClear(zone.spawn.x, zone.spawn.z, PLAYER_RADIUS, colliders)).toBe(true);
    const chief = zone.interactables[0]!;
    expect(isClear(chief.position.x, chief.position.z, PLAYER_RADIUS, colliders)).toBe(true);
    expect(isClear(0, 0, PLAYER_RADIUS, colliders)).toBe(false); // the fire
    expect(isClear(-8, -8, PLAYER_RADIUS, colliders)).toBe(false); // the flagpole
    expect(isClear(-17, -12, PLAYER_RADIUS, colliders)).toBe(false); // the cabin
    expect(isClear(10, 7, PLAYER_RADIUS, colliders)).toBe(false); // a rock
  });

  it('stays well inside the draw-call budget with the player in it (limit 40)', () => {
    const scene = new THREE.Scene();
    scene.add(zone.root);
    scene.add(personPlaceholder(0xf2c14e, 1.95)); // the player
    expect(countDrawCalls(scene)).toBeLessThan(40);
  });

  it('animates the campfire without throwing', () => {
    for (let i = 0; i < 120; i++) zone.update(1 / 60);
  });

  it('adds 3 draw calls of ambient life: 8 butterflies (1), 4 birds (1) and 14 fireflies at the fire (1)', () => {
    expect(critterDrawCalls(zone.root.getObjectByName('butterflies')!)).toBe(1);
    expect(critterDrawCalls(zone.root.getObjectByName('birds')!)).toBe(1);
    expect(critterDrawCalls(zone.root.getObjectByName('fireflies')!)).toBe(1);
    expect(wingBodies(zone.root, 'butterfly-wings')).toHaveLength(8);
    expect(wingBodies(zone.root, 'bird-wings')).toHaveLength(4);
    expect(fireflyPositions(zone.root)).toHaveLength(14);
    const scene = new THREE.Scene();
    scene.add(zone.root);
    scene.add(personPlaceholder(0xf2c14e, 1.95)); // the player
    expect(critterDrawCalls(scene)).toBeLessThan(40); // meshes and points together
  });

  it('keeps the fireflies within 3 units of the campfire, low, and the birds high over the camp, for a long run', () => {
    const z = createBaseCamp({ onTalkToDenChief: () => {} });
    const violations: string[] = [];
    const check = (): void => {
      for (const p of fireflyPositions(z.root)) {
        if (Math.hypot(p.x, p.z) > 3 + 1e-6 || p.y < 0.5 - 1e-6 || p.y > 2.4 + 1e-6) violations.push(`firefly at ${p.x}, ${p.y}, ${p.z}`);
      }
      for (const p of wingBodies(z.root, 'bird-wings')) {
        if (p.y <= 15 || Math.hypot(p.x, p.z) > 120 + 1e-6) violations.push(`bird at ${p.x}, ${p.y}, ${p.z}`);
      }
    };
    check();
    expect(() => runZone(z, 1800, check)).not.toThrow(); // half a minute at 60 Hz, checked every half second
    expect(violations).toEqual([]);
  });

  it('keeps the butterflies inside the walkable square and out of the campfire and the Den Chief, for a long flight', () => {
    const z = createBaseCamp({ onTalkToDenChief: () => {} });
    const chief = z.interactables[0]!.position;
    const violations: string[] = [];
    const check = (): void => {
      for (const p of wingBodies(z.root, 'butterfly-wings')) {
        if (Math.max(Math.abs(p.x), Math.abs(p.z)) > 25) violations.push(`outside the square at ${p.x}, ${p.z}`);
        if (p.y < 0.3 || p.y > 2) violations.push(`height ${p.y}`);
        if (Math.hypot(p.x, p.z) < 2) violations.push('in the campfire');
        if (Math.hypot(p.x - chief.x, p.z - chief.z) < 1.5) violations.push('on the Den Chief');
        if (Math.hypot(p.x + 8, p.z + 8) < 1.2) violations.push('on the flagpole');
        if (Math.hypot(p.x + 17, p.z + 12) < 5.5) violations.push('in the cabin');
      }
    };
    check();
    runZone(z, 1800, check); // half a minute at 60 Hz, checked every half second
    expect(violations).toEqual([]);
  });

  it('flies the same way every time (seeded)', () => {
    const a = createBaseCamp({ onTalkToDenChief: () => {} });
    const b = createBaseCamp({ onTalkToDenChief: () => {} });
    runZone(a, 300);
    runZone(b, 300);
    for (const name of ['butterfly-wings', 'bird-wings'] as const) {
      expect(wingBodies(a.root, name).map((p) => p.toArray())).toEqual(wingBodies(b.root, name).map((p) => p.toArray()));
    }
    expect(fireflyPositions(a.root).map((p) => p.toArray())).toEqual(fireflyPositions(b.root).map((p) => p.toArray()));
  });

  it('has a horizon (3 draw calls): hills, a distant tree line and far mountains, all outside the 50 by 50 square', () => {
    const horizon = zone.root.getObjectByName('horizon')!;
    expect(horizon.children.map((c) => c.name).sort()).toEqual(['horizon-hills', 'horizon-peaks', 'horizon-trees']);
    expect(horizonStats(horizon).drawCalls).toBe(3);
  });

  it('keeps the walkable square flat (within the 3 cm ripple) while the ground rolls up beyond the trees', () => {
    const pos = (zone.root.getObjectByName('ground') as THREE.Mesh).geometry.getAttribute('position');
    let beyond = 0;
    for (let i = 0; i < pos.count; i++) {
      const edge = Math.max(Math.abs(pos.getX(i)), Math.abs(pos.getZ(i)));
      if (edge <= 25) expect(Math.abs(pos.getY(i))).toBeLessThanOrEqual(0.031);
      else if (pos.getY(i) > 0.05) beyond++;
    }
    expect(beyond).toBeGreaterThan(20);
  });
});

describe('Base Camp zone, models loaded', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('puts white birches in the tree mix with the pines, rounds and oaks', async () => {
    vi.spyOn(assets, 'load').mockResolvedValue(undefined);
    vi.spyOn(assets, 'has').mockReturnValue(true);
    vi.spyOn(assets, 'instance').mockImplementation((id) => {
      const group = new THREE.Group();
      group.name = id;
      group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial()));
      return group;
    });
    vi.spyOn(assets, 'instanced').mockImplementation((id, count) => {
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), count);
      mesh.name = id;
      return mesh;
    });
    const camp = createBaseCamp({ onTalkToDenChief: () => {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const trees = camp.root.getObjectByName('trees')!;
    expect(trees.children.map((c) => c.name).sort()).toEqual(['tree.birch', 'tree.oak', 'tree.pine', 'tree.pine.tall', 'tree.round']);
    const count = trees.children.reduce((n, c) => n + (c as THREE.InstancedMesh).count, 0);
    expect(count).toBe(camp.colliders!.filter((c) => c.kind === 'circle' && c.r === TREE_TRUNK_RADIUS).length); // one trunk collider each
  });
});
