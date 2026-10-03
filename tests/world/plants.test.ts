import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assets } from '../../src/engine/assets';
import { mulberry32 } from '../../src/engine/seed';
import { DEFAULT_PLANT_DENSITY, scatterPlants, tintPlants, tintTealVertices, type AvoidCircle } from '../../src/world/props';

const bounds = { minX: -24, maxX: 24, minZ: -24, maxZ: 24 };
const avoid: AvoidCircle[] = [{ x: 0, z: 0, radius: 6 }];

type RGB = readonly [number, number, number];

/** The kit's teal, and some petal colors, as the GLBs store them (linear RGB). */
const TEAL: RGB = [0.173, 0.847, 0.722];
const RED: RGB = [0.878, 0.29, 0.314];
const YELLOW: RGB = [0.996, 0.694, 0.278];
const PURPLE: RGB = [0.624, 0.537, 1.0];
const WHITE: RGB = [1, 1, 1];

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

const hexOf = (rgb: RGB): string => new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2]).getHexString();

/** A color's hue in degrees, as it looks on screen (sRGB), from linear RGB. */
function screenHue(rgb: RGB): number {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2]).getHSL(hsl, THREE.SRGBColorSpace);
  return hsl.h * 360;
}

/** The per-vertex COLOR_0 values of the first mesh in a GLB (the kit stores plain float vec3s). */
function glbVertexColors(file: string): RGB[] {
  const bytes = readFileSync(file);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString()) as {
    meshes: Array<{ primitives: Array<{ attributes: Record<string, number> }> }>;
    accessors: Array<{ bufferView: number; byteOffset?: number; count: number; componentType: number }>;
    bufferViews: Array<{ byteOffset?: number; byteStride?: number }>;
  };
  const bin = bytes.subarray(20 + jsonLength + 8);
  const accessor = json.accessors[json.meshes[0]!.primitives[0]!.attributes.COLOR_0!]!;
  expect(accessor.componentType).toBe(5126); // float
  const view = json.bufferViews[accessor.bufferView]!;
  const stride = view.byteStride ?? 12;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  return Array.from({ length: accessor.count }, (_, i): RGB => [
    bin.readFloatLE(start + i * stride),
    bin.readFloatLE(start + i * stride + 4),
    bin.readFloatLE(start + i * stride + 8),
  ]);
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

describe('plant color', () => {
  it('shifts the kit teal to a natural grass green, and nothing else', () => {
    const geometry = paintedGeometry([TEAL, RED, TEAL, YELLOW, PURPLE, WHITE]);
    expect(tintTealVertices(geometry)).toEqual({ teal: 2, total: 6 });
    expect(screenHue(TEAL)).toBeGreaterThan(160); // it really was teal
    for (const i of [0, 2]) {
      const rgb = vertexColor(geometry, i);
      expect(rgb[1]).toBeGreaterThan(rgb[0] * 2); // green, not teal: far more green than red...
      expect(rgb[1]).toBeGreaterThan(rgb[2] * 4); // ...and almost no blue (the teal had blue at 85 percent of its green)
      expect(screenHue(rgb)).toBeGreaterThan(95);
      expect(screenHue(rgb)).toBeLessThan(125); // grass, not mint
      expect(hexOf(rgb)).toBe('4e9b3a');
    }
    // Petals and mushroom white: exactly as painted.
    expect(vertexColor(geometry, 1)).toEqual(stored(RED));
    expect(vertexColor(geometry, 3)).toEqual(stored(YELLOW));
    expect(vertexColor(geometry, 4)).toEqual(stored(PURPLE));
    expect(vertexColor(geometry, 5)).toEqual(stored(WHITE));
  });

  it('leaves a geometry without vertex colors alone', () => {
    const plain = new THREE.BoxGeometry(1, 1, 1);
    plain.deleteAttribute('color');
    expect(tintTealVertices(plain)).toEqual({ teal: 0, total: 0 });
  });

  it('does not tint twice into black: a green vertex is not teal, so a second pass changes nothing', () => {
    const geometry = paintedGeometry([TEAL, RED]);
    tintTealVertices(geometry);
    const once = [vertexColor(geometry, 0), vertexColor(geometry, 1)];
    expect(tintTealVertices(geometry)).toEqual({ teal: 0, total: 2 });
    expect([vertexColor(geometry, 0), vertexColor(geometry, 1)]).toEqual(once);
  });

  it('matches the real models: the teal in the GLBs is the teal the tint expects, and flowers keep their petals', () => {
    const dir = 'public/assets/models/kenney-nature-kit';
    const grass = paintedGeometry(glbVertexColors(`${dir}/grass.glb`));
    const grassResult = tintTealVertices(grass);
    expect(grassResult.teal).toBe(grassResult.total); // every blade is teal, so every blade turns green
    expect(grassResult.total).toBeGreaterThan(50);
    for (let i = 0; i < grassResult.total; i++) expect(hexOf(vertexColor(grass, i))).toBe('4e9b3a');

    for (const file of ['flower_redA', 'flower_yellowA', 'flower_purpleA']) {
      const raw = glbVertexColors(`${dir}/${file}.glb`);
      const flower = paintedGeometry(raw);
      const { teal, total } = tintTealVertices(flower);
      expect(teal, `${file} has stems to tint`).toBeGreaterThan(0);
      expect(teal, `${file} has petals to keep`).toBeLessThan(total);
      raw.forEach((original, i) => {
        const after = vertexColor(flower, i);
        const wasTeal = Math.abs(original[0] - TEAL[0]) < 0.01 && Math.abs(original[1] - TEAL[1]) < 0.01;
        if (wasTeal) expect(hexOf(after)).toBe('4e9b3a'); // stem: green
        else expect(after).toEqual(stored(original)); // petal: untouched
      });
    }
  });
});

describe('tintPlants (per instance)', () => {
  const meshOf = (colors: readonly RGB[], count = 40): THREE.InstancedMesh =>
    new THREE.InstancedMesh(paintedGeometry(colors), new THREE.MeshLambertMaterial({ vertexColors: true }), count);

  it('gives foliage a slight shift per instance, close to 1, so a field of tufts is not one flat green', () => {
    const mesh = meshOf([TEAL, TEAL, TEAL]);
    tintPlants(mesh, mulberry32(4));
    expect(mesh.instanceColor).not.toBeNull();
    const shifts = Array.from({ length: mesh.count }, (_, i) => {
      const c = new THREE.Color();
      mesh.getColorAt(i, c);
      return [c.r, c.g, c.b] as const;
    });
    for (const [r, g, b] of shifts) {
      for (const v of [r, g, b]) {
        expect(v).toBeGreaterThan(0.4);
        expect(v).toBeLessThan(2); // red and blue are small numbers, so a hue nudge moves them most
      }
      expect(g).toBeGreaterThan(0.8); // lightness changes a little, never wildly
      expect(g).toBeLessThan(1.25);
    }
    expect(new Set(shifts.map((s) => s.join(','))).size).toBeGreaterThan(30); // not all the same
  });

  it('is the same shifts for the same seed', () => {
    const colorsOf = (seed: number): number[] => {
      const mesh = meshOf([TEAL]);
      tintPlants(mesh, mulberry32(seed));
      return Array.from(mesh.instanceColor!.array);
    };
    expect(colorsOf(7)).toEqual(colorsOf(7));
    expect(colorsOf(7)).not.toEqual(colorsOf(8));
  });

  it("tints flowers' stems but gives them no shift, so petals stay as painted", () => {
    const mesh = meshOf([TEAL, TEAL, RED, RED]);
    tintPlants(mesh, mulberry32(4));
    expect(mesh.instanceColor).toBeNull();
    expect(vertexColor(mesh.geometry, 0)[0]).toBeLessThan(TEAL[0]); // the stem went green
    expect(vertexColor(mesh.geometry, 2)).toEqual(stored(RED));
  });

  it('gives no shift without a random source (planters want every bush alike)', () => {
    const mesh = meshOf([TEAL]);
    tintPlants(mesh);
    expect(mesh.instanceColor).toBeNull();
    expect(vertexColor(mesh.geometry, 0)[1]).toBeCloseTo(0.327, 2);
  });

  it('survives a mesh with no vertex colors (a model that was not painted)', () => {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), 5);
    mesh.geometry.deleteAttribute('color');
    expect(() => tintPlants(mesh, mulberry32(1))).not.toThrow();
    expect(mesh.instanceColor).toBeNull();
  });
});

describe('scatterPlants with the models loaded', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Pretend the plant models loaded: each is a little teal mesh, flowers with red petals too. */
  function fakePlantAssets(): void {
    vi.spyOn(assets, 'load').mockResolvedValue(undefined);
    vi.spyOn(assets, 'has').mockReturnValue(true);
    vi.spyOn(assets, 'instanced').mockImplementation((id, n) => {
      const colors = id.startsWith('plant.flower') ? [TEAL, TEAL, RED, RED] : [TEAL, TEAL, TEAL];
      const mesh = new THREE.InstancedMesh(paintedGeometry(colors), new THREE.MeshLambertMaterial({ vertexColors: true }), n);
      mesh.name = id;
      return mesh;
    });
  }

  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it('swaps the tufts for the models, tinted green, in one draw call per model (8 at most)', async () => {
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
      const [r, g] = vertexColor(mesh.geometry, 0);
      expect(g).toBeGreaterThan(r * 2); // the first vertex of every model is a stem or a blade, and it is green now
      expect(g).toBeLessThan(0.5); // and darker than the mint it was (0.847)
      if (mesh.name.startsWith('plant.flower')) {
        expect(vertexColor(mesh.geometry, 3)).toEqual(stored(RED));
        expect(mesh.instanceColor).toBeNull();
      } else {
        expect(mesh.instanceColor).not.toBeNull();
      }
    }
    expect(planted).toBe(180); // 300 asked for, 60 percent kept
  });

  it('tints the models picked by id too (a zone with its own mix)', async () => {
    fakePlantAssets();
    const plants = scatterPlants(mulberry32(5), 100, bounds, avoid, { ids: ['plant.grass', 'plant.bush'] });
    await flush();
    expect(plants.children.map((c) => c.name).sort()).toEqual(['plant.bush', 'plant.grass']);
    for (const mesh of plants.children as THREE.InstancedMesh[]) expect(vertexColor(mesh.geometry, 0)[1]).toBeLessThan(0.5);
  });
});
