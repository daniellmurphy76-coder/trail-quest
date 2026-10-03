// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectActivity, COMPASS_REFRESH_MS } from '../../src/activities/collect';
import type { CollectParams } from '../../src/activities/types';
import { createFakeWorldHost, type FakeWorldHost } from '../../src/activities/world-fake';
import { placeAt, REUSE_OFFSET, ringPoint, seededOrder, seedFrom } from '../../src/activities/world-spots';
import { overlayCount } from '../../src/game/overlays';
import { buttonByText, flush, makeCtx, makeHost } from './helpers';

const PARAMS: CollectParams = {
  prompt: 'Find the pretend things.',
  zone: 'nature-trail',
  targets: [
    { id: 'alpha', label: 'Alpha', count: 1, hint: 'Hint for alpha.' },
    { id: 'beta', label: 'Beta', count: 2, hint: 'Hint for beta.' },
    { id: 'gamma', label: 'Gamma', count: 1 },
  ],
};
const TOTAL = 4;

let host: HTMLElement;
let world: FakeWorldHost;
beforeEach(() => {
  host = makeHost();
  world = createFakeWorldHost();
});
afterEach(() => {
  vi.useRealTimers();
});

const run = (params: CollectParams = PARAMS) => collectActivity.run(host, params, makeCtx({ world }));
const panel = (): HTMLElement | null => host.querySelector('[data-tq-nonmodal="true"]');
const rows = (): HTMLElement[] => Array.from(host.querySelectorAll<HTMLElement>('.tq-check-item'));
const eyebrow = (): string => panel()!.querySelector('.tq-eyebrow')!.textContent ?? '';

describe('collect: placing pickups', () => {
  it('places count pickups per target, one marker per pickup, with the content ids and labels', () => {
    void run();
    expect(world.placements).toHaveLength(TOTAL);
    expect(world.placements.map((p) => p.id)).toEqual(['alpha', 'beta', 'beta', 'gamma']);
    expect(world.placements.every((p) => p.kind === 'pickup' && p.active)).toBe(true);
    expect(world.placements.map((p) => p.label)).toEqual(['Alpha', 'Beta', 'Beta', 'Gamma']);
  });

  it('puts them on distinct open spots of the zone', () => {
    void run();
    const spots = world.openSpots().map((s) => `${s.x},${s.z}`);
    const used = world.placements.map((p) => `${p.position.x},${p.position.z}`);
    expect(new Set(used).size).toBe(TOTAL);
    for (const key of used) expect(spots).toContain(key);
  });

  it('shuffles the same way every time for the same targets, and differently for other targets', () => {
    void run();
    const first = world.placements.map((p) => [p.position.x, p.position.z]);
    const again = createFakeWorldHost();
    void collectActivity.run(makeHost(), PARAMS, makeCtx({ world: again }));
    expect(again.placements.map((p) => [p.position.x, p.position.z])).toEqual(first);

    const other = createFakeWorldHost();
    const params: CollectParams = { ...PARAMS, targets: PARAMS.targets.map((t) => ({ ...t, id: `${t.id}-x` })) };
    void collectActivity.run(makeHost(), params, makeCtx({ world: other }));
    expect(other.placements.map((p) => [p.position.x, p.position.z])).not.toEqual(first);
  });

  it('reuses spots with a 1.5 unit offset when they run out, so nothing stacks', () => {
    world = createFakeWorldHost({ openSpots: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }] });
    void run();
    const spots = world.placements.map((p) => p.position);
    expect(new Set(spots.map((s) => `${s.x.toFixed(3)},${s.z.toFixed(3)}`)).size).toBe(TOTAL);
    const nearSpot = (p: { x: number; z: number }): number =>
      Math.min(Math.hypot(p.x, p.z), Math.hypot(p.x - 10, p.z));
    expect(nearSpot(spots[0]!)).toBe(0);
    expect(nearSpot(spots[1]!)).toBe(0);
    expect(nearSpot(spots[2]!)).toBeCloseTo(REUSE_OFFSET, 5);
    expect(nearSpot(spots[3]!)).toBeCloseTo(REUSE_OFFSET, 5);
  });

  it('spreads pickups around the player when the zone has no open spots at all', () => {
    world = createFakeWorldHost({ openSpots: [], player: { x: 3, y: 0, z: 4 } });
    void run();
    for (const p of world.placements) {
      const d = Math.hypot(p.position.x - 3, p.position.z - 4);
      expect(d).toBeGreaterThanOrEqual(5 - 1e-9);
      expect(d).toBeLessThanOrEqual(10 + 1e-9);
    }
    expect(new Set(world.placements.map((p) => p.position.x)).size).toBe(TOTAL);
  });
});

describe('collect: the panel', () => {
  it('is a non-modal panel: it does not count as an overlay and takes no focus', () => {
    const before = document.activeElement;
    void run();
    expect(panel()).not.toBeNull();
    expect(host.querySelector('.tq-overlay')).toBeNull();
    expect(overlayCount(host)).toBe(0);
    expect(panel()!.getAttribute('aria-modal')).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it('shows the prompt, a checklist with "0 of N" counts, and a hint for the first target', () => {
    void run();
    expect(panel()!.textContent).toContain('Find the pretend things.');
    expect(eyebrow()).toBe('Found 0 of 4');
    expect(rows().map((r) => r.querySelector('.tq-check-row__label')!.textContent)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(rows().map((r) => r.querySelector('.tq-check-row__count')!.textContent)).toEqual(['0 of 1', '0 of 2', '0 of 1']);
    const hints = rows().map((r) => r.querySelector<HTMLElement>('.tq-check-item__hint'));
    expect(hints[0]!.hidden).toBe(false);
    expect(hints[0]!.textContent).toBe('Hint for alpha.');
    expect(hints[1]!.hidden).toBe(true);
    expect(hints[2]).toBeNull(); // no hint in the content
  });

  it('lets the Scout open and close any hint, and the whole list', () => {
    void run();
    const beta = rows()[1]!;
    const toggle = beta.querySelector<HTMLButtonElement>('.tq-check-row')!;
    toggle.click();
    expect(beta.querySelector<HTMLElement>('.tq-check-item__hint')!.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    toggle.click();
    expect(beta.querySelector<HTMLElement>('.tq-check-item__hint')!.hidden).toBe(true);

    const list = host.querySelector<HTMLElement>('.tq-check-list')!;
    buttonByText(panel()!, 'Hide list').click();
    expect(list.hidden).toBe(true);
    buttonByText(panel()!, 'Show list').click();
    expect(list.hidden).toBe(false);
  });

  it('has 44px-tall controls by class and no Read button (the game has no voice)', () => {
    void run();
    const labels = Array.from(panel()!.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels.some((l) => l?.includes('Read'))).toBe(false);
    expect(labels.some((l) => l?.includes('Back'))).toBe(true);
    for (const b of panel()!.querySelectorAll('button')) expect(b.classList.contains('tq-btn') || b.classList.contains('tq-check-row')).toBe(true);
  });
});

describe('collect: compass', () => {
  it('points at the nearest pickup first', () => {
    void run();
    const me = world.player;
    const nearest = [...world.placements].sort(
      (a, b) => Math.hypot(a.position.x - me.x, a.position.z - me.z) - Math.hypot(b.position.x - me.x, b.position.z - me.z),
    )[0]!;
    expect(world.compassTarget).toEqual(nearest.position);
  });

  it('moves to the next nearest pickup after one is found', () => {
    void run();
    const first = world.compassTarget!;
    world.walkToNext(); // reaches the one the compass points at, and stands on it
    const second = world.compassTarget!;
    expect(second).not.toEqual(first);
    const left = world.active().map((p) => p.position);
    expect(left.some((p) => p.x === second.x && p.z === second.z)).toBe(true);
    const me = world.player;
    for (const p of left) {
      expect(Math.hypot(second.x - me.x, second.z - me.z)).toBeLessThanOrEqual(Math.hypot(p.x - me.x, p.z - me.z) + 1e-9);
    }
  });

  it('follows the Scout as they walk, with some stickiness so it does not flicker', () => {
    vi.useFakeTimers();
    world = createFakeWorldHost({
      openSpots: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
      player: { x: 4.5, y: 0, z: 0 },
    });
    void run({ prompt: 'x', zone: 'nature-trail', targets: [{ id: 'a', label: 'A', count: 1 }, { id: 'b', label: 'B', count: 1 }] });
    const aimedAt = world.compassTarget!;
    expect(aimedAt.x).toBe(0); // the player at 4.5 is nearer the spot at 0 than the one at 10

    // Past halfway the other one is a bit closer, but not by more than the margin: stay.
    world.player = { x: 5.4, y: 0, z: 0 };
    vi.advanceTimersByTime(COMPASS_REFRESH_MS);
    expect(world.compassTarget).toEqual(aimedAt);

    // Clearly closer to the other one: switch.
    world.player = { x: 9, y: 0, z: 0 };
    vi.advanceTimersByTime(COMPASS_REFRESH_MS);
    expect(world.compassTarget!.x).toBe(10);
  });
});

describe('collect: finding things', () => {
  it('updates the count, the checklist and the progress, and shows a short "Yes!" banner', () => {
    void run();
    const id = world.walkToNext()!;
    expect(eyebrow()).toBe('Found 1 of 4');
    const row = rows().find((r) => r.querySelector('.tq-check-row__label')!.textContent!.toLowerCase() === id)!;
    expect(row.querySelector('.tq-check-row__count')!.textContent).toBe(id === 'beta' ? '1 of 2' : '1 of 1');
    const banner = host.querySelector('.tq-banner--yes')!;
    expect(banner.textContent).toContain('Yes!');
    expect(banner.textContent).toContain('Found:');
    expect(host.querySelector('.tq-feedback')!.textContent).toContain(id[0]!.toUpperCase());
    expect(world.active()).toHaveLength(3);
    expect(panel()!.textContent).not.toContain('Finish');
  });

  it('marks a target done only when all its pickups are found, with a check mark and the count', () => {
    void run();
    while (world.active().some((p) => p.id !== 'beta')) world.walkTo(world.active().find((p) => p.id !== 'beta')!.id);
    const beta = rows()[1]!;
    expect(beta.classList.contains('is-done')).toBe(false);
    expect(beta.querySelector('.tq-check-row__mark')!.textContent).toBe('☐');
    world.walkTo('beta');
    expect(beta.classList.contains('is-done')).toBe(false);
    world.walkTo('beta');
    expect(beta.classList.contains('is-done')).toBe(true);
    expect(beta.querySelector('.tq-check-row__mark')!.textContent).toBe('✔');
    expect(beta.querySelector('.tq-check-row__count')!.textContent).toBe('2 of 2');
  });

  it('counts a pickup once even if it is reached twice', () => {
    void run();
    const first = world.placements[0]!;
    first.onReach();
    first.onReach();
    expect(eyebrow()).toBe('Found 1 of 4');
  });

  it('moves the open hint on to the next target that is still left', () => {
    void run();
    world.walkTo('alpha');
    const hints = rows().map((r) => r.querySelector<HTMLElement>('.tq-check-item__hint'));
    expect(hints[0]!.hidden).toBe(true); // alpha is done
    expect(hints[1]!.hidden).toBe(false); // beta is next
  });
});

describe('collect: finishing', () => {
  it('says "You found them all!" and offers Finish, which resolves completed with a full score', async () => {
    vi.useFakeTimers();
    const result = run();
    for (let i = 0; i < TOTAL; i++) expect(world.walkToNext()).toBeDefined();
    expect(host.textContent).toContain('You found them all!');
    expect(eyebrow()).toBe('Found 4 of 4');
    expect(world.compassTarget).toBeNull();
    const calls = world.compassHistory.length;
    vi.advanceTimersByTime(COMPASS_REFRESH_MS * 5);
    expect(world.compassHistory.length).toBe(calls); // the compass timer is done
    buttonByText(panel()!, 'Finish').click();
    await expect(result).resolves.toEqual({ completed: true, attempts: TOTAL, score: 1 });
    expect(panel()).toBeNull();
    expect(world.clearCount).toBe(1);
    expect(world.active()).toHaveLength(0);
  });

  it('does not offer Finish before everything is found', () => {
    void run();
    world.walkToNext();
    expect(Array.from(panel()!.querySelectorAll('button')).some((b) => b.textContent?.includes('Finish'))).toBe(false);
  });

  it('Back resolves not completed with how many were found, and clears the world', async () => {
    vi.useFakeTimers();
    const result = run();
    world.walkToNext();
    world.walkToNext();
    buttonByText(panel()!, 'Back').click();
    await expect(result).resolves.toEqual({ completed: false, attempts: 2 });
    expect(panel()).toBeNull();
    expect(world.clearCount).toBe(1);
    expect(world.compassTarget).toBeNull();
    const calls = world.compassHistory.length;
    vi.advanceTimersByTime(COMPASS_REFRESH_MS * 5);
    expect(world.compassHistory.length).toBe(calls); // and the compass timer is stopped
  });

  it('Back right away resolves with zero found', async () => {
    const result = run();
    buttonByText(panel()!, 'Back').click();
    await expect(result).resolves.toEqual({ completed: false, attempts: 0 });
  });

  it('ignores a pickup that is reached after Back', async () => {
    const result = run();
    const late = world.placements[0]!;
    buttonByText(panel()!, 'Back').click();
    late.onReach();
    await expect(result).resolves.toEqual({ completed: false, attempts: 0 });
    expect(panel()).toBeNull();
  });
});

describe('collect: without a 3D world', () => {
  it('shows a card saying this stop needs the camp, and Back resolves not completed', async () => {
    const result = collectActivity.run(host, PARAMS, makeCtx());
    expect(host.textContent).toContain('This stop needs the camp.');
    expect(panel()).toBeNull();
    buttonByText(host, 'Back').click();
    await expect(result).resolves.toEqual({ completed: false, attempts: 0 });
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('resolves at once with nothing to find', async () => {
    await expect(run({ prompt: 'x', zone: 'nature-trail', targets: [] })).resolves.toEqual({ completed: false, attempts: 0 });
    await flush();
    expect(panel()).toBeNull();
    expect(world.placements).toHaveLength(0);
  });
});

describe('spot helpers', () => {
  it('seeds from ids the same way every time and keeps different id lists apart', () => {
    expect(seedFrom(['a', 'b'])).toBe(seedFrom(['a', 'b']));
    expect(seedFrom(['a', 'b'])).not.toBe(seedFrom(['b', 'a']));
    expect(seedFrom(['ab', 'c'])).not.toBe(seedFrom(['a', 'bc']));
  });

  it('shuffles 0..n-1 into a permutation, the same one for the same seed', () => {
    const order = seededOrder(12, 99);
    expect([...order].sort((x, y) => x - y)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(seededOrder(12, 99)).toEqual(order);
    expect(seededOrder(12, 100)).not.toEqual(order);
    expect(seededOrder(0, 1)).toEqual([]);
  });

  it('walks the order, then goes around again nudged by 1.5 units, a quarter turn further each lap', () => {
    const spots = [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 5 }];
    const order = [1, 0];
    const origin = { x: 0, y: 0, z: 0 };
    expect(placeAt(spots, order, 0, origin)).toEqual({ x: 5, y: 0, z: 5 });
    expect(placeAt(spots, order, 1, origin)).toEqual({ x: 0, y: 0, z: 0 });
    const lap1 = placeAt(spots, order, 2, origin);
    expect(Math.hypot(lap1.x - 5, lap1.z - 5)).toBeCloseTo(REUSE_OFFSET, 6);
    const lap2 = placeAt(spots, order, 4, origin);
    expect(Math.hypot(lap2.x - 5, lap2.z - 5)).toBeCloseTo(REUSE_OFFSET, 6);
    expect(lap1).not.toEqual(lap2);
  });

  it('falls back to a spiral around the origin', () => {
    const origin = { x: 10, y: 0, z: -4 };
    const points = Array.from({ length: 6 }, (_, i) => ringPoint(origin, i));
    expect(new Set(points.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`)).size).toBe(6);
    for (const p of points) expect(Math.hypot(p.x - origin.x, p.z - origin.z)).toBeGreaterThanOrEqual(5 - 1e-9);
    expect(placeAt([], [], 3, origin)).toEqual(ringPoint(origin, 3));
  });
});
