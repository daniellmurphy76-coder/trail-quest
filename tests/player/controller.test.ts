import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { InputState } from '../../src/engine/input';
import { defaultAvatar } from '../../src/player/avatar/options';
import { Player, PLAYER_SPEED } from '../../src/player/controller';
import { squareBounds } from '../../src/world/bounds';

const zone = { bounds: squareBounds(25) };
const still: InputState = { move: { x: 0, z: 0 }, action: false, actionPressed: false };
const forward: InputState = { move: { x: 0, z: -1 }, action: false, actionPressed: false };

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  root.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh) found.push(o as THREE.Mesh);
  });
  return found;
}

describe('Player with the avatar rig', () => {
  it('shows the blocky Scout at once (no model to wait for) in the Wolf look by default', () => {
    const player = new Player();
    expect(player.root.getObjectByName('player')).toBeDefined();
    expect(meshes(player.root)).toHaveLength(7);
    expect(player.avatar).toEqual(defaultAvatar('wolf'));
  });

  it('keeps the public API the game uses', () => {
    const player = new Player({ avatar: defaultAvatar('bear'), rank: 'bear' });
    player.setPosition(new THREE.Vector3(3, 9, -4), 1);
    expect(player.position.toArray()).toEqual([3, 0, -4]);
    expect(player.root.position.toArray()).toEqual([3, 0, -4]);
    expect(player.facing).toBe(1);
    expect(player.isMoving).toBe(false);
    expect(typeof player.viewYaw).toBe('number');
    player.interpolate(0.5);
    expect(player.root.rotation.y).toBeCloseTo(1);
  });

  it('walks when pushed: moves, turns, plays the walk cycle, then settles', () => {
    const player = new Player();
    player.viewYaw = Math.PI;
    player.setPosition(new THREE.Vector3(0, 0, 0), Math.PI);
    for (let i = 0; i < 30; i++) player.update(1 / 60, forward, zone);
    expect(player.isMoving).toBe(true);
    expect(player.emote).toBe('walk');
    expect(player.position.length()).toBeGreaterThan(PLAYER_SPEED * 0.4);
    const legs = player.root.getObjectByName('leg-l')!.rotation.x;
    expect(Math.abs(legs)).toBeGreaterThan(0);

    for (let i = 0; i < 90; i++) player.update(1 / 60, still, zone);
    expect(player.isMoving).toBe(false);
    expect(player.emote).toBe('idle');
  });

  it('stays inside the zone bounds', () => {
    const player = new Player();
    player.viewYaw = Math.PI;
    player.setPosition(new THREE.Vector3(0, 0, 24.9), Math.PI);
    for (let i = 0; i < 300; i++) player.update(1 / 60, { ...forward, move: { x: 0, z: 1 } }, zone);
    expect(Math.abs(player.position.z)).toBeLessThanOrEqual(25);
  });

  it('setAvatar rebuilds in place: same root, same meshes, new look, same spot', () => {
    const player = new Player();
    player.setPosition(new THREE.Vector3(5, 0, 5), 2);
    const before = meshes(player.root);
    const rigRoot = player.root.getObjectByName('player');
    player.setAvatar({ ...defaultAvatar('wolf'), hat: 'cap', hairStyle: 'ponytail', build: 'tall' });
    expect(player.avatar).toMatchObject({ hat: 'cap', hairStyle: 'ponytail', build: 'tall' });
    expect(meshes(player.root)).toEqual(before);
    expect(player.root.getObjectByName('player')).toBe(rigRoot);
    expect(player.position.toArray()).toEqual([5, 0, 5]);
  });

  it('setAvatar with a new rank rebuilds the rig and keeps exactly one Scout in the scene', () => {
    const player = new Player();
    player.setAvatar({ bodyColor: '#e07a5f' }, 'lion');
    expect(player.root.children).toHaveLength(1);
    expect(player.avatar.neckerchief).toBe(defaultAvatar('lion').neckerchief);
    expect(player.avatar.shirt).toBe('#e07a5f');
    expect(meshes(player.root)).toHaveLength(7);
  });

  it('celebrate() cheers once, then goes back to standing', () => {
    const player = new Player();
    player.celebrate();
    expect(player.emote).toBe('cheer');
    for (let i = 0; i < 60; i++) player.update(1 / 60, still, zone);
    expect(player.root.getObjectByName('arm-l')!.rotation.z).toBeGreaterThan(2);
    for (let i = 0; i < 150; i++) player.update(1 / 60, still, zone);
    expect(player.emote).toBe('idle');
  });

  it('does not use the Kenney character models any more', () => {
    const player = new Player();
    const names: string[] = [];
    player.root.traverse((o) => names.push(o.name));
    expect(names.some((n) => n.includes('model'))).toBe(false);
  });
});
