// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RankId } from '../../src/activities/types';
import { startApp, type App } from '../../src/game/app';
import { events, type GameEvent } from '../../src/game/events';
import { createDefaultSave, createProfile, loadSave, memoryStore, persistSave } from '../../src/save/store';
import type { Profile } from '../../src/save/types';
import { card, doneReq } from '../fixtures/profile.fixture';
import { ID } from '../fixtures/rank.fixture';
import { buttonByText, flush, makeHost } from '../ui/helpers';

// The same stand-in for the 3D world as app.test.ts: the app only touches these members.
const world = vi.hoisted(() => {
  const state = { zone: 'base-camp' as string };
  return {
    state,
    input: { setEnabled: vi.fn(), lastDevice: 'keyboard' as 'keyboard' | 'gamepad' | 'touch' },
    idleSeconds: 0,
    setDenChiefHandler: vi.fn(),
    setGuideName: vi.fn(),
    setPlayerAvatar: vi.fn(),
    placeAtGuide: vi.fn(),
    setObjectiveVisible: vi.fn(),
    currentZoneId: () => state.zone,
    travelTo: vi.fn(async (id: string) => {
      state.zone = id;
    }),
    setReturnHandler: vi.fn(),
    onZoneChange: vi.fn(() => () => {}),
    scene: { add: vi.fn(), remove: vi.fn() },
    get zone() {
      return { id: state.zone, openSpots: [], landmarks: {} };
    },
    player: { position: { x: 0, y: 0, z: 0 }, celebrate: vi.fn() },
    labels: { add: vi.fn(() => ({})), remove: vi.fn() },
    compass: { setTarget: vi.fn() },
    onUpdate: vi.fn<(fn: (dt: number) => void) => () => void>(() => () => {}),
  };
});
vi.mock('../../src/game/world', () => ({ createWorld: () => world }));

// Test content only: the rank cards and trails come from the synthetic fixture.
vi.mock('../../src/content/load', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/content/load')>();
  const { fixtureRank: content } = await import('../fixtures/rank.fixture');
  return {
    ...actual,
    listRankContent: () => [content],
    loadRankContent: (rank: RankId) => (rank === content.rank ? content : undefined),
  };
});

let host: HTMLElement;
let seen: GameEvent[];
let off: () => void;

beforeEach(() => {
  host = makeHost();
  world.state.zone = 'base-camp';
  world.player.celebrate.mockClear();
  world.setPlayerAvatar.mockClear();
  seen = [];
  off = events.on((event) => seen.push(event));
});
// Apps started in a test are stopped when it ends: each keeps a timer, an overlay watcher on its own
// `#ui` and event-bus listeners, and the fake world is shared by every test in this file.
const startedApps: App[] = [];
afterEach(() => {
  off();
  for (const app of startedApps.splice(0)) app.dispose();
});

const types = (): string[] => seen.map((e) => e.type);
const toasts = (): string[] => Array.from(host.querySelectorAll('.tq-toast')).map((t) => t.textContent ?? '');
const click = async (text: string): Promise<void> => {
  buttonByText(host, text).click();
  await flush();
};

/** A store that already holds one Scout (xp, streak and the rest are set by `tweak`). */
function storeWith(tweak: (profile: Profile) => void = () => {}) {
  const store = memoryStore();
  const save = createDefaultSave();
  const profile = createProfile(save, { name: 'Rowan', rank: 'wolf' });
  profile.sessions = [{ date: '2026-10-02', stops: [], xpEarned: 30, durationSec: 80 }];
  tweak(profile);
  persistSave(store, save);
  return store;
}

/** A Scout with the camp quiz learned, so today's first stop is its warm-up review. */
const withWarmUp = (profile: Profile): void => {
  profile.streak = { current: 1, best: 1, lastTrailDate: '2026-10-02', embers: 0 };
  profile.requirements[ID.campQuiz] = doneReq();
  profile.review = { [ID.campQuiz]: card(0, '2026-10-02') };
};

async function play(store = storeWith(withWarmUp)) {
  const app = startApp({ canvas: document.createElement('canvas'), ui: host, store, today: '2026-10-03', autoGreet: false });
  startedApps.push(app);
  buttonByText(host, 'Play').click();
  await app.ready;
  await flush();
  return { app, store };
}

const talk = async (): Promise<void> => {
  const handler = world.setDenChiefHandler.mock.calls.at(-1)![0] as () => void;
  handler();
  await flush();
};

describe('app: events', () => {
  it('says profile-active when a Scout sits down', async () => {
    const { app } = await play();
    expect(seen.filter((e) => e.type === 'profile-active')).toEqual([{ type: 'profile-active', profileId: app.profile!.id }]);
  });

  it('says dialog-open for each Den Chief page and dialog-advance when the Scout moves on', async () => {
    await play();
    seen.length = 0;
    await talk(); // the greeting opens
    expect(types()).toEqual(['dialog-open']);
    await click("Let's go!");
    expect(types().slice(0, 3)).toEqual(['dialog-open', 'dialog-advance', 'session-start']);
    // The intro page of the first stop opened right after.
    expect(types().slice(3)).toEqual(['dialog-open']);
    await click('Next');
    expect(types().slice(-2)).toEqual(['dialog-advance', 'dialog-open']);
  });

  it('cheers with the avatar when a stop is done, and says stop-complete', async () => {
    await play();
    await talk();
    await click("Let's go!");
    await click('Next'); // intro
    await click('I remember!');
    expect(world.player.celebrate).not.toHaveBeenCalled();
    await click('Alpha'); // the warm-up quiz
    expect(types()).toContain('ui-tap');
    expect(types()).toContain('answer-right');
    await click('Finish');
    expect(world.player.celebrate).toHaveBeenCalledTimes(1);
    expect(seen.find((e) => e.type === 'stop-complete')).toEqual({ type: 'stop-complete', kind: 'warm-up', xp: 10 });
    expect(types().indexOf('activity-complete')).toBeLessThan(types().indexOf('stop-complete'));
  });
});

describe('app: rewards when a Scout sits down', () => {
  it('saves what was earned while away and tells the Scout with one toast', async () => {
    const { store } = await play(
      storeWith((p) => {
        p.xp = 60; // the beanie (50 XP)
      }),
    );
    expect(toasts()).toEqual(['You earned a new hat! Try it on in Change my look.']);
    expect(seen.filter((e) => e.type === 'cosmetic-unlocked')).toEqual([{ type: 'cosmetic-unlocked', id: 'hat-beanie' }]);
    expect(loadSave(store).profiles[0]!.unlocks).toEqual(['cosmetic:hat-beanie']);
  });

  it('says "new things" when more than one was earned', async () => {
    const { store } = await play(
      storeWith((p) => {
        p.xp = 70;
        p.streak = { current: 4, best: 4, lastTrailDate: '2026-10-02', embers: 0 };
      }),
    );
    expect(toasts()).toEqual(['You earned new things! Try them on in Change my look.']);
    expect(loadSave(store).profiles[0]!.unlocks).toEqual(['cosmetic:hat-beanie', 'cosmetic:eyes-star']);
  });

  it('does not tell the Scout twice: the next time they sit down there is nothing new', async () => {
    const { store } = await play(storeWith((p) => (p.xp = 60)));
    host = makeHost();
    seen.length = 0;
    await play(store);
    expect(toasts()).toEqual([]);
    expect(types()).not.toContain('cosmetic-unlocked');
    expect(loadSave(store).profiles[0]!.unlocks).toEqual(['cosmetic:hat-beanie']);
  });

  it('says nothing to a Scout who has earned nothing', async () => {
    const { store } = await play(storeWith(() => {}));
    expect(toasts()).toEqual([]);
    expect(loadSave(store).profiles[0]!.unlocks).toEqual([]);
  });

  it('keeps what a look from before rewards already wears, quietly: no toast, nothing taken away', async () => {
    const { store } = await play(
      storeWith((p) => {
        p.avatar = { ...p.avatar, hat: 'scout', backpack: true };
      }),
    );
    expect(toasts()).toEqual([]);
    expect(types()).not.toContain('cosmetic-unlocked');
    const saved = loadSave(store).profiles[0]!;
    expect(saved.unlocks).toEqual(['cosmetic:hat-scout', 'cosmetic:backpack']);
    expect(saved.avatar).toMatchObject({ hat: 'scout', backpack: true });
    expect(world.setPlayerAvatar).toHaveBeenLastCalledWith(expect.objectContaining({ hat: 'scout', backpack: true }), 'wolf');
  });
});

describe('app: Change my look', () => {
  async function openEditor(): Promise<void> {
    buttonByText(host.querySelector('.tq-hud')!, "Today's Trail").click();
    await flush();
    buttonByText(host.querySelector('.tq-trail-panel')!, 'Change my look').click();
    await flush();
  }

  const lockedLabels = (): string[] =>
    Array.from(host.querySelectorAll('.tq-opt--locked .tq-opt__label')).map((l) => l.textContent ?? '');

  it('locks everything the Scout has not earned yet, with the earn-it line', async () => {
    await play(storeWith(() => {}));
    await openEditor();
    expect(lockedLabels().sort()).toEqual(['Backpack', 'Beanie', 'Bucket', 'Gold', 'Scout', 'Star']);
    expect(host.querySelector('.tq-opt--locked .tq-opt__earn')!.textContent).not.toBe('');
  });

  it('opens what the Scout has earned, and only that', async () => {
    await play(
      storeWith((p) => {
        p.xp = 70;
        p.streak = { current: 4, best: 4, lastTrailDate: '2026-10-02', embers: 0 };
      }),
    );
    await openEditor();
    expect(lockedLabels().sort()).toEqual(['Backpack', 'Bucket', 'Gold', 'Scout']); // the beanie and star eyes are open
  });
});
