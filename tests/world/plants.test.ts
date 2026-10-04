/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assets, parseManifest } from '../../src/engine/assets';
import { mulberry32 } from '../../src/engine/seed';
import {
  DEFAULT_PLANT_DENSITY,
  PLANT_LIGHTNESS_SPREAD,
  PLANT_WARMTH_SPREAD,
  isFoliageOnly,
  scatterPlants,
  tintPlants,
  varyPlants,
  type AvoidCircle,
} from '../../src/world/props';

const bounds = { minX: -24, maxX: 24, minZ: -24, maxZ: 24 };
const avoid: AvoidCircle[] = [{ x: 0, z: 0, radius: 6 }];

type RGB = readonly [number, number, number];

/** Vertex colors as the plant models store them (linear RGB): a leaf green, and some petal and cap colors. */
const GREEN: RGB = [0.1, 0.32, 0.04];
const DARK_GREEN: RGB = [0.01, 0.15, 0.03];
const RED: RGB = [0.878, 0.29, 0.314];
const YELLOW: RGB = [0.996, 0.694, 0.278];
const PURPLE: RGB = [0.624, 0.537, 1.0];
const CREAM: RGB = [0.9, 0.82, 0.62];
/** The old Kenney nature kit's mint-teal leaf (linear RGB): the color the tint used to repair. */
const MINT: RGB = [0.173, 0.847, 0.722];

/** Colors as a Float32 attribute would hold them. */
const stored = (rgb: RGB): number[] => rgb.map((v) => Math.fround(v));

function paintedGeometry(colors: readonly RGB[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(colors.flatMap((_, i) => [i, 0, 0]), 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors.flat(), 3));
  return geometry;
}

const vertexColor = (g: THREE.BufferGeometry, i: number): RGB => {
  const c = g.getAttribute('color');
  return [c.getX(i), c.getY(i), c.getZ(i)];
};

const meshOf = (colors: readonly RGB[], count = 40): THREE.InstancedMesh =>
  new THREE.InstancedMesh(paintedGeometry(colors), new THREE.MeshLambertMaterial({ vertexColors: true }), count);

const publicDir = path.resolve(__dirname, '../../public');
const manifest = parseManifest(JSON.parse(readFileSync(path.join(publicDir, 'assets', 'manifest.json'), 'utf8')));

/** The geometry of a real shipped model, loaded the way the game loads it. */
async function realGeometry(id: string): Promise<THREE.BufferGeometry> {
  const bytes = readFileSync(path.join(publicDir, manifest.models[id]!.path));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
  let geometry: THREE.BufferGeometry | undefined;
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) geometry = (o as THREE.Mesh).geometry;
  });
  return geometry!;
}

describe('scatterPlants density', () => {
  const count = (plants: THREE.Group): number => (plants.getObjectByName('plant-tufts') as THREE.InstancedMesh).count;

  it('keeps 60 percent of the plants it is asked for, unless told otherwise', () => {
    expect(DEFAULT_PLANT_DENSITY).toBe(0.6);
    expect(count(scatterPlants(mulberry32(3), 200, bounds, avoid))).toBe(120);
    expect(count(scatterPlants(mulberry32(3), 150, bounds, avoid))).toBe(90);
    expect(count(scatterPlants(mulberry32(3), 260, bounds, avoid))).toBe(156);
  });

  it('can be asked for exactly the count (density 1) or for more or fewer', () => {
    expect(count(scatterPlants(mulberry32(3), 200, bounds, avoid, { density: 1 }))).toBe(200);
    expect(count(scatterPlants(mulberry32(3), 200, bounds, avoid, { density: 0.25 }))).toBe(50);
    expect(scatterPlants(mulberry32(3), 200, bounds, avoid, { density: 0 }).children).toHaveLength(0);
  });

  it('thins the same layout rather than making a new one: the kept plants are the first of the full scatter', () => {
    const at = (density: number): Array<[number, number]> => {
      const mesh = scatterPlants(mulberry32(8), 100, bounds, avoid, { density }).getObjectByName('plant-tufts') as THREE.InstancedMesh;
      const m = new THREE.Matrix4();
      return Array.from({ length: mesh.count }, (_, i): [number, number] => {
        mesh.getMatrixAt(i, m);
        return [m.elements[12]!, m.elements[14]!];
      });
    };
    expect(at(1).slice(0, 60)).toEqual(at(0.6));
  });
});

describe('plant color: the models are painted in natural greens, so nothing is recolored', () => {
  it('tells foliage (all leaf green) from flowers, mushrooms, and the old mint-teal', () => {
    expect(isFoliageOnly(paintedGeometry([GREEN, DARK_GREEN, GREEN]))).toBe(true);
    expect(isFoliageOnly(paintedGeometry([GREEN, RED, GREEN]))).toBe(false); // a flower: green stem, red petals
    expect(isFoliageOnly(paintedGeometry([CREAM, RED]))).toBe(false); // a mushroom
    expect(isFoliageOnly(paintedGeometry([GREEN, YELLOW, PURPLE]))).toBe(false);
    expect(isFoliageOnly(paintedGeometry([MINT]))).toBe(false); // mint is not a leaf green
    const plain = new THREE.BoxGeometry(1, 1, 1);
    plain.deleteAttribute('color');
    expect(isFoliageOnly(plain)).toBe(false);
  });

  it('finds the real grass and bush models all green, and the real flowers and mushrooms not', async () => {
    for (const id of ['plant.grass', 'plant.grass.large', 'plant.bush', 'plant.bush.large']) {
      expect(isFoliageOnly(await realGeometry(id)), `${id} is foliage`).toBe(true);
    }
    for (const id of ['plant.flower.red', 'plant.flower.yellow', 'plant.flower.purple', 'plant.mushroom']) {
      expect(isFoliageOnly(await realGeometry(id)), `${id} keeps its own colors`).toBe(false);
    }
  });

  it('has no teal left to repair: no plant model has the old kit mint (hue 160 to 200)', async () => {
    const color = new THREE.Color();
    const hsl = { h: 0, s: 0, l: 0 };
    for (const id of Object.keys(manifest.models).filter((i) => i.startsWith('plant.'))) {
      const attr = (await realGeometry(id)).getAttribute('color');
      for (let i = 0; i < attr.count; i++) {
        color.setRGB(attr.getX(i), attr.getY(i), attr.getZ(i), THREE.LinearSRGBColorSpace).getHSL(hsl, THREE.SRGBColorSpace);
        const hue = hsl.h * 360;
        expect(hue >= 160 && hue <= 200 && hsl.s > 0.15, `${id} vertex ${i} hue ${hue.toFixed(0)}`).toBe(false);
      }
    }
  });
});

describe('varyPlants (per instance)', () => {
  it('gives foliage a slight shift per instance, close to 1, so a field of tufts is not one flat green', () => {
    const mesh = meshOf([GREEN, DARK_GREEN, GREEN]);
    varyPlants(mesh, mulberry32(4));
    expect(mesh.instanceColor).not.toBeNull();
    const shifts = Array.from({ length: mesh.count }, (_, i) => {
      const c = new THREE.Color();
      mesh.getColorAt(i, c);
      return [c.r, c.g, c.b] as const;
    });
    for (const [r, g, b] of shifts) {
      // lightness moves green by at most the spread; warmth moves red and blue the other way round
      expect(g).toBeGreaterThanOrEqual(1 - PLANT_LIGHTNESS_SPREAD - 1e-6);
      expect(g).toBeLessThanOrEqual(1 + PLANT_LIGHTNESS_SPREAD + 1e-6);
      expect(r).toBeGreaterThan(g * (1 - PLANT_WARMTH_SPREAD) - 1e-6);
      expect(r).toBeLessThan(g * (1 + PLANT_WARMTH_SPREAD) + 1e-6);
      expect(b).toBeGreaterThan(g * (1 - PLANT_WARMTH_SPREAD) - 1e-6);
      expect(b).toBeLessThan(g * (1 + PLANT_WARMTH_SPREAD) + 1e-6);
      expect(r + b).toBeCloseTo(2 * g, 5); // warmer means more red and less blue by the same amount
    }
    expect(new Set(shifts.map((s) => s.join(','))).size).toBeGreaterThan(30); // not all the same
  });

  it('is the same shifts for the same seed', () => {
    const colorsOf = (seed: number): number[] => {
      const mesh = meshOf([GREEN]);
      varyPlants(mesh, mulberry32(seed));
      return Array.from(mesh.instanceColor!.array);
    };
    expect(colorsOf(7)).toEqual(colorsOf(7));
    expect(colorsOf(7)).not.toEqual(colorsOf(8));
  });

  it('leaves the painted vertex colors exactly as they are, for foliage and for flowers', () => {
    const grass = meshOf([GREEN, DARK_GREEN]);
    varyPlants(grass, mulberry32(4));
    expect(vertexColor(grass.geometry, 0)).toEqual(stored(GREEN));
    expect(vertexColor(grass.geometry, 1)).toEqual(stored(DARK_GREEN));
    const flower = meshOf([GREEN, GREEN, RED, RED]);
    varyPlants(flower, mulberry32(4));
    expect(vertexColor(flower.geometry, 2)).toEqual(stored(RED));
  });

  it('gives flowers and mushrooms no shift at all, so petals and caps stay as painted', () => {
    for (const colors of [[GREEN, GREEN, RED, RED], [CREAM, RED, CREAM], [YELLOW, PURPLE]]) {
      const mesh = meshOf(colors);
      varyPlants(mesh, mulberry32(4));
      expect(mesh.instanceColor).toBeNull();
    }
  });

  it('draws nothing from the random source for a model it leaves alone, so the layout never shifts', () => {
    let draws = 0;
    const counting = (): number => {
      draws++;
      return 0.5;
    };
    varyPlants(meshOf([RED, RED]), counting);
    expect(draws).toBe(0);
    varyPlants(meshOf([GREEN], 10), counting);
    expect(draws).toBe(20); // two per instance
  });

  it('survives a mesh with no vertex colors (a model that was not painted)', () => {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), 5);
    mesh.geometry.deleteAttribute('color');
    expect(() => varyPlants(mesh, mulberry32(1))).not.toThrow();
    expect(mesh.instanceColor).toBeNull();
  });

  it('keeps tintPlants for the Town Square planters: it only varies when it is given a random source', () => {
    const planter = meshOf([GREEN, DARK_GREEN], 6);
    tintPlants(planter);
    expect(planter.instanceColor).toBeNull();
    expect(vertexColor(planter.geometry, 0)).toEqual(stored(GREEN)); // no recolor: the models are already green
    const varied = meshOf([GREEN], 6);
    tintPlants(varied, mulberry32(2));
    expect(varied.instanceColor).not.toBeNull();
  });
});

describe('scatterPlants with the models loaded', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Pretend the plant models loaded: grass and bushes are all green, flowers have red petals, the mushroom is red and cream. */
  function fakePlantAssets(): void {
    vi.spyOn(assets, 'load').mockResolvedValue(undefined);
    vi.spyOn(assets, 'has').mockReturnValue(true);
    vi.spyOn(assets, 'instanced').mockImplementation((id, n) => {
      const colors = id.startsWith('plant.flower') ? [GREEN, GREEN, RED, RED] : id === 'plant.mushroom' ? [CREAM, RED, CREAM] : [GREEN, DARK_GREEN, GREEN];
      const mesh = new THREE.InstancedMesh(paintedGeometry(colors), new THREE.MeshLambertMaterial({ vertexColors: true }), n);
      mesh.name = id;
      return mesh;
    });
  }

  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it('swaps the tufts for the models in one draw call per model (8 at most), grass and bushes varied, the rest as painted', async () => {
    fakePlantAssets();
    const plants = scatterPlants(mulberry32(5), 300, bounds, avoid);
    await flush();
    expect(plants.getObjectByName('plant-tufts')).toBeUndefined();
    const meshes = plants.children as THREE.InstancedMesh[];
    expect(meshes.length).toBeGreaterThan(3);
    expect(meshes.length).toBeLessThanOrEqual(8);
    let planted = 0;
    for (const mesh of meshes) {
      planted += mesh.count;
      const foliage = !mesh.name.startsWith('plant.flower') && mesh.name !== 'plant.mushroom';
      if (foliage) expect(mesh.instanceColor, `${mesh.name} varies per instance`).not.toBeNull();
      else expect(mesh.instanceColor, `${mesh.name} keeps its colors`).toBeNull();
      // never recolored: the first vertex is exactly what the model was painted with
      const painted = foliage ? GREEN : mesh.name === 'plant.mushroom' ? CREAM : GREEN;
      expect(vertexColor(mesh.geometry, 0)).toEqual(stored(painted));
    }
    expect(planted).toBe(180); // 300 asked for, 60 percent kept
  });

  it('puts the models on exactly the spots the tufts had: the layout is the same whichever art is showing', async () => {
    const at = (group: THREE.Group): string[] => {
      const m = new THREE.Matrix4();
      const out: string[] = [];
      for (const child of group.children as THREE.InstancedMesh[]) {
        for (let i = 0; i < child.count; i++) {
          child.getMatrixAt(i, m);
          out.push(`${m.elements[12]!.toFixed(4)},${m.elements[14]!.toFixed(4)}`);
        }
      }
      return out.sort();
    };
    const tufts = scatterPlants(mulberry32(6), 200, bounds, avoid); // models not loaded yet: the tufts
    const tuftSpots = at(tufts);
    fakePlantAssets();
    const withModels = scatterPlants(mulberry32(6), 200, bounds, avoid);
    await flush();
    expect(withModels.getObjectByName('plant-tufts')).toBeUndefined();
    expect(at(withModels)).toEqual(tuftSpots);
  });

  it('uses the model ids a zone picks (a zone with its own mix), with the same rules for color', async () => {
    fakePlantAssets();
    const plants = scatterPlants(mulberry32(5), 100, bounds, avoid, { ids: ['plant.grass', 'plant.flower.red'] });
    await flush();
    expect(plants.children.map((c) => c.name).sort()).toEqual(['plant.flower.red', 'plant.grass']);
    const byName = (name: string): THREE.InstancedMesh => plants.getObjectByName(name) as THREE.InstancedMesh;
    expect(byName('plant.grass').instanceColor).not.toBeNull();
    expect(byName('plant.flower.red').instanceColor).toBeNull();
  });
});
