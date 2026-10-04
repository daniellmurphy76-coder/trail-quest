import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assets } from '../../src/engine/assets';
import { createFitnessField, FITNESS_FIELD_HALF, FITNESS_TRACK } from '../../src/world/fitness-field';
import { personPlaceholder } from '../../src/world/props';
import { findInteractableInRange } from '../../src/world/zone';
import type { ZoneDeps } from '../../src/world/zones';
import { critterDrawCalls, runZone, wingBodies } from './critter-helpers';

function makeDeps() {
  const deps = { onTalkToDenChief: vi.fn<() => void>(), onReturnToBaseCamp: vi.fn<() => void>() };
  return deps satisfies ZoneDeps;
}

/** One draw call per visible Mesh, InstancedMesh or Sprite (every material here is a single one). */
function drawCalls(root: THREE.Object3D): number {
  let n = 0;
  root.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh || (o as THREE.Sprite).isSprite) n++;
  });
  return n;
}

/** Positions of every instance of an InstancedMesh, as ground (x, z) points. */
function instancePoints(mesh: THREE.InstancedMesh): Array<{ x: number; z: number }> {
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const out: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    p.setFromMatrixPosition(m);
    out.push({ x: p.x, z: p.z });
  }
  return out;
}

/** 1 on the ellipse that is `offset` units outside the track's center line, < 1 inside it. */
function ellipseValue(x: number, z: number, offset: number): number {
  const { cx, cz, a, b } = FITNESS_TRACK;
  return ((x - cx) / (a + offset)) ** 2 + ((z - cz) / (b + offset)) ** 2;
}

const HALF_WIDTH = FITNESS_TRACK.width / 2;

describe('Fitness Field zone', () => {
  const deps = makeDeps();
  const zone = createFitnessField(deps);
  const { bounds, spawn } = zone;
  const inside = (p: { x: number; z: number }): boolean =>
    p.x >= bounds.minX && p.x <= bounds.maxX && p.z >= bounds.minZ && p.z <= bounds.maxZ;
  const mesh = (name: string): THREE.InstancedMesh => zone.root.getObjectByName(name) as THREE.InstancedMesh;

  it('builds a zone with its own id, a scene root, and no landmarks', () => {
    expect(zone.id).toBe('fitness-field');
    expect(zone.root).toBeInstanceOf(THREE.Group);
    expect(zone.root.children.length).toBeGreaterThan(0);
    expect(zone.landmarks).toEqual({});
    expect(zone.bounds).toEqual({
      minX: -FITNESS_FIELD_HALF,
      maxX: FITNESS_FIELD_HALF,
      minZ: -FITNESS_FIELD_HALF,
      maxZ: FITNESS_FIELD_HALF,
    });
  });

  it('spawns on the ground, inside the bounds, near the +z edge', () => {
    expect(inside(spawn)).toBe(true);
    expect(spawn.y).toBe(0);
    expect(spawn.z).toBeGreaterThan(bounds.maxZ - 6);
  });

  it('has 10 to 14 open spots inside the bounds, at least 2 apart and 3 from the spawn', () => {
    const spots = zone.openSpots!;
    expect(spots.length).toBeGreaterThanOrEqual(10);
    expect(spots.length).toBeLessThanOrEqual(14);
    for (const spot of spots) {
      expect(inside(spot)).toBe(true);
      expect(Math.hypot(spot.x - spawn.x, spot.z - spawn.z)).toBeGreaterThanOrEqual(3);
    }
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        expect(Math.hypot(spots[i]!.x - spots[j]!.x, spots[i]!.z - spots[j]!.z)).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('puts every open spot on the track or in the infield', () => {
    for (const spot of zone.openSpots!) {
      expect(ellipseValue(spot.x, spot.z, HALF_WIDTH)).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the open spots clear of the cones, stones, ball, benches and Trail sign', () => {
    const props = [
      ...instancePoints(mesh('cones')).map((p) => ({ ...p, clear: 1.2 })),
      ...instancePoints(mesh('stretch-stones')).map((p) => ({ ...p, clear: 1.2 })),
      ...instancePoints(mesh('benches')).map((p) => ({ ...p, clear: 1.5 })),
      { x: zone.root.getObjectByName('ball')!.position.x, z: zone.root.getObjectByName('ball')!.position.z, clear: 1.2 },
      { x: zone.interactables[0]!.position.x, z: zone.interactables[0]!.position.z, clear: 3 },
    ];
    for (const spot of zone.openSpots!) {
      for (const prop of props) {
        expect(Math.hypot(spot.x - prop.x, spot.z - prop.z)).toBeGreaterThanOrEqual(prop.clear);
      }
    }
  });

  it('places the same layout every time (seeded)', () => {
    const again = createFitnessField(makeDeps());
    expect(again.openSpots!.map((s) => [s.x, s.z])).toEqual(zone.openSpots!.map((s) => [s.x, s.z]));
    const positions = (z: typeof zone): number[] =>
      Array.from((z.root.getObjectByName('track') as THREE.Mesh).geometry.getAttribute('position').array);
    expect(positions(again)).toEqual(positions(zone));
    const treeMatrices = (z: typeof zone): number[] =>
      Array.from((z.root.getObjectByName('trees')!.children[0] as THREE.InstancedMesh).instanceMatrix.array);
    expect(treeMatrices(again)).toEqual(treeMatrices(zone));
  });

  describe('Back to camp sign', () => {
    const signs = zone.interactables.filter((i) => i.label === 'Back to camp');

    it('is the zone\'s only interactable, with the Trail sign tag and radius 2', () => {
      expect(zone.interactables).toHaveLength(1);
      expect(signs).toHaveLength(1);
      expect(signs[0]!.id).toBe('trail-sign');
      expect(signs[0]!.nameTag).toBe('Trail sign');
      expect(signs[0]!.radius).toBe(2);
    });

    it('stands near the spawn, in range only once the player steps up to it', () => {
      const sign = signs[0]!;
      expect(Math.hypot(sign.position.x - spawn.x, sign.position.z - spawn.z)).toBeLessThanOrEqual(6);
      expect(findInteractableInRange(spawn.x, spawn.z, zone.interactables)).toBeNull();
      expect(findInteractableInRange(sign.position.x, sign.position.z, zone.interactables)).toBe(sign);
    });

    it('returns to Base Camp when used', () => {
      signs[0]!.onInteract();
      expect(deps.onReturnToBaseCamp).toHaveBeenCalledOnce();
      expect(deps.onTalkToDenChief).not.toHaveBeenCalled();
    });
  });

  describe('track', () => {
    const track = zone.root.getObjectByName('track') as THREE.Mesh;
    const position = track.geometry.getAttribute('position');
    const color = track.geometry.getAttribute('color');

    it('is a flat dirt ring a little above the grass, between the two track ellipses and their soft edge bands', () => {
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < position.count; i++) {
        minY = Math.min(minY, position.getY(i));
        maxY = Math.max(maxY, position.getY(i));
        const e = ellipseValue(position.getX(i), position.getZ(i), 0);
        expect(Math.abs(e - 1)).toBeLessThan(0.65); // every vertex hugs the center line, within the track width and its soft edge band
      }
      expect(minY).toBeGreaterThan(0.02);
      expect(maxY).toBeLessThan(0.1);
      expect(track.receiveShadow).toBe(true);
      expect(track.castShadow).toBe(false);
    });

    it('has a white start line on the near straight, and dirt everywhere else', () => {
      const white: number[] = [];
      for (let i = 0; i < color.count; i++) {
        if (Math.min(color.getX(i), color.getY(i), color.getZ(i)) > 0.7) white.push(i);
      }
      expect(white).toHaveLength(4); // one quad
      for (const i of white) {
        expect(position.getY(i)).toBeGreaterThan(0.05); // above the dirt
        expect(position.getZ(i)).toBeGreaterThan(FITNESS_TRACK.cz); // the near (+z) side
      }
    });

    it('winds around the infield with every triangle facing up', () => {
      const index = track.geometry.getIndex()!;
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      for (let i = 0; i < index.count; i += 3) {
        a.fromBufferAttribute(position, index.getX(i));
        b.fromBufferAttribute(position, index.getX(i + 1));
        c.fromBufferAttribute(position, index.getX(i + 2));
        const normal = b.sub(a).cross(c.sub(a));
        expect(normal.y).toBeGreaterThan(0);
      }
    });
  });

  it('has four orange cones on the inside edge of the track, one in each corner', () => {
    const cones = mesh('cones');
    expect(cones.count).toBe(4);
    const quadrants = new Set<string>();
    for (const p of instancePoints(cones)) {
      expect(ellipseValue(p.x, p.z, -HALF_WIDTH)).toBeLessThan(1); // in the infield, off the dirt
      expect(ellipseValue(p.x, p.z, -HALF_WIDTH)).toBeGreaterThan(0.7); // but right at its edge
      quadrants.add(`${Math.sign(p.x - FITNESS_TRACK.cx)}${Math.sign(p.z - FITNESS_TRACK.cz)}`);
    }
    expect(quadrants.size).toBe(4);
  });

  it('has a fence with a gate, log benches and a scoreboard along the far side', () => {
    expect(mesh('fence').count).toBeGreaterThanOrEqual(6);
    expect(mesh('fence-gate').count).toBe(1);
    expect(mesh('benches').count).toBeGreaterThanOrEqual(3);
    const scoreboard = zone.root.getObjectByName('scoreboard')!;
    expect(scoreboard).toBeDefined();
    for (const p of [...instancePoints(mesh('fence')), ...instancePoints(mesh('benches')), scoreboard.position]) {
      expect(p.z).toBeLessThan(FITNESS_TRACK.cz - FITNESS_TRACK.b - HALF_WIDTH); // behind the far straight
      expect(inside(p)).toBe(true);
    }
  });

  it('marks the stretching circle with stones in the infield, and puts a ball beside it', () => {
    const stones = mesh('stretch-stones');
    expect(stones.count).toBeGreaterThanOrEqual(6);
    const points = instancePoints(stones);
    for (const p of points) expect(ellipseValue(p.x, p.z, -HALF_WIDTH)).toBeLessThan(1);
    const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
    const cz = points.reduce((s, p) => s + p.z, 0) / points.length;
    const radii = points.map((p) => Math.hypot(p.x - cx, p.z - cz));
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(0.3); // a circle (the stones are nudged a little)
    const ball = zone.root.getObjectByName('ball') as THREE.Mesh;
    expect(ball.geometry).toBeInstanceOf(THREE.SphereGeometry);
    expect(Math.hypot(ball.position.x - cx, ball.position.z - cz)).toBeGreaterThan(radii[0]! + 0.5); // not inside the ring
    expect(ellipseValue(ball.position.x, ball.position.z, -HALF_WIDTH)).toBeLessThan(1);
  });

  it('keeps the trees outside the walkable field and the plants off the track and infield', () => {
    const trees = zone.root.getObjectByName('trees')!.children[0] as THREE.InstancedMesh;
    expect(trees.count).toBeGreaterThanOrEqual(20);
    for (const p of instancePoints(trees)) {
      expect(Math.max(Math.abs(p.x), Math.abs(p.z))).toBeGreaterThan(FITNESS_FIELD_HALF);
    }
    const plants = zone.root.getObjectByName('plants')!.children[0] as THREE.InstancedMesh;
    expect(plants.count).toBeGreaterThanOrEqual(60);
    for (const p of instancePoints(plants)) {
      expect(inside(p)).toBe(true);
      expect(ellipseValue(p.x, p.z, HALF_WIDTH)).toBeGreaterThan(1);
    }
  });

  it('stays inside the draw-call cap with placeholders, with room for the model swap', () => {
    // 19 draw calls today (17 before the butterflies and birds, 2 more); the swap adds about 8 (gate, plant models). Cap 20 leaves headroom.
    expect(drawCalls(zone.root)).toBeLessThanOrEqual(20);
    const scene = new THREE.Scene();
    scene.add(zone.root, personPlaceholder(0xf2c14e, 1.95)); // the player
    expect(drawCalls(scene)).toBeLessThan(30);
  });

  it('adds 2 draw calls of ambient life: 8 butterflies over the infield (1) and 3 birds overhead (1)', () => {
    expect(critterDrawCalls(zone.root.getObjectByName('butterflies')!)).toBe(1);
    expect(critterDrawCalls(zone.root.getObjectByName('birds')!)).toBe(1);
    expect(wingBodies(zone.root, 'butterfly-wings')).toHaveLength(8);
    expect(wingBodies(zone.root, 'bird-wings')).toHaveLength(3);
  });

  it('keeps the butterflies over the infield, off the ball and the cones, and the birds in the sky, for a long flight', () => {
    const z = createFitnessField(makeDeps());
    const ball = z.root.getObjectByName('ball')!;
    const cones = instancePoints(z.root.getObjectByName('cones') as THREE.InstancedMesh);
    const violations: string[] = [];
    const check = (): void => {
      for (const p of wingBodies(z.root, 'butterfly-wings')) {
        if (ellipseValue(p.x, p.z, 0) > 1) violations.push(`off the infield at ${p.x}, ${p.z}`); // inside the track's center line
        if (p.y < 0.3 || p.y > 2) violations.push(`height ${p.y}`);
        if (Math.hypot(p.x - ball.position.x, p.z - ball.position.z) < 0.9) violations.push('over the ball');
        for (const c of cones) {
          if (Math.hypot(p.x - c.x, p.z - c.z) < 0.8) violations.push('over a cone');
        }
      }
      for (const p of wingBodies(z.root, 'bird-wings')) {
        if (p.y <= 15 || Math.hypot(p.x, p.z) > 120 + 1e-6) violations.push(`bird at ${p.x}, ${p.y}, ${p.z}`);
      }
    };
    check();
    expect(() => runZone(z, 1800, check)).not.toThrow(); // half a minute at 60 Hz, checked every half second
    expect(violations).toEqual([]);
  });

  it('flies the same way every time (seeded)', () => {
    const a = createFitnessField(makeDeps());
    const b = createFitnessField(makeDeps());
    runZone(a, 300);
    runZone(b, 300);
    for (const name of ['butterfly-wings', 'bird-wings'] as const) {
      expect(wingBodies(a.root, name).map((p) => p.toArray())).toEqual(wingBodies(b.root, name).map((p) => p.toArray()));
    }
  });

  it('animates without throwing, and the ball hops but never sinks into the grass', () => {
    const ball = zone.root.getObjectByName('ball')!;
    const ys: number[] = [];
    for (let i = 0; i < 240; i++) {
      expect(() => zone.update(1 / 60)).not.toThrow();
      ys.push(ball.position.y);
    }
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0.4 - 1e-9);
    expect(Math.max(...ys)).toBeGreaterThan(0.5);
  });
});

describe('Fitness Field model swap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Pretend every model has loaded: a one-mesh stand-in per id (the gate has two meshes, like the real one). */
  function fakeLoadedAssets(): void {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial();
    vi.spyOn(assets, 'load').mockResolvedValue(undefined);
    vi.spyOn(assets, 'has').mockReturnValue(true);
    vi.spyOn(assets, 'instanced').mockImplementation((id: string, count: number) => {
      const m = new THREE.InstancedMesh(box, material, count);
      m.name = id;
      return m;
    });
    vi.spyOn(assets, 'instance').mockImplementation((id: string) => {
      const g = new THREE.Group();
      g.name = id;
      g.add(new THREE.Mesh(box, material));
      if (id === 'fence.gate') g.add(new THREE.Mesh(box, material));
      return g;
    });
  }

  const names = (root: THREE.Object3D): string[] => {
    const out: string[] = [];
    root.traverseVisible((o) => out.push(o.name));
    return out;
  };

  it('swaps every model prop in, drops the primitives, and stays under 80 draw calls', async () => {
    fakeLoadedAssets();
    const zone = createFitnessField(makeDeps());
    const before = drawCalls(zone.root);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const visible = names(zone.root);

    for (const id of ['tree.round', 'tree.oak', 'fence.simple', 'fence.gate', 'log.single', 'rock.small', 'signpost.single', 'signpost']) {
      expect(visible, `${id} should be in the scene`).toContain(id);
    }
    for (const primitive of ['fence', 'fence-gate', 'benches', 'stretch-stones', 'plant-tufts']) {
      expect(visible, `primitive ${primitive} should be gone`).not.toContain(primitive);
    }
    // The cones, ball and track have no model: they stay.
    for (const keep of ['cones', 'ball', 'track', 'ground']) expect(visible).toContain(keep);

    const after = drawCalls(zone.root);
    expect(after).toBeLessThan(80);
    expect(after).toBeLessThanOrEqual(40); // 23 in practice (plants add up to 8)
    expect(after).toBeGreaterThanOrEqual(before);
    expect(() => zone.update(1 / 60)).not.toThrow();
  });

  it('keeps the primitive of any model that does not load', async () => {
    vi.spyOn(assets, 'load').mockResolvedValue(undefined);
    vi.spyOn(assets, 'has').mockReturnValue(false);
    const zone = createFitnessField(makeDeps());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const visible = names(zone.root);
    for (const primitive of ['fence', 'fence-gate', 'benches', 'stretch-stones', 'trail-sign', 'scoreboard']) {
      expect(visible).toContain(primitive);
    }
    expect(drawCalls(zone.root)).toBeLessThanOrEqual(20);
  });

  it('keeps the primitives if the asset library rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(assets, 'load').mockRejectedValue(new Error('offline'));
    const zone = createFitnessField(makeDeps());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(names(zone.root)).toContain('fence');
    expect(warn).toHaveBeenCalled();
  });
});
