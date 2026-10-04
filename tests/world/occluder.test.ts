import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  OCCLUDER_AIM_HEIGHT,
  OCCLUDER_BEHIND,
  OCCLUDER_CACHE_KEY,
  OCCLUDER_FAR,
  OCCLUDER_MARKER,
  OCCLUDER_MAX_DROP,
  OCCLUDER_NEAR,
  applyOccluderFade,
  applyOccluderFadeToMesh,
  bayer4,
  hasOccluderFade,
  injectOccluderFade,
  isShadowMaterial,
  occluderDrop,
  occluderDrops,
  occluderFadeFor,
  occluderMaterial,
  occluderTargetPoint,
  setOccluderTarget,
  smoothstep,
} from '../../src/world/occluder';
import { WIND_CACHE_KEY, applyWind, windDepthMaterial, windMaterial, type WindOptions } from '../../src/world/wind';

const TREE: WindOptions = { kind: 'tree', strength: 0.05, heightScale: 0.2 };

/** The follow camera's usual spot: 7.5 behind the Scout and 3 up, and the Scout's aim point. */
const CAMERA = { x: 0, y: 3, z: -7.5 };
const TARGET = { x: 0, y: OCCLUDER_AIM_HEIGHT, z: 0 };

/** The point a fraction `s` of the way along the line from the camera to the Scout, pushed `side` to the right. */
const along = (s: number, side = 0, up = 0): { x: number; y: number; z: number } => ({
  x: CAMERA.x + (TARGET.x - CAMERA.x) * s + side,
  y: CAMERA.y + (TARGET.y - CAMERA.y) * s + up,
  z: CAMERA.z + (TARGET.z - CAMERA.z) * s,
});
const lineLength = Math.hypot(TARGET.x - CAMERA.x, TARGET.y - CAMERA.y, TARGET.z - CAMERA.z);

interface Compiled {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, THREE.IUniform>;
}

/** What the renderer hands `onBeforeCompile`: both shaders and a uniform bag. */
function compile(material: THREE.Material, shaders: { vertexShader: string; fragmentShader: string }): Compiled {
  const shader: Compiled = { vertexShader: shaders.vertexShader, fragmentShader: shaders.fragmentShader, uniforms: {} };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return shader;
}
const LAMBERT = THREE.ShaderLib.lambert;
const DEPTH = THREE.ShaderLib.depth;

describe('the fade math (the same as the shader, in TypeScript)', () => {
  it('fades a point on the line between the camera and the Scout, by the most it ever fades', () => {
    for (const s of [0.05, 0.3, 0.5, 0.8]) expect(occluderDrop(along(s), CAMERA, TARGET), `s = ${s}`).toBeCloseTo(OCCLUDER_MAX_DROP, 9);
  });

  it('fades what is close to the line, and does not fade it when it is far to the side', () => {
    expect(occluderDrop(along(0.5, OCCLUDER_NEAR - 0.05), CAMERA, TARGET)).toBeCloseTo(OCCLUDER_MAX_DROP, 9);
    expect(occluderDrop(along(0.5, OCCLUDER_FAR + 0.01), CAMERA, TARGET)).toBe(0);
    expect(occluderDrop(along(0.5, 4), CAMERA, TARGET)).toBe(0);
    expect(occluderDrop(along(0.5, -4), CAMERA, TARGET)).toBe(0);
    expect(occluderDrop(along(0.5, 0, 6), CAMERA, TARGET)).toBe(0); // high above the line (a tall tree's top)
    expect(occluderDrop(along(0.5, 0, -2), CAMERA, TARGET)).toBe(0); // well under it (the ground)
  });

  it('eases from full to nothing between the near and far distances, never going back up', () => {
    let last = Infinity;
    for (let d = 0; d <= 1.6; d += 0.05) {
      const drop = occluderDrop(along(0.5, d), CAMERA, TARGET);
      expect(drop).toBeLessThanOrEqual(last + 1e-12);
      last = drop;
    }
    const mid = occluderDrop(along(0.5, (OCCLUDER_NEAR + OCCLUDER_FAR) / 2), CAMERA, TARGET);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(OCCLUDER_MAX_DROP);
  });

  it('never fades a point behind the Scout, and eases out before it so there is no hard edge', () => {
    for (const s of [OCCLUDER_BEHIND, 0.95, 1, 1.05, 1.5, 3]) expect(occluderDrop(along(s), CAMERA, TARGET), `s = ${s}`).toBe(0);
    expect(occluderDrop({ x: 0, y: 0.9, z: 4 }, CAMERA, TARGET)).toBe(0); // well behind the Scout, still on the line
    const before = occluderDrop(along(0.8), CAMERA, TARGET);
    const near = occluderDrop(along(0.9), CAMERA, TARGET);
    expect(before).toBeCloseTo(OCCLUDER_MAX_DROP, 9);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(before);
  });

  it('covers the very-near-camera case: full a hand from the lens, and nothing behind the camera', () => {
    expect(occluderDrop(along(0.02 + 0.01), CAMERA, TARGET)).toBeCloseTo(OCCLUDER_MAX_DROP, 9); // about 0.23 from the lens
    expect(occluderDrop(along(0.06, 0.2), CAMERA, TARGET)).toBeCloseTo(OCCLUDER_MAX_DROP, 9);
    const atLens = occluderDrop(CAMERA, CAMERA, TARGET);
    expect(atLens).toBeGreaterThan(0);
    expect(atLens).toBeLessThan(OCCLUDER_MAX_DROP);
    expect(occluderDrop(along(-0.05), CAMERA, TARGET)).toBe(0); // behind the camera
    expect(occluderDrop(along(-1), CAMERA, TARGET)).toBe(0);
  });

  it('never exceeds three pixels in four, anywhere', () => {
    let most = 0;
    for (let x = -12; x <= 12; x += 0.75) {
      for (let y = -1; y <= 8; y += 0.75) {
        for (let z = -16; z <= 12; z += 0.75) {
          const drop = occluderDrop({ x, y, z }, CAMERA, TARGET);
          expect(drop).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(drop)).toBe(true);
          most = Math.max(most, drop);
        }
      }
    }
    expect(most).toBeLessThanOrEqual(0.75);
    expect(most).toBeGreaterThan(0.5); // and the grid does find the line
    expect(OCCLUDER_MAX_DROP).toBe(0.75);
  });

  it('does not depend on where the camera is: it works for any heading and a camera that has swung round', () => {
    const camera = { x: 6, y: 3, z: 4 };
    const target = { x: 0, y: 0.9, z: 0 };
    const between = { x: 3, y: 1.95, z: 2 };
    expect(occluderDrop(between, camera, target)).toBeCloseTo(OCCLUDER_MAX_DROP, 9);
    expect(occluderDrop({ x: -3, y: 1.95, z: -2 }, camera, target)).toBe(0); // behind the Scout
    expect(occluderDrop({ x: 3, y: 1.95, z: -2 }, camera, target)).toBe(0); // off to the side
  });

  it('does not blow up when the camera sits on the target', () => {
    const drop = occluderDrop({ x: 1, y: 1, z: 1 }, TARGET, TARGET);
    expect(Number.isFinite(drop)).toBe(true);
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(drop).toBeLessThanOrEqual(OCCLUDER_MAX_DROP);
  });

  it('has a smoothstep that matches GLSL', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(0.6, 1.3, 0.95)).toBeCloseTo(0.5, 9);
  });
});

describe('the dither', () => {
  const tile = (drop: number): boolean[] => {
    const out: boolean[] = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) out.push(occluderDrops(drop, x, y));
    return out;
  };

  it('is the 4 by 4 Bayer matrix: sixteen different thresholds, all strictly between 0 and 1', () => {
    const thresholds = new Set<number>();
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) thresholds.add(bayer4(x, y));
    expect(thresholds.size).toBe(16);
    for (const t of thresholds) {
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(1);
    }
    expect(bayer4(5, 9)).toBe(bayer4(1, 1)); // it tiles
    expect(bayer4(4.7, 8.2)).toBe(bayer4(0, 0)); // and reads the pixel the fragment is in
  });

  it('drops nothing at 0 and exactly three of four pixels at the cap', () => {
    expect(tile(0).filter(Boolean)).toHaveLength(0);
    expect(tile(OCCLUDER_MAX_DROP).filter(Boolean)).toHaveLength(12);
    expect(tile(0.375).filter(Boolean)).toHaveLength(6);
  });

  it('keeps a screen-door look: a quarter drop takes one pixel from every 2 by 2 block', () => {
    const dropped = tile(0.25);
    expect(dropped.filter(Boolean)).toHaveLength(4);
    for (const [bx, by] of [[0, 0], [2, 0], [0, 2], [2, 2]] as const) {
      let n = 0;
      for (let y = by; y < by + 2; y++) for (let x = bx; x < bx + 2; x++) if (dropped[y * 4 + x]) n++;
      expect(n, `block ${bx},${by}`).toBe(1);
    }
  });

  it('drops more pixels as the drop grows, and never un-drops one', () => {
    const a = tile(0.2);
    const b = tile(0.6);
    a.forEach((gone, i) => {
      if (gone) expect(b[i]).toBe(true);
    });
  });
});

describe('the shader code', () => {
  const lit = (): Compiled => compile(applyWind(new THREE.MeshLambertMaterial(), TREE), LAMBERT);

  it('goes into the vertex shader after the projection, so it sees the instance matrix and the wind push, and passes the world position across', () => {
    const v = lit().vertexShader;
    expect(v).toContain(OCCLUDER_MARKER);
    expect(v).toContain('varying vec3 vTqWorld;');
    expect(v.indexOf('#include <common>')).toBeLessThan(v.indexOf('varying vec3 vTqWorld;'));
    expect(v.indexOf('varying vec3 vTqWorld;')).toBeLessThan(v.indexOf('void main'));
    expect(v.indexOf(OCCLUDER_MARKER)).toBeGreaterThan(v.indexOf('#include <project_vertex>'));
    expect(v.indexOf(OCCLUDER_MARKER)).toBeGreaterThan(v.indexOf('transformed +=')); // after the wind has moved the vertex
    expect(v).toContain('vTqWorld = ( modelMatrix * tqWorld4 ).xyz;');
    expect(v).toMatch(/#ifdef USE_INSTANCING\s+tqWorld4 = instanceMatrix \* tqWorld4;/);
  });

  it('dithers in the fragment shader with a Bayer table on gl_FragCoord, right after the clipping planes', () => {
    const f = lit().fragmentShader;
    expect(f).toContain(OCCLUDER_MARKER);
    expect(f).toContain('varying vec3 vTqWorld;');
    expect(f).toContain('uniform vec3 uOccluderTarget;');
    expect(f).toContain('cameraPosition');
    expect(f).toContain('gl_FragCoord');
    expect(f).toContain('TQ_BAYER');
    expect(f).toContain('discard');
    expect(f.indexOf('uniform vec3 uOccluderTarget;')).toBeLessThan(f.indexOf('void main'));
    expect(f.indexOf('discard')).toBeGreaterThan(f.indexOf('#include <clipping_planes_fragment>'));
    expect(f.indexOf('discard')).toBeLessThan(f.indexOf('#include <lights_fragment_begin>')); // before the light work
  });

  it('puts the same constants in the shader as the TypeScript mirror uses', () => {
    const f = lit().fragmentShader;
    expect(f).toContain(`smoothstep( ${OCCLUDER_NEAR}, ${OCCLUDER_FAR}, tqD )`);
    expect(f).toContain(`return tqFade * ${OCCLUDER_MAX_DROP};`);
    expect(f).toMatch(/1\.0 - smoothstep\( 0\.84, 0\.92, tqS \)/);
    const table = /TQ_BAYER\[ 16 \] = float\[ 16 \]\( ([^)]*) \)/.exec(f);
    expect(table, 'the table is declared').not.toBeNull();
    const values = table![1]!.split(',').map((n) => Number(n.trim()));
    expect(values).toHaveLength(16);
    values.forEach((v, i) => expect(bayer4(i % 4, Math.floor(i / 4)), `cell ${i}`).toBeCloseTo((v + 0.5) / 16, 12));
  });

  it('is balanced and declares every name it uses', () => {
    const { vertexShader, fragmentShader } = lit();
    for (const [name, source] of [['vertex', vertexShader], ['fragment', fragmentShader]] as const) {
      const start = source.indexOf(OCCLUDER_MARKER);
      expect(start, name).toBeGreaterThan(-1);
      expect(source.split('{').length, name).toBe(source.split('}').length);
      expect(source.split('(').length, name).toBe(source.split(')').length);
    }
    const fragment = fragmentShader.slice(fragmentShader.indexOf('uniform vec3 uOccluderTarget;'), fragmentShader.indexOf('void main'));
    for (const name of new Set(fragment.match(/\btq[A-Z][A-Za-z]*\b/g))) {
      expect(fragment, `${name} is declared`).toMatch(new RegExp(`\\b(float|vec3|int)\\s+${name}\\b`));
    }
  });

  it('hands the shader the one shared target', () => {
    const a = lit();
    const b = compile(applyWind(new THREE.MeshLambertMaterial(), { kind: 'grass', strength: 0.16, heightScale: 1.2 }), LAMBERT);
    const c = compile(applyOccluderFade(new THREE.MeshLambertMaterial()), LAMBERT);
    expect(a.uniforms.uOccluderTarget).toBeDefined();
    expect(b.uniforms.uOccluderTarget).toBe(a.uniforms.uOccluderTarget);
    expect(c.uniforms.uOccluderTarget).toBe(a.uniforms.uOccluderTarget);
    expect(a.uniforms.uOccluderTarget!.value).toBe(occluderTargetPoint());
  });

  it('never goes into a depth material, so a shadow stays whole (and a depth shader would not take it anyway)', () => {
    const depth = windDepthMaterial(TREE);
    expect(isShadowMaterial(depth)).toBe(true);
    const shader = compile(depth, DEPTH);
    expect(shader.vertexShader).not.toContain(OCCLUDER_MARKER);
    expect(shader.vertexShader).not.toContain('vTqWorld');
    expect(shader.fragmentShader).toBe(DEPTH.fragmentShader);
    expect(shader.fragmentShader).not.toContain('discard');
    expect(shader.uniforms.uOccluderTarget).toBeUndefined();
    // the point-light shadow material is left out too, even if someone asks for the fade on it
    expect(isShadowMaterial(new THREE.MeshDistanceMaterial())).toBe(true);
    expect(applyOccluderFade(depth)).toBe(depth);
    expect(hasOccluderFade(depth)).toBe(false);
    expect(applyOccluderFade(new THREE.MeshDistanceMaterial()).onBeforeCompile).toBe(new THREE.MeshDistanceMaterial().onBeforeCompile);
    expect(isShadowMaterial(new THREE.MeshLambertMaterial())).toBe(false);
  });

  it('is patched once, whichever patch got there first', () => {
    const wind = lit();
    expect(wind.vertexShader.split(OCCLUDER_MARKER)).toHaveLength(2);
    expect(wind.fragmentShader.split(OCCLUDER_MARKER)).toHaveLength(3); // the function's comment and the block
    const both = new THREE.MeshLambertMaterial();
    applyOccluderFade(both);
    applyWind(both, TREE);
    const shader = compile(both, LAMBERT);
    expect(shader.vertexShader.split('varying vec3 vTqWorld;')).toHaveLength(2);
    expect(shader.fragmentShader.split('float tqOccluderDrop()')).toHaveLength(2);
    expect(applyOccluderFade(both)).toBe(both);
  });

  it('leaves a shader without the chunks it hooks into alone', () => {
    const odd: Compiled = { vertexShader: 'void main() { gl_Position = vec4(0.0); }', fragmentShader: 'void main() {}', uniforms: {} };
    injectOccluderFade(odd);
    expect(odd.vertexShader).toBe('void main() { gl_Position = vec4(0.0); }');
    expect(odd.fragmentShader).toBe('void main() {}');
    expect(odd.uniforms).toEqual({});
    const noFragment = { vertexShader: LAMBERT.vertexShader, uniforms: {} as Record<string, THREE.IUniform> };
    injectOccluderFade(noFragment); // a stub with no fragment shader (the wind tests') is left alone
    expect(noFragment.vertexShader).toBe(LAMBERT.vertexShader);
  });

  it('has its own program cache key, apart from the wind one, and keeps a custom key the material set itself', () => {
    const fade = applyOccluderFade(new THREE.MeshLambertMaterial());
    expect(fade.customProgramCacheKey()).toBe(OCCLUDER_CACHE_KEY);
    expect(OCCLUDER_CACHE_KEY).not.toBe(WIND_CACHE_KEY);
    const mine = new THREE.MeshLambertMaterial();
    mine.customProgramCacheKey = () => 'mine';
    applyOccluderFade(mine);
    expect(mine.customProgramCacheKey()).toBe(`mine|${OCCLUDER_CACHE_KEY}`);
  });

  it('chains an onBeforeCompile the material already had', () => {
    const seen: string[] = [];
    const material = new THREE.MeshLambertMaterial();
    material.onBeforeCompile = () => seen.push('first');
    applyOccluderFade(material);
    expect(compile(material, LAMBERT).vertexShader).toContain(OCCLUDER_MARKER);
    expect(seen).toEqual(['first']);
  });
});

describe('which materials fade', () => {
  it('patches a copy and leaves the source alone, one copy per source, shared by every mesh', () => {
    const source = new THREE.MeshLambertMaterial({ vertexColors: true, name: 'palette' });
    const plain = source.onBeforeCompile;
    const copy = occluderMaterial(source);
    expect(copy).not.toBe(source);
    expect(copy.name).toBe('palette (fade)');
    expect((copy as THREE.MeshLambertMaterial).vertexColors).toBe(true);
    expect(hasOccluderFade(copy)).toBe(true);
    expect(hasOccluderFade(source)).toBe(false);
    expect(source.onBeforeCompile).toBe(plain);
    expect(occluderMaterial(source)).toBe(copy);
    expect(occluderMaterial(copy)).toBe(copy);
  });

  it('does not touch a wind copy of the same source: swaying props still get their own material', () => {
    const source = new THREE.MeshLambertMaterial();
    const swaying = windMaterial(source, TREE);
    const fading = occluderMaterial(source);
    expect(swaying).not.toBe(fading);
    expect(compile(swaying, LAMBERT).vertexShader).toContain('uWindTime');
    expect(compile(fading, LAMBERT).vertexShader).not.toContain('uWindTime');
  });

  it('applyOccluderFadeToMesh swaps in the copy unless the mesh owns its material (inPlace), and never sets a shadow material', () => {
    const shared = new THREE.MeshLambertMaterial();
    const a = new THREE.Mesh(new THREE.BoxGeometry(), shared);
    applyOccluderFadeToMesh(a);
    expect(a.material).not.toBe(shared);
    expect(hasOccluderFade(a.material as THREE.Material)).toBe(true);
    expect(a.customDepthMaterial).toBeUndefined();
    const own = new THREE.MeshLambertMaterial();
    const b = new THREE.Mesh(new THREE.BoxGeometry(), own);
    applyOccluderFadeToMesh(b, { inPlace: true });
    expect(b.material).toBe(own);
    expect(hasOccluderFade(own)).toBe(true);
    const many = new THREE.Mesh(new THREE.BoxGeometry(), [new THREE.MeshLambertMaterial(), new THREE.MeshLambertMaterial()]);
    applyOccluderFadeToMesh(many);
    for (const m of many.material as THREE.Material[]) expect(hasOccluderFade(m)).toBe(true);
  });

  it('picks rocks, stumps, logs and tents (whole segments only) and leaves plants, trees and the rest to their own patches', () => {
    for (const id of ['rock.large', 'rock.tall', 'rock.small', 'rock.flat', 'stump', 'log.single', 'log.large', 'log.stack', 'tent', 'tent.small', 'tent.open']) {
      expect(occluderFadeFor(id), id).toBe(true);
    }
    for (const id of ['rock', 'rocket', 'stumpy', 'logo', 'tenter', 'tree.pine', 'plant.bush', 'plant.mushroom', 'building.firestation', 'fence.simple', 'signpost', 'street.lamp', 'campfire', 'path.stone']) {
      expect(occluderFadeFor(id), id).toBe(false);
    }
  });
});

describe('the target', () => {
  it('sits about the middle of the Scout: the feet plus the aim height', () => {
    setOccluderTarget({ x: 3, y: 0, z: -2 });
    expect(occluderTargetPoint().toArray()).toEqual([3, OCCLUDER_AIM_HEIGHT, -2]);
    setOccluderTarget({ x: -1, y: 1.5, z: 7 });
    expect(occluderTargetPoint().x).toBe(-1);
    expect(occluderTargetPoint().y).toBeCloseTo(1.5 + OCCLUDER_AIM_HEIGHT, 12);
    expect(occluderTargetPoint().z).toBe(7);
  });

  it('is one vector every patched material reads, so one call per frame moves every prop at once', () => {
    const wind = compile(applyWind(new THREE.MeshLambertMaterial(), TREE), LAMBERT);
    const fade = compile(applyOccluderFade(new THREE.MeshLambertMaterial()), LAMBERT);
    expect(wind.uniforms.uOccluderTarget).toBe(fade.uniforms.uOccluderTarget);
    setOccluderTarget({ x: 10, y: 0, z: 12 });
    expect(wind.uniforms.uOccluderTarget!.value.toArray()).toEqual([10, OCCLUDER_AIM_HEIGHT, 12]);
    expect(fade.uniforms.uOccluderTarget!.value.toArray()).toEqual([10, OCCLUDER_AIM_HEIGHT, 12]);
    setOccluderTarget({ x: -4, y: 0, z: 0.5 });
    expect(wind.uniforms.uOccluderTarget!.value.toArray()).toEqual([-4, OCCLUDER_AIM_HEIGHT, 0.5]);
  });

  it('is set every rendered frame, from the Scout, in the world loop (which needs WebGL, so the wiring is read from the source)', () => {
    const source = readFileSync(new URL('../../src/game/world.ts', import.meta.url), 'utf8');
    const render = source.slice(source.indexOf('onRender('), source.indexOf('loop.start()'));
    expect(render).toContain('setOccluderTarget(player.root.position)');
    expect(render.indexOf('follow.update')).toBeLessThan(render.indexOf('setOccluderTarget'));
    expect(render.indexOf('setOccluderTarget')).toBeLessThan(render.indexOf('post.render'));
    expect(source).toContain("from '../world/occluder'");
  });
});

describe('the length of the line', () => {
  it('is what the follow camera makes it, so the constants above are sized for it', () => {
    // 7.5 back, 3 up, aim 0.9 up: a bit under 8 units, so the end ramp (0.08 of the line) is about 0.6 units
    expect(lineLength).toBeGreaterThan(7.5);
    expect(lineLength).toBeLessThan(8.5);
    expect((1 - OCCLUDER_BEHIND) * lineLength).toBeGreaterThan(0.5); // the Scout is clear of the fade by half a unit
  });
});
