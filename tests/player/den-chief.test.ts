import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { defaultAvatar } from '../../src/player/avatar/options';
import { buildAvatar } from '../../src/player/avatar/rig';
import { createBaseCamp } from '../../src/world/base-camp';

function drawCalls(root: THREE.Object3D): number {
  let n = 0;
  root.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh) n++;
  });
  return n;
}

describe('Base Camp Den Chief (avatar rig)', () => {
  const zone = createBaseCamp({ onTalkToDenChief: vi.fn() });
  const chief = zone.root.getObjectByName('den-chief')!;

  it('is a preset avatar: tall, scout hat, glasses, a cord, and no Kenney model', () => {
    expect(chief).toBeDefined();
    const parts = ['head-mesh', 'torso-mesh', 'arm-l-mesh', 'arm-r-mesh', 'leg-l-mesh', 'leg-r-mesh'];
    for (const part of parts) expect(chief.getObjectByName(part), part).toBeDefined();
    const names: string[] = [];
    chief.traverse((o) => names.push(o.name));
    expect(names.some((n) => n.includes('model'))).toBe(false);
    const box = new THREE.Box3().setFromObject(chief);
    expect(box.max.y).toBeGreaterThan(1.95);
  });

  it('keeps the interactable: id, position, radius, label and name tag', () => {
    expect(zone.interactables).toHaveLength(1);
    const talk = zone.interactables[0]!;
    expect(talk.id).toBe('den-chief');
    expect(talk.position.x).toBeCloseTo(3.4);
    expect(talk.position.z).toBeCloseTo(-1.8);
    expect(talk.position.y).toBeCloseTo(2.3);
    expect(talk.radius).toBe(2);
    expect(talk.label).toBe('Talk');
    expect(talk.nameTag).toBe('Den Chief');
    expect(chief.position.x).toBeCloseTo(talk.position.x);
    expect(chief.position.z).toBeCloseTo(talk.position.z);
  });

  it('faces the spawn point', () => {
    const toSpawn = new THREE.Vector3(zone.spawn.x - chief.position.x, 0, zone.spawn.z - chief.position.z).normalize();
    const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), chief.rotation.y);
    expect(forward.dot(toSpawn)).toBeGreaterThan(0.99);
  });

  it('idles through zone.update, and waves now and then', () => {
    const armR = chief.getObjectByName('arm-r')!;
    const upper = chief.getObjectByName('upper')!;
    const ys = new Set<number>();
    let wavedOnce = false;
    for (let t = 0; t < 8; t += 1 / 60) {
      zone.update(1 / 60);
      ys.add(Math.round(upper.position.y * 1e5));
      if (armR.rotation.z < -2) wavedOnce = true;
    }
    expect(ys.size).toBeGreaterThan(10); // breathing
    expect(wavedOnce).toBe(true); // the first wave comes about 5 seconds in
    for (let t = 0; t < 3; t += 1 / 60) zone.update(1 / 60);
    expect(armR.rotation.z).toBeGreaterThan(-0.5); // and the arm comes back down
  });

  it('stays inside the zone draw-call budget with the player standing in it', () => {
    const scene = new THREE.Scene();
    scene.add(zone.root);
    scene.add(buildAvatar(defaultAvatar('wolf')).root);
    expect(drawCalls(scene)).toBeLessThan(40);
    expect(drawCalls(chief)).toBe(7);
  });
});
