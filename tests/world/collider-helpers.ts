import { isClear, PLAYER_RADIUS, type Collider } from '../../src/world/collide';
import type { Bounds } from '../../src/world/bounds';

export interface Point {
  x: number;
  z: number;
}

/** True when the straight walk from `a` to `b` never overlaps a collider (checked every 0.1 units). */
export function laneIsClear(a: Point, b: Point, colliders: readonly Collider[], radius = PLAYER_RADIUS): boolean {
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(1, Math.ceil(length / 0.1));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!isClear(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, radius, colliders)) return false;
  }
  return true;
}

/** A tiny binary min-heap of [cost, cell], enough for Dijkstra on a grid. */
class Heap {
  private readonly items: Array<[number, number]> = [];

  get size(): number {
    return this.items.length;
  }

  push(cost: number, cell: number): void {
    const a = this.items;
    a.push([cost, cell]);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent]![0] <= a[i]![0]) break;
      [a[parent], a[i]] = [a[i]!, a[parent]!];
      i = parent;
    }
  }

  pop(): [number, number] {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]![0] < a[m]![0]) m = l;
        if (r < a.length && a[r]![0] < a[m]![0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

export interface WalkMap {
  /** Walking distance from the start to the nearest open cell around (x, z) within `slack`, or null when it cannot be reached. */
  distanceTo(x: number, z: number, slack?: number): number | null;
}

/**
 * Every place a player circle can stand, on a grid, and how far each is to walk from `start`
 * (Dijkstra over eight neighbours). Cells outside the bounds or overlapping a collider are walls.
 * It answers "can the Scout get there at all, and how far is it?" for the zone as built.
 */
export function walkMap(bounds: Bounds, colliders: readonly Collider[], start: Point, step = 0.3): WalkMap {
  const cols = Math.floor((bounds.maxX - bounds.minX) / step) + 1;
  const rows = Math.floor((bounds.maxZ - bounds.minZ) / step) + 1;
  const px = (c: number): number => bounds.minX + c * step;
  const pz = (r: number): number => bounds.minZ + r * step;
  const open = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) open[r * cols + c] = isClear(px(c), pz(r), PLAYER_RADIUS, colliders) ? 1 : 0;
  }

  const cellNear = (x: number, z: number, slack: number): number | null => {
    const c0 = Math.round((x - bounds.minX) / step);
    const r0 = Math.round((z - bounds.minZ) / step);
    const reach = Math.ceil(slack / step);
    let best: number | null = null;
    let bestD = Infinity;
    for (let r = r0 - reach; r <= r0 + reach; r++) {
      for (let c = c0 - reach; c <= c0 + reach; c++) {
        if (c < 0 || r < 0 || c >= cols || r >= rows || !open[r * cols + c]) continue;
        const d = Math.hypot(px(c) - x, pz(r) - z);
        if (d <= slack && d < bestD) {
          best = r * cols + c;
          bestD = d;
        }
      }
    }
    return best;
  };

  const dist = new Float64Array(cols * rows).fill(Infinity);
  const from = cellNear(start.x, start.z, 1);
  if (from !== null) {
    const heap = new Heap();
    dist[from] = 0;
    heap.push(0, from);
    while (heap.size > 0) {
      const [d, cell] = heap.pop();
      if (d > dist[cell]!) continue;
      const r = Math.floor(cell / cols);
      const c = cell % cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          const next = nr * cols + nc;
          if (!open[next]) continue;
          const nd = d + (dr !== 0 && dc !== 0 ? step * Math.SQRT2 : step);
          if (nd < dist[next]!) {
            dist[next] = nd;
            heap.push(nd, next);
          }
        }
      }
    }
  }

  return {
    distanceTo(x, z, slack = 0.5) {
      const cell = cellNear(x, z, slack);
      if (cell === null || !Number.isFinite(dist[cell]!)) return null;
      return dist[cell]!;
    },
  };
}
