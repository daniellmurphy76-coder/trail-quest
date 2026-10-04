import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WIND_CACHE_KEY,
  WIND_KINDS,
  WIND_MARKER,
  WIND_PERIOD,
  applyWind,
  applyWindToMesh,
  effectiveWindStrength,
  hasWind,
  modelHeight,
  prefersReducedMotion,
  refreshWindMotion,
  tickWind,
  windBend,
  windClock,
  windDepthMaterial,
  windKindFor,
  windMaterial,
  windMotionScale,
  windOptions,
  windPush,
  type WindKind,
  type WindOptions,
} from '../../src/world/wind';

const TREE: WindOptions = { kind: 'tree', strength: 0.05, heightScale: 0.2 };

interface Compiled {
  vertexShader: string;
  uniforms: Record<string, THREE.IUniform>;
}

/** What the renderer hands `onBeforeCompile`, as far as the wind patch looks: a vertex shader and a uniform bag. */
function compile(material: THREE.Material, vertexShader: string): Compiled {
  const shader: Compiled = { vertexShader, uniforms: {} };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return shader;
}

const LAMBERT = THREE.ShaderLib.lambert.vertexShader;
const DEPTH = THREE.ShaderLib.depth.vertexShader;

/** Expand `#include <chunk>` lines the way the renderer does, so the whole shader can be read. */
function resolveIncludes(source: string): string {
  return source.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_, name: string) => {
    const chunk = (THREE.ShaderChunk as Record<string, string>)[name];
    if (chunk === undefined) throw new Error(`no shader chunk ${name}`);
    return resolveIncludes(chunk);
  });
}

/** Keep the lines of `source` a compiler would, given the defines; understands `#ifdef`, `#ifndef`, `#else` and `#endif` only. */
function preprocess(source: string, defines: ReadonlySet<string>): string {
  const keep: boolean[] = [];
  const out: string[] = [];
  for (const line of source.split('\n')) {
    const t = line.trim();
    const ifdef = /^#ifdef\s+(\w+)/.exec(t);
    const ifndef = /^#ifndef\s+(\w+)/.exec(t);
    if (ifdef) keep.push(defines.has(ifdef[1]!));
    else if (ifndef) keep.push(!defines.has(ifndef[1]!));
    else if (t.startsWith('#else')) keep.push(!keep.pop()!);
    else if (t.startsWith('#endif')) keep.pop();
    else if (keep.every(Boolean)) out.push(line);
  }
  return out.join('\n');
}

/** The part of a patched vertex shader that is the wind: from its marker to the next chunk include. */
function windBlock(vertexShader: string): string {
  const start = vertexShader.indexOf(WIND_MARKER);
  const end = vertexShader.indexOf('#include <', start);
  return vertexShader.slice(start, end);
}

afterEach(() => {
  vi.unstubAllGlobals();
  refreshWindMotion();
});

describe('the injected vertex code', () => {
  it('goes into a Lambert shader right after begin_vertex, with its uniforms declared after common', () => {
    const material = applyWind(new THREE.MeshLambertMaterial(), TREE);
    const shader = compile(material, LAMBERT);
    const v = shader.vertexShader;
    expect(v).toContain(WIND_MARKER);
    expect(v).toContain('uniform float uWindTime;');
    expect(v.indexOf('#include <common>')).toBeLessThan(v.indexOf('uniform float uWindTime;'));
    expect(v.indexOf('uniform float uWindTime;')).toBeLessThan(v.indexOf('void main'));
    const begin = v.indexOf('#include <begin_vertex>');
    expect(begin).toBeGreaterThan(-1);
    expect(v.indexOf(WIND_MARKER)).toBeGreaterThan(begin);
    expect(v.indexOf(WIND_MARKER)).toBeLessThan(v.indexOf('#include <project_vertex>')); // the push lands before the projection
    expect(v).toContain('transformed +=');
    expect(v).toContain('instanceMatrix');
    expect(v).toContain('modelMatrix');
  });

  it('hands the shader the shared clock and motion scale, and this material\'s own strength, height and flutter', () => {
    const a = compile(applyWind(new THREE.MeshLambertMaterial(), TREE), LAMBERT);
    const b = compile(applyWind(new THREE.MeshLambertMaterial(), { kind: 'grass', strength: 0.16, heightScale: 1.2 }), LAMBERT);
    expect(a.uniforms.uWindTime).toBe(b.uniforms.uWindTime); // one clock for everything
    expect(a.uniforms.uWindScale).toBe(b.uniforms.uWindScale);
    expect(a.uniforms.uWindStrength).not.toBe(b.uniforms.uWindStrength);
    expect(a.uniforms.uWindStrength!.value).toBe(0.05);
    expect(a.uniforms.uWindHeightScale!.value).toBe(0.2);
    expect(a.uniforms.uWindFlutter!.value).toBe(WIND_KINDS.tree.flutter);
    expect(b.uniforms.uWindStrength!.value).toBe(0.16);
    expect(b.uniforms.uWindFlutter!.value).toBe(WIND_KINDS.grass.flutter);
  });

  it('has one stable program cache key, whatever the kind, strength or height (they are uniforms, not code)', () => {
    const keys = new Set<string>();
    for (const kind of Object.keys(WIND_KINDS) as WindKind[]) {
      for (const heightScale of [0.2, 1.4]) {
        const m = applyWind(new THREE.MeshLambertMaterial(), { kind, strength: WIND_KINDS[kind].strength, heightScale });
        keys.add(m.customProgramCacheKey());
        expect(m.customProgramCacheKey()).toBe(m.customProgramCacheKey());
      }
    }
    expect([...keys]).toEqual([WIND_CACHE_KEY]);
    // and every material compiles to the same text, so the renderer can share one program
    const text = (m: THREE.Material): string => compile(m, LAMBERT).vertexShader;
    expect(text(applyWind(new THREE.MeshLambertMaterial(), TREE))).toBe(
      text(applyWind(new THREE.MeshLambertMaterial(), { kind: 'flower', strength: 0.12, heightScale: 1.6 })),
    );
  });

  it('works for instanced and plain meshes: the block reads the instance matrix only under USE_INSTANCING', () => {
    const block = windBlock(compile(applyWind(new THREE.MeshLambertMaterial(), TREE), LAMBERT).vertexShader);
    const instanced = preprocess(block, new Set(['USE_INSTANCING']));
    const plain = preprocess(block, new Set());
    expect(instanced).toContain('instanceMatrix');
    expect(plain).not.toContain('instanceMatrix');
    for (const variant of [instanced, plain]) {
      expect(variant).toContain('tqOrigin');
      expect(variant).toContain('tqLinear');
      expect(variant).toContain('modelMatrix');
      expect(variant.split('{').length).toBe(variant.split('}').length); // braces balance
      expect(variant.split('(').length).toBe(variant.split(')').length);
      // every tq name the block uses is declared by it
      const used = new Set(variant.match(/\btq[A-Za-z]+\b/g));
      for (const name of used) {
        expect(variant, `${name} is declared`).toMatch(new RegExp(`\\b(float|vec2|vec3|mat3)\\s+${name}\\b`));
      }
    }
  });

  it('resolves against the real chunks: begin_vertex declares `transformed`, which the block adds to', () => {
    const resolved = resolveIncludes(compile(applyWind(new THREE.MeshLambertMaterial(), TREE), LAMBERT).vertexShader);
    const declared = resolved.indexOf('vec3 transformed = vec3( position );');
    expect(declared).toBeGreaterThan(-1);
    expect(resolved.indexOf('transformed +=')).toBeGreaterThan(declared);
    expect(resolved.indexOf('transformed +=')).toBeLessThan(resolved.indexOf('mvPosition')); // before the projection reads it
  });

  it('chains an onBeforeCompile the material already had, and leaves a shader with no begin_vertex alone', () => {
    const seen: string[] = [];
    const material = new THREE.MeshLambertMaterial();
    material.onBeforeCompile = () => seen.push('first');
    applyWind(material, TREE);
    const shader = compile(material, LAMBERT);
    expect(seen).toEqual(['first']);
    expect(shader.vertexShader).toContain(WIND_MARKER);
    const odd = compile(applyWind(new THREE.MeshBasicMaterial(), TREE), 'void main() { gl_Position = vec4(0.0); }');
    expect(odd.vertexShader).toBe('void main() { gl_Position = vec4(0.0); }');
    expect(odd.uniforms).toEqual({});
  });

  it('keeps a custom cache key the material set itself, and adds the wind key to it', () => {
    const material = new THREE.MeshLambertMaterial();
    material.customProgramCacheKey = () => 'mine';
    applyWind(material, TREE);
    expect(material.customProgramCacheKey()).toBe(`mine|${WIND_CACHE_KEY}`);
  });

  it('is patched once: applying again to the same material updates its settings and does not stack the code', () => {
    const material = new THREE.MeshLambertMaterial();
    applyWind(material, TREE);
    expect(applyWind(material, { kind: 'bush', strength: 0.07, heightScale: 0.9 })).toBe(material);
    const shader = compile(material, LAMBERT);
    expect(shader.vertexShader.split(WIND_MARKER)).toHaveLength(2);
    expect(shader.uniforms.uWindStrength!.value).toBe(0.07);
    expect(shader.uniforms.uWindFlutter!.value).toBe(WIND_KINDS.bush.flutter);
  });
});

describe('the depth material (shadows sway with the plants)', () => {
  it('is a MeshDepthMaterial with the same sway, compiled from the depth shader', () => {
    const depth = windDepthMaterial(TREE);
    expect(depth).toBeInstanceOf(THREE.MeshDepthMaterial);
    expect(hasWind(depth)).toBe(true);
    const shader = compile(depth, DEPTH);
    expect(shader.vertexShader).toContain(WIND_MARKER);
    expect(shader.vertexShader.indexOf(WIND_MARKER)).toBeGreaterThan(shader.vertexShader.indexOf('#include <begin_vertex>'));
    expect(shader.vertexShader.indexOf(WIND_MARKER)).toBeLessThan(shader.vertexShader.indexOf('#include <project_vertex>'));
    expect(depth.customProgramCacheKey()).toBe(WIND_CACHE_KEY);
  });

  it('is shared by every mesh with the same settings, and moves on the very same clock as the visible material', () => {
    expect(windDepthMaterial(TREE)).toBe(windDepthMaterial({ ...TREE }));
    expect(windDepthMaterial(TREE)).not.toBe(windDepthMaterial({ ...TREE, strength: 0.06 }));
    const visible = compile(applyWind(new THREE.MeshLambertMaterial(), TREE), LAMBERT);
    const shadow = compile(windDepthMaterial(TREE), DEPTH);
    expect(shadow.uniforms.uWindTime).toBe(visible.uniforms.uWindTime);
    expect(shadow.uniforms.uWindScale).toBe(visible.uniforms.uWindScale);
    expect(shadow.uniforms.uWindStrength!.value).toBe(visible.uniforms.uWindStrength!.value);
  });

  it('is set as the customDepthMaterial of an instanced mesh (and of a plain one), with the geometry\'s own height', () => {
    const tall = new THREE.BoxGeometry(1, 5, 1).translate(0, 2.5, 0);
    const instanced = new THREE.InstancedMesh(tall, new THREE.MeshLambertMaterial(), 4);
    const plain = new THREE.Mesh(tall.clone(), new THREE.MeshLambertMaterial());
    for (const mesh of [instanced, plain]) {
      applyWindToMesh(mesh, 'tree');
      expect(mesh.customDepthMaterial).toBeInstanceOf(THREE.MeshDepthMaterial);
      expect(hasWind(mesh.customDepthMaterial!)).toBe(true);
      const visible = compile(mesh.material as THREE.Material, LAMBERT);
      const shadow = compile(mesh.customDepthMaterial!, DEPTH);
      expect(visible.uniforms.uWindHeightScale!.value).toBeCloseTo(1 / 5, 6);
      expect(shadow.uniforms.uWindHeightScale!.value).toBeCloseTo(1 / 5, 6);
      expect(shadow.uniforms.uWindStrength!.value).toBe(WIND_KINDS.tree.strength);
    }
  });
});

describe('materials are cloned, never shared with a prop that must stay still', () => {
  it('windMaterial patches a copy of the source and leaves the source alone', () => {
    const source = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xabcdef, name: 'palette' });
    const copy = windMaterial(source, TREE) as THREE.MeshLambertMaterial;
    expect(copy).not.toBe(source);
    expect(hasWind(copy)).toBe(true);
    expect(hasWind(source)).toBe(false);
    expect(source.customProgramCacheKey()).not.toBe(WIND_CACHE_KEY);
    expect(compile(source, LAMBERT).vertexShader).toBe(LAMBERT); // untouched
    expect(copy.vertexColors).toBe(true);
    expect(copy.color.getHex()).toBe(0xabcdef);
    expect(copy.name).toContain('palette');
    expect(copy.name).toContain('tree');
  });

  it('makes one copy per source and kind, reused by every mesh and every zone that asks', () => {
    const source = new THREE.MeshLambertMaterial();
    const tree = windMaterial(source, TREE);
    expect(windMaterial(source, { ...TREE })).toBe(tree);
    const grass = windMaterial(source, { kind: 'grass', strength: 0.16, heightScale: 1.2 });
    expect(grass).not.toBe(tree);
    expect(windMaterial(source, { kind: 'grass', strength: 0.16, heightScale: 1.2 })).toBe(grass);
    expect(windMaterial(new THREE.MeshLambertMaterial(), TREE)).not.toBe(tree); // another source, another copy
    expect(windMaterial(tree, TREE)).toBe(tree); // already swaying: not cloned again
  });

  it('applyWindToMesh swaps in the copy unless the mesh owns its material (inPlace)', () => {
    const shared = new THREE.MeshLambertMaterial();
    const geometry = new THREE.BoxGeometry(1, 2, 1).translate(0, 1, 0);
    const a = new THREE.InstancedMesh(geometry, shared, 2);
    const b = new THREE.InstancedMesh(geometry, shared, 2);
    applyWindToMesh(a, 'bush');
    applyWindToMesh(b, 'bush');
    expect(a.material).not.toBe(shared);
    expect(a.material).toBe(b.material);
    expect(hasWind(shared)).toBe(false);

    const own = new THREE.MeshLambertMaterial();
    const mine = new THREE.InstancedMesh(geometry, own, 2);
    applyWindToMesh(mine, 'grass', { inPlace: true });
    expect(mine.material).toBe(own);
    expect(hasWind(own)).toBe(true);

    const two = [new THREE.MeshLambertMaterial(), new THREE.MeshLambertMaterial()];
    const multi = new THREE.Mesh(geometry, two);
    applyWindToMesh(multi, 'tree');
    expect(Array.isArray(multi.material)).toBe(true);
    for (const m of multi.material as THREE.Material[]) expect(hasWind(m)).toBe(true);
    for (const m of two) expect(hasWind(m)).toBe(false);
  });
});

describe('reduced motion', () => {
  const stubMotion = (reduce: boolean): void => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('prefers-reduced-motion'), media: query }));
  };

  it('reads the system preference, and is false where there is no matchMedia (node)', () => {
    expect(prefersReducedMotion()).toBe(false);
    stubMotion(true);
    expect(prefersReducedMotion()).toBe(true);
    stubMotion(false);
    expect(prefersReducedMotion()).toBe(false);
    vi.stubGlobal('matchMedia', () => {
      throw new Error('blocked');
    });
    expect(prefersReducedMotion()).toBe(false);
  });

  it('gives zero strength: the shared motion scale the shader multiplies by is 0', () => {
    stubMotion(true);
    const material = applyWind(new THREE.MeshLambertMaterial(), TREE); // applying reads the preference
    expect(windMotionScale()).toBe(0);
    expect(effectiveWindStrength(TREE)).toBe(0);
    const shader = compile(material, LAMBERT);
    expect(shader.uniforms.uWindScale!.value).toBe(0);
    expect(shader.vertexShader).toContain('uWindStrength * uWindScale'); // the shader multiplies the push by it
    expect(compile(windDepthMaterial(TREE), DEPTH).uniforms.uWindScale!.value).toBe(0); // shadows stand still too
  });

  it('is 1 normally, and gives the full strength back', () => {
    expect(refreshWindMotion()).toBe(1);
    expect(effectiveWindStrength(TREE)).toBe(0.05);
  });

  it('follows the system setting while the game runs (looked at about once a second), with no reload', () => {
    const shader = compile(applyWind(new THREE.MeshLambertMaterial(), TREE), LAMBERT);
    expect(shader.uniforms.uWindScale!.value).toBe(1);
    stubMotion(true);
    tickWind(0.2); // not yet looked at
    expect(shader.uniforms.uWindScale!.value).toBe(1);
    for (let i = 0; i < 70; i++) tickWind(1 / 60);
    expect(shader.uniforms.uWindScale!.value).toBe(0);
    stubMotion(false);
    for (let i = 0; i < 70; i++) tickWind(1 / 60);
    expect(shader.uniforms.uWindScale!.value).toBe(1);
  });
});

describe('the wind clock', () => {
  it('advances by tickWind and ignores a bad step', () => {
    const before = windClock();
    tickWind(0.25);
    expect(windClock()).toBeCloseTo((before + 0.25) % WIND_PERIOD, 9);
    const mid = windClock();
    for (const bad of [0, -1, NaN, Infinity]) tickWind(bad);
    expect(windClock()).toBe(mid);
  });

  it('is the one uniform every material reads', () => {
    const shader = compile(applyWind(new THREE.MeshLambertMaterial(), TREE), LAMBERT);
    const t0 = shader.uniforms.uWindTime!.value as number;
    tickWind(1 / 60);
    expect(shader.uniforms.uWindTime!.value).not.toBe(t0);
    expect(shader.uniforms.uWindTime!.value).toBe(windClock());
  });

  it('wraps at the period and never grows without bound, however long the game is left open', () => {
    for (let i = 0; i < 20; i++) tickWind(WIND_PERIOD * 0.3);
    expect(windClock()).toBeGreaterThanOrEqual(0);
    expect(windClock()).toBeLessThan(WIND_PERIOD);
  });

  it('wraps without a visible jump: the sway at the end of a period is the sway at the start of the next', () => {
    const origin = { x: 3.2, z: -7.9 };
    const vertex = { x: 0.2, y: 3, z: -0.4 };
    for (const t of [0.0001, 10, 100.5, 250]) {
      const a = windPush(t, origin, vertex, 0.3);
      const b = windPush(t + WIND_PERIOD, origin, vertex, 0.3);
      expect(b.x).toBeCloseTo(a.x, 9);
      expect(b.z).toBeCloseTo(a.z, 9);
    }
  });
});

describe('the sway (the same math as the shader, in TypeScript)', () => {
  const vertex = { x: 0.1, y: 4, z: -0.2 };

  it('keeps the base planted and grows with height: nothing at y = 0 or below, the full push at the top', () => {
    expect(windBend(0, 0.2)).toBe(0);
    expect(windBend(-0.35, 0.2)).toBe(0); // the part of a trunk below the ground
    let last = 0;
    for (let y = 0.5; y <= 5; y += 0.5) {
      const bend = windBend(y, 0.2);
      expect(bend).toBeGreaterThan(last);
      last = bend;
    }
    expect(windBend(5, 0.2)).toBeCloseTo(1, 9);
    expect(windBend(1, 0.2)).toBeLessThan(0.05); // a trunk about a meter up barely moves
    expect(windBend(2.5, 0.2)).toBeCloseTo(0.25, 9); // halfway up moves a quarter as far, not half
  });

  it('keeps a tree canopy to a few centimeters, bushes a little more, grass and flowers the most', () => {
    expect(WIND_KINDS.tree.strength).toBeLessThanOrEqual(0.08);
    expect(WIND_KINDS.tree.strength).toBeGreaterThan(0.02);
    expect(WIND_KINDS.tree.strength).toBeLessThan(WIND_KINDS.bush.strength);
    expect(WIND_KINDS.bush.strength).toBeLessThan(WIND_KINDS.flower.strength);
    expect(WIND_KINDS.flower.strength).toBeLessThanOrEqual(WIND_KINDS.grass.strength);
    // the tip of a tree travels well under 10 cm even in the strongest gust with the flutter on top
    let farthest = 0;
    for (let t = 0; t < WIND_PERIOD; t += 0.5) {
      const push = windPush(t, { x: 0, z: 0 }, vertex, WIND_KINDS.tree.flutter);
      farthest = Math.max(farthest, Math.hypot(push.x, push.z) * WIND_KINDS.tree.strength);
    }
    expect(farthest).toBeLessThan(0.08);
    expect(farthest).toBeGreaterThan(0.02);
  });

  it('is bounded: a gust never pushes past about 1.4 times the strength', () => {
    for (const flutter of [0.25, 0.3, 0.35]) {
      for (let t = 0; t < WIND_PERIOD; t += 0.7) {
        for (const x of [-30, 0, 11.3, 40]) {
          const push = windPush(t, { x, z: x * 0.37 - 4 }, vertex, flutter);
          expect(Math.hypot(push.x, push.z)).toBeLessThan(1.4);
        }
      }
    }
  });

  it('has a slow primary sway and a faster, smaller flutter on top', () => {
    const at = { x: 5, z: 2 };
    const swayOnly = (t: number): number => windPush(t, at, vertex, 0).x;
    // zero flutter: a smooth swing, so a 0.1 s step barely changes it
    let slow = 0;
    for (let t = 0; t < 60; t += 0.1) slow = Math.max(slow, Math.abs(swayOnly(t + 0.1) - swayOnly(t)));
    // the flutter alone (full flutter minus none) changes much faster over the same step
    let fast = 0;
    for (let t = 0; t < 60; t += 0.1) {
      const f = (s: number): number => windPush(s, at, vertex, 1).x - windPush(s, at, vertex, 0).x;
      fast = Math.max(fast, Math.abs(f(t + 0.1) - f(t)));
    }
    expect(fast).toBeGreaterThan(slow * 1.5);
    // and it is the smaller of the two motions
    const sway = Math.max(...Array.from({ length: 300 }, (_, i) => Math.abs(swayOnly(i * 0.5))));
    const flutter = Math.max(...Array.from({ length: 300 }, (_, i) => Math.abs(windPush(i * 0.5, at, vertex, 0.3).x - swayOnly(i * 0.5))));
    expect(flutter).toBeLessThan(sway * 0.5);
  });

  it('leans downwind: the average push points along the wind, not at random', () => {
    let x = 0;
    let z = 0;
    let n = 0;
    for (let t = 0; t < WIND_PERIOD; t += 0.5) {
      const p = windPush(t, { x: 2, z: 3 }, vertex, 0.3);
      x += p.x;
      z += p.z;
      n++;
    }
    expect(x / n).toBeGreaterThan(0.2);
    expect(z / n).toBeGreaterThan(0.1);
  });

  it('moves neighbors out of step: two plants half a meter apart are not in lockstep', () => {
    let same = 0;
    let total = 0;
    let spread = 0;
    for (let i = 0; i < 40; i++) {
      const a = { x: i * 1.7 - 20, z: (i % 7) * 2.3 - 5 };
      const b = { x: a.x + 0.5, z: a.z + 0.2 };
      for (const t of [3, 17, 29, 51]) {
        const pa = windPush(t, a, vertex, 0.3);
        const pb = windPush(t, b, vertex, 0.3);
        spread += Math.abs(pa.x - pb.x);
        total++;
        if (Math.abs(pa.x - pb.x) < 0.01 && Math.abs(pa.z - pb.z) < 0.01) same++;
      }
    }
    expect(same / total).toBeLessThan(0.05);
    expect(spread / total).toBeGreaterThan(0.1);
  });

  it('is worked out in the world, so it does not depend on how a plant was turned or sized (only the position sets the phase)', () => {
    // the shader reads only the instance translation for its phase: the same spot gives the same push
    const spot = { x: 8.4, z: -3.3 };
    const a = windPush(12, spot, vertex, 0.3);
    const b = windPush(12, { ...spot }, vertex, 0.3);
    expect(a).toEqual(b);
  });
});

describe('what sways', () => {
  it('trees, bushes, grass and flowers, and nothing else', () => {
    for (const id of ['tree.pine', 'tree.pine.tall', 'tree.pine.round', 'tree.round', 'tree.oak', 'tree.fall', 'tree.birch']) {
      expect(windKindFor(id), id).toBe('tree');
    }
    expect(windKindFor('plant.bush')).toBe('bush');
    expect(windKindFor('plant.bush.large')).toBe('bush');
    expect(windKindFor('plant.grass')).toBe('grass');
    expect(windKindFor('plant.grass.large')).toBe('grass');
    for (const id of ['plant.flower.red', 'plant.flower.yellow', 'plant.flower.purple']) expect(windKindFor(id), id).toBe('flower');
    for (const id of ['treehouse', 'tree', 'xtree.pine', 'plant.flowerpot', 'plant', 'plant.']) expect(windKindFor(id), id).toBeNull(); // whole segments only
    for (const id of [
      'plant.mushroom',
      'rock.large',
      'rock.tall',
      'rock.small',
      'rock.flat',
      'stump',
      'log.single',
      'log.large',
      'log.stack',
      'tent',
      'tent.small',
      'tent.open',
      'campfire',
      'building.firestation',
      'house.a',
      'fence.simple',
      'signpost',
      'street.lamp',
      'path.stone',
    ]) {
      expect(windKindFor(id), id).toBeNull();
    }
  });

  it('sizes the sway from the model: strength is the tip travel, and a flat or empty geometry cannot divide by zero', () => {
    expect(windOptions('tree', 5).heightScale).toBeCloseTo(0.2, 9);
    expect(windOptions('grass', 0.5).strength).toBe(WIND_KINDS.grass.strength);
    expect(Number.isFinite(windOptions('grass', 0).heightScale)).toBe(true);
    expect(modelHeight(new THREE.BoxGeometry(1, 3, 1).translate(0, 1.5, 0))).toBeCloseTo(3, 9);
    expect(modelHeight(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2))).toBeGreaterThan(0);
    expect(Number.isFinite(modelHeight(new THREE.BufferGeometry()))).toBe(true);
  });
});
