import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/engine/seed';
import { createBaseCamp } from '../../src/world/base-camp';
import {
  campfire,
  flagpole,
  lodge,
  personPlaceholder,
  rock,
  scatterPlants,
  tree,
  type AvoidCircle,
} from '../../src/world/props';

/** One draw call per visible Mesh, InstancedMesh, or Points (no single-object has several materials here). */
function drawCalls(root: THREE.Object3D): number {
  let n = 0;
  root.traverseVisible((o) => {
    const x = o as THREE.Mesh & THREE.Points;
    if (x.isMesh || x.isPoints) n++;
  });
  return n;
}

function instancePositions(mesh: THREE.InstancedMesh): THREE.Vector3[] {
  const m = new THREE.Matrix4();
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    out.push(new THREE.Vector3().setFromMatrixPosition(m));
  }
  return out;
}

describe('campfire', () => {
  it('stays under 6 draw calls (stones, logs, two flames, embers)', () => {
    const fire = campfire();
    expect(drawCalls(fire.root)).toBeLessThan(6);
  });

  it('has a warm point light that does not cast shadows, with a short range', () => {
    const fire = campfire();
    const lights: THREE.PointLight[] = [];
    fire.root.traverse((o) => {
      if ((o as THREE.PointLight).isPointLight) lights.push(o as THREE.PointLight);
    });
    expect(lights).toHaveLength(1);
    const light = lights[0]!;
    expect(light.castShadow).toBe(false);
    expect(light.distance).toBeGreaterThan(0);
    expect(light.distance).toBeLessThanOrEqual(20);
    expect(light.color.r).toBeGreaterThan(light.color.b); // warm
  });

  it('flickers: the light, the flame scale, and the flame height all change from frame to frame', () => {
    const fire = campfire();
    const light = fire.root.getObjectByName('campfire-light') as THREE.PointLight;
    const flames = fire.root.children.filter((o) => (o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) as THREE.Mesh[];
    expect(flames.length).toBeGreaterThanOrEqual(2); // two or three nested flames
    const intensities = new Set<number>();
    const scales = new Set<number>();
    const heights = new Set<number>();
    for (let i = 0; i < 60; i++) {
      fire.update(1 / 60);
      intensities.add(Math.round(light.intensity * 1000));
      scales.add(Math.round(flames[0]!.scale.y * 1000));
      heights.add(Math.round(flames[0]!.position.y * 10000));
    }
    expect(intensities.size).toBeGreaterThan(20);
    expect(scales.size).toBeGreaterThan(20);
    expect(heights.size).toBeGreaterThan(20);
    for (const v of intensities) {
      expect(v / 1000).toBeGreaterThan(8);
      expect(v / 1000).toBeLessThan(20);
    }
  });

  it('wears yellow, orange, and red on its flames (vertex colors), glowing and not tone mapped', () => {
    const fire = campfire();
    const flames = fire.root.children.filter((o) => (o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) as THREE.Mesh[];
    let hottest = 0;
    let reddest = 0;
    for (const f of flames) {
      const mat = f.material as THREE.MeshBasicMaterial;
      expect(mat.vertexColors).toBe(true);
      expect(mat.toneMapped).toBe(false);
      expect(f.castShadow).toBe(false);
      const col = f.geometry.getAttribute('color');
      for (let i = 0; i < col.count; i++) {
        hottest = Math.max(hottest, col.getY(i)); // yellow has a strong green channel
        reddest = Math.max(reddest, col.getX(i) - col.getY(i));
      }
    }
    expect(hottest).toBeGreaterThan(0.6);
    expect(reddest).toBeGreaterThan(0.5);
  });

  it('sends embers upward and loops them without NaN', () => {
    const fire = campfire();
    const embers = fire.root.getObjectByName('embers') as THREE.Points;
    expect(embers.isPoints).toBe(true);
    const pos = embers.geometry.getAttribute('position');
    const col = embers.geometry.getAttribute('color');
    let minY = Infinity;
    let maxY = -Infinity;
    for (let frame = 0; frame < 600; frame++) {
      fire.update(1 / 60);
      for (let i = 0; i < pos.count; i++) {
        expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
        minY = Math.min(minY, pos.getY(i));
        maxY = Math.max(maxY, pos.getY(i));
        for (const c of [col.getX(i), col.getY(i), col.getZ(i)]) {
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(pos.count).toBeGreaterThanOrEqual(8);
    expect(minY).toBeGreaterThanOrEqual(0.4);
    expect(maxY).toBeLessThan(4); // they rise a few units, then restart
    expect(maxY - minY).toBeGreaterThan(1.5);
  });

  it('makes the stones and logs cast shadows but never the flames or embers', () => {
    const fire = campfire();
    fire.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if ((m as THREE.InstancedMesh).isInstancedMesh) {
        expect(m.castShadow).toBe(true);
        expect(m.receiveShadow).toBe(true);
      } else {
        expect(m.castShadow).toBe(false);
      }
    });
  });
});

describe('shadow flags on props', () => {
  const spots = [
    { x: 1, z: 2 },
    { x: -3, z: 4 },
  ];
  const allMeshes = (root: THREE.Object3D): THREE.Mesh[] => {
    const found: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) found.push(o as THREE.Mesh);
    });
    return found;
  };

  it('trees and rocks cast and receive, and stay instanced', () => {
    const trees = tree(mulberry32(1), spots);
    const rocks = rock(mulberry32(1), spots);
    for (const m of [...allMeshes(trees), rocks]) {
      expect((m as THREE.InstancedMesh).isInstancedMesh).toBe(true);
      expect(m.castShadow).toBe(true);
      expect(m.receiveShadow).toBe(true);
    }
    expect(trees.children).toHaveLength(2); // trunks and crowns: still two draw calls
  });

  it('the flagpole and lodge cast and receive; the window panes only receive', () => {
    for (const m of allMeshes(flagpole())) expect(m.castShadow).toBe(true);
    const cabin = lodge();
    const meshes = allMeshes(cabin);
    expect(meshes).toHaveLength(4);
    for (const m of meshes) {
      expect(m.receiveShadow).toBe(true);
      expect(m.castShadow).toBe((m as THREE.InstancedMesh).isInstancedMesh ? false : true);
    }
  });

  it('people cast and receive, and the blob under them does neither', () => {
    const person = personPlaceholder(0xf2c14e, 1.95);
    let casters = 0;
    for (const m of allMeshes(person)) {
      if ((m.material as THREE.Material).transparent) {
        expect(m.castShadow).toBe(false);
        expect(m.receiveShadow).toBe(false);
      } else {
        expect(m.castShadow).toBe(true);
        casters++;
      }
    }
    expect(casters).toBe(4);
  });
});

describe('scatterPlants', () => {
  const bounds = { minX: -24, maxX: 24, minZ: -24, maxZ: 24 };
  const avoid: AvoidCircle[] = [
    { x: 0, z: 0, radius: 10 },
    { x: 15, z: 12, radius: 3 },
  ];
  const tuftsOf = (g: THREE.Group): THREE.InstancedMesh => g.getObjectByName('plant-tufts') as THREE.InstancedMesh;

  it('starts as one instanced mesh of tufts that only receive shadows', () => {
    const plants = scatterPlants(mulberry32(3), 120, bounds, avoid);
    expect(plants.children).toHaveLength(1);
    const tufts = tuftsOf(plants);
    expect(tufts.isInstancedMesh).toBe(true);
    expect(tufts.count).toBe(72); // 120 asked for, 60 percent kept: the plant scatter was cut by 40 percent
    expect(tufts.castShadow).toBe(false);
    expect(tufts.receiveShadow).toBe(true);
    expect(drawCalls(plants)).toBe(1);
  });

  it('keeps every plant inside the bounds and out of every avoid circle', () => {
    const plants = scatterPlants(mulberry32(4), 300, bounds, avoid);
    for (const p of instancePositions(tuftsOf(plants))) {
      expect(p.x).toBeGreaterThanOrEqual(bounds.minX);
      expect(p.x).toBeLessThanOrEqual(bounds.maxX);
      expect(p.z).toBeGreaterThanOrEqual(bounds.minZ);
      expect(p.z).toBeLessThanOrEqual(bounds.maxZ);
      for (const a of avoid) expect(Math.hypot(p.x - a.x, p.z - a.z)).toBeGreaterThanOrEqual(a.radius);
      expect(p.y).toBe(0);
    }
  });

  it('is the same layout for the same seed', () => {
    const a = instancePositions(tuftsOf(scatterPlants(mulberry32(9), 80, bounds, avoid)));
    const b = instancePositions(tuftsOf(scatterPlants(mulberry32(9), 80, bounds, avoid)));
    const c = instancePositions(tuftsOf(scatterPlants(mulberry32(10), 80, bounds, avoid)));
    expect(a.map((p) => [p.x, p.z])).toEqual(b.map((p) => [p.x, p.z]));
    expect(a.map((p) => [p.x, p.z])).not.toEqual(c.map((p) => [p.x, p.z]));
  });

  it('gathers plants near the edge of an avoided area when edgeFalloff is set', () => {
    const meanEdgeDistance = (edgeFalloff?: number): number => {
      const g = scatterPlants(mulberry32(5), 200, bounds, [{ x: 0, z: 0, radius: 6 }], edgeFalloff === undefined ? {} : { edgeFalloff });
      const ps = instancePositions(tuftsOf(g));
      return ps.reduce((sum, p) => sum + Math.hypot(p.x, p.z) - 6, 0) / ps.length;
    };
    expect(meanEdgeDistance(3)).toBeLessThan(meanEdgeDistance() * 0.7);
  });

  it('makes fewer plants rather than loop forever when there is no room', () => {
    const plants = scatterPlants(mulberry32(1), 50, { minX: 0, maxX: 4, minZ: 0, maxZ: 4 }, [{ x: 2, z: 2, radius: 100 }]);
    expect(plants.children).toHaveLength(0);
    expect(scatterPlants(mulberry32(1), 0, bounds, avoid).children).toHaveLength(0);
  });

  it('does not throw when the models are not available (stays on tufts)', async () => {
    const plants = scatterPlants(mulberry32(2), 30, bounds, avoid);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tuftsOf(plants)).toBeDefined();
  });
});

describe('Base Camp look', () => {
  const zone = createBaseCamp({ onTalkToDenChief: () => {} });
  it('carries no lights of its own except the campfire (the world environment lights the zone)', () => {
    const lights: THREE.Light[] = [];
    zone.root.traverse((o) => {
      if ((o as THREE.Light).isLight) lights.push(o as THREE.Light);
    });
    expect(lights).toHaveLength(1);
    expect((lights[0] as THREE.PointLight).isPointLight).toBe(true);
    expect(lights[0]!.castShadow).toBe(false);
  });

  it('uses the shaded, shadow-receiving ground with an apron under it', () => {
    const ground = zone.root.getObjectByName('ground') as THREE.Mesh;
    expect(ground.receiveShadow).toBe(true);
    expect((ground.material as THREE.MeshLambertMaterial).vertexColors).toBe(true);
    expect(zone.root.getObjectByName('ground-apron')).toBeDefined();
    // The dirt clearing is flat: the player stands at y = 0 on it.
    const pos = ground.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      if (Math.hypot(pos.getX(i), pos.getZ(i)) <= 8) expect(Math.abs(pos.getY(i))).toBe(0);
    }
  });

  it('has plants, and trees and rocks that cast shadows', () => {
    expect(zone.root.getObjectByName('plants')).toBeDefined();
    for (const name of ['trees', 'rocks']) {
      const obj = zone.root.getObjectByName(name)!;
      const found: THREE.Mesh[] = [];
      obj.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) found.push(o as THREE.Mesh);
      });
      expect(found.length).toBeGreaterThan(0);
      for (const m of found) expect(m.castShadow).toBe(true);
    }
  });

  it('stays well under the 60 draw call budget (primitives, fire, plants, Den Chief)', () => {
    expect(drawCalls(zone.root)).toBeLessThan(40);
  });
});
