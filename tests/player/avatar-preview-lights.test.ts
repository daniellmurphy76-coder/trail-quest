import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createPreviewLights, PREVIEW_FILL_DIRECTION, PREVIEW_KEY_DIRECTION } from '../../src/player/avatar/preview';

/** Unit vector from the stage toward a directional light. */
function toward(light: THREE.DirectionalLight): THREE.Vector3 {
  return light.position.clone().sub(light.target.position).normalize();
}

/** Where the Scout's face points at `yaw`: the front is +z at yaw 0 (the preview camera is on +z). */
function face(yaw: number): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
}

const lambert = (normal: THREE.Vector3, light: THREE.DirectionalLight): number => Math.max(0, normal.dot(toward(light)));

describe('the avatar preview lights', () => {
  const { hemisphere, key, fill } = createPreviewLights();

  it('puts the key in front of the Scout, high and a little to the left, with the shadow', () => {
    const dir = toward(key);
    expect(dir.z).toBeGreaterThanOrEqual(0.6);
    expect(dir.y).toBeGreaterThan(0);
    expect(dir.x).toBeLessThan(0);
    expect(dir.distanceTo(PREVIEW_KEY_DIRECTION)).toBeLessThan(1e-9);
    expect(key.castShadow).toBe(true);
  });

  it('adds a soft cool fill from the front right that never casts a shadow', () => {
    const dir = toward(fill);
    expect(fill.castShadow).toBe(false);
    expect(dir.z).toBeGreaterThan(0.5);
    expect(dir.x).toBeGreaterThan(0);
    expect(dir.distanceTo(PREVIEW_FILL_DIRECTION)).toBeLessThan(1e-9);
    expect(fill.intensity).toBeLessThan(key.intensity);
    expect(fill.color.b).toBeGreaterThan(fill.color.r); // cool
  });

  it('lights a face turned to the camera mostly head on: key N dot L at least 0.6 (it was 0.37)', () => {
    expect(lambert(face(0), key)).toBeGreaterThanOrEqual(0.6);
    expect(lambert(face(0), fill)).toBeGreaterThan(0.6);
  });

  it('gives the face direct light at every turn that shows it to the camera', () => {
    for (let degrees = -90; degrees <= 90; degrees += 5) {
      const yaw = THREE.MathUtils.degToRad(degrees);
      const direct = Math.max(lambert(face(yaw), key), lambert(face(yaw), fill));
      expect(direct, `${degrees} degrees`).toBeGreaterThan(0.3);
    }
  });

  it('has a sky light that is warm below instead of green', () => {
    expect(hemisphere.groundColor.g).toBeLessThanOrEqual(hemisphere.groundColor.r);
    expect(hemisphere.groundColor.b).toBeLessThan(hemisphere.groundColor.g); // warm: red over green over blue
    expect(hemisphere.color.b).toBeGreaterThan(hemisphere.color.r); // the sky stays pale blue
  });

  it('aims both directional lights at the Scout', () => {
    for (const light of [key, fill]) {
      expect(light.target.position.x).toBe(0);
      expect(light.target.position.y).toBeGreaterThan(0.5);
      expect(light.target.position.y).toBeLessThan(1.3);
      expect(light.target.position.z).toBe(0);
    }
  });
});
