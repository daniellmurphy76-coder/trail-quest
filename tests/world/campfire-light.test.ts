import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assets } from '../../src/engine/assets';
import { DEFAULT_LOOK } from '../../src/engine/look';
import { createZoneTraveler } from '../../src/game/travel';
import {
  campfire,
  dressCampfireModel,
  ensureFireLight,
  fireFlicker,
  FIRE_FLICKER_DEPTH,
  FIRE_LIGHT_HEIGHT,
  FIRE_LIGHT_INTENSITY,
  FIRE_LIGHT_NAME,
} from '../../src/world/props';
import { refreshWindMotion } from '../../src/world/wind';
import { createZone, ZONE_IDS } from '../../src/world/zones';

const SUN = DEFAULT_LOOK.sunIntensity;
const PEAK = FIRE_LIGHT_INTENSITY * (1 + FIRE_FLICKER_DEPTH);

function makeDeps() {
  return { onTalkToDenChief: vi.fn<() => void>(), onReturnToBaseCamp: vi.fn<() => void>() };
}

function pointLights(root: THREE.Object3D): THREE.PointLight[] {
  const found: THREE.PointLight[] = [];
  root.traverse((o) => {
    if ((o as THREE.PointLight).isPointLight) found.push(o as THREE.PointLight);
  });
  return found;
}

/** The world-space corners of an instanced mesh's geometry, every instance applied. */
function instancedVertices(mesh: THREE.InstancedMesh): THREE.Vector3[] {
  const position = mesh.geometry.getAttribute('position');
  const matrix = new THREE.Matrix4();
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    for (let v = 0; v < position.count; v++) {
      out.push(new THREE.Vector3(position.getX(v), position.getY(v), position.getZ(v)).applyMatrix4(matrix));
    }
  }
  return out;
}

/**
 * Every vertex of the real `campfire` model (Kenney's campfire-pit.glb), placed the way the game
 * places it: the manifest's scale and lift, and each node's own offset. Read straight from the file,
 * so the numbers cannot drift from the art.
 */
function modelVertices(): { name: string; points: THREE.Vector3[] }[] {
  const file = fs.readFileSync(path.resolve('public/assets/models/kenney-survival-kit/campfire-pit.glb'));
  const jsonLength = file.readUInt32LE(12);
  const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString('utf8')) as {
    nodes: { name: string; mesh?: number; translation?: number[] }[];
    meshes: { primitives: { attributes: { POSITION: number } }[] }[];
    accessors: { bufferView: number; byteOffset?: number; count: number }[];
    bufferViews: { byteOffset?: number; byteStride?: number }[];
  };
  const bin = file.subarray(20 + jsonLength + 8);
  const manifest = JSON.parse(fs.readFileSync(path.resolve('public/assets/manifest.json'), 'utf8')) as {
    models: Record<string, { scale: number; yOffset: number }>;
  };
  const { scale, yOffset } = manifest.models['campfire']!;
  const out: { name: string; points: THREE.Vector3[] }[] = [];
  for (const node of gltf.nodes) {
    if (node.mesh === undefined) continue;
    const accessor = gltf.accessors[gltf.meshes[node.mesh]!.primitives[0]!.attributes.POSITION]!;
    const view = gltf.bufferViews[accessor.bufferView]!;
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const stride = view.byteStride ?? 12;
    const [tx, ty, tz] = node.translation ?? [0, 0, 0];
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < accessor.count; i++) {
      const at = start + i * stride;
      points.push(
        new THREE.Vector3(
          (bin.readFloatLE(at) + tx!) * scale,
          (bin.readFloatLE(at + 4) + ty!) * scale + yOffset,
          (bin.readFloatLE(at + 8) + tz!) * scale,
        ),
      );
    }
    out.push({ name: node.name, points });
  }
  return out;
}

const lightPoint = new THREE.Vector3(0, FIRE_LIGHT_HEIGHT, 0);
const nearest = (points: readonly THREE.Vector3[]): number => Math.min(...points.map((p) => p.distanceTo(lightPoint)));
/** What the light adds on a surface that faces it squarely at distance `d`: candela over distance squared (decay 2). */
const irradiance = (intensity: number, d: number): number => intensity / (d * d);

describe('fire flicker', () => {
  it('is the same every time for the same moment', () => {
    for (const t of [0, 0.37, 1, 12.5, 600.123]) expect(fireFlicker(t)).toBe(fireFlicker(t));
  });

  it('stays within 15 percent of resting and above zero, through ten minutes at 60 Hz', () => {
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < 36000; i++) {
      const f = fireFlicker(i / 60);
      expect(f).toBeGreaterThan(0);
      low = Math.min(low, f);
      high = Math.max(high, f);
    }
    expect(low).toBeGreaterThanOrEqual(1 - FIRE_FLICKER_DEPTH - 1e-9);
    expect(high).toBeLessThanOrEqual(1 + FIRE_FLICKER_DEPTH + 1e-9);
    expect(FIRE_FLICKER_DEPTH).toBe(0.15);
    // It is a real flicker, not a faint hum: it uses most of its range both ways.
    expect(low).toBeLessThan(1 - 0.75 * FIRE_FLICKER_DEPTH);
    expect(high).toBeGreaterThan(1 + 0.75 * FIRE_FLICKER_DEPTH);
  });

  it('is a steady 1 under reduced motion, at any time', () => {
    for (let i = 0; i < 500; i++) expect(fireFlicker(i * 0.173, true)).toBe(1);
  });
});

describe('campfire light', () => {
  it('hangs above the flame, at least 0.9 above every log top and every stone, in the primitive fire', () => {
    const fire = campfire();
    const light = fire.root.getObjectByName(FIRE_LIGHT_NAME) as THREE.PointLight;
    expect(light.position.x).toBe(0);
    expect(light.position.z).toBe(0);
    expect(light.position.y).toBe(FIRE_LIGHT_HEIGHT);
    const logs = instancedVertices(fire.root.children.find((o) => (o as THREE.InstancedMesh).isInstancedMesh && (o as THREE.InstancedMesh).count === 3) as THREE.InstancedMesh);
    const stones = instancedVertices(fire.root.children.find((o) => (o as THREE.InstancedMesh).isInstancedMesh && (o as THREE.InstancedMesh).count === 8) as THREE.InstancedMesh);
    expect(logs.length).toBeGreaterThan(0);
    expect(stones.length).toBeGreaterThan(0);
    expect(light.position.y - Math.max(...logs.map((p) => p.y))).toBeGreaterThanOrEqual(0.9);
    expect(nearest(logs)).toBeGreaterThanOrEqual(0.9);
    expect(nearest(stones)).toBeGreaterThanOrEqual(0.9);
  });

  it('is at least 0.9 from the real model, logs and stones, and the log tops see at most 1.5 suns at the top of the flicker', () => {
    const meshes = modelVertices();
    expect(meshes.map((m) => m.name).sort()).toEqual(['campfire-pit', 'wood']);
    const wood = meshes.find((m) => m.name === 'wood')!.points;
    const pit = meshes.find((m) => m.name === 'campfire-pit')!.points;
    expect(Math.max(...wood.map((p) => p.y))).toBeCloseTo(0.94, 1); // the log tops this was tuned for
    expect(nearest(wood)).toBeGreaterThanOrEqual(0.9);
    expect(nearest(pit)).toBeGreaterThanOrEqual(0.9);
    // The nearest vertex is the worst case: a face looking at the light squarely gets the full I / d^2.
    expect(irradiance(PEAK, nearest(wood))).toBeLessThanOrEqual(1.5 * SUN);
    expect(irradiance(PEAK, nearest(pit))).toBeLessThanOrEqual(1.5 * SUN);
  });

  it('keeps a warm pool on the ground out to 5 units: 5 percent of the sun at 5, 15 percent at 3', () => {
    const onGround = (rho: number): number => {
      const d = Math.hypot(rho, FIRE_LIGHT_HEIGHT);
      return irradiance(FIRE_LIGHT_INTENSITY, d) * (FIRE_LIGHT_HEIGHT / d); // times the cosine of the angle to the ground's up
    };
    expect(onGround(5)).toBeGreaterThanOrEqual(0.05 * SUN);
    expect(onGround(3)).toBeGreaterThanOrEqual(0.15 * SUN);
    expect(onGround(3)).toBeGreaterThan(onGround(4));
    expect(onGround(4)).toBeGreaterThan(onGround(5));
  });

  it('flickers within 15 percent of its resting intensity, never to zero', () => {
    const fire = campfire();
    const light = fire.root.getObjectByName(FIRE_LIGHT_NAME) as THREE.PointLight;
    const seen = new Set<number>();
    for (let i = 0; i < 3600; i++) {
      fire.update(1 / 60);
      expect(light.intensity).toBeGreaterThanOrEqual(FIRE_LIGHT_INTENSITY * (1 - FIRE_FLICKER_DEPTH) - 1e-9);
      expect(light.intensity).toBeLessThanOrEqual(FIRE_LIGHT_INTENSITY * (1 + FIRE_FLICKER_DEPTH) + 1e-9);
      expect(light.position.y).toBe(FIRE_LIGHT_HEIGHT); // the light itself does not drift
      seen.add(Math.round(light.intensity * 1000));
    }
    expect(seen.size).toBeGreaterThan(100);
  });

  describe('under reduced motion', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      refreshWindMotion();
    });

    it('holds the light steady and the flames still', () => {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }) as MediaQueryList);
      refreshWindMotion();
      const fire = campfire();
      const light = fire.root.getObjectByName(FIRE_LIGHT_NAME) as THREE.PointLight;
      const flames = fire.root.children.filter((o) => (o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) as THREE.Mesh[];
      expect(flames.length).toBe(2);
      const intensities = new Set<number>();
      const heights = new Set<number>();
      for (let i = 0; i < 300; i++) {
        fire.update(1 / 60);
        intensities.add(light.intensity);
        heights.add(flames[0]!.scale.y);
      }
      expect([...intensities]).toEqual([FIRE_LIGHT_INTENSITY]);
      expect([...heights]).toEqual([1]);
    });

    it('still lets the embers rise', () => {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }) as MediaQueryList);
      refreshWindMotion();
      const fire = campfire();
      const embers = fire.root.getObjectByName('embers') as THREE.Points;
      const y = embers.geometry.getAttribute('position');
      const before = Array.from({ length: y.count }, (_, i) => y.getY(i));
      for (let i = 0; i < 30; i++) fire.update(1 / 60);
      expect(Array.from({ length: y.count }, (_, i) => y.getY(i))).not.toEqual(before);
    });
  });
});

describe('campfire model colors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A stand-in for the loaded model: two meshes, named as in the file, sharing the kit's one textured material. */
  function fakeModel(): { model: THREE.Group; shared: THREE.MeshLambertMaterial; pit: THREE.Mesh; wood: THREE.Mesh } {
    const palette = new THREE.DataTexture(new Uint8Array([203, 119, 83, 255]), 1, 1, THREE.RGBAFormat);
    const shared = new THREE.MeshLambertMaterial({ map: palette, side: THREE.DoubleSide });
    const pit = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared);
    pit.name = 'campfire-pit';
    const wood = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared);
    wood.name = 'wood';
    const model = new THREE.Group();
    model.name = 'campfire';
    model.add(pit, wood);
    return { model, shared, pit, wood };
  }

  it('turns the logs bark brown (keeping the texture) and the ring stone grey, on their own materials', () => {
    const { model, shared, pit, wood } = fakeModel();
    dressCampfireModel(model);
    const bark = wood.material as THREE.MeshLambertMaterial;
    const stone = pit.material as THREE.MeshLambertMaterial;
    expect(bark).not.toBe(shared);
    expect(stone).not.toBe(shared);
    expect(bark).not.toBe(stone);
    // The shared material (every other copy of the kit's palette) is untouched.
    expect(shared.color.getHex()).toBe(0xffffff);
    expect(shared.map).not.toBeNull();
    expect(bark.map).toBe(shared.map); // the darker and lighter faces survive
    expect(bark.side).toBe(THREE.DoubleSide);
    expect(stone.map).toBeNull();

    // Light on the kit's own wood color (sRGB 203, 119, 83) through the tint gives dark brown.
    const texel = new THREE.Color(0xcb7753).multiply(bark.color);
    const hsl = { h: 0, s: 0, l: 0 };
    texel.getHSL(hsl, THREE.SRGBColorSpace); // hue and lightness as the eye sees them
    expect(hsl.h).toBeGreaterThanOrEqual(0.04); // orange-brown, 14 to 43 degrees
    expect(hsl.h).toBeLessThanOrEqual(0.12);
    expect(hsl.l).toBeLessThanOrEqual(0.3); // dark, so a bright fire cannot wash it out
    expect(hsl.l).toBeGreaterThanOrEqual(0.12); // but not black

    // Stone is a near-neutral mid grey.
    stone.color.getHSL(hsl, THREE.SRGBColorSpace);
    expect(hsl.s).toBeLessThan(0.1);
    expect(hsl.l).toBeGreaterThan(0.3);
    expect(hsl.l).toBeLessThan(0.6);
  });

  it('leaves a stand-in that is not Lambert alone', () => {
    const group = new THREE.Group();
    const basic = new THREE.MeshBasicMaterial();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), basic));
    dressCampfireModel(group);
    expect((group.children[0] as THREE.Mesh).material).toBe(basic);
  });

  it('is applied when the model swaps in, and the light, flames and embers stay', () => {
    const { model, pit, wood } = fakeModel();
    vi.spyOn(assets, 'has').mockReturnValue(true);
    vi.spyOn(assets, 'instance').mockReturnValue(model);
    const fire = campfire();
    expect(fire.useModel()).toBe(true);
    expect(pit.material).not.toBe(wood.material);
    expect((pit.material as THREE.MeshLambertMaterial).map).toBeNull();
    expect(pointLights(fire.root)).toHaveLength(1);
    expect(fire.root.getObjectByName('embers')).toBeDefined();
    expect(() => fire.update(1 / 60)).not.toThrow();
  });
});

describe('one fire light in every zone', () => {
  const WITH_FIRE: string[] = ['base-camp', 'campfire-circle', 'nature-trail'];

  describe.each(ZONE_IDS)('%s', (id) => {
    const zone = createZone(id, makeDeps());

    it('carries exactly one point light, a visible fire light that casts no shadow', () => {
      const lights = pointLights(zone.root);
      expect(lights).toHaveLength(1);
      expect(lights[0]!.name).toBe(FIRE_LIGHT_NAME);
      expect(lights[0]!.visible).toBe(true);
      expect(lights[0]!.castShadow).toBe(false);
      expect(lights[0]!.distance).toBeGreaterThan(0);
    });

    it(WITH_FIRE.includes(id) ? 'is lit by the campfire' : 'is dark (intensity 0) but still in the scene', () => {
      const light = pointLights(zone.root)[0]!;
      const hasFire = zone.root.getObjectByName('campfire') !== undefined;
      expect(hasFire).toBe(WITH_FIRE.includes(id));
      if (hasFire) {
        expect(light.intensity).toBeGreaterThan(0);
        expect(light.userData.dormant).toBeUndefined();
      } else {
        expect(light.intensity).toBe(0);
        expect(light.userData.dormant).toBe(true);
        for (let i = 0; i < 120; i++) zone.update(1 / 60);
        expect(light.intensity).toBe(0);
        expect(light.visible).toBe(true);
      }
    });
  });

  it('adds a dark light once, and leaves a zone that has one alone', () => {
    const empty = new THREE.Group();
    const first = ensureFireLight(empty);
    expect(first.intensity).toBe(0);
    expect(first.visible).toBe(true);
    expect(ensureFireLight(empty)).toBe(first);
    expect(pointLights(empty)).toHaveLength(1);
    const fire = campfire();
    expect(ensureFireLight(fire.root)).toBe(fire.root.getObjectByName(FIRE_LIGHT_NAME));
    expect(pointLights(fire.root)).toHaveLength(1);
  });

  it('keeps the same lights in the scene, by kind, on every trip between zones', async () => {
    // Three builds a lit shader for the lights it finds, so the same kinds in the same numbers means
    // the same programs. `traverseVisible` skips what three skips (a hidden light is not counted).
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(), new THREE.DirectionalLight()); // stand-ins for the environment
    const deps = makeDeps();
    const camp = createZone('base-camp', deps);
    scene.add(camp.root);
    const traveler = createZoneTraveler({
      scene,
      initial: camp,
      createZone: (id) => createZone(id, deps),
      player: { setPosition: () => {} },
      follow: { snapTo: () => {} },
      followTarget: { position: new THREE.Vector3(), facing: 0, isMoving: false },
      veil: { fadeOut: async () => {}, fadeIn: async () => {} },
      onSwap: () => {},
    });
    const lightsInScene = (): Record<string, number> => {
      const counts: Record<string, number> = {};
      scene.traverseVisible((o) => {
        if ((o as THREE.Light).isLight) counts[o.type] = (counts[o.type] ?? 0) + 1;
      });
      return counts;
    };
    const expected = { HemisphereLight: 1, DirectionalLight: 1, PointLight: 1 };
    expect(lightsInScene()).toEqual(expected);
    for (const id of [...ZONE_IDS, 'base-camp' as const, 'town-square' as const, 'nature-trail' as const]) {
      await traveler.travelTo(id);
      expect(lightsInScene(), `after travelling to ${id}`).toEqual(expected);
    }
  });
});
