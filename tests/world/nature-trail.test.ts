import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assets, type ModelAnimator } from '../../src/engine/assets';
import { createNatureTrail, natureTrailLayout, NATURE_TRAIL_HALF } from '../../src/world/nature-trail';
import { findInteractableInRange } from '../../src/world/zone';
import type { ZoneDeps } from '../../src/world/zones';

function makeDeps() {
  const deps = { onTalkToDenChief: vi.fn<() => void>(), onReturnToBaseCamp: vi.fn<() => void>() };
  return deps satisfies ZoneDeps;
}

/** Draw calls: one per visible mesh (instanced or not), sprite, or point cloud. */
function countDrawCalls(root: THREE.Object3D): number {
  let n = 0;
  root.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh || (o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints) n++;
  });
  return n;
}

/** Placeholder art, plus 4 landmark labels in a browser. The 90 draw call budget leaves room for the model swap. */
const PLACEHOLDER_DRAW_CAP = 30;
/** After the swap (fake models, one mesh each, two for the rabbit and the campfire), with the player and sky on top. */
const SWAPPED_DRAW_CAP = 60;

const deps = makeDeps();
const zone = createNatureTrail(deps);
const { bounds, spawn } = zone;
const inside = (p: THREE.Vector3): boolean =>
  p.x >= bounds.minX && p.x <= bounds.maxX && p.z >= bounds.minZ && p.z <= bounds.maxZ;
const landmarks = zone.landmarks!;
const layout = natureTrailLayout();

describe('Nature Trail zone', () => {
  it('builds a zone with its own id and a scene root, and update(dt) runs', () => {
    expect(zone.id).toBe('nature-trail');
    expect(zone.root).toBeInstanceOf(THREE.Group);
    expect(zone.root.children.length).toBeGreaterThan(0);
    expect(() => {
      for (let i = 0; i < 120; i++) zone.update(1 / 60);
    }).not.toThrow();
  });

  it('is about 35 across with the spawn near the +z edge, on the trail, facing the zone', () => {
    expect(bounds.maxX - bounds.minX).toBeGreaterThanOrEqual(34);
    expect(bounds.maxX - bounds.minX).toBeLessThanOrEqual(35); // the shared zone test caps a zone at 35
    expect(NATURE_TRAIL_HALF).toBe(bounds.maxX);
    expect(inside(spawn)).toBe(true);
    expect(spawn.y).toBe(0);
    expect(spawn.z).toBeGreaterThan(bounds.maxZ - 6);
    expect(Math.abs(spawn.x)).toBeLessThan(1); // facing the zone center means looking toward -z
    expect(layout.path.nearest(spawn.x, spawn.z).dist).toBeLessThan(layout.pathHalf);
  });

  it('has 10 to 14 open spots, inside the bounds and at least 2 units apart', () => {
    const spots = zone.openSpots!;
    expect(spots.length).toBeGreaterThanOrEqual(10);
    expect(spots.length).toBeLessThanOrEqual(14);
    for (const spot of spots) {
      expect(inside(spot)).toBe(true);
      expect(spot.y).toBe(0);
    }
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        expect(Math.hypot(spots[i]!.x - spots[j]!.x, spots[i]!.z - spots[j]!.z)).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('keeps open spots at least 3 from every landmark, the Trail sign and the spawn (1.5 is the floor)', () => {
    const sign = zone.interactables.find((i) => i.id === 'trail-sign')!;
    const blockers = [spawn, sign.position, ...Object.values(landmarks)];
    for (const spot of zone.openSpots!) {
      for (const b of blockers) expect(Math.hypot(spot.x - b.x, spot.z - b.z)).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps open spots off the stream, every prop and the decorative animals, and beside the path', () => {
    const animals = ['animal.rabbit', 'animal.frog', 'animal.bird'].map((name) => zone.root.getObjectByName(name)!);
    for (const animal of animals) expect(animal).toBeDefined();
    for (const spot of zone.openSpots!) {
      expect(layout.stream.nearest(spot.x, spot.z).dist).toBeGreaterThan(layout.streamHalf + 0.5);
      for (const c of layout.blockers) expect(Math.hypot(spot.x - c.x, spot.z - c.z)).toBeGreaterThan(c.r + 0.5);
      for (const a of animals) expect(Math.hypot(spot.x - a.position.x, spot.z - a.position.z)).toBeGreaterThan(2);
      expect(layout.path.nearest(spot.x, spot.z).dist).toBeLessThan(3.5); // along and beside the path
    }
    // Spread over the whole trail: some in the south, some past the bridge, some by the camp.
    expect(zone.openSpots!.some((s) => s.z > 5)).toBe(true);
    expect(zone.openSpots!.some((s) => s.z < -9)).toBe(true);
  });

  it('has the four landmarks, inside the bounds, each with a named group at its place', () => {
    expect(Object.keys(landmarks).sort()).toEqual(['campsite', 'footbridge', 'lookout', 'trailhead']);
    for (const [id, point] of Object.entries(landmarks)) {
      expect(inside(point)).toBe(true);
      const group = zone.root.getObjectByName(`landmark:${id}`);
      expect(group, `group for ${id}`).toBeDefined();
      expect(group!.position.x).toBeCloseTo(point.x);
      expect(group!.position.z).toBeCloseTo(point.z);
    }
  });

  it('lays the landmarks along the path in the order of the walk', () => {
    const along = (p: THREE.Vector3): number => layout.path.nearest(p.x, p.z).s;
    const order = [landmarks.trailhead!, landmarks.footbridge!, landmarks.lookout!, landmarks.campsite!].map(along);
    for (let i = 1; i < order.length; i++) expect(order[i]!).toBeGreaterThan(order[i - 1]!);
    // Standing on the path at each one is within the navigate reach (2 units).
    for (const p of Object.values(landmarks)) expect(layout.path.nearest(p.x, p.z).dist).toBeLessThanOrEqual(2);
    // Walking the trail from the spawn reaches the first waypoint only after a few steps.
    expect(Math.hypot(landmarks.trailhead!.x - spawn.x, landmarks.trailhead!.z - spawn.z)).toBeGreaterThan(4);
  });

  it('carries the path over a 3 unit wide see-through stream that crosses the whole zone, under the bridge', () => {
    const stream = zone.root.getObjectByName('stream') as THREE.Mesh;
    expect(stream).toBeDefined();
    const material = stream.material as THREE.MeshLambertMaterial;
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeLessThan(1);
    expect(layout.streamHalf * 2).toBe(3);
    stream.geometry.computeBoundingBox();
    const box = stream.geometry.boundingBox!;
    expect(box.min.x).toBeLessThanOrEqual(bounds.minX);
    expect(box.max.x).toBeGreaterThanOrEqual(bounds.maxX);

    const bridge = landmarks.footbridge!;
    expect(layout.stream.nearest(bridge.x, bridge.z).dist).toBeLessThan(0.3);
    // The path meets the stream only at the bridge.
    const wet = layout.path.pts.filter((p) => layout.stream.nearest(p.x, p.z).dist < layout.streamHalf);
    expect(wet.length).toBeGreaterThan(0);
    for (const p of wet) expect(Math.hypot(p.x - bridge.x, p.z - bridge.z)).toBeLessThan(2.5);
  });

  it('builds the path and stream surfaces from finite, upward-facing triangles', () => {
    for (const name of ['path', 'stream']) {
      const mesh = zone.root.getObjectByName(name) as THREE.Mesh;
      expect(mesh, name).toBeDefined();
      const position = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.getIndex()!;
      expect(position.count).toBeGreaterThan(100);
      for (const v of position.array) expect(Number.isFinite(v)).toBe(true);
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i);
        const b = index.getX(i + 1);
        const c = index.getX(i + 2);
        const ux = position.getX(b) - position.getX(a);
        const uz = position.getZ(b) - position.getZ(a);
        const vx = position.getX(c) - position.getX(a);
        const vz = position.getZ(c) - position.getZ(a);
        expect(uz * vx - ux * vz).toBeGreaterThanOrEqual(0); // normal points up (+y)
      }
    }
    const stream = (zone.root.getObjectByName('stream') as THREE.Mesh).geometry;
    expect(stream.getAttribute('color').itemSize).toBe(4); // per-vertex alpha for the soft shores
  });

  it('puts a rock cluster at the lookout with a clear flat spot in front', () => {
    const lookout = landmarks.lookout!;
    const near = layout.rocks.filter((r) => Math.hypot(r.x - lookout.x, r.z - lookout.z) < 7);
    expect(near.some((r) => r.kind === 'large')).toBe(true);
    expect(near.some((r) => r.kind === 'tall')).toBe(true);
    expect(near.length).toBeGreaterThanOrEqual(4);
    for (const r of layout.rocks) {
      expect(Math.hypot(r.x - lookout.x, r.z - lookout.z)).toBeGreaterThan(layout.lookoutPad.r + 0.5);
    }
  });

  it('has a camp at the end of the path: a tent, a campfire and firewood close to it', () => {
    const camp = landmarks.campsite!;
    const end = layout.path.pointAt(layout.path.length);
    expect(Math.hypot(camp.x - end.x, camp.z - end.z)).toBeLessThan(0.5);
    for (const p of [layout.tent, layout.fire, layout.firewood]) expect(Math.hypot(p.x - camp.x, p.z - camp.z)).toBeLessThan(6.5);
    expect(zone.root.getObjectByName('campfire')).toBeDefined();
    expect(zone.root.getObjectByName('tent')).toBeDefined();
    expect(zone.root.getObjectByName('firewood')).toBeDefined();
  });

  it('keeps the walking path clear of props', () => {
    const props = [
      ...layout.rocks,
      ...layout.stumps,
      ...layout.trees,
      layout.tent,
      layout.fire,
      layout.firewood,
      ...layout.seats,
      layout.rabbit,
      layout.frog,
      layout.bird,
    ];
    for (const p of props) expect(layout.path.nearest(p.x, p.z).dist).toBeGreaterThan(layout.pathHalf + 0.3);
    // The two signs stand at the edge, not on the walking line.
    expect(layout.path.nearest(layout.trailheadSign.x, layout.trailheadSign.z).dist).toBeGreaterThan(layout.pathHalf);
    expect(layout.path.nearest(layout.backSign.x, layout.backSign.z).dist).toBeGreaterThan(layout.pathHalf);
  });

  it('is ringed by dense trees, with a gap at the entrance behind the spawn and none on the path', () => {
    expect(layout.trees.length).toBeGreaterThanOrEqual(60);
    for (const t of layout.trees) {
      expect(Math.max(Math.abs(t.x), Math.abs(t.z))).toBeGreaterThan(NATURE_TRAIL_HALF - 4.5);
      expect(layout.path.nearest(t.x, t.z).dist).toBeGreaterThan(layout.pathHalf + 1);
      expect(t.z > 8 && Math.abs(t.x) < 8, 'no tree in front of the camera at the entrance').toBe(false);
    }
    const outside = layout.trees.filter((t) => Math.max(Math.abs(t.x), Math.abs(t.z)) > NATURE_TRAIL_HALF);
    expect(outside.length).toBeGreaterThanOrEqual(40);
    const trees = zone.root.getObjectByName('trees');
    expect(trees).toBeDefined();
  });

  it('puts three decorative animals off the path: a rabbit in the grass, a frog by the stream, a bird on a rock', () => {
    const { rabbit, frog, bird } = layout;
    expect(layout.stream.nearest(frog.x, frog.z).dist).toBeLessThan(layout.streamHalf + 1.5);
    expect(layout.stream.nearest(frog.x, frog.z).dist).toBeGreaterThan(layout.streamHalf);
    expect(layout.stream.nearest(rabbit.x, rabbit.z).dist).toBeGreaterThan(4);
    expect(bird.y).toBeGreaterThan(0.3); // up on the rock
    const rock = layout.rocks.find((r) => r.kind === 'large' && Math.hypot(r.x - bird.x, r.z - bird.z) < 0.01);
    expect(rock).toBeDefined();
  });

  it('has a Back to camp trail sign near the spawn that sends the player home', () => {
    const signs = zone.interactables.filter((i) => i.label === 'Back to camp');
    expect(signs).toHaveLength(1);
    expect(zone.interactables).toHaveLength(1);
    const sign = signs[0]!;
    expect(sign.id).toBe('trail-sign');
    expect(sign.nameTag).toBe('Trail sign');
    expect(sign.radius).toBe(2);
    expect(Math.hypot(sign.position.x - spawn.x, sign.position.z - spawn.z)).toBeLessThanOrEqual(6);
    expect(findInteractableInRange(spawn.x, spawn.z, zone.interactables)).toBeNull();
    expect(findInteractableInRange(sign.position.x, sign.position.z, zone.interactables)).toBe(sign);
    sign.onInteract();
    expect(deps.onReturnToBaseCamp).toHaveBeenCalledOnce();
    expect(deps.onTalkToDenChief).not.toHaveBeenCalled();
  });

  it('adds no lights of its own beyond the campfire glow', () => {
    const lights: THREE.Light[] = [];
    zone.root.traverse((o) => {
      if ((o as THREE.Light).isLight) lights.push(o as THREE.Light);
    });
    expect(lights.every((l) => (l as THREE.PointLight).isPointLight)).toBe(true);
    expect(lights).toHaveLength(1);
  });

  it('stays under the draw-call cap with placeholder art, leaving room for the model swap', () => {
    const scene = new THREE.Scene();
    scene.add(zone.root);
    const calls = countDrawCalls(scene);
    expect(calls).toBeGreaterThan(10);
    expect(calls).toBeLessThanOrEqual(PLACEHOLDER_DRAW_CAP);
    scene.remove(zone.root);
  });

  it('places the same things every time (seeded)', () => {
    const again = createNatureTrail(makeDeps());
    expect(again.openSpots!.map((s) => [s.x, s.z])).toEqual(zone.openSpots!.map((s) => [s.x, s.z]));
    const matrices = (z: typeof zone): number[] => {
      const trees = z.root.getObjectByName('trees')!.children[0] as THREE.InstancedMesh;
      return Array.from(trees.instanceMatrix.array);
    };
    expect(matrices(again)).toEqual(matrices(zone));
    expect(JSON.stringify(natureTrailLayout())).toEqual(JSON.stringify(layout));
  });
});

describe('Nature Trail model swap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fakeMesh = (): THREE.Mesh => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial());

  /** Pretend every model has loaded: single static meshes, two meshes for the rabbit and the campfire. */
  function fakeLoadedAssets(): { animators: Map<string, ModelAnimator & { update: ReturnType<typeof vi.fn> }> } {
    const animators = new Map<string, ModelAnimator & { update: ReturnType<typeof vi.fn> }>();
    vi.spyOn(assets, 'load').mockResolvedValue(undefined);
    vi.spyOn(assets, 'has').mockReturnValue(true);
    vi.spyOn(assets, 'instance').mockImplementation((id) => {
      const group = new THREE.Group();
      group.name = id;
      group.add(fakeMesh());
      if (id === 'animal.rabbit' || id === 'campfire') group.add(fakeMesh());
      return group;
    });
    vi.spyOn(assets, 'instanced').mockImplementation((id, count) => {
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), count);
      mesh.name = id; // the real library names it by id too
      return mesh;
    });
    vi.spyOn(assets, 'animator').mockImplementation((id) => {
      if (id === 'animal.bird') return undefined; // the bird has no clips in the manifest
      const animator = { play: vi.fn(), update: vi.fn() } as unknown as ModelAnimator & { update: ReturnType<typeof vi.fn> };
      animators.set(id, animator);
      return animator;
    });
    return { animators };
  }

  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it('keeps the placeholder art when nothing has loaded', async () => {
    const z = createNatureTrail(makeDeps());
    await flush();
    expect(z.root.getObjectByName('tent')).toBeDefined();
    expect(z.root.getObjectByName('rocks')).toBeInstanceOf(THREE.InstancedMesh);
  });

  it('swaps every prop for its model, within the draw-call budget, and animates the animals', async () => {
    const { animators } = fakeLoadedAssets();
    const z = createNatureTrail(makeDeps());
    await flush();

    // Placeholders are gone, models are in.
    expect(z.root.getObjectByName('tent')).toBeUndefined();
    expect(z.root.getObjectByName('firewood')).toBeUndefined();
    expect(z.root.getObjectByName('stumps')).toBeUndefined();
    expect(z.root.getObjectByName('seats')).toBeUndefined();
    expect(z.root.getObjectByName('tent.small')).toBeInstanceOf(THREE.InstancedMesh);
    expect(z.root.getObjectByName('stump')).toBeInstanceOf(THREE.InstancedMesh);
    expect(z.root.getObjectByName('log.stack')).toBeInstanceOf(THREE.InstancedMesh);
    expect(z.root.getObjectByName('log.single')).toBeInstanceOf(THREE.InstancedMesh);
    expect(z.root.getObjectByName('path.stone')).toBeInstanceOf(THREE.InstancedMesh);
    const rocks = z.root.getObjectByName('rocks')!;
    expect(rocks.children.map((c) => c.name).sort()).toEqual(['rock.large', 'rock.small', 'rock.tall']);
    const trees = z.root.getObjectByName('trees')!;
    expect(trees.children.map((c) => c.name).sort()).toEqual(['tree.oak', 'tree.pine', 'tree.pine.tall', 'tree.round']);
    expect(z.root.getObjectByName('signpost')).toBeDefined();

    // The bridge model is flattened to the player's height and runs north to south.
    const bridge = z.root.getObjectByName('bridge')!;
    expect(bridge.scale.y).toBeLessThan(0.5);
    expect(bridge.parent!.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(z.root.getObjectByName('landmark:footbridge')!.getObjectByName('bridge')).toBeDefined();

    // Both clip-bearing animals got an animator that update(dt) advances; the bird stays still-ish.
    expect([...animators.keys()].sort()).toEqual(['animal.frog', 'animal.rabbit']);
    for (const a of animators.values()) a.update.mockClear();
    z.update(1 / 60);
    for (const a of animators.values()) expect(a.update).toHaveBeenCalledWith(1 / 60);

    const scene = new THREE.Scene();
    scene.add(z.root);
    const calls = countDrawCalls(scene);
    expect(calls).toBeGreaterThan(30);
    expect(calls).toBeLessThanOrEqual(SWAPPED_DRAW_CAP);
  });

  it('keeps the placeholder for a model that failed while the rest swap in', async () => {
    fakeLoadedAssets();
    vi.spyOn(assets, 'has').mockImplementation((id) => id !== 'bridge' && id !== 'rock.tall');
    const z = createNatureTrail(makeDeps());
    await flush();
    expect(z.root.getObjectByName('footbridge')!.children.length).toBeGreaterThan(0);
    expect(z.root.getObjectByName('bridge')).toBeUndefined();
    expect(z.root.getObjectByName('rocks')).toBeInstanceOf(THREE.InstancedMesh); // whole set stays primitive
    expect(z.root.getObjectByName('tent.small')).toBeDefined();
  });
});
