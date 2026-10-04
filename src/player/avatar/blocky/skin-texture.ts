/**
 * Turns a painted skin sheet into a Three.js texture, and remembers the textures it has made.
 *
 * The texture is a `DataTexture` built straight from the pixel buffer (no canvas, so it works in Node and on
 * any browser), in sRGB, with nearest-neighbor magnification so the face stays crisp pixel art up close, and
 * nearest mipmaps so it does not shimmer when the Scout is far away.
 *
 * Textures are cached by the fields of the look that change the sheet. A cache hit hands back the same texture,
 * so a Scout who changes the hat (which is a mesh, not paint) never repaints. The cache holds the newest
 * `CACHE_LIMIT` looks; one that falls out is disposed on the GPU (if it is still on screen Three.js uploads it
 * again, so an old look is never lost, only re-sent).
 */
import * as THREE from 'three';
import type { FilledAvatar } from '../options';
import { SKIN_SIZE } from './layout';
import { paintSkin } from './painter';

const CACHE_LIMIT = 16;

/** The fields of a look that change the painted sheet. Two looks with the same key paint the same pixels. */
export function skinKey(c: FilledAvatar): string {
  // The painter only tells bald, buzz and the rest apart, and only uses the hair color when there is hair.
  const hair = c.hairStyle === 'none' ? 'none' : `${c.hairStyle === 'buzz' ? 'buzz' : 'hair'}:${c.hairColor}`;
  return [c.skin, c.eyes, hair, c.shirt, c.legs === 'pants' ? 'pants' : 'bare', c.legColor, c.shoes].join('|');
}

const cache = new Map<string, THREE.DataTexture>();

/** The skin texture for a look: made once, then shared. Do not dispose it yourself. */
export function getSkinTexture(config: FilledAvatar): THREE.DataTexture {
  const key = skinKey(config);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key); // move to the newest end
    cache.set(key, hit);
    return hit;
  }
  const sheet = paintSkin(config, SKIN_SIZE);
  const texture = new THREE.DataTexture(sheet.data, sheet.size, sheet.size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = `scout-skin:${key}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.flipY = false;
  texture.needsUpdate = true;
  cache.set(key, texture);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value as string;
    cache.get(oldest)?.dispose();
    cache.delete(oldest);
  }
  return texture;
}

/** How many skin textures are remembered now (for tests and dev tools). */
export function skinCacheSize(): number {
  return cache.size;
}

/** Forget every skin texture and free it on the GPU. */
export function clearSkinTextures(): void {
  for (const texture of cache.values()) texture.dispose();
  cache.clear();
}
