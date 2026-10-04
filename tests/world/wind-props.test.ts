import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assets } from '../../src/engine/assets';
import { mulberry32 } from '../../src/engine/seed';
import {
  campfire,
  flagpole,
  instancedModel,
  lodge,
  personPlaceholder,
  rock,
  scatterModels,
  scatterPlants,
  tree,
  type AvoidCircle,
} from '../../src/world/props';
import { hasWind, WIND_CACHE_KEY, WIND_KINDS, windKindFor } from '../../src/world/wind';

const bounds = { minX: -24, maxX: 24, minZ: -24, maxZ: 24 };
const avoid: AvoidCircle[] = [{ x: 0, z: 0, radius: 6 }];
const spots = [
  { x: 1, z: 2 },
  { x: -3, z: 4 },
  { x: 6, z: -5 },
];
const plain = new THREE.MeshLambertMaterial().onBeforeCompile;

const meshesOf = (root: THREE.Object3D): THREE.Mesh[] => {
  const found: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) found.push(o as THREE.Mesh);
  });
  return found;
};
const swaysAt = (mesh: THREE.Mesh): boolean => hasWind(mesh.material as THREE.Material);
const isStill = (mesh: THREE.Mesh, shared?: THREE.Material): boolean =>
  !swaysAt(mesh) && mesh.customDepthMaterial === undefined && (mesh.material as THREE.Material).onBeforeCompile === plain && (shared === undefined || mesh.material === shared);

/**
 * Pretend every model loaded, all of them painted with ONE material (as when several models of a kit
 * share a palette material), so a patch that touched the source would show up on the rocks and tents.
 */
const SHARED = new THREE.MeshLambertMaterial({ vertexColors: true, name: 'kit palette' });

function fakeAssets(): void {
  vi.spyOn(assets, 'load').mockResolvedValue(undefined);
  vi.spyOn(assets, 'has').mockReturnValue(true);
  vi.spyOn(assets, 'instanced').mockImplementation((id, n) => {
    const tall = id.startsWith('tree.') ? 5 : id.startsWith('plant.grass') ? 0.9 : id.startsWith('plant.') ? 0.8 : 1;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, tall, 1).translate(0, tall / 2, 0), SHARED, n);
    mesh.name = id;
    return mesh;
  });
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('wind on model props (instancedModel)', () => {
  beforeEach(fakeAssets);
  const placements = spots.map((s) => ({ x: s.x, z: s.z }));

  it('sways trees, bushes, grass and flowers, each on a copy of the material, with a shadow that sways too', () => {
    const ids = ['tree.pine', 'tree.pine.tall', 'tree.round', 'tree.oak', 'plant.bush', 'plant.bush.large', 'plant.grass', 'plant.grass.large', 'plant.flower.red', 'plant.flower.yellow', 'plant.flower.purple'];
    const copies = new Map<string, THREE.Material>();
    for (const id of ids) {
      const mesh = instancedModel(id, placements)!;
      expect(mesh.isInstancedMesh, id).toBe(true);
      expect(mesh.count).toBe(3);
      expect(mesh.name).toBe(id);
      expect(swaysAt(mesh), id).toBe(true);
      expect(mesh.material, id).not.toBe(SHARED);
      expect((mesh.material as THREE.Material).customProgramCacheKey()).toBe(WIND_CACHE_KEY);
      expect(mesh.customDepthMaterial, id).toBeInstanceOf(THREE.MeshDepthMaterial);
      expect(hasWind(mesh.customDepthMaterial!), id).toBe(true);
      expect((mesh.material as THREE.MeshLambertMaterial).vertexColors).toBe(true); // the copy keeps the model's look
      copies.set(id, mesh.material as THREE.Material);
    }
    expect(hasWind(SHARED)).toBe(false);
    expect(SHARED.onBeforeCompile).toBe(plain);
    // asking again (another zone, another mesh) reuses the copy: no new material, no new program
    expect(instancedModel('tree.oak', placements)!.material).toBe(copies.get('tree.oak'));
  });

  it('never sways rocks, stumps, logs, tents, mushrooms or buildings, even though they share the very same source material', () => {
    const ids = ['rock.large', 'rock.tall', 'rock.small', 'rock.flat', 'stump', 'log.single', 'log.large', 'log.stack', 'tent', 'tent.small', 'tent.open', 'plant.mushroom', 'building.firestation', 'street.lamp', 'fence.simple', 'signpost'];
    for (const id of ids) {
      expect(windKindFor(id), id).toBeNull();
      const mesh = instancedModel(id, placements)!;
      expect(isStill(mesh, SHARED), id).toBe(true);
    }
    // ...even after trees (same source material) were made to sway
    const trees = instancedModel('tree.round', placements)!;
    expect(swaysAt(trees)).toBe(true);
    expect(isStill(instancedModel('rock.large', placements)!, SHARED)).toBe(true);
    expect(hasWind(SHARED)).toBe(false);
  });

  it('keeps the shadow flags and the placements as they were', () => {
    const mesh = instancedModel('tree.round', placements, { cast: true, receive: false })!;
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(false);
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(1, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).toArray()).toEqual([-3, 0, 4]);
    expect(instancedModel('tree.round', [])).toBeUndefined();
  });

  it('scatterModels sways the trees it scatters and not the rocks', () => {
    const trees = scatterModels('trees', ['tree.pine', 'tree.oak'], spots, mulberry32(1), [0.9, 1.3])!;
    expect(trees.children.length).toBeGreaterThan(0);
    for (const m of meshesOf(trees)) expect(swaysAt(m), m.name).toBe(true);
    const rocks = scatterModels('rocks', ['rock.large', 'rock.small'], spots, mulberry32(1), [0.8, 1.4])!;
    for (const m of meshesOf(rocks)) expect(isStill(m, SHARED), m.name).toBe(true);
  });
});

describe('wind on the plant scatter', () => {
  beforeEach(fakeAssets);

  it('sways the tufts that show before the models arrive, as grass', () => {
    vi.restoreAllMocks(); // models not loaded: the placeholder
    const plants = scatterPlants(mulberry32(3), 120, bounds, avoid);
    const tufts = plants.getObjectByName('plant-tufts') as THREE.InstancedMesh;
    expect(swaysAt(tufts)).toBe(true);
    expect(tufts.customDepthMaterial).toBeInstanceOf(THREE.MeshDepthMaterial);
    expect(tufts.castShadow).toBe(false);
  });

  it('sways grass, flowers and bushes once the models are in, and leaves mushrooms still', async () => {
    const plants = scatterPlants(mulberry32(5), 400, bounds, avoid);
    await flush();
    const meshes = plants.children as THREE.InstancedMesh[];
    const names = meshes.map((m) => m.name);
    expect(names).toEqual(expect.arrayContaining(['plant.grass', 'plant.mushroom', 'plant.bush']));
    for (const mesh of meshes) {
      if (mesh.name === 'plant.mushroom') expect(isStill(mesh, SHARED), mesh.name).toBe(true);
      else expect(swaysAt(mesh), mesh.name).toBe(true);
      expect(mesh.castShadow, mesh.name).toBe(false); // plants only receive shadows, as before
    }
    expect(hasWind(SHARED)).toBe(false);
  });

  it('gives grass and flowers the strongest sway of the lot', async () => {
    const plants = scatterPlants(mulberry32(5), 400, bounds, avoid);
    await flush();
    const strength = (name: string): number => {
      const mesh = plants.getObjectByName(name) as THREE.InstancedMesh;
      const shader = { vertexShader: THREE.ShaderLib.lambert.vertexShader, uniforms: {} as Record<string, THREE.IUniform> };
      (mesh.material as THREE.Material).onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
      return shader.uniforms.uWindStrength!.value as number;
    };
    expect(strength('plant.grass')).toBe(WIND_KINDS.grass.strength);
    expect(strength('plant.bush')).toBe(WIND_KINDS.bush.strength);
    expect(strength('plant.grass')).toBeGreaterThanOrEqual(strength('plant.bush'));
  });
});

describe('wind on the primitive props', () => {
  it('sways the crowns of the primitive trees and not their trunks', () => {
    const [trunks, crowns] = tree(mulberry32(1), spots).children as THREE.InstancedMesh[];
    expect(swaysAt(crowns!)).toBe(true);
    expect(crowns!.customDepthMaterial).toBeInstanceOf(THREE.MeshDepthMaterial);
    expect(crowns!.castShadow).toBe(true);
    expect(isStill(trunks!)).toBe(true);
  });

  it('never sways the rocks, the fire, the flagpole, the lodge or a person', () => {
    const still: THREE.Object3D[] = [rock(mulberry32(1), spots), campfire().root, flagpole(), lodge(), personPlaceholder(0xf2c14e, 1.95)];
    for (const root of still) {
      for (const mesh of meshesOf(root)) expect(isStill(mesh), `${root.name} ${mesh.name}`).toBe(true);
    }
  });
});
