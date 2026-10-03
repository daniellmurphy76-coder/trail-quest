/**
 * Pure helpers for placing things in a zone, shared by collect and navigate. No DOM, no Three.js.
 */
import { mulberry32 } from '../engine/seed';
import type { WorldPoint } from './types';

/** How far a reused spot is nudged, so two pickups never sit on the same point. */
export const REUSE_OFFSET = 1.5;

/** A stable 32-bit seed from a list of strings (FNV-1a). Same ids, same seed. */
export function seedFrom(parts: readonly string[]): number {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      hash ^= part.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 0x7c; // a separator, so ["ab", "c"] and ["a", "bc"] differ
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The numbers 0 to n-1 in a seeded random order (Fisher-Yates). Same seed, same order. */
export function seededOrder(n: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

/**
 * Where thing number `index` goes. Walks `order` through `spots`; once the spots run out it goes
 * around again, each lap nudged `REUSE_OFFSET` units (a quarter turn further each lap), so reused
 * spots never stack. With no spots at all, things are spread in a ring around `origin`.
 */
export function placeAt(
  spots: readonly WorldPoint[],
  order: readonly number[],
  index: number,
  origin: WorldPoint,
): WorldPoint {
  if (spots.length === 0) return ringPoint(origin, index);
  const spot = spots[order[index % spots.length]!]!;
  const lap = Math.floor(index / spots.length);
  if (lap === 0) return { ...spot };
  const angle = lap * (Math.PI / 2);
  return { x: spot.x + Math.cos(angle) * REUSE_OFFSET, y: spot.y, z: spot.z + Math.sin(angle) * REUSE_OFFSET };
}

/** Fallback when a zone has no open spots: a spiral of points around `origin`, 5 to 10 units out. */
export function ringPoint(origin: WorldPoint, index: number): WorldPoint {
  const angle = index * 2.399963; // the golden angle, so neighbors never line up
  const radius = 5 + (index % 3) * 2.5;
  return { x: origin.x + Math.cos(angle) * radius, y: origin.y, z: origin.z + Math.sin(angle) * radius };
}

export function groundDistance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
