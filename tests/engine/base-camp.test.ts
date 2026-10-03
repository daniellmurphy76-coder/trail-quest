import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createBaseCamp } from '../../src/world/base-camp';
import { isClear, PLAYER_RADIUS } from '../../src/world/collide';
import { personPlaceholder } from '../../src/world/props';
import { findInteractableInRange } from '../../src/world/zone';

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
});
