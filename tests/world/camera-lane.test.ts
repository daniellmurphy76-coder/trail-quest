/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ZoneId } from '../../src/activities/types';
import { assets, parseManifest, type ModelAnimator } from '../../src/engine/assets';
import { CAMERA_DISTANCE, CAMERA_HEIGHT } from '../../src/engine/camera';
import { facingIntoZone } from '../../src/game/travel';
import { BASE_CAMP_TREE_REACH } from '../../src/world/base-camp';
import {
  CAMERA_LANE_AHEAD,
  CAMERA_LANE_BEYOND,
  CAMERA_LANE_HALF_WIDTH,
  cameraLane,
  canopyHitsLane,
  TREE_CROWN_REACH,
  worstCrownReach,
  type Lane,
} from '../../src/world/camera-lane';
import { CAMPFIRE_CIRCLE_TREE_REACH } from '../../src/world/campfire-circle';
import { FITNESS_FIELD_TREE_REACH, FITNESS_TRACK } from '../../src/world/fitness-field';
import { natureTrailLayout, NATURE_TRAIL_TREE_REACH } from '../../src/world/nature-trail';
import { SAFETY_STATION_TREE_REACH } from '../../src/world/safety-station';
import { TOWN_SQUARE_STREET_HALF, TOWN_SQUARE_TREE_REACH } from '../../src/world/town-square';
import type { Zone } from '../../src/world/zone';
import { createZone, ZONE_IDS } from '../../src/world/zones';

function makeDeps() {
  return { onTalkToDenChief: vi.fn<() => void>(), onReturnToBaseCamp: vi.fn<() => void>() };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Pretend every model has loaded: single-box meshes, instanced ones named after their id (as the library names them). */
function fakeLoadedAssets(): void {
  vi.spyOn(assets, 'load').mockResolvedValue(undefined);
  vi.spyOn(assets, 'has').mockReturnValue(true);
  vi.spyOn(assets, 'instance').mockImplementation((id) => {
    const group = new THREE.Group();
    group.name = id;
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial()));
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial()));
    return group;
  });
  vi.spyOn(assets, 'instanced').mockImplementation((id, count) => {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), count);
    mesh.name = id;
    return mesh;
  });
  vi.spyOn(assets, 'animator').mockImplementation(
    () => ({ play: vi.fn(), update: vi.fn() }) as unknown as ModelAnimator,
  );
}

interface Crown {
  x: number;
  z: number;
  /** How far the crown reaches from the trunk. */
  reach: number;
}

/**
 * Every tree crown in a zone. Once the models are in, each instance reaches its model's crown radius
 * times its own size; before that (primitive cones) there is only the trunk position, so the zone's
 * worst case stands in.
 */
function crowns(zone: Zone, worst: number): Crown[] {
  const group = zone.root.getObjectByName('trees');
  expect(group, 'zone has trees').toBeDefined();
  const meshes = group!.children.filter((c): c is THREE.InstancedMesh => (c as THREE.InstancedMesh).isInstancedMesh);
  const models = meshes.filter((m) => m.name in TREE_CROWN_REACH);
  const use = models.length > 0 ? models : meshes.slice(0, 1); // primitives: the first mesh is the trunks
  const out: Crown[] = [];
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  for (const mesh of use) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      m.decompose(p, q, s);
      out.push({ x: p.x, z: p.z, reach: models.length > 0 ? TREE_CROWN_REACH[mesh.name]! * s.x : worst });
    }
  }
  return out;
}

const rectDistance = (x: number, z: number, r: Lane): number =>
  Math.hypot(x - Math.min(r.maxX, Math.max(r.minX, x)), z - Math.min(r.maxZ, Math.max(r.minZ, z)));

/** Ground distance from a point to the track's center line (an ellipse), minus half the track's width. */
function trackClearance(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < 720; i++) {
    const a = (i / 720) * Math.PI * 2;
    best = Math.min(best, Math.hypot(x - (FITNESS_TRACK.cx + Math.cos(a) * FITNESS_TRACK.a), z - (FITNESS_TRACK.cz + Math.sin(a) * FITNESS_TRACK.b)));
  }
  return Math.max(0, best - FITNESS_TRACK.width / 2);
}

const nature = natureTrailLayout();

interface Case {
  /** The widest crown the zone can grow (exported by the zone). */
  reach: number;
  /** Ground distance from a point to the zone's main path or paths, 0 on them. Null when the zone has none. */
  pathClearance: ((x: number, z: number, zone: Zone) => number) | null;
  /** Models the zone's tree mix must include. */
  mix: readonly string[];
}

const CASES: Record<ZoneId, Case> = {
  'base-camp': { reach: BASE_CAMP_TREE_REACH, pathClearance: null, mix: ['tree.birch', 'tree.oak', 'tree.pine', 'tree.round'] },
  'nature-trail': {
    reach: NATURE_TRAIL_TREE_REACH,
    pathClearance: (x, z) => Math.max(0, nature.path.nearest(x, z).dist - nature.pathHalf),
    mix: ['tree.birch', 'tree.oak', 'tree.pine', 'tree.round'],
  },
  'town-square': {
    reach: TOWN_SQUARE_TREE_REACH,
    // Both streets cross at the middle; the Scout walks them from the spawn.
    pathClearance: (x, z) => Math.max(0, Math.min(Math.abs(x), Math.abs(z)) - TOWN_SQUARE_STREET_HALF),
    mix: ['tree.round'],
  },
  'fitness-field': { reach: FITNESS_FIELD_TREE_REACH, pathClearance: trackClearance, mix: ['tree.oak', 'tree.round'] },
  'safety-station': {
    reach: SAFETY_STATION_TREE_REACH,
    // The paved path from the spawn down to the crossing.
    pathClearance: (x, z, zone) =>
      rectDistance(x, z, { minX: -1.5, maxX: 1.5, minZ: -2.5, maxZ: zone.spawn.z }),
    mix: ['tree.pine', 'tree.round'],
  },
  'campfire-circle': {
    reach: CAMPFIRE_CIRCLE_TREE_REACH,
    // Through the gateway and the gap in the benches to the fire.
    pathClearance: (x, z, zone) => rectDistance(x, z, { minX: -1.5, maxX: 1.5, minZ: 0, maxZ: zone.spawn.z }),
    mix: ['tree.birch', 'tree.fall', 'tree.oak', 'tree.pine.tall'],
  },
};

describe('the camera lane (pure)', () => {
  it('is a strip behind the spawn: from just ahead of it back to a little past where the camera sits', () => {
    const lane = cameraLane({ x: 2, z: 13.5 });
    expect(lane.minX).toBe(2 - CAMERA_LANE_HALF_WIDTH);
    expect(lane.maxX).toBe(2 + CAMERA_LANE_HALF_WIDTH);
    expect(lane.minZ).toBe(13.5 - CAMERA_LANE_AHEAD);
    expect(lane.maxZ).toBe(13.5 + CAMERA_DISTANCE + CAMERA_LANE_BEYOND);
    // The camera on arrival (7.5 behind, 3 up) is well inside it.
    const camera = { x: 2, z: 13.5 + CAMERA_DISTANCE };
    expect(canopyHitsLane(camera.x, camera.z, 0.01, lane)).toBe(true);
    expect(CAMERA_HEIGHT).toBe(3);
  });

  it('says whether a crown (a circle of `reach` around a trunk) overlaps the lane', () => {
    const lane: Lane = { minX: -4, maxX: 4, minZ: 10, maxZ: 22 };
    expect(canopyHitsLane(0, 15, 0.1, lane)).toBe(true); // a trunk in the lane
    // A trunk 2 beyond the edge (x = 6, the lane ends at 4).
    expect(canopyHitsLane(6, 15, 1.9, lane)).toBe(false); // crown stops 0.1 short
    expect(canopyHitsLane(6, 15, 2, lane)).toBe(false); // touching is not hanging over
    expect(canopyHitsLane(6, 15, 2.1, lane)).toBe(true); // crown reaches 0.1 over the edge
    expect(canopyHitsLane(7, 15, 3.5, lane)).toBe(true);
    expect(canopyHitsLane(7, 15, 3, lane)).toBe(false);
    // Past the end of the lane the corner counts, not just the sides: (7, 26) is 5 from the corner (4, 22).
    expect(canopyHitsLane(7, 26, 4.9, lane)).toBe(false);
    expect(canopyHitsLane(7, 26, 5.1, lane)).toBe(true);
  });

  it('knows the crown reach of every tree model in the manifest and rejects an unknown one', () => {
    const manifest = parseManifest(JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../public/assets/manifest.json'), 'utf8')));
    for (const id of Object.keys(manifest.models).filter((i) => i.startsWith('tree.'))) {
      expect(TREE_CROWN_REACH[id], `${id} needs a crown reach`).toBeGreaterThan(1);
    }
    expect(worstCrownReach(['tree.pine', 'tree.oak'], [0.8, 1.2])).toBeCloseTo(TREE_CROWN_REACH['tree.oak']! * 1.2, 10);
    expect(() => worstCrownReach(['tree.unknown'], [1, 1])).toThrow(/no crown reach/);
  });

  it('matches the real models: each reach covers the farthest vertex of the glTF, and is not wildly more', async () => {
    const publicDir = path.resolve(__dirname, '../../public');
    const manifest = parseManifest(JSON.parse(fs.readFileSync(path.join(publicDir, 'assets', 'manifest.json'), 'utf8')));
    for (const id of Object.keys(TREE_CROWN_REACH)) {
      const entry = manifest.models[id]!;
      const bytes = fs.readFileSync(path.join(publicDir, entry.path));
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const gltf = await new GLTFLoader().parseAsync(buffer, '');
      gltf.scene.scale.setScalar(entry.scale);
      gltf.scene.updateMatrixWorld(true);
      let farthest = 0;
      const v = new THREE.Vector3();
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const position = mesh.geometry.getAttribute('position');
        for (let i = 0; i < position.count; i++) {
          v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
          farthest = Math.max(farthest, Math.hypot(v.x, v.z));
        }
      });
      expect(TREE_CROWN_REACH[id], `${id} reaches ${farthest.toFixed(2)}`).toBeGreaterThanOrEqual(farthest - 1e-6);
      expect(TREE_CROWN_REACH[id]!, id).toBeLessThanOrEqual(farthest + 0.35);
    }
  });
});

describe.each(ZONE_IDS)('%s tree canopies', (id) => {
  const { reach, pathClearance, mix } = CASES[id];

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const check = (zone: Zone, list: readonly Crown[], label: string): void => {
    const lane = cameraLane(zone.spawn);
    expect(list.length, `${label} trees`).toBeGreaterThanOrEqual(12);
    for (const c of list) {
      const where = `${label} tree at ${c.x.toFixed(1)}, ${c.z.toFixed(1)} (reach ${c.reach.toFixed(2)})`;
      expect(canopyHitsLane(c.x, c.z, c.reach, lane), `${where} hangs over the camera lane`).toBe(false);
      if (pathClearance) expect(pathClearance(c.x, c.z, zone), `${where} hangs over the main path`).toBeGreaterThanOrEqual(c.reach - 1e-9);
      expect(c.reach, `${where} is wider than the zone allows`).toBeLessThanOrEqual(reach + 1e-9);
    }
  };

  it('keeps every crown off the camera lane behind the spawn and off the main path (primitive trees)', () => {
    const zone = createZone(id, makeDeps());
    check(zone, crowns(zone, reach), 'primitive');
  });

  it('keeps every crown off the lane and the path once the models are in, each at its own size', async () => {
    fakeLoadedAssets();
    const zone = createZone(id, makeDeps());
    await flush();
    const group = zone.root.getObjectByName('trees')!;
    const names = group.children.map((c) => c.name);
    for (const model of mix) expect(names, `${model} in the mix`).toContain(model);
    check(zone, crowns(zone, reach), 'model');
  });

  it('declares a crown reach that is the widest of its mix, at its largest size', () => {
    expect(reach).toBeGreaterThan(2);
    expect(reach).toBeLessThanOrEqual(3.8);
  });
});

describe('the camera lane assumption: every Scout arrives facing -z, so the camera trails on the +z side', () => {
  it.each(ZONE_IDS)('%s: the spawn is on the x = 0 axis, so the heading into the zone is straight down -z', (id) => {
    const zone = createZone(id, makeDeps());
    expect(zone.spawn.x).toBe(0);
    expect(zone.spawn.z).toBeGreaterThan(0);
    const facing = facingIntoZone(zone);
    expect(Math.sin(facing)).toBeCloseTo(0, 6);
    expect(Math.cos(facing)).toBeCloseTo(-1, 6);
  });
});

describe('the camera lane is not an empty strip: trees stand all around it', () => {
  it.each(ZONE_IDS)('%s still has a wall of trees on both sides of the lane', (id) => {
    const zone = createZone(id, makeDeps());
    const list = crowns(zone, CASES[id].reach);
    const lane = cameraLane(zone.spawn);
    const left = list.filter((c) => c.x < lane.minX).length;
    const right = list.filter((c) => c.x > lane.maxX).length;
    expect(left).toBeGreaterThan(3);
    expect(right).toBeGreaterThan(3);
  });
});
