import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assets } from '../../src/engine/assets';
import { createCampfireCircle } from '../../src/world/campfire-circle';
import { findInteractableInRange } from '../../src/world/zone';
import type { ZoneDeps } from '../../src/world/zones';

function makeDeps() {
  const deps = { onTalkToDenChief: vi.fn<() => void>(), onReturnToBaseCamp: vi.fn<() => void>() };
  return deps satisfies ZoneDeps;
}

/** One draw call per visible mesh, instanced mesh, point cloud, or sprite (all single-material here). */
function countDrawCalls(root: THREE.Object3D): number {
  let n = 0;
  root.traverseVisible((o) => {
    const x = o as THREE.Mesh & THREE.Points & THREE.Sprite;
    if (x.isMesh || x.isPoints || x.isSprite) n++;
  });
  return n;
}

/** The ground position of every instance of the InstancedMesh called `name`. */
function instancePositions(root: THREE.Object3D, name: string): THREE.Vector3[] {
  const mesh = root.getObjectByName(name) as THREE.InstancedMesh | undefined;
  expect(mesh, `zone should have an instanced mesh named "${name}"`).toBeDefined();
  const m = new THREE.Matrix4();
  return Array.from({ length: mesh!.count }, (_, i) => {
    mesh!.getMatrixAt(i, m);
    return new THREE.Vector3().setFromMatrixPosition(m);
  });
}

function ground(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

describe('Campfire Circle zone (placeholder art)', () => {
  const deps = makeDeps();
  const zone = createCampfireCircle(deps);
  const { bounds, spawn } = zone;
  const inside = (p: THREE.Vector3): boolean =>
    p.x >= bounds.minX && p.x <= bounds.maxX && p.z >= bounds.minZ && p.z <= bounds.maxZ;
  const spots = zone.openSpots!;
  const sign = zone.interactables[0]!;

  it('builds a zone with its own id, a scene root, and about 36 by 36 bounds', () => {
    expect(zone.id).toBe('campfire-circle');
    expect(zone.root).toBeInstanceOf(THREE.Group);
    expect(zone.root.children.length).toBeGreaterThan(0);
    expect(bounds.maxX - bounds.minX).toBeGreaterThanOrEqual(34);
    expect(bounds.maxX - bounds.minX).toBeLessThanOrEqual(36);
    expect(bounds.maxZ - bounds.minZ).toBeGreaterThanOrEqual(34);
    expect(bounds.maxZ - bounds.minZ).toBeLessThanOrEqual(36);
    expect(zone.landmarks).toEqual({});
  });

  it('spawns inside the bounds near the +z edge', () => {
    expect(inside(spawn)).toBe(true);
    expect(spawn.y).toBe(0);
    expect(spawn.z).toBeGreaterThan(bounds.maxZ - 4);
  });

  it('has 10 to 14 open spots, all inside the bounds', () => {
    expect(spots.length).toBeGreaterThanOrEqual(10);
    expect(spots.length).toBeLessThanOrEqual(14);
    for (const spot of spots) expect(inside(spot)).toBe(true);
  });

  it('keeps the open spots at least 2 apart and clear of the spawn, the sign, and the campfire', () => {
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) expect(ground(spots[i]!, spots[j]!)).toBeGreaterThanOrEqual(2);
    }
    for (const spot of spots) {
      expect(ground(spot, spawn)).toBeGreaterThanOrEqual(3);
      expect(ground(spot, sign.position)).toBeGreaterThanOrEqual(3);
      expect(ground(spot, { x: 0, z: 0 })).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('keeps the open spots clear of the benches, stumps, lanterns, rocks, woodpile, and gateway posts', () => {
    const props = [
      ...instancePositions(zone.root, 'benches'),
      ...instancePositions(zone.root, 'stumps'),
      ...instancePositions(zone.root, 'lanterns'),
      ...instancePositions(zone.root, 'reading-rock'),
      ...instancePositions(zone.root, 'woodpile'),
      new THREE.Vector3(-2.2, 0, 12.2),
      new THREE.Vector3(2.2, 0, 12.2),
    ];
    for (const spot of spots) {
      for (const p of props) expect(ground(spot, p)).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('places the same spots and the same trees every load (seeded)', () => {
    const again = createCampfireCircle(makeDeps());
    expect(again.openSpots!.map((s) => [s.x, s.z])).toEqual(spots.map((s) => [s.x, s.z]));
    expect(instancePositions(again.root, 'lanterns').map((p) => p.toArray())).toEqual(
      instancePositions(zone.root, 'lanterns').map((p) => p.toArray()),
    );
  });

  it('has a "Back to camp" trail sign near the spawn that calls onReturnToBaseCamp', () => {
    expect(zone.interactables).toHaveLength(1);
    expect(sign.id).toBe('trail-sign');
    expect(sign.label).toBe('Back to camp');
    expect(sign.nameTag).toBe('Trail sign');
    expect(sign.radius).toBe(2);
    expect(ground(sign.position, spawn)).toBeLessThanOrEqual(6);
    expect(findInteractableInRange(spawn.x, spawn.z, zone.interactables)).toBeNull(); // a step or two away
    expect(findInteractableInRange(sign.position.x, sign.position.z, zone.interactables)).toBe(sign);
    sign.onInteract();
    expect(deps.onReturnToBaseCamp).toHaveBeenCalledOnce();
    expect(deps.onTalkToDenChief).not.toHaveBeenCalled();
  });

  it('has the campfire at the center, ringed by eight benches facing in, with a few stumps', () => {
    const fire = zone.root.getObjectByName('campfire')!;
    expect(fire.position.toArray()).toEqual([0, 0, 0]);
    const benches = instancePositions(zone.root, 'benches');
    expect(benches).toHaveLength(8);
    for (const b of benches) expect(Math.hypot(b.x, b.z)).toBeCloseTo(4.4, 5);
    const stumps = instancePositions(zone.root, 'stumps');
    expect(stumps.length).toBeGreaterThanOrEqual(3);
    for (const s of stumps) expect(Math.hypot(s.x, s.z)).toBeGreaterThan(4.4);
  });

  it('keeps the way from the spawn to the campfire clear: no bench, grove tree, or open spot in the lane', () => {
    const lane = 1.5; // half-width either side of x = 0, between the gateway and the fire
    for (const p of [...instancePositions(zone.root, 'benches'), ...spots]) {
      if (p.z > 0) expect(Math.abs(p.x)).toBeGreaterThanOrEqual(lane);
    }
    const trunks = zone.root.getObjectByName('trees')!.children[0] as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    for (let i = 0; i < trunks.count; i++) {
      trunks.getMatrixAt(i, m);
      const t = new THREE.Vector3().setFromMatrixPosition(m);
      // The wall outside the bounds is fine anywhere; the grove ring leaves the entrance open.
      if (inside(t) && t.z > 0) expect(Math.abs(t.x), `tree ${i} stands in the entrance`).toBeGreaterThanOrEqual(4);
    }
  });

  it('rings the walkable square with trees just outside it, and the grove with more inside', () => {
    const trunks = zone.root.getObjectByName('trees')!.children[0] as THREE.InstancedMesh;
    expect(trunks.count).toBeGreaterThanOrEqual(60);
    const m = new THREE.Matrix4();
    let outside = 0;
    for (let i = 0; i < trunks.count; i++) {
      trunks.getMatrixAt(i, m);
      const t = new THREE.Vector3().setFromMatrixPosition(m);
      if (!inside(t)) outside++;
    }
    expect(outside).toBeGreaterThanOrEqual(50);
    expect(trunks.count - outside).toBeGreaterThanOrEqual(15);
  });

  it('has a gateway, flanking and ring lanterns with glowing globes, and a woodpile', () => {
    expect(zone.root.getObjectByName('gateway')).toBeDefined();
    const lanterns = instancePositions(zone.root, 'lanterns');
    expect(lanterns.length).toBeGreaterThanOrEqual(6);
    const globes = zone.root.getObjectByName('lantern-globes') as THREE.InstancedMesh;
    expect(globes.count).toBe(lanterns.length);
    expect((globes.material as THREE.MeshLambertMaterial).emissiveIntensity).toBeGreaterThan(0);
    expect(zone.root.getObjectByName('woodpile')).toBeDefined();
  });

  it('adds no lights beyond the campfire point light', () => {
    const lights: THREE.Object3D[] = [];
    zone.root.traverse((o) => {
      if ((o as THREE.Light).isLight) lights.push(o);
    });
    expect(lights).toHaveLength(1);
    expect((lights[0] as THREE.PointLight).isPointLight).toBe(true);
  });

  it('stays well inside the draw-call budget with placeholder art (cap 24; about 20 today)', () => {
    expect(countDrawCalls(zone.root)).toBeLessThanOrEqual(24);
  });

  it('animates the campfire and the fireflies without throwing, and the fireflies stay in the grove', () => {
    const flies = zone.root.getObjectByName('fireflies') as THREE.Points;
    expect(flies).toBeDefined();
    const position = flies.geometry.getAttribute('position');
    expect(position.count).toBeGreaterThanOrEqual(6);
    expect(position.count).toBeLessThanOrEqual(10);
    const before = Array.from(position.array);
    for (let i = 0; i < 600; i++) zone.update(1 / 60);
    const after = Array.from(position.array);
    expect(after).not.toEqual(before); // they drift
    for (let i = 0; i < position.count; i++) {
      expect(Math.abs(position.getX(i))).toBeLessThanOrEqual(bounds.maxX);
      expect(Math.abs(position.getZ(i))).toBeLessThanOrEqual(bounds.maxZ);
      expect(position.getY(i)).toBeGreaterThan(0.2);
      expect(position.getY(i)).toBeLessThan(4);
    }
    for (const v of after) expect(Number.isFinite(v)).toBe(true);
    const colors = flies.geometry.getAttribute('color');
    for (const v of Array.from(colors.array)) expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe('Campfire Circle zone after the models load (simulated)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Stand-ins for the GLB models: every id is a single static mesh, except the two-mesh campfire. */
  function fakeModels(): void {
    vi.spyOn(assets, 'load').mockResolvedValue(undefined);
    vi.spyOn(assets, 'has').mockReturnValue(true);
    vi.spyOn(assets, 'instanced').mockImplementation((id, count) => {
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), count);
      mesh.name = id;
      return mesh;
    });
    vi.spyOn(assets, 'instance').mockImplementation((id) => {
      const group = new THREE.Group();
      group.name = id;
      const meshes = id === 'campfire' ? 2 : 1;
      for (let i = 0; i < meshes; i++) group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
      return group;
    });
  }

  it('swaps every primitive for its model and stays under 80 draw calls', async () => {
    fakeModels();
    const zone = createCampfireCircle(makeDeps());
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const gone of ['benches', 'gateway', 'stumps', 'lanterns', 'reading-rock', 'woodpile', 'trail-sign']) {
      expect(zone.root.getObjectByName(gone), `${gone} primitive should be gone`).toBeUndefined();
    }
    expect(zone.root.getObjectByName('logs')).toBeDefined(); // benches and gateway share one mesh
    for (const id of ['tree.fall', 'tree.oak', 'tree.pine.tall', 'stump', 'signpost.single', 'rock.flat', 'log.stack', 'signpost']) {
      expect(zone.root.getObjectByName(id), `${id} model should be in the zone`).toBeDefined();
    }
    const calls = countDrawCalls(zone.root);
    expect(calls).toBeLessThan(80);
    expect(() => zone.update(1 / 60)).not.toThrow();
  });

  it('stands the two gateway posts on end and lays the crossbeam across them', async () => {
    fakeModels();
    const zone = createCampfireCircle(makeDeps());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const logs = zone.root.getObjectByName('logs') as THREE.InstancedMesh;
    expect(logs.count).toBe(11); // eight benches and three gateway logs
    const m = new THREE.Matrix4();
    const lengthAxis = (i: number): THREE.Vector3 => {
      logs.getMatrixAt(i, m);
      return new THREE.Vector3(0, 0, 1).transformDirection(m); // a log lies along its local z
    };
    for (const i of [8, 9]) {
      const axis = lengthAxis(i);
      expect(axis.y).toBeCloseTo(1, 5); // upright
    }
    const beam = lengthAxis(10);
    expect(Math.abs(beam.x)).toBeCloseTo(1, 5); // across the way in
    expect(beam.y).toBeCloseTo(0, 5);
    // The beam rests on top of the posts and spans them.
    logs.getMatrixAt(10, m);
    const beamPos = new THREE.Vector3().setFromMatrixPosition(m);
    expect(beamPos.y).toBeGreaterThan(2.8);
    logs.getMatrixAt(8, m);
    const postA = new THREE.Vector3().setFromMatrixPosition(m);
    logs.getMatrixAt(9, m);
    const postB = new THREE.Vector3().setFromMatrixPosition(m);
    expect(Math.abs(postA.x - postB.x)).toBeGreaterThan(3.5);
    expect(postA.z).toBeCloseTo(postB.z, 5);
  });
});
