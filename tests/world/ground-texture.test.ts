/// <reference types="node" />
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../../src/engine/seed';
import {
  applyGroundTexture,
  createGround,
  createGroundTexture,
  dirtWeight,
  GROUND_TEXTURE_GAIN,
  GROUND_TEXTURE_MEAN,
  GROUND_TEXTURE_SIZE,
  GROUND_TEXTURE_TILE,
  groundTexturePixels,
  patchedGroundShaders,
  type GroundTextureMode,
} from '../../src/world/ground';
import { zoneTerrain } from '../../src/world/terrain';
import { createZone, ZONE_IDS } from '../../src/world/zones';

const N = GROUND_TEXTURE_SIZE;
const dataOf = (mesh: THREE.Mesh): { mode: GroundTextureMode; texture: THREE.Texture } =>
  (mesh.material as THREE.Material).userData.groundTexture as { mode: GroundTextureMode; texture: THREE.Texture };
const channel = (pixels: Uint8Array, c: number): number[] => Array.from({ length: pixels.length / 4 }, (_, i) => pixels[i * 4 + c]! / 255);
const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
const std = (v: number[]): number => {
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
};

describe('the ground texture (pixels)', () => {
  const pixels = groundTexturePixels();

  it('is N by N RGBA with a full alpha channel', () => {
    expect(pixels).toBeInstanceOf(Uint8Array);
    expect(pixels.length).toBe(N * N * 4);
    let notOpaque = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 255) notOpaque++;
    expect(notOpaque).toBe(0);
  });

  it('is deterministic: the same seed gives the same texels, another seed gives different ones', () => {
    expect(Buffer.from(groundTexturePixels()).equals(Buffer.from(pixels))).toBe(true);
    expect(Buffer.from(groundTexturePixels(N, 4242)).equals(Buffer.from(pixels))).toBe(false);
    expect(groundTexturePixels(64, 3).length).toBe(64 * 64 * 4);
  });

  it('keeps the average brightness of the grass and pebble layers where the shader gain expects it', () => {
    expect(GROUND_TEXTURE_MEAN * GROUND_TEXTURE_GAIN).toBeCloseTo(1, 10);
    expect(mean(channel(pixels, 0))).toBeCloseTo(GROUND_TEXTURE_MEAN, 1);
    expect(mean(channel(pixels, 1))).toBeCloseTo(GROUND_TEXTURE_MEAN, 1);
    expect(mean(channel(pixels, 2))).toBeCloseTo(0.5, 1); // the tint is centered: no overall warm or cool shift
  });

  it('has soft speckle on the grass layer and clearer marks on the pebble layer, both subtle and in range', () => {
    const grass = channel(pixels, 0);
    const pebbles = channel(pixels, 1);
    expect(std(grass)).toBeGreaterThan(0.025);
    expect(std(grass)).toBeLessThan(0.1); // subtle
    expect(std(pebbles)).toBeGreaterThan(0.04);
    expect(std(pebbles)).toBeLessThan(0.14);
    for (const layer of [grass, pebbles]) {
      const lowest = layer.reduce((a, b) => Math.min(a, b), 1);
      const highest = layer.reduce((a, b) => Math.max(a, b), 0);
      expect(lowest).toBeGreaterThanOrEqual(0.5);
      expect(highest).toBeLessThanOrEqual(1);
    }
    expect(std(channel(pixels, 2))).toBeGreaterThan(0.01); // the tint varies a little
  });

  it('has lighter and darker marks on both sides of the average (not only darkening)', () => {
    for (const c of [0, 1]) {
      const v = channel(pixels, c);
      const m = mean(v);
      expect(v.filter((x) => x > m + 0.04).length).toBeGreaterThan(v.length * 0.01);
      expect(v.filter((x) => x < m - 0.04).length).toBeGreaterThan(v.length * 0.01);
    }
  });

  it('tiles: across the wrapped edge it changes no more than between neighbors inside', () => {
    for (const c of [0, 1, 2]) {
      const v = channel(pixels, c);
      let seamX = 0;
      let seamY = 0;
      let insideX = 0;
      let insideY = 0;
      for (let i = 0; i < N; i++) {
        seamX += Math.abs(v[i * N]! - v[i * N + N - 1]!); // right edge to left edge, row i
        seamY += Math.abs(v[i]! - v[(N - 1) * N + i]!); // bottom edge to top edge, column i
      }
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N - 1; x++) {
          insideX += Math.abs(v[y * N + x]! - v[y * N + x + 1]!);
          insideY += Math.abs(v[x * N + y]! - v[(x + 1) * N + y]!);
        }
      }
      insideX /= N * (N - 1);
      insideY /= N * (N - 1);
      expect(seamX / N, `channel ${c}, across x`).toBeLessThan(insideX * 1.5 + 0.004);
      expect(seamY / N, `channel ${c}, across y`).toBeLessThan(insideY * 1.5 + 0.004);
    }
  });

  it('does not repeat inside one tile: the pattern is not correlated with itself at an offset', () => {
    for (const c of [0, 1]) {
      const v = channel(pixels, c);
      const m = mean(v);
      let cov = 0;
      for (let i = 0; i < v.length; i++) cov += (v[i]! - m) * (v[(i + 37 * N + 11) % v.length]! - m);
      expect(Math.abs(cov / v.length / std(v) ** 2), `channel ${c}`).toBeLessThan(0.2);
    }
  });
});

describe('the ground texture (Three.js)', () => {
  const texture = createGroundTexture();

  it('is a typed-array DataTexture, repeat-wrapped and mipmapped, with no color space (it is a multiplier)', () => {
    expect(texture).toBeInstanceOf(THREE.DataTexture);
    expect(texture.image.width).toBe(N);
    expect(texture.image.height).toBe(N);
    expect(texture.image.data).toBeInstanceOf(Uint8Array);
    expect(texture.format).toBe(THREE.RGBAFormat);
    expect(texture.type).toBe(THREE.UnsignedByteType);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.wrapT).toBe(THREE.RepeatWrapping);
    expect(texture.generateMipmaps).toBe(true);
    expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(texture.magFilter).toBe(THREE.LinearFilter);
    expect(texture.colorSpace).toBe(THREE.NoColorSpace);
    expect(texture.anisotropy).toBeGreaterThan(1);
    expect(Buffer.from(texture.image.data as Uint8Array).equals(Buffer.from(groundTexturePixels()))).toBe(true);
  });

  it('is shared: every ground and every zone gets the same texture object', () => {
    expect(createGroundTexture()).toBe(texture);
  });
});

describe('applying the texture to a material', () => {
  const lambert = THREE.ShaderLib.lambert;
  const balanced = (s: string): boolean => (s.match(/\{/g) ?? []).length === (s.match(/\}/g) ?? []).length;

  it.each(['grass', 'pebbles', 'blend', 'paved'] as GroundTextureMode[])('patches the Lambert shaders in %s mode', (mode) => {
    const { vertexShader, fragmentShader } = patchedGroundShaders(mode, lambert.vertexShader, lambert.fragmentShader);
    // Looked up by world position, one tile per GROUND_TEXTURE_TILE units, with no UVs involved.
    expect(vertexShader).toContain('varying vec2 vGroundUv;');
    expect(vertexShader).toContain(`vGroundUv = transformed.xz * ${(1 / GROUND_TEXTURE_TILE).toFixed(6)};`);
    expect(vertexShader.indexOf('vGroundUv = ')).toBeGreaterThan(vertexShader.indexOf('#include <begin_vertex>'));
    expect(fragmentShader).toContain('uniform sampler2D groundMap;');
    expect(fragmentShader).toContain('varying vec2 vGroundUv;');
    expect(fragmentShader).toContain('texture2D( groundMap, vGroundUv )');
    expect(fragmentShader).toContain(`* ${GROUND_TEXTURE_GAIN.toFixed(2)};`);
    // The multiply lands after the material's own color and before the lighting.
    expect(fragmentShader.indexOf('groundMap, vGroundUv )')).toBeGreaterThan(fragmentShader.indexOf('vec4 diffuseColor'));
    expect(fragmentShader.indexOf('groundMap, vGroundUv )')).toBeLessThan(fragmentShader.indexOf('#include <lights_lambert_fragment>'));
    expect(balanced(vertexShader)).toBe(true);
    expect(balanced(fragmentShader)).toBe(true);

    const needsDirt = mode === 'blend' || mode === 'paved';
    expect(vertexShader.includes('attribute float dirt;')).toBe(needsDirt);
    expect(vertexShader.includes('vDirt = dirt;')).toBe(needsDirt);
    expect(fragmentShader.includes('varying float vDirt;')).toBe(needsDirt);
    expect(fragmentShader.includes('vDirt')).toBe(needsDirt);
  });

  it('shows the blades in grass mode, the pebbles in pebbles mode, a mix by the dirt weight in blend mode, and plain paving in paved mode', () => {
    const fragment = (mode: GroundTextureMode): string => patchedGroundShaders(mode, lambert.vertexShader, lambert.fragmentShader).fragmentShader;
    expect(fragment('grass')).toContain('diffuseColor.rgb *= ( vec3( grassMod ) * tint )');
    expect(fragment('pebbles')).toContain('diffuseColor.rgb *= ( vec3( pebbleMod ) )');
    expect(fragment('blend')).toContain('mix( vec3( grassMod ) * tint, vec3( pebbleMod ), vDirt )');
    expect(fragment('paved')).toContain('mix( vec3( grassMod ) * tint, vec3( 1.0 ), vDirt )');
  });

  it('compiles each mode to its own program, and puts the texture in the shader uniforms', () => {
    const keys = (['grass', 'pebbles', 'blend', 'paved'] as GroundTextureMode[]).map((mode) => {
      const material = applyGroundTexture(new THREE.MeshLambertMaterial(), texture(), mode);
      const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: lambert.vertexShader, fragmentShader: lambert.fragmentShader };
      (material.onBeforeCompile as unknown as (s: typeof shader, r: unknown) => void)(shader, undefined);
      expect(shader.uniforms.groundMap!.value).toBe(texture());
      expect(material.userData.groundTexture).toMatchObject({ mode });
      return material.customProgramCacheKey();
    });
    expect(new Set(keys).size).toBe(4);
  });

  it('leaves the stock program alone for a material it was never applied to', () => {
    const { vertexShader, fragmentShader } = patchedGroundShaders('grass', lambert.vertexShader, lambert.fragmentShader);
    expect(lambert.vertexShader).not.toContain('vGroundUv');
    expect(lambert.fragmentShader).not.toContain('groundMap');
    expect(vertexShader).not.toBe(lambert.vertexShader);
    expect(fragmentShader).not.toBe(lambert.fragmentShader);
  });

  function texture(): THREE.DataTexture {
    return createGroundTexture();
  }
});

describe('createGround with the texture and terrain', () => {
  const path = { center: { x: 0, z: 0 }, radius: 6, feather: 3 };
  const make = (extra: Partial<Parameters<typeof createGround>[0]> = {}): THREE.Mesh =>
    createGround({ size: 56, rng: mulberry32(9), grass: 0x5f9e45, dirt: 0xb89a6a, path, ...extra });

  it('carries the dirt weight as a vertex attribute, 1 on the clearing and 0 on the grass, and shows the blend texture', () => {
    const ground = make();
    const position = ground.geometry.getAttribute('position');
    const dirt = ground.geometry.getAttribute('dirt');
    expect(dirt.count).toBe(position.count);
    for (let i = 0; i < position.count; i++) {
      expect(dirt.getX(i)).toBeCloseTo(dirtWeight(position.getX(i), position.getZ(i), path), 6);
    }
    expect(dataOf(ground)).toMatchObject({ mode: 'blend' });
    expect((ground.material as THREE.MeshLambertMaterial).vertexColors).toBe(true);
  });

  it('shows plain paving instead of pebbles when asked (the plaza)', () => {
    expect(dataOf(make({ pebbles: false }))).toMatchObject({ mode: 'paved' });
  });

  it('is still one draw call, and the same ground as before when there is no terrain', () => {
    const plain = make();
    const again = make();
    expect(Array.from(again.geometry.getAttribute('position').array)).toEqual(Array.from(plain.geometry.getAttribute('position').array));
    expect(Array.from(again.geometry.getAttribute('color').array)).toEqual(Array.from(plain.geometry.getAttribute('color').array));
  });

  it('with terrain, rises beyond the walkable square and meets the hills at its edge, flat inside', () => {
    const half = 17.5;
    const terrain = zoneTerrain('nature-trail', half, 77);
    const ground = make({ terrain, size: 50 });
    const position = ground.geometry.getAttribute('position');
    let rose = 0;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const y = position.getY(i);
      const square = Math.max(Math.abs(x), Math.abs(z));
      if (square <= half) expect(Math.abs(y), `walkable ground at ${x}, ${z}`).toBeLessThanOrEqual(0.031);
      if (square >= 24.99) expect(y).toBeCloseTo(terrain.height(x, z), 6); // the edge has no ripple left
      if (y > 0.5) rose++;
      expect(y).toBeGreaterThanOrEqual(-0.031);
    }
    expect(rose).toBeGreaterThan(20);
  });

  it('with terrain, fades the color noise toward the edge so the hills can match it', () => {
    const terrain = zoneTerrain('nature-trail', 17.5, 77);
    const ground = make({ terrain, size: 50, path: undefined as never });
    const position = ground.geometry.getAttribute('position');
    const color = ground.geometry.getAttribute('color');
    const edge: number[] = [];
    const inner: number[] = [];
    for (let i = 0; i < position.count; i++) {
      const square = Math.max(Math.abs(position.getX(i)), Math.abs(position.getZ(i)));
      if (square >= 24.99) edge.push(color.getY(i));
      else if (square < 14 && square > 4) inner.push(color.getY(i));
    }
    // Neighbors along the edge differ far less than random neighbors on the lawn do.
    const spread = (v: number[]): number => Math.sqrt(v.reduce((a, b) => a + (b - mean(v)) ** 2, 0) / v.length);
    expect(spread(edge)).toBeLessThan(spread(inner));
  });

  it('keeps the shared texture one object across grounds', () => {
    expect(dataOf(make()).texture).toBe(dataOf(make()).texture);
  });
});

describe.each(ZONE_IDS)('%s ground', (id) => {
  const zone = createZone(id, { onTalkToDenChief: vi.fn(), onReturnToBaseCamp: vi.fn() });
  const half = zone.bounds.maxX;
  const ground = zone.root.getObjectByName('ground') as THREE.Mesh;

  it('keeps the walkable ground at y = 0 within a few centimeters', () => {
    const position = ground.geometry.getAttribute('position');
    let walkable = 0;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      if (Math.abs(x) <= half + 3 && Math.abs(z) <= half + 3) {
        walkable++;
        expect(Math.abs(position.getY(i)), `ground at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBeLessThanOrEqual(0.031);
      }
    }
    expect(walkable).toBeGreaterThan(400);
  });

  it('rolls into hills outside the walkable square, up to its own edge', () => {
    const position = ground.geometry.getAttribute('position');
    let top = 0;
    for (let i = 0; i < position.count; i++) top = Math.max(top, position.getY(i));
    expect(top).toBeGreaterThan(0.05); // the ground itself only starts to rise; the ring of hills does the rest
    expect(top).toBeLessThan(14);
  });

  it('is textured: vertex colors times the shared ground texture', () => {
    expect((ground.material as THREE.MeshLambertMaterial).vertexColors).toBe(true);
    expect(dataOf(ground).texture).toBe(createGroundTexture());
    expect(ground.receiveShadow).toBe(true);
    expect(ground.castShadow).toBe(false);
  });
});

describe('which layer each zone surface shows', () => {
  const build = (id: (typeof ZONE_IDS)[number]): THREE.Group =>
    createZone(id, { onTalkToDenChief: vi.fn(), onReturnToBaseCamp: vi.fn() }).root;
  const modeOf = (root: THREE.Object3D, name: string): GroundTextureMode | undefined =>
    ((root.getObjectByName(name) as THREE.Mesh | undefined)?.material as THREE.Material | undefined)?.userData.groundTexture?.mode;

  it('shows grass and pebbles on the ground (dirt clearings), and plain paving on the Town Square plaza', () => {
    for (const id of ZONE_IDS) expect(modeOf(build(id), 'ground'), id).toBe(id === 'town-square' ? 'paved' : 'blend');
  });

  it('shows pebbles on the Nature Trail path and the Fitness Field track, laid in world space like the ground', () => {
    expect(modeOf(build('nature-trail'), 'path')).toBe('pebbles');
    expect(modeOf(build('fitness-field'), 'track')).toBe('pebbles');
  });

  it('shows the blade speckle on the hills, so the ground carries on into them', () => {
    for (const id of ZONE_IDS) expect(modeOf(build(id), 'horizon-hills'), id).toBe('grass');
  });
});
