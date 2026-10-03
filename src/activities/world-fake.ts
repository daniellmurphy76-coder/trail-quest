/**
 * A fake `WorldActivityHost` for the activity harness and for tests: no Three.js, no game. It
 * records what was placed and lets the caller "walk" to things, which fires their `onReach`
 * callbacks the way the real host does when the player gets close.
 */
import type {
  WorldActivityHost,
  WorldPlaceOptions,
  WorldPlacedHandle,
  WorldPoint,
  ZoneId,
} from './types';

export interface FakePlacement {
  kind: 'pickup' | 'marker';
  id: string;
  label: string;
  position: WorldPoint;
  radius: number;
  onReach: () => void;
  /** False once it was reached or removed. */
  active: boolean;
}

export interface FakeWorldOptions {
  zoneId?: ZoneId;
  openSpots?: WorldPoint[];
  landmarks?: Record<string, WorldPoint>;
  player?: WorldPoint;
}

export interface FakeWorldHost extends WorldActivityHost {
  /** Settable: what `openSpots()` returns. */
  spots: WorldPoint[];
  /** Settable: what `landmark(id)` looks in. */
  landmarks: Record<string, WorldPoint>;
  /** Where the fake player stands. Walking moves it. */
  player: WorldPoint;
  /** Every pickup and marker ever placed, in order (inactive ones stay, with `active: false`). */
  placements: FakePlacement[];
  /** The ones still waiting, in the order they were placed. */
  active(): FakePlacement[];
  /** The last point the compass was aimed at, or null. */
  compassTarget: WorldPoint | null;
  /** Every `setCompassTarget` call, in order. */
  compassHistory: (WorldPoint | null)[];
  /** How many times `clear()` was called. */
  clearCount: number;
  /**
   * Walk to the next thing: the active placement the compass points at, else the first active
   * one. Moves the player there and fires its `onReach`. In compass-only navigate (nothing
   * placed) it just moves the player onto the compass target. Returns the id reached, or undefined.
   */
  walkToNext(): string | undefined;
  /** Walk to the first active placement with this content id (or, failing that, a landmark with it). */
  walkTo(id: string): boolean;
}

const same = (a: WorldPoint, b: WorldPoint): boolean => a.x === b.x && a.z === b.z;

/** Twelve walkable points on a loose 4 by 3 grid, 6 units apart. */
export function defaultFakeSpots(): WorldPoint[] {
  const spots: WorldPoint[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) spots.push({ x: -9 + col * 6, y: 0, z: -6 + row * 6 });
  }
  return spots;
}

export function createFakeWorldHost(opts: FakeWorldOptions = {}): FakeWorldHost {
  const placements: FakePlacement[] = [];

  function place(kind: FakePlacement['kind'], o: WorldPlaceOptions): WorldPlacedHandle {
    const placement: FakePlacement = {
      kind,
      id: o.id,
      label: o.label,
      position: { ...o.position },
      radius: o.radius ?? (kind === 'pickup' ? 1.5 : 2),
      onReach: o.onReach,
      active: true,
    };
    placements.push(placement);
    return {
      remove() {
        placement.active = false;
      },
    };
  }

  function reach(placement: FakePlacement): void {
    host.player = { ...placement.position };
    placement.active = false; // gone before the callback, like the real host
    placement.onReach();
  }

  const host: FakeWorldHost = {
    spots: opts.openSpots ?? defaultFakeSpots(),
    openSpots: () => host.spots.map((s) => ({ ...s })),
    landmarks: opts.landmarks ?? {},
    player: opts.player ?? { x: 0, y: 0, z: 12 },
    placements,
    active: () => placements.filter((p) => p.active),
    compassTarget: null,
    compassHistory: [],
    clearCount: 0,
    zoneId: () => opts.zoneId ?? 'nature-trail',
    playerPosition: () => ({ ...host.player }),
    landmark: (id) => (Object.prototype.hasOwnProperty.call(host.landmarks, id) ? { ...host.landmarks[id]! } : undefined),
    spawnPickup: (o) => place('pickup', o),
    spawnMarker: (o) => place('marker', o),
    setCompassTarget(position) {
      host.compassTarget = position ? { ...position } : null;
      host.compassHistory.push(host.compassTarget);
    },
    clear() {
      for (const p of placements) p.active = false;
      host.clearCount += 1;
      host.compassTarget = null;
      host.compassHistory.push(null);
    },
    walkToNext() {
      const waiting = host.active();
      const aimed = host.compassTarget ? waiting.find((p) => same(p.position, host.compassTarget!)) : undefined;
      const next = aimed ?? waiting[0];
      if (next) {
        const id = next.id;
        reach(next);
        return id;
      }
      if (host.compassTarget) host.player = { ...host.compassTarget }; // compass-only: just stand there
      return undefined;
    },
    walkTo(id) {
      const found = host.active().find((p) => p.id === id);
      if (found) {
        reach(found);
        return true;
      }
      const landmark = host.landmark(id);
      if (landmark) {
        host.player = landmark;
        return true;
      }
      return false;
    },
  };
  return host;
}
