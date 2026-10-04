import * as THREE from 'three';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetBlockyModel, useBlockyModel, type BlockyAsset } from '../../src/player/avatar/blocky/model';
import { defaultAvatar } from '../../src/player/avatar/options';
import {
  BLOB_GEOMETRY,
  BLOB_LIFT,
  BLOB_MATERIAL,
  BLOB_OPACITY,
  BLOB_RADIUS,
  BLOB_TEXTURE,
  blobScale,
  buildProceduralAvatar,
} from '../../src/player/avatar/procedural';
import { buildAvatar, type AvatarRig } from '../../src/player/avatar/rig';
import { loadModel } from './model-file';

let model: BlockyAsset;
beforeAll(async () => {
  model = await loadModel();
});
beforeEach(() => resetBlockyModel());
afterEach(() => resetBlockyModel());

const wolf = defaultAvatar('wolf');
const still = { moving: false, speed: 0 } as const;

const blobOf = (rig: AvatarRig): THREE.Mesh => rig.root.getObjectByName('avatar-blob') as THREE.Mesh;
/** A Scout wearing the Kenney model (installed first, so there is no fallback). */
function modelRig(): AvatarRig {
  useBlockyModel(model);
  return buildAvatar(wolf);
}

/** The blob's height above the ground and its sideways scale, in the world. */
function blobPose(rig: AvatarRig): { y: number; scale: number } {
  rig.root.updateMatrixWorld(true);
  const blob = blobOf(rig);
  return { y: blob.getWorldPosition(new THREE.Vector3()).y, scale: blob.getWorldScale(new THREE.Vector3()).x };
}

describe('the blob shadow texture', () => {
  const { data, width, height } = BLOB_TEXTURE.image as { data: Uint8Array; width: number; height: number };
  const alpha = (x: number, y: number): number => data[(y * width + x) * 4 + 3]!;

  it('is a small black dot made in code, with linear filtering and no mipmaps', () => {
    expect(BLOB_TEXTURE).toBeInstanceOf(THREE.DataTexture);
    expect([width, height]).toEqual([64, 64]);
    for (let i = 0; i < width * height; i++) expect([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]).toEqual([0, 0, 0]);
    expect(BLOB_TEXTURE.magFilter).toBe(THREE.LinearFilter);
    expect(BLOB_TEXTURE.minFilter).toBe(THREE.LinearFilter);
    expect(BLOB_TEXTURE.generateMipmaps).toBe(false);
    expect(BLOB_TEXTURE.version).toBeGreaterThan(0); // needsUpdate was set
  });

  it('is darkest in the middle, softer toward the rim, and exactly clear at the edge', () => {
    const mid = (width - 1) / 2;
    const center = Math.max(alpha(31, 31), alpha(32, 32));
    const halfway = alpha(Math.round(mid + mid / 2), 32);
    const rim = alpha(width - 1, 32);
    expect(center).toBeGreaterThan(halfway);
    expect(halfway).toBeGreaterThan(rim);
    expect(center).toBeGreaterThan(250);
    expect(rim).toBe(0);
  });

  it('is clear all the way around the border, and falls off the same in every direction', () => {
    for (let i = 0; i < width; i++) {
      expect(alpha(i, 0)).toBe(0);
      expect(alpha(i, height - 1)).toBe(0);
      expect(alpha(0, i)).toBe(0);
      expect(alpha(width - 1, i)).toBe(0);
    }
    expect(alpha(40, 32)).toBe(alpha(23, 31)); // mirrored through the middle
    for (let x = 32; x < width - 1; x++) expect(alpha(x + 1, 32)).toBeLessThanOrEqual(alpha(x, 32)); // never brightens outward
  });
});

describe('the blob shadow geometry and material', () => {
  it('is a flat square about 1.2 across, lying on the ground', () => {
    BLOB_GEOMETRY.computeBoundingBox();
    const box = BLOB_GEOMETRY.boundingBox!;
    expect(box.max.x - box.min.x).toBeCloseTo(BLOB_RADIUS * 2, 5);
    expect(box.max.z - box.min.z).toBeCloseTo(BLOB_RADIUS * 2, 5);
    expect(box.max.y - box.min.y).toBeCloseTo(0, 5);
    expect(BLOB_RADIUS * 2).toBeCloseTo(1.2, 5);
    const normal = BLOB_GEOMETRY.getAttribute('normal');
    expect(normal.getY(0)).toBeCloseTo(1, 5); // faces up
  });

  it('is transparent, writes no depth, and is pulled toward the camera so the ground never hides it', () => {
    expect(BLOB_MATERIAL.transparent).toBe(true);
    expect(BLOB_MATERIAL.depthWrite).toBe(false);
    expect(BLOB_MATERIAL.polygonOffset).toBe(true);
    expect(BLOB_MATERIAL.polygonOffsetFactor).toBeLessThan(0);
    expect(BLOB_MATERIAL.polygonOffsetUnits).toBeLessThan(0);
    expect(BLOB_MATERIAL.color.getHex()).toBe(0x000000);
    expect(BLOB_MATERIAL.map).toBe(BLOB_TEXTURE);
    expect(BLOB_MATERIAL.opacity).toBe(BLOB_OPACITY);
    expect(BLOB_OPACITY).toBeCloseTo(0.32, 5);
  });
});

describe('the blob shadow on the rigs', () => {
  it('shares one geometry, one material and one texture between two plain Scouts', () => {
    const a = blobOf(buildProceduralAvatar(wolf));
    const b = blobOf(buildProceduralAvatar(defaultAvatar('bear')));
    expect(a).not.toBe(b);
    expect(a.geometry).toBe(BLOB_GEOMETRY);
    expect(b.geometry).toBe(a.geometry);
    expect(b.material).toBe(a.material);
    expect((a.material as THREE.MeshBasicMaterial).map).toBe(BLOB_TEXTURE);
  });

  it('shares them between two Scouts in the model, and with the plain Scout too', () => {
    const a = blobOf(modelRig());
    const b = blobOf(buildAvatar(defaultAvatar('bear')));
    const plain = blobOf(buildProceduralAvatar(wolf));
    expect(a).not.toBe(b);
    for (const other of [b, plain]) {
      expect(other.geometry).toBe(a.geometry);
      expect(other.material).toBe(a.material);
    }
    expect(a.geometry).toBe(BLOB_GEOMETRY);
    expect(a.material).toBe(BLOB_MATERIAL);
  });

  it('never casts or receives a shadow, and floats a hair above the ground', () => {
    for (const rig of [modelRig(), buildProceduralAvatar(wolf)]) {
      const blob = blobOf(rig);
      expect(blob.castShadow).toBe(false);
      expect(blob.receiveShadow).toBe(false);
      expect(blobPose(rig).y).toBeCloseTo(BLOB_LIFT, 5);
      expect(blobPose(rig).scale).toBeCloseTo(1, 5);
    }
  });
});

describe('the blob shadow while the Scout hops', () => {
  it('shrinks the more the Scout rises, but never to nothing', () => {
    expect(blobScale(0)).toBe(1);
    expect(blobScale(0.1)).toBeLessThan(1);
    expect(blobScale(0.2)).toBeLessThan(blobScale(0.1));
    expect(blobScale(0.2)).toBeGreaterThan(0.75); // only a little
    expect(blobScale(5)).toBeGreaterThan(0);
  });

  it.each([
    ['the plain Scout', (): AvatarRig => buildProceduralAvatar(wolf)],
    ['the Scout in the model', modelRig],
  ])('stays on the ground and shrinks in the cheer, then is back to full size (%s)', (_name, make) => {
    const rig = make();
    rig.play('cheer');
    let smallest = 1;
    for (let i = 0; i < 60; i++) {
      rig.update(1 / 60, still);
      const { y, scale } = blobPose(rig);
      expect(y).toBeCloseTo(BLOB_LIFT, 5); // the hop never lifts it off the ground
      smallest = Math.min(smallest, scale);
    }
    expect(smallest).toBeLessThan(0.95);
    expect(smallest).toBeGreaterThan(0.75);
    for (let i = 0; i < 150; i++) rig.update(1 / 60, still);
    expect(rig.emote).toBe('idle');
    expect(blobPose(rig).scale).toBeCloseTo(1, 2);
  });
});
