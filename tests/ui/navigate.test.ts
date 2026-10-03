// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NAVIGATE_REACH_RADIUS, navigateActivity, REACH_POLL_MS } from '../../src/activities/navigate';
import type { NavigateParams } from '../../src/activities/types';
import { createFakeWorldHost, type FakeWorldHost } from '../../src/activities/world-fake';
import { overlayCount } from '../../src/game/overlays';
import { buttonByText, makeCtx, makeHost } from './helpers';

const LANDMARKS = {
  alpha: { x: -8, y: 0, z: 2 },
  beta: { x: 4, y: 0, z: -9 },
  gamma: { x: 9, y: 0, z: 5 },
};
const PARAMS: NavigateParams = {
  prompt: 'Walk to the pretend places.',
  zone: 'nature-trail',
  waypoints: [
    { id: 'alpha', label: 'Alpha place' },
    { id: 'beta', label: 'Beta place' },
    { id: 'gamma', label: 'Gamma place' },
  ],
};

let host: HTMLElement;
let world: FakeWorldHost;
beforeEach(() => {
  host = makeHost();
  world = createFakeWorldHost({ landmarks: LANDMARKS });
});
afterEach(() => {
  vi.useRealTimers();
});

const run = (params: NavigateParams = PARAMS) => navigateActivity.run(host, params, makeCtx({ world }));
const panel = (): HTMLElement | null => host.querySelector('[data-tq-nonmodal="true"]');
const goal = (): string => panel()!.querySelector('.tq-world-panel__goal')!.textContent ?? '';
const count = (): string => panel()!.querySelector('.tq-eyebrow')!.textContent ?? '';
const marks = (): string[] => Array.from(panel()!.querySelectorAll('.tq-way__mark')).map((m) => m.textContent ?? '');

describe('navigate: the panel', () => {
  it('says "Go to: {label}" with "k of N", and is non-modal', () => {
    const before = document.activeElement;
    void run();
    expect(goal()).toBe('Go to: Alpha place');
    expect(count()).toBe('1 of 3');
    expect(panel()!.textContent).toContain('Walk to the pretend places.');
    expect(host.querySelector('.tq-overlay')).toBeNull();
    expect(overlayCount(host)).toBe(0);
    expect(document.activeElement).toBe(before);
  });

  it('lists the waypoints with an icon for done, now and later', () => {
    void run();
    expect(marks()).toEqual(['→', '·', '·']);
    const items = Array.from(panel()!.querySelectorAll('.tq-way'));
    expect(items[0]!.getAttribute('aria-current')).toBe('step');
    expect(items[0]!.textContent).toContain('(go here)'); // status is words too, not color alone
    world.walkToNext();
    expect(marks()).toEqual(['✔', '→', '·']);
    expect(items[0]!.textContent).toContain('(done)');
    expect(items[0]!.getAttribute('aria-current')).toBeNull();
  });

  it('has no Read button (the game has no voice)', () => {
    void run();
    expect(Array.from(panel()!.querySelectorAll('button')).some((b) => b.textContent?.includes('Read'))).toBe(false);
  });
});

describe('navigate: the world', () => {
  it('stands the beacon at the landmark and points the compass at it', () => {
    void run();
    const active = world.active();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ kind: 'marker', id: 'alpha', label: 'Alpha place', position: LANDMARKS.alpha });
    expect(active[0]!.radius).toBe(NAVIGATE_REACH_RADIUS);
    expect(world.compassTarget).toEqual(LANDMARKS.alpha);
  });

  it('uses the next open spot in order for a waypoint the zone has no landmark for', () => {
    const spots = [
      { x: 1, y: 0, z: 1 },
      { x: 2, y: 0, z: 2 },
      { x: 3, y: 0, z: 3 },
    ];
    world = createFakeWorldHost({ openSpots: spots, landmarks: { beta: LANDMARKS.beta } });
    void run();
    expect(world.active()[0]!.position).toEqual(spots[0]); // alpha: no landmark, first spot
    world.walkToNext();
    expect(world.active()[0]!.position).toEqual(LANDMARKS.beta); // beta: its landmark, no spot used
    world.walkToNext();
    expect(world.active()[0]!.position).toEqual(spots[1]); // gamma: no landmark, the second spot
  });

  it('spreads waypoints around the player when there is neither a landmark nor an open spot', () => {
    world = createFakeWorldHost({ openSpots: [], landmarks: {}, player: { x: 0, y: 0, z: 0 } });
    void run();
    const p = world.active()[0]!.position;
    expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(5 - 1e-9);
  });
});

describe('navigate: walking from one waypoint to the next', () => {
  it('shows a banner, drops the old beacon, and moves on to the next waypoint in order', () => {
    void run();
    world.walkToNext();
    const banner = host.querySelector('.tq-banner--yes')!;
    expect(banner.textContent).toContain('Yes!');
    expect(banner.textContent).toContain('You found the Alpha place!');
    expect(goal()).toBe('Go to: Beta place');
    expect(count()).toBe('2 of 3');
    expect(world.placements.map((p) => p.active)).toEqual([false, true]);
    expect(world.active()[0]).toMatchObject({ id: 'beta', position: LANDMARKS.beta });
    expect(world.compassTarget).toEqual(LANDMARKS.beta);
  });

  it('visits the waypoints strictly in order', () => {
    void run();
    world.walkTo('gamma'); // gamma has no beacon yet, so the fake player only stands at its landmark
    expect(goal()).toBe('Go to: Alpha place');
    world.walkToNext();
    world.walkToNext();
    expect(goal()).toBe('Go to: Gamma place');
  });

  it('ignores a reach callback for an earlier or later waypoint', () => {
    void run();
    const first = world.placements[0]!;
    world.walkToNext();
    first.onReach(); // a stale callback
    expect(goal()).toBe('Go to: Beta place');
    expect(world.placements).toHaveLength(2); // nothing new was placed
  });
});

describe('navigate: finishing', () => {
  it('celebrates after the last waypoint, offers Finish, and resolves completed', async () => {
    const result = run();
    world.walkToNext();
    world.walkToNext();
    world.walkToNext();
    expect(goal()).toBe('You made it!');
    expect(count()).toBe('3 of 3');
    expect(marks()).toEqual(['✔', '✔', '✔']);
    expect(host.querySelector('.tq-banner--yes')!.textContent).toContain('You found the Gamma place!');
    expect(world.compassTarget).toBeNull();
    expect(world.active()).toHaveLength(0);
    buttonByText(panel()!, 'Finish').click();
    await expect(result).resolves.toEqual({ completed: true, attempts: 3, score: 1 });
    expect(panel()).toBeNull();
    expect(world.clearCount).toBe(1);
  });

  it('does not offer Finish before the last waypoint', () => {
    void run();
    world.walkToNext();
    expect(Array.from(panel()!.querySelectorAll('button')).some((b) => b.textContent?.includes('Finish'))).toBe(false);
  });

  it('Back resolves not completed with how many were reached, and clears the world', async () => {
    const result = run();
    world.walkToNext();
    buttonByText(panel()!, 'Back').click();
    await expect(result).resolves.toEqual({ completed: false, attempts: 1 });
    expect(panel()).toBeNull();
    expect(world.clearCount).toBe(1);
    expect(world.compassTarget).toBeNull();
    expect(world.active()).toHaveLength(0);
  });

  it('Back right away resolves with zero', async () => {
    const result = run();
    buttonByText(panel()!, 'Back').click();
    await expect(result).resolves.toEqual({ completed: false, attempts: 0 });
  });
});

describe('navigate: compass only (useCompass true)', () => {
  const COMPASS: NavigateParams = { ...PARAMS, useCompass: true };

  it('places no beacon, only the compass', () => {
    void run(COMPASS);
    expect(world.placements).toHaveLength(0);
    expect(world.compassTarget).toEqual(LANDMARKS.alpha);
    expect(goal()).toBe('Go to: Alpha place');
  });

  it('notices the Scout arriving by looking at where they stand, and moves the compass on', () => {
    vi.useFakeTimers();
    void run(COMPASS);
    world.player = { x: LANDMARKS.alpha.x + NAVIGATE_REACH_RADIUS + 1, y: 0, z: LANDMARKS.alpha.z };
    vi.advanceTimersByTime(REACH_POLL_MS * 3);
    expect(goal()).toBe('Go to: Alpha place'); // still too far

    world.player = { x: LANDMARKS.alpha.x + NAVIGATE_REACH_RADIUS - 0.1, y: 0, z: LANDMARKS.alpha.z };
    vi.advanceTimersByTime(REACH_POLL_MS);
    expect(host.querySelector('.tq-banner--yes')!.textContent).toContain('You found the Alpha place!');
    expect(goal()).toBe('Go to: Beta place');
    expect(world.compassTarget).toEqual(LANDMARKS.beta);
    expect(world.placements).toHaveLength(0);
  });

  it('finishes the same way, and stops watching once it is done', async () => {
    vi.useFakeTimers();
    const result = run(COMPASS);
    for (const id of ['alpha', 'beta', 'gamma'] as const) {
      world.player = { ...LANDMARKS[id] };
      vi.advanceTimersByTime(REACH_POLL_MS);
    }
    expect(goal()).toBe('You made it!');
    const calls = world.compassHistory.length;
    vi.advanceTimersByTime(REACH_POLL_MS * 5);
    expect(world.compassHistory.length).toBe(calls);
    buttonByText(panel()!, 'Finish').click();
    await expect(result).resolves.toEqual({ completed: true, attempts: 3, score: 1 });
  });

  it('stops watching after Back', async () => {
    vi.useFakeTimers();
    const result = run(COMPASS);
    buttonByText(panel()!, 'Back').click();
    await expect(result).resolves.toEqual({ completed: false, attempts: 0 });
    world.player = { ...LANDMARKS.alpha };
    vi.advanceTimersByTime(REACH_POLL_MS * 5);
    expect(panel()).toBeNull();
  });
});

describe('navigate: edge cases', () => {
  it('shows a card saying this stop needs the camp when there is no 3D world', async () => {
    const result = navigateActivity.run(host, PARAMS, makeCtx());
    expect(host.textContent).toContain('This stop needs the camp.');
    expect(panel()).toBeNull();
    buttonByText(host, 'Back').click();
    await expect(result).resolves.toEqual({ completed: false, attempts: 0 });
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('resolves at once when there are no waypoints', async () => {
    await expect(run({ ...PARAMS, waypoints: [] })).resolves.toEqual({ completed: false, attempts: 0 });
    expect(panel()).toBeNull();
  });

  it('works with a single waypoint: reaching it is the celebration', async () => {
    const result = run({ ...PARAMS, waypoints: [PARAMS.waypoints[0]!] });
    expect(count()).toBe('1 of 1');
    world.walkToNext();
    expect(goal()).toBe('You made it!');
    buttonByText(panel()!, 'Finish').click();
    await expect(result).resolves.toEqual({ completed: true, attempts: 1, score: 1 });
  });
});
