import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { ZoneId } from '../../src/activities/types';
import { QUALITY_TIERS } from '../../src/engine/quality';
import { mulberry32 } from '../../src/engine/seed';
import { createGround, edgeGrassColor, type RGB } from '../../src/world/ground';
import {
  addHorizon,
  capFog,
  horizonStats,
  HORIZON_MAX_DRAW_CALLS,
  HORIZON_MAX_TRIANGLES,
  HORIZON_PEAK_RANGE,
  HORIZON_ROOF_RANGE,
  HORIZON_TREE_RANGE,
  setHorizonQuality,
  type HorizonKind,
  type Summit,
} from '../../src/world/horizon';
import { createTerrain, TERRAIN_FLAT_MARGIN, TERRAIN_OUTER, zoneTerrain } from '../../src/world/terrain';
import { createZone, ZONE_IDS } from '../../src/world/zones';

function makeDeps() {
  return { onTalkToDenChief: vi.fn<() => void>(), onReturnToBaseCamp: vi.fn<() => void>() };
}

/** What each zone passes to `addHorizon`: outdoors get mountains, the two town zones get rooftops. */
const KIND: Record<ZoneId, HorizonKind> = {
  'base-camp': 'outdoor',
  'nature-trail': 'outdoor',
  'fitness-field': 'outdoor',
  'campfire-circle': 'outdoor',
  'town-square': 'town',
  'safety-station': 'town',
};

const square = (x: number, z: number): number => Math.max(Math.abs(x), Math.abs(z));

/** Every world-space corner or vertex of a horizon mesh: one per vertex, or the 8 box corners per instance. */
function points(mesh: THREE.Mesh): THREE.Vector3[] {
  mesh.updateMatrixWorld(true);
  const out: THREE.Vector3[] = [];
  const geometry = mesh.geometry;
  if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
    const instanced = mesh as THREE.InstancedMesh;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const m = new THREE.Matrix4();
    for (let i = 0; i < instanced.count; i++) {
      instanced.getMatrixAt(i, m);
      m.premultiply(mesh.matrixWorld);
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) out.push(new THREE.Vector3(x, y, z).applyMatrix4(m));
        }
      }
    }
    return out;
  }
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld));
  return out;
}

/** The origin of every instance of an InstancedMesh, in world space. */
function origins(mesh: THREE.InstancedMesh): THREE.Vector3[] {
  const m = new THREE.Matrix4();
  return Array.from({ length: mesh.count }, (_, i) => {
    mesh.getMatrixAt(i, m);
    return new THREE.Vector3().setFromMatrixPosition(m);
  });
}

const meshOf = (group: THREE.Object3D, name: string): THREE.Mesh | undefined => group.getObjectByName(name) as THREE.Mesh | undefined;

describe.each(ZONE_IDS)('%s horizon', (id) => {
  const zone = createZone(id, makeDeps());
  const half = zone.bounds.maxX;
  const horizon = zone.root.getObjectByName('horizon')!;

  it('is one group in the zone root, with hills, a tree line and mountains or rooftops', () => {
    expect(zone.root.children.filter((c) => c.name === 'horizon')).toHaveLength(1);
    const names = horizon.children.map((c) => c.name).sort();
    if (KIND[id] === 'outdoor') expect(names).toEqual(['horizon-hills', 'horizon-peaks', 'horizon-trees']);
    else expect(names).toEqual(['horizon-hills', 'horizon-rooftops', 'horizon-trees']);
  });

  it(`stays within ${HORIZON_MAX_DRAW_CALLS} draw calls and ${HORIZON_MAX_TRIANGLES} triangles`, () => {
    const stats = horizonStats(horizon);
    expect(stats.drawCalls).toBeLessThanOrEqual(HORIZON_MAX_DRAW_CALLS);
    expect(stats.drawCalls).toBe(3);
    expect(stats.triangles).toBeGreaterThan(5_000);
    expect(stats.triangles).toBeLessThanOrEqual(HORIZON_MAX_TRIANGLES);
  });

  it('lies fully outside the walkable bounds, and beyond the wall of trees', () => {
    for (const child of horizon.children) {
      for (const p of points(child as THREE.Mesh)) {
        expect(square(p.x, p.z), `${child.name} at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`).toBeGreaterThanOrEqual(half + 5 - 1e-6);
      }
    }
  });

  it('has the hills start at the ground plane and end at 70 units, with the hill tops above the ground', () => {
    const hills = meshOf(horizon, 'horizon-hills')!;
    let min = Infinity;
    let max = 0;
    let top = 0;
    for (const p of points(hills)) {
      min = Math.min(min, square(p.x, p.z));
      max = Math.max(max, square(p.x, p.z));
      top = Math.max(top, p.y);
      expect(p.y).toBeGreaterThanOrEqual(0);
    }
    expect(min).toBeGreaterThanOrEqual(half + 5 - 1e-6);
    expect(min).toBeLessThan(half + 14);
    expect(max).toBeCloseTo(TERRAIN_OUTER, 3);
    expect(top).toBeGreaterThan(2);
  });

  it('stands the tree line 45 to 90 units out, on the hills', () => {
    const trees = meshOf(horizon, 'horizon-trees') as THREE.InstancedMesh;
    expect(trees.count).toBeGreaterThanOrEqual(60);
    for (const p of origins(trees)) {
      const d = Math.hypot(p.x, p.z);
      expect(d).toBeGreaterThanOrEqual(HORIZON_TREE_RANGE[0] - 1e-6);
      expect(d).toBeLessThanOrEqual(HORIZON_TREE_RANGE[1] + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(-0.31); // a little sunk into the hill, never floating
      expect(p.y).toBeLessThan(15);
    }
  });

  if (KIND[id] === 'outdoor') {
    it('has far mountains 100 to 190 units out, blue-grey, with at least one to the north', () => {
      const peaks = meshOf(horizon, 'horizon-peaks')!;
      const summits = peaks.userData.summits as Summit[];
      expect(summits.length).toBeGreaterThanOrEqual(5);
      for (const s of summits) {
        expect(s.distance).toBeGreaterThanOrEqual(HORIZON_PEAK_RANGE[0]);
        expect(s.distance).toBeLessThanOrEqual(HORIZON_PEAK_RANGE[1]);
        expect(s.distance - s.radius).toBeGreaterThanOrEqual(85); // the foot never crowds the hills
        expect(s.height).toBeGreaterThan(15);
      }
      expect(summits.some((s) => s.z < 0 && Math.abs(s.x) < -s.z)).toBe(true);
      // Blue-grey: blue is the strongest channel on the flanks, and the caps are pale.
      const color = peaks.geometry.getAttribute('color');
      const position = peaks.geometry.getAttribute('position');
      let bluish = 0;
      let pale = 0;
      for (let i = 0; i < color.count; i++) {
        const r = color.getX(i);
        const b = color.getZ(i);
        if (position.getY(i) > 5 && b > r) bluish++;
        if (r > 0.5 && color.getY(i) > 0.5 && b > 0.5) pale++;
      }
      expect(bluish).toBeGreaterThan(color.count * 0.4);
      expect(pale).toBeGreaterThan(0);
      // The tallest vertices belong to the summits.
      const tallest = Math.max(...summits.map((s) => s.height));
      let top = 0;
      for (let i = 0; i < position.count; i++) top = Math.max(top, position.getY(i));
      expect(top).toBeCloseTo(tallest, 3);
    });
  } else {
    it('has distant rooftops 50 to 95 units out instead of mountains', () => {
      expect(meshOf(horizon, 'horizon-peaks')).toBeUndefined();
      const roofs = meshOf(horizon, 'horizon-rooftops') as THREE.InstancedMesh;
      expect(roofs.count).toBeGreaterThanOrEqual(60);
      for (const p of origins(roofs)) {
        const d = Math.hypot(p.x, p.z);
        expect(d).toBeGreaterThanOrEqual(HORIZON_ROOF_RANGE[0] - 1e-6);
        expect(d).toBeLessThanOrEqual(HORIZON_ROOF_RANGE[1] + 1e-6);
      }
    });
  }

  it('fades into the sky: every material uses the scene fog, and the far ones cap it so they stay visible', () => {
    for (const child of horizon.children) {
      const material = (child as THREE.Mesh).material as THREE.MeshLambertMaterial;
      expect(material.fog, child.name).toBe(true);
      if (child.name !== 'horizon-hills') expect(material.userData.fogCap as number, child.name).toBeLessThan(1);
    }
    const peaks = meshOf(horizon, 'horizon-peaks');
    if (peaks) expect((peaks.material as THREE.Material).userData.fogCap as number).toBeLessThanOrEqual(0.75);
  });
});

describe('the horizon in a zone is deterministic', () => {
  const build = (seed: number): THREE.Group => {
    const root = new THREE.Group();
    return addHorizon(root, { zoneId: 'nature-trail', half: 17.5, seed, kind: 'outdoor', quality: 'high' }).group;
  };
  const sums = (group: THREE.Group): number[] =>
    group.children.map((c) => {
      const mesh = c as THREE.Mesh;
      const array = (mesh as THREE.InstancedMesh).isInstancedMesh
        ? (mesh as THREE.InstancedMesh).instanceMatrix.array
        : mesh.geometry.getAttribute('position').array;
      return Array.from(array as ArrayLike<number>).reduce((a, b) => a + b, 0);
    });

  it('builds the same horizon for the same seed and a different one for another', () => {
    expect(sums(build(7))).toEqual(sums(build(7)));
    expect(sums(build(7))).not.toEqual(sums(build(8)));
  });
});

describe('quality tiers', () => {
  const make = (tier: (typeof QUALITY_TIERS)[number], kind: HorizonKind = 'outdoor') => {
    const root = new THREE.Group();
    const horizon = addHorizon(root, {
      zoneId: kind === 'outdoor' ? 'nature-trail' : 'town-square',
      half: 17.5,
      seed: 99,
      kind,
      quality: tier,
    });
    return { root, horizon, trees: meshOf(horizon.group, 'horizon-trees') as THREE.InstancedMesh, peaks: meshOf(horizon.group, 'horizon-peaks') };
  };

  it('keeps everything on the high and medium tiers', () => {
    for (const tier of ['high', 'medium'] as const) {
      const { horizon, trees, peaks } = make(tier);
      expect(peaks!.visible).toBe(true);
      expect(trees.count).toBe(trees.userData.fullCount);
      expect(horizonStats(horizon.group).drawCalls).toBe(3);
    }
  });

  it('skips the mountains and uses half the distant trees on the low tier', () => {
    const high = make('high');
    const low = make('low');
    expect(low.peaks!.visible).toBe(false);
    expect(low.trees.count).toBe(Math.ceil(high.trees.count / 2));
    expect(horizonStats(low.horizon.group).drawCalls).toBe(2);
    expect(horizonStats(low.horizon.group).triangles).toBeLessThan(horizonStats(high.horizon.group).triangles);
  });

  it('spreads the half that is kept all the way around, not into one corner', () => {
    const { trees } = make('low');
    const sectors = new Set<number>();
    for (const p of origins(trees)) sectors.add(Math.floor(((Math.atan2(p.z, p.x) + Math.PI) / (Math.PI * 2)) * 8));
    expect(sectors.size).toBeGreaterThanOrEqual(7);
  });

  it('follows a tier change at run time (an automatic downgrade), and back up', () => {
    const { root, horizon, trees, peaks } = make('high');
    const full = trees.count;
    setHorizonQuality(root, 'low');
    expect(peaks!.visible).toBe(false);
    expect(trees.count).toBe(Math.ceil(full / 2));
    horizon.setQuality('medium');
    expect(peaks!.visible).toBe(true);
    expect(trees.count).toBe(full);
  });

  it('gives a town zone rooftops on every tier, and still only 2 or 3 draw calls', () => {
    for (const tier of QUALITY_TIERS) {
      const { horizon } = make(tier, 'town');
      expect(meshOf(horizon.group, 'horizon-rooftops')!.visible).toBe(true);
      expect(horizonStats(horizon.group).drawCalls).toBe(3);
    }
  });

  it('does nothing when asked to set a tier on a root with no horizon', () => {
    expect(() => setHorizonQuality(new THREE.Group(), 'low')).not.toThrow();
  });
});

describe('the hills continue the ground', () => {
  const size = 50;
  const segments = 48;
  const grass = 0x58a042;
  const terrain = zoneTerrain('nature-trail', 17.5, 3321);
  const ground = createGround({ size, rng: mulberry32(5), grass, dirt: 0xb59468, terrain, segments });
  const root = new THREE.Group();
  const hills = addHorizon(root, {
    zoneId: 'nature-trail',
    half: 17.5,
    seed: 3321,
    kind: 'outdoor',
    grass,
    groundHalf: size / 2,
    groundSegments: segments,
    terrain,
    quality: 'high',
  }).group.getObjectByName('horizon-hills') as THREE.Mesh;

  const key = (x: number, z: number): string => `${x.toFixed(3)},${z.toFixed(3)}`;

  it('shares its inner edge vertices with the ground plane: same place, same height, same color, same normal', () => {
    const gp = ground.geometry.getAttribute('position');
    const gc = ground.geometry.getAttribute('color');
    const gn = ground.geometry.getAttribute('normal');
    const edge = new Map<string, number>();
    for (let i = 0; i < gp.count; i++) {
      if (square(gp.getX(i), gp.getZ(i)) > size / 2 - 1e-6) edge.set(key(gp.getX(i), gp.getZ(i)), i);
    }
    expect(edge.size).toBe(segments * 4);

    const hp = hills.geometry.getAttribute('position');
    const hc = hills.geometry.getAttribute('color');
    const hn = hills.geometry.getAttribute('normal');
    let matched = 0;
    for (let i = 0; i < segments * 4; i++) {
      const g = edge.get(key(hp.getX(i), hp.getZ(i)));
      expect(g, `ring vertex ${i} at ${hp.getX(i).toFixed(3)}, ${hp.getZ(i).toFixed(3)} has a ground vertex`).toBeDefined();
      matched++;
      expect(hp.getY(i)).toBeCloseTo(gp.getY(g!), 5);
      for (const [a, b] of [
        [hc.getX(i), gc.getX(g!)],
        [hc.getY(i), gc.getY(g!)],
        [hc.getZ(i), gc.getZ(g!)],
        [hn.getX(i), gn.getX(g!)],
        [hn.getY(i), gn.getY(g!)],
        [hn.getZ(i), gn.getZ(g!)],
      ] as const) {
        expect(a).toBeCloseTo(b, 4);
      }
    }
    expect(matched).toBe(segments * 4);
  });

  it('starts from the same grass color the ground ends in, turns blue-green in the middle distance, and is plain grass again at the outer edge', () => {
    const color = hills.geometry.getAttribute('color');
    const position = hills.geometry.getAttribute('position');
    const base = new THREE.Color(grass);
    const near: RGB = edgeGrassColor([base.r, base.g, base.b], position.getX(0), position.getZ(0));
    expect(color.getX(0)).toBeCloseTo(near[0], 5);
    const blueness = (i: number): number => color.getZ(i) / color.getX(i);
    // A vertex about 52 units out has more blue and less red than the green at the edge...
    let middle = 0;
    for (let i = 0; i < position.count; i++) {
      const s = Math.max(Math.abs(position.getX(i)), Math.abs(position.getZ(i)));
      if (s > 51 && s < 53) {
        middle = i;
        break;
      }
    }
    expect(middle).toBeGreaterThan(0);
    expect(blueness(middle)).toBeGreaterThan(blueness(0) * 1.1);
    // ...and the outer edge hands back to the grass the flat apron beyond it is made of (no color seam).
    const last = position.count - 1;
    expect(Math.max(Math.abs(position.getX(last)), Math.abs(position.getZ(last)))).toBeCloseTo(70, 3);
    const apron = new THREE.Color(grass);
    expect(color.getX(last)).toBeCloseTo(apron.r, 1);
    expect(color.getY(last)).toBeCloseTo(apron.g, 1);
    expect(color.getZ(last)).toBeCloseTo(apron.b, 1);
  });

  it('faces up everywhere (counter-clockwise from above)', () => {
    const position = hills.geometry.getAttribute('position');
    const index = hills.geometry.getIndex()!;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let i = 0; i < index.count; i += 3) {
      a.fromBufferAttribute(position, index.getX(i));
      b.fromBufferAttribute(position, index.getX(i + 1));
      c.fromBufferAttribute(position, index.getX(i + 2));
      const normal = b.sub(a).cross(c.sub(a));
      expect(normal.y).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('terrain', () => {
  const terrain = createTerrain(17.5, 42);

  it('is exactly flat across the walkable square and the band of trees beyond it', () => {
    const flat = 17.5 + TERRAIN_FLAT_MARGIN;
    for (let x = -flat; x <= flat; x += 0.7) {
      for (let z = -flat; z <= flat; z += 0.7) expect(terrain.height(x, z)).toBe(0);
    }
    expect(terrain.normal(3, -4)).toEqual([0, 1, 0]);
  });

  it('rolls into hills beyond that, never below the ground, easing back to flat by 70 units', () => {
    let top = 0;
    let beyondFlat = 0;
    for (let x = -80; x <= 80; x += 1) {
      for (let z = -80; z <= 80; z += 1) {
        const y = terrain.height(x, z);
        expect(y).toBeGreaterThanOrEqual(0);
        top = Math.max(top, y);
        if (y > 0) beyondFlat++;
        if (square(x, z) >= TERRAIN_OUTER) expect(y).toBe(0);
        const n = terrain.normal(x, z);
        expect(n[1]).toBeGreaterThan(0.7); // never steeper than about 45 degrees
        expect(Math.hypot(...n)).toBeCloseTo(1, 6);
      }
    }
    expect(top).toBeGreaterThan(5);
    expect(top).toBeLessThan(14);
    expect(beyondFlat).toBeGreaterThan(5000);
  });

  it('is the same land for the same seed, another for a different seed, lower in the town zones', () => {
    expect(createTerrain(17.5, 42).height(40, 12)).toBe(terrain.height(40, 12));
    expect(createTerrain(17.5, 43).height(40, 12)).not.toBe(terrain.height(40, 12));
    const hill = (zone: ZoneId): number => {
      const t = zoneTerrain(zone, 17.5, 42);
      let top = 0;
      for (let x = -60; x <= 60; x += 2) for (let z = -60; z <= 60; z += 2) top = Math.max(top, t.height(x, z));
      return top;
    };
    expect(hill('town-square')).toBeLessThan(hill('nature-trail') * 0.7);
  });

  it('has its slope field consistent with its height (the normal tilts away from the climb)', () => {
    const x = 36;
    const z = 6;
    const eps = 0.05;
    const dx = (terrain.height(x + eps, z) - terrain.height(x - eps, z)) / (2 * eps);
    expect(terrain.normal(x, z)[0]).toBeCloseTo(-dx / Math.hypot(dx, 1, 0), 1);
  });
});

describe('capFog', () => {
  it('replaces the fog line in the Lambert fragment shader with a capped one, keeping the scene fog uniforms', () => {
    const material = capFog(new THREE.MeshLambertMaterial(), 0.7);
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.lambert.vertexShader,
      fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
    };
    expect(shader.fragmentShader).toContain('#include <fog_fragment>');
    (material.onBeforeCompile as unknown as (s: typeof shader, r: unknown) => void)(shader, undefined);
    expect(shader.fragmentShader).not.toContain('#include <fog_fragment>');
    expect(shader.fragmentShader).toContain('min( smoothstep( fogNear, fogFar, vFogDepth ), 0.700 )');
    expect(shader.fragmentShader).toContain('mix( gl_FragColor.rgb, fogColor, fogFactor )');
    expect(shader.fragmentShader.match(/#ifdef/g)?.length).toBe(shader.fragmentShader.match(/#endif/g)?.length);
    // Different caps compile to different programs.
    const other = capFog(new THREE.MeshLambertMaterial(), 0.5);
    expect(material.customProgramCacheKey()).not.toBe(other.customProgramCacheKey());
  });
});
