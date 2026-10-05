// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RankId } from '../../src/activities/types';
import { startApp, type App, type AppOptions } from '../../src/game/app';
import { events, type GameEvent } from '../../src/game/events';
import { GUIDE_LINES } from '../../src/npc/guide-lines';
import type { GuideId } from '../../src/npc/guide-types';
import { createDefaultSave, createProfile, loadSave, memoryStore, persistSave } from '../../src/save/store';
import type { Profile } from '../../src/save/types';
import { TRAVEL_SIGN_MS } from '../../src/game/session';
import { card, doneReq } from '../fixtures/profile.fixture';
import { fixtureRank, ID } from '../fixtures/rank.fixture';
import { buttonByText, flush, makeHost } from '../ui/helpers';

// The 3D world needs WebGL, which a DOM test does not have. The app only touches these members.
const world = vi.hoisted(() => {
  const state = { zone: 'base-camp' as string };
  const listeners = new Set<() => void>();
  // `enabled` is what the player feels: whether the game takes input right now. Tests read it, not
  // the order of setEnabled calls (those can come from any app that is still watching its own DOM).
  const input = {
    enabled: true,
    lastDevice: 'keyboard' as 'keyboard' | 'gamepad' | 'touch',
    setEnabled: vi.fn((on: boolean) => {
      input.enabled = on;
    }),
  };
  return {
    state,
    listeners,
    input,
    idleSeconds: 0,
    setDenChiefHandler: vi.fn(),
    setGuideTalkHandler: vi.fn(),
    setGuideName: vi.fn(),
    setPlayerAvatar: vi.fn(),
    placeAtGuide: vi.fn(),
    setObjectiveVisible: vi.fn(),
    // Zone travel: the mock just remembers where the player is and tells the listeners.
    currentZoneId: () => state.zone,
    travelTo: vi.fn(async (id: string) => {
      state.zone = id;
      for (const listener of [...listeners]) listener();
    }),
    setReturnHandler: vi.fn(),
    onZoneChange: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    // What the world host needs, so a stop can run (nothing is drawn).
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
beforeEach(() => {
  host = makeHost();
  world.input.setEnabled.mockClear();
  world.input.enabled = true;
  world.player.celebrate.mockClear();
  world.setDenChiefHandler.mockClear();
  world.setGuideTalkHandler.mockClear();
  world.setGuideName.mockClear();
  world.setPlayerAvatar.mockClear();
  world.placeAtGuide.mockClear();
  world.setObjectiveVisible.mockClear();
  world.travelTo.mockClear();
  world.setReturnHandler.mockClear();
  world.onZoneChange.mockClear();
  world.state.zone = 'base-camp';
  world.listeners.clear();
  world.idleSeconds = 0;
  world.input.lastDevice = 'keyboard';
});

// Every app a test boots is stopped when the test ends. An app keeps a timer, a MutationObserver
// on its own `#ui` and listeners on the event bus, and the fake world is shared by every test in
// this file: a leftover app would keep calling `world.input.setEnabled` and the rest from its
// detached host (a toast timing out, a dialog still open) in the middle of a later test.
const startedApps: App[] = [];
afterEach(() => {
  for (const app of startedApps.splice(0)) app.dispose();
});

/** Most tests drive the Den Chief by hand, so the greeting that opens by itself is off unless asked for. */
function boot(store = memoryStore(), today = '2026-10-03', extra: Partial<AppOptions> = { autoGreet: false }) {
  const app = startApp({ canvas: document.createElement('canvas'), ui: host, store, today, ...extra });
  startedApps.push(app);
  return { app, store };
}

function hudText(): string {
  return host.querySelector('.tq-hud')?.textContent ?? '';
}

/** After the name and rank, "Make your Scout" opens: accept the default look. */
async function makeScout(): Promise<void> {
  await flush();
  buttonByText(host, 'Done').click();
}

function typeInto(selector: string, value: string): void {
  const input = host.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** A store that already holds one Scout with a streak, as if the game had been played before. */
function storeWithScout(
  streak = { current: 4, best: 4, lastTrailDate: '2026-10-02', embers: 0 },
  tweak: (profile: Profile) => void = () => {},
) {
  const store = memoryStore();
  const save = createDefaultSave();
  const profile = createProfile(save, { name: 'Rowan', rank: 'wolf' });
  profile.streak = streak;
  profile.xp = 70;
  profile.sessions = [{ date: '2026-10-02', stops: [], xpEarned: 30, durationSec: 80 }];
  tweak(profile);
  persistSave(store, save);
  return store;
}

/** Three finished sessions on record: past the first three, so the controls hint no longer shows by default. */
const manySessions = (profile: Profile): void => {
  profile.sessions = ['2026-09-28', '2026-09-30', '2026-10-02'].map((date) => ({
    date,
    stops: [],
    xpEarned: 30,
    durationSec: 80,
  }));
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const startButton = (): HTMLButtonElement | null => host.querySelector('.tq-dock .tq-start');
const hintCard = (): HTMLElement | null => host.querySelector('.tq-hint-card');
const shown = (el: HTMLElement | null): boolean => el !== null && !el.hidden;
const lastObjective = (): unknown => world.setObjectiveVisible.mock.calls.at(-1)?.[0];

/** The Scout walks up to a zone guide and talks: what the world's Talk spot does through the handler the app gave it. */
async function talkToZoneGuide(id: GuideId): Promise<void> {
  const handler = world.setGuideTalkHandler.mock.calls.at(-1)![0] as (guide: GuideId) => void;
  handler(id);
  await flush();
}

describe('app: first run', () => {
  it('shows profile setup when there are no profiles, then the HUD once a Scout is made', async () => {
    const { app, store } = boot();
    expect(host.querySelector('.tq-overlay')).not.toBeNull();
    expect(host.textContent).toContain('Who is playing?');
    expect(host.textContent).toContain('Test Wolf · grade 2');
    expect(host.querySelector<HTMLElement>('.tq-hud')!.hidden).toBe(true);

    typeInto('input[name="scout-name"]', 'Rowan');
    buttonByText(host, 'Test Wolf').click();
    buttonByText(host, "Let's start").click();
    await makeScout();
    await app.ready;

    expect(host.querySelector('.tq-overlay')).toBeNull();
    expect(host.querySelector<HTMLElement>('.tq-hud')!.hidden).toBe(false);
    expect(hudText()).toContain('Rowan');
    expect(hudText()).toContain('Test Wolf');
    expect(hudText()).toContain('0 XP');
    expect(hudText()).toContain('Day 0 streak');
    expect(hudText()).toContain("Today's Trail");
    expect(hudText()).toMatch(/0 of \d/); // the progress dots, with words beside them
    expect(host.querySelectorAll('.tq-hud .tq-dot').length).toBeGreaterThanOrEqual(2);
    expect(world.setGuideName).toHaveBeenLastCalledWith('Den Chief');
    expect(loadSave(store).profiles).toHaveLength(1);
    expect(loadSave(store).profiles[0]).toMatchObject({ name: 'Rowan', rank: 'wolf' });
    expect(app.profile?.name).toBe('Rowan');
    expect(app.session).not.toBeNull();
  });

  it('turns game input off while an overlay is open and on when it closes', async () => {
    const { app } = boot();
    await flush();
    expect(world.input.enabled).toBe(false); // profile setup is open
    typeInto('input[name="scout-name"]', 'Rowan');
    buttonByText(host, 'Test Wolf').click();
    buttonByText(host, "Let's start").click();
    await makeScout();
    await app.ready;
    await flush();
    expect(world.input.enabled).toBe(true);
  });
});

describe('app: returning', () => {
  it('shows the picker with a streak flame, and Play opens the game', async () => {
    const { app } = boot(storeWithScout());
    expect(host.querySelectorAll('.tq-profile')).toHaveLength(1);
    expect(host.textContent).toContain('Rowan');
    expect(host.textContent).toContain('\u{1F525} 4 days');
    expect(host.textContent).toContain('Add a Scout');
    expect(host.textContent).toContain('Parent');

    buttonByText(host, 'Play').click();
    await app.ready;
    expect(hudText()).toContain('70 XP');
    expect(hudText()).toContain('Day 4 streak');
  });

  it('shows a lapsed streak as 0 and follows a date override', async () => {
    const { app } = boot(storeWithScout());
    buttonByText(host, 'Play').click();
    await app.ready;
    expect(app.today()).toBe('2026-10-03');
    app.setToday('2026-10-09');
    expect(hudText()).toContain('Day 0 streak');
    app.setToday('2026-10-03');
    expect(hudText()).toContain('Day 4 streak');
  });
});

describe('app: Den Chief and the trail panel', () => {
  async function play() {
    const booted = boot(storeWithScout());
    buttonByText(host, 'Play').click();
    await booted.app.ready;
    const handler = world.setDenChiefHandler.mock.calls.at(-1)![0] as () => void;
    return { ...booted, talk: handler };
  }

  it('greets by name and lets the kid look around first', async () => {
    const { app, talk } = await play();
    talk();
    await flush();
    expect(host.textContent).toContain('Welcome back, Rowan!');
    expect(host.textContent).toContain('Day 4');
    expect(host.textContent).toContain("Let's go!");
    expect(host.textContent).toContain('Look around first');
    expect(host.textContent).not.toContain('Not now');
    expect(app.session!.busy).toBe(true);
    buttonByText(host, 'Look around first').click();
    await flush();
    expect(host.querySelector('.tq-overlay')).toBeNull();
    expect(app.session!.busy).toBe(false);
  });

  it('opens the trail panel from the HUD with today stops and the Switch and Parent buttons', async () => {
    await play();
    buttonByText(host.querySelector('.tq-hud')!, "Today's Trail").click();
    await flush();
    expect(host.textContent).toContain("Today's Trail");
    expect(host.textContent).toContain('Up next');
    expect(host.textContent).toContain('Later');
    expect(host.textContent).toContain('Switch Scout');
    expect(host.textContent).toContain('Parent');
    buttonByText(host, 'Close').click();
    await flush();
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('Switch Scout goes to the picker, and Add a Scout can go back', async () => {
    await play();
    buttonByText(host.querySelector('.tq-hud')!, "Today's Trail").click();
    await flush();
    buttonByText(host, 'Switch Scout').click();
    await flush();
    expect(host.querySelectorAll('.tq-profile')).toHaveLength(1);
    expect(host.querySelector<HTMLElement>('.tq-hud')!.hidden).toBe(true);

    buttonByText(host, 'Add a Scout').click();
    await flush();
    expect(host.textContent).toContain('Test Wolf · grade 2');
    buttonByText(host, 'Back').click();
    await flush();
    expect(host.querySelectorAll('.tq-profile')).toHaveLength(1);
  });

  it('does not open the trail panel twice', async () => {
    await play();
    const trail = buttonByText(host.querySelector('.tq-hud')!, "Today's Trail");
    trail.click();
    trail.click();
    await flush();
    expect(host.querySelectorAll('.tq-overlay')).toHaveLength(1);
  });

  it('asks a parent to set a PIN before Parent mode when there is none', async () => {
    const { app } = boot(storeWithScout());
    buttonByText(host, 'Parent').click();
    await flush();
    expect(host.textContent).toContain('Parent: choose a PIN');
    expect(host.textContent).toContain('not a security lock');
    buttonByText(host, 'Cancel').click();
    await flush();
    // Back on the picker.
    expect(host.querySelectorAll('.tq-profile')).toHaveLength(1);
    expect(app.profile).toBeNull();
  });
});

describe('app: guided start', () => {
  const GREET_MS = 40;
  const guided: Partial<AppOptions> = { autoGreet: true, greetingDelayMs: GREET_MS };

  async function createFirstScout() {
    const booted = boot(memoryStore(), '2026-10-03', guided);
    typeInto('input[name="scout-name"]', 'Rowan');
    buttonByText(host, 'Test Wolf').click();
    buttonByText(host, "Let's start").click();
    await makeScout();
    await booted.app.ready;
    return booted;
  }

  it('puts the Scout by the Den Chief and, a moment later, explains the game on the very first session', async () => {
    await createFirstScout();
    expect(world.placeAtGuide).toHaveBeenCalledTimes(1);
    // Nothing opens straight away, and the controls hint waits for the greeting to be over.
    expect(host.querySelector('.tq-overlay')).toBeNull();
    expect(shown(hintCard())).toBe(false);

    await wait(GREET_MS + 80);
    expect(host.querySelector('.tq-overlay')).not.toBeNull();
    expect(host.textContent).toContain('Hi Rowan, I am Den Chief!');
    expect(host.textContent).toContain('A trail is three quick stops.');
    expect(host.textContent).toContain('grow your campfire');
    const labels = Array.from(host.querySelectorAll('.tq-dialog__choices button')).map((b) => b.textContent);
    expect(labels).toEqual(["Let's go!", 'Look around first']);
    // The Start button and the objective step aside while the Den Chief talks.
    expect(shown(startButton())).toBe(false);
    expect(lastObjective()).toBe(false);
  });

  it('"Look around first" closes the dialog, then shows the controls hint, the objective and the Start button', async () => {
    await createFirstScout();
    await wait(GREET_MS + 80);
    buttonByText(host, 'Look around first').click();
    await flush();

    expect(host.querySelector('.tq-overlay')).toBeNull();
    expect(shown(hintCard())).toBe(true);
    expect(hintCard()!.textContent).toContain('Walk: arrow keys or W A S D.');
    expect(hintCard()!.textContent).toContain('Talk: E');
    expect(host.querySelectorAll('.tq-hint-card .tq-key')).toHaveLength(5);
    expect(lastObjective()).toBe(true);
    expect(shown(startButton())).toBe(true);
    expect(startButton()!.textContent).toContain("Start today's trail");
  });

  it('words the hint for touch when the last device was touch, with no key caps', async () => {
    world.input.lastDevice = 'touch';
    await createFirstScout();
    await wait(GREET_MS + 80);
    buttonByText(host, 'Look around first').click();
    await flush();
    expect(hintCard()!.textContent).toContain('Walk: drag the circle.');
    expect(hintCard()!.textContent).toContain('Talk: tap the big button.');
    expect(host.querySelectorAll('.tq-hint-card .tq-key')).toHaveLength(0);
  });

  it('says hello on a later day and offers the same two choices', async () => {
    const { app } = boot(storeWithScout(), '2026-10-03', guided);
    buttonByText(host, 'Play').click();
    await app.ready;
    await wait(GREET_MS + 80);
    expect(host.textContent).toContain('Welcome back, Rowan!');
    const labels = Array.from(host.querySelectorAll('.tq-dialog__choices button')).map((b) => b.textContent);
    expect(labels).toEqual(["Let's go!", 'Look around first']);
  });

  it('does not open the greeting by itself when today is already done', async () => {
    const done = { current: 5, best: 5, lastTrailDate: '2026-10-03', embers: 0 };
    const { app } = boot(storeWithScout(done), '2026-10-03', guided);
    buttonByText(host, 'Play').click();
    await app.ready;
    expect(world.placeAtGuide).toHaveBeenCalledTimes(1);
    await wait(GREET_MS + 80);
    expect(host.querySelector('.tq-overlay')).toBeNull();
    expect(lastObjective()).toBe(false);
    expect(hudText()).toContain('Done');
  });

  it('leaves the Scout alone when they open something before the greeting fires', async () => {
    const { app } = boot(storeWithScout(), '2026-10-03', { autoGreet: true, greetingDelayMs: 120 });
    buttonByText(host, 'Play').click();
    await app.ready;
    buttonByText(host.querySelector('.tq-hud')!, "Today's Trail").click();
    await wait(200);
    expect(host.querySelectorAll('.tq-overlay')).toHaveLength(1);
    expect(host.textContent).toContain('Up next'); // still the trail panel, no dialog on top
  });

  it('cancels the greeting when the Scout switches away', async () => {
    const { app } = boot(storeWithScout(), '2026-10-03', { autoGreet: true, greetingDelayMs: 120 });
    buttonByText(host, 'Play').click();
    await app.ready;
    buttonByText(host.querySelector('.tq-hud')!, "Today's Trail").click();
    await flush();
    buttonByText(host, 'Switch Scout').click();
    await wait(200);
    expect(host.textContent).toContain('Who is playing?');
    expect(host.textContent).not.toContain('Welcome back');
  });
});

describe('app: the Start button', () => {
  async function play(store = storeWithScout()) {
    const booted = boot(store);
    buttonByText(host, 'Play').click();
    await booted.app.ready;
    await flush();
    return booted;
  }

  it('shows "Start today\'s trail" at Base Camp and opens the Den Chief from anywhere', async () => {
    await play();
    expect(shown(startButton())).toBe(true);
    expect(startButton()!.textContent).toContain("Start today's trail");
    expect(lastObjective()).toBe(true);

    startButton()!.click();
    await flush();
    expect(host.textContent).toContain('Welcome back, Rowan!');
    expect(shown(startButton())).toBe(false); // an overlay is open
    expect(lastObjective()).toBe(false); // a session is running

    buttonByText(host, 'Look around first').click();
    await flush();
    expect(shown(startButton())).toBe(true);
    expect(lastObjective()).toBe(true);
  });

  it('hides while the trail panel is open', async () => {
    await play();
    buttonByText(host.querySelector('.tq-hud')!, "Today's Trail").click();
    await flush();
    expect(shown(startButton())).toBe(false);
  });

  it('puts the same Start button at the top of the trail panel, and it starts the trail talk', async () => {
    await play();
    buttonByText(host.querySelector('.tq-hud')!, "Today's Trail").click();
    await flush();
    const panelStart = host.querySelector<HTMLButtonElement>('.tq-overlay .tq-start')!;
    expect(panelStart.textContent).toContain("Start today's trail");
    // First thing after the title row, before the list of stops.
    const panel = host.querySelector('.tq-trail-panel')!;
    expect(Array.from(panel.children).indexOf(panelStart)).toBe(1);

    panelStart.click();
    await flush();
    expect(host.querySelector('.tq-trail-panel')).toBeNull();
    expect(host.textContent).toContain('Welcome back, Rowan!');
  });

  const doneToday = { current: 5, best: 5, lastTrailDate: '2026-10-03', embers: 0 };

  it('says "Keep going!" when the trail is done and more waits, and it starts the next trail', async () => {
    const store = storeWithScout(doneToday, (p) => {
      p.requirements = { [ID.campQuiz]: doneReq() };
      p.review = { [ID.campQuiz]: card(0, '2026-10-02') };
    });
    await play(store);
    expect(shown(startButton())).toBe(true);
    expect(startButton()!.textContent).toContain('Keep going!');
    expect(startButton()!.textContent).not.toContain('Bonus');
    expect(lastObjective()).toBe(false);

    buttonByText(host.querySelector('.tq-hud')!, "Today's Trail").click();
    await flush();
    expect(host.querySelector('.tq-overlay .tq-start')!.textContent).toContain('Keep going!');
    expect(host.textContent).toContain('Your trail is done! Great job!');
    buttonByText(host, 'Close').click();
    await flush();

    // The button asks the Den Chief, who offers the two choices.
    startButton()!.click();
    await flush();
    expect(host.textContent).toContain('Your trail is done today. Want to keep going?');
    const labels = Array.from(host.querySelectorAll('.tq-dialog__choices button')).map((b) => b.textContent);
    expect(labels).toEqual(['Keep going!', 'Look around']);
    expect(host.textContent).not.toContain('Bonus');
  });

  it('shows the dots of the new trail once the Scout keeps going', async () => {
    const store = storeWithScout(doneToday, (p) => {
      p.requirements = { [ID.campQuiz]: doneReq() };
      p.review = { [ID.campQuiz]: card(0, '2026-10-02') };
    });
    await play(store);
    expect(hudText()).toContain('Done'); // today's trail is finished
    startButton()!.click();
    await flush();
    buttonByText(host.querySelector('.tq-dialog__choices')!, 'Keep going!').click();
    await flush();
    // A fresh trail is on its way: warm-up, new step, mission card. Nothing of it is done yet.
    expect(host.textContent).toContain('Warm-up time!');
    expect(hudText()).toContain('0 of 3');
    expect(host.querySelectorAll('.tq-hud .tq-dot')).toHaveLength(3);
  });

  it('is hidden when the trail is done and nothing is left to keep going with', async () => {
    // Everything is done, and today's log already shows every requirement used.
    const store = storeWithScout(doneToday, (p) => {
      const ids = Object.values(ID);
      for (const id of ids) p.requirements[id] = doneReq();
      p.sessions = [
        { date: '2026-10-03', stops: ids.map((requirementId) => ({ kind: 'bonus' as const, requirementId, completed: true })), xpEarned: 0, durationSec: 60 },
      ];
    });
    await play(store);
    expect(shown(startButton())).toBe(false);
    buttonByText(host.querySelector('.tq-hud')!, "Today's Trail").click();
    await flush();
    expect(host.querySelector('.tq-overlay .tq-start')).toBeNull();
  });

  it('is hidden on the picker, before anybody is playing', async () => {
    boot(storeWithScout());
    await flush();
    expect(shown(startButton())).toBe(false);
  });
});

describe('app: the controls hint', () => {
  async function play(tweak: (profile: Profile) => void = () => {}) {
    const booted = boot(storeWithScout(undefined, tweak));
    buttonByText(host, 'Play').click();
    await booted.app.ready;
    await flush();
    return booted;
  }

  /** Re-check the hint without waiting for the 250 ms timer. */
  const recheck = (app: ReturnType<typeof boot>['app']): void => app.setToday(app.today());

  it('shows during the first three sessions', async () => {
    await play(); // one finished session on record
    expect(shown(hintCard())).toBe(true);
  });

  it('stays away after the first three sessions until the Scout has stood still for 8 seconds', async () => {
    const { app } = await play(manySessions);
    expect(shown(hintCard())).toBe(false);
    world.idleSeconds = 7.9;
    recheck(app);
    expect(shown(hintCard())).toBe(false);
    world.idleSeconds = 8;
    recheck(app);
    expect(shown(hintCard())).toBe(true);
  });

  it('is put away by one tap and stays away until the Scout moves', async () => {
    const { app } = await play(manySessions);
    world.idleSeconds = 9;
    recheck(app);
    expect(shown(hintCard())).toBe(true);

    hintCard()!.click();
    expect(shown(hintCard())).toBe(false);
    world.idleSeconds = 20; // still standing there: no nagging
    recheck(app);
    expect(shown(hintCard())).toBe(false);

    world.idleSeconds = 0; // walked
    recheck(app);
    world.idleSeconds = 8;
    recheck(app);
    expect(shown(hintCard())).toBe(true);
  });

  it('does not show over a dialog or panel', async () => {
    await play();
    expect(shown(hintCard())).toBe(true);
    buttonByText(host.querySelector('.tq-hud')!, "Today's Trail").click();
    await flush();
    expect(shown(hintCard())).toBe(false);
    buttonByText(host, 'Close').click();
    await flush();
    expect(shown(hintCard())).toBe(true);
  });

  it('has no Read button: the game has no voice', async () => {
    await play();
    expect(Array.from(hintCard()!.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Got it']);
  });

  it('is only for Base Camp', async () => {
    const { app } = await play();
    expect(shown(hintCard())).toBe(true);
    world.state.zone = 'nature-trail';
    app.setToday(app.today()); // any refresh re-checks the hint
    expect(shown(hintCard())).toBe(false);
  });
});

describe('app: zones', () => {
  async function play() {
    const booted = boot(storeWithScout());
    buttonByText(host, 'Play').click();
    await booted.app.ready;
    await flush();
    return booted;
  }

  const openTrailPanel = async (): Promise<void> => {
    buttonByText(host.querySelector('.tq-hud')!, "Today's Trail").click();
    await flush();
  };

  it('lists a Places button for every zone in the trail panel and marks where the Scout is', async () => {
    await play();
    await openTrailPanel();
    const places = host.querySelector('.tq-places')!;
    const labels = Array.from(places.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toHaveLength(6);
    for (const name of ['Base Camp', 'Fitness Field', 'Nature Trail', 'Town Square', 'Safety Station', 'Campfire Circle']) {
      expect(labels.some((l) => l?.includes(name))).toBe(true);
    }
    const here = places.querySelector<HTMLButtonElement>('button[aria-current="location"]')!;
    expect(here.textContent).toContain('Base Camp');
    expect(here.textContent).toContain('You are here');
    expect(here.disabled).toBe(true);
  });

  it('opens the Scout Book from the trail panel, next to Change my look, and Close comes back to the panel', async () => {
    await play();
    await openTrailPanel();
    const panel = host.querySelector('.tq-trail-panel')!;
    const labels = Array.from(panel.querySelectorAll('.tq-actions button')).map((b) => b.textContent ?? '');
    expect(labels.findIndex((t) => t.includes('Scout Book'))).toBe(labels.findIndex((t) => t.includes('Change my look')) + 1);

    buttonByText(panel, 'Scout Book').click();
    await flush();
    const book = host.querySelector<HTMLElement>('.tq-book')!;
    expect(book).not.toBeNull();
    expect(book.textContent).toContain('Scout Book');
    expect(host.querySelectorAll('.tq-overlay')).toHaveLength(2); // the panel is still underneath

    buttonByText(book, 'Close').click();
    await flush();
    expect(host.querySelector('.tq-book')).toBeNull();
    expect(host.querySelector('.tq-trail-panel')).not.toBeNull();
  });

  it('a Places button closes the panel and walks to that zone, which hides the Start button', async () => {
    await play();
    expect(shown(startButton())).toBe(true);
    await openTrailPanel();
    buttonByText(host.querySelector('.tq-places')!, 'Nature Trail').click();
    await flush();
    expect(world.travelTo).toHaveBeenCalledWith('nature-trail');
    expect(host.querySelector('.tq-overlay')).toBeNull();
    expect(shown(startButton())).toBe(false); // the Den Chief lives at Base Camp
  });

  it('Start in the trail panel walks home first when the Scout is somewhere else', async () => {
    await play();
    world.state.zone = 'nature-trail';
    await openTrailPanel();
    expect(host.querySelector('.tq-places button[aria-current="location"]')!.textContent).toContain('Nature Trail');
    host.querySelector<HTMLButtonElement>('.tq-overlay .tq-start')!.click();
    await flush();
    expect(world.travelTo).toHaveBeenCalledWith('base-camp');
    expect(host.textContent).toContain('Welcome back, Rowan!');
  });

  it('walks back to Base Camp when a conversation with the Den Chief ends somewhere else', async () => {
    await play();
    const talk = world.setDenChiefHandler.mock.calls.at(-1)![0] as () => void;
    talk();
    await flush();
    world.state.zone = 'nature-trail'; // as if the trail's last stop was out there
    buttonByText(host, 'Look around first').click();
    await flush();
    expect(world.travelTo).toHaveBeenCalledWith('base-camp');
    expect(world.state.zone).toBe('base-camp');
  });

  it('stays put when the conversation ends at Base Camp already', async () => {
    await play();
    const talk = world.setDenChiefHandler.mock.calls.at(-1)![0] as () => void;
    talk();
    await flush();
    buttonByText(host, 'Look around first').click();
    await flush();
    expect(world.travelTo).not.toHaveBeenCalled();
  });

  /**
   * Boots a Scout whose trail is a warm-up quiz, the collect stop (Nature Trail) and a mission card,
   * and plays on until the trail sign for the walk to the Nature Trail is up.
   */
  async function playToCollectSign() {
    // Bobcat is done, so today's trail is: a warm-up quiz, the collect stop (Nature Trail), a mission card.
    const store = storeWithScout(undefined, (p) => {
      for (const id of [ID.campQuiz, ID.campChore, ID.campErrand, ID.campSort]) p.requirements[id] = doneReq();
      p.review = { [ID.campQuiz]: card(0, '2026-10-02') }; // due: the warm-up is its quiz
    });
    const started = boot(store);
    buttonByText(host, 'Play').click();
    await started.app.ready;
    await flush();
    const click = async (text: string): Promise<void> => {
      buttonByText(host, text).click();
      await flush();
    };
    const talk = world.setDenChiefHandler.mock.calls.at(-1)![0] as () => void;
    talk();
    await flush();
    await click("Let's go!");

    // Stop 1: the warm-up quiz, at Base Camp. No travel. The Den Chief asks if a reminder is wanted.
    await click('Next'); // intro
    expect(host.textContent).toContain('Do you remember this one?');
    await click('I remember!');
    await click('Alpha');
    await click('Finish');
    await click('Next'); // cheer
    await click('Great!'); // finishing the quiz completed Test Camp: a badge
    await click('Great!'); // and the Scout hat that a Bobcat adventure earns
    expect(world.travelTo).not.toHaveBeenCalled();

    // Stop 2: collect. The Den Chief teaches at camp first (this content has no lesson yet, so the
    // page is the requirement's own words), then the trail sign walks to the Nature Trail.
    await click('Next'); // intro
    expect(host.textContent).toContain('Test step 1 of wolf.test-trek.');
    expect(host.textContent).not.toContain('Walking to the Nature Trail');
    await click('Next'); // the lesson page
    // The Den Chief says who will help out there, then the trail sign walks to the Nature Trail.
    expect(host.textContent).toContain('The Ranger will help you there. Say hi!');
    expect(host.textContent).not.toContain('Walking to the Nature Trail');
    await click('Next');
    expect(host.textContent).toContain('Walking to the Nature Trail');
    return { app: started.app, click };
  }

  it('plays a collect stop in the zone, with the world host in ctx.world, then walks back to camp', async () => {
    const { click } = await playToCollectSign();
    expect(world.input.enabled).toBe(false); // the trail sign is a modal overlay: the player stands still
    await wait(TRAVEL_SIGN_MS + 200);
    expect(world.travelTo).toHaveBeenCalledWith('nature-trail');
    expect(world.state.zone).toBe('nature-trail');

    // The Ranger says hello before the activity opens (one page, spoken by the Ranger).
    expect(host.querySelector('.tq-nameplate')!.textContent).toBe('Ranger');
    expect(host.textContent).toContain('Welcome to the trail, Rowan!');
    expect(host.querySelector('[data-tq-nonmodal="true"]')).toBeNull(); // the activity has not opened yet
    await click('Next');

    // The panel is up and does not take input away; two tokens stand in the world.
    const panel = host.querySelector('[data-tq-nonmodal="true"]')!;
    expect(panel.textContent).toContain('Collect the test tokens.');
    expect(host.querySelector('.tq-overlay')).toBeNull();
    // The sign is gone, so the player can walk. This is the state of the input switch (it was off a
    // moment ago, behind the sign), awaited because the overlay watcher runs after the DOM changes.
    // It is not "the last setEnabled call": that is whatever any watcher on the shared fake did last.
    await vi.waitFor(() => expect(world.input.enabled).toBe(true));
    const placed = world.scene.add.mock.calls.map((c) => c[0] as { name: string; position: { x: number; z: number } });
    const tokens = placed.filter((o) => o.name === 'pickup:token');
    expect(tokens).toHaveLength(2);

    // Walk onto each token: the host's reach check runs on the world's fixed update.
    const step = world.onUpdate.mock.calls.at(-1)![0] as (dt: number) => void;
    for (const token of tokens) {
      world.player.position.x = token.position.x;
      world.player.position.z = token.position.z;
      step(1 / 60);
    }
    await flush();
    expect(panel.textContent).toContain('You found them all!');
    await click('Finish');
    expect(host.querySelector('[data-tq-nonmodal="true"]')).toBeNull();
    expect(world.scene.remove).toHaveBeenCalledTimes(2); // the world is cleaned up
    await click('Next'); // cheer

    // Stop 3: a mission card, still in the Nature Trail (no second trip), then the summary.
    await click('Next'); // intro
    await wait(TRAVEL_SIGN_MS + 200);
    // The Den Chief has already named the Ranger today and the Ranger has already said hello on this visit.
    expect(host.textContent).not.toContain('will help you there');
    expect(host.textContent).not.toContain('Welcome to the trail');
    await click('Got it!'); // the mission card (the controls hint's button has no exclamation mark)
    await click('Next'); // cheer
    expect(world.travelTo).toHaveBeenCalledTimes(1);
    expect(world.state.zone).toBe('nature-trail');
    expect(host.textContent).toContain('Great trail, Rowan!');
    expect(world.player.celebrate).toHaveBeenCalledTimes(3); // the avatar cheers after each stop
    // The trail is finished and more is waiting: the summary offers both ways on.
    expect(Array.from(host.querySelectorAll('.tq-summary .tq-actions button')).map((b) => b.textContent)).toEqual([
      '▶Keep going!',
      'Explore camp',
    ]);

    // "Explore camp" is a camp: the Scout walks back.
    await click('Explore camp');
    expect(world.travelTo).toHaveBeenLastCalledWith('base-camp');
    expect(world.state.zone).toBe('base-camp');

    // The Ranger already welcomed the Scout in today, so a free-roam talk is a plain "hi again".
    await talkToZoneGuide('ranger');
    expect(host.querySelector('.tq-dialog__text .tq-sr')!.textContent).toBe('Hi again, Rowan! Nice day for a hike.');
  }, 15000);

  it('does not repeat the Den Chief\'s guide introduction, or the guide\'s hello, for a second stop in the same zone', async () => {
    const { click } = await playToCollectSign();
    await wait(TRAVEL_SIGN_MS + 200);
    expect(host.querySelector('.tq-nameplate')!.textContent).toBe('Ranger'); // the arrival page, once
    await click('Next');
    expect(host.querySelector('[data-tq-nonmodal="true"]')).not.toBeNull(); // then the activity
  });

  it('has the guide greet again, with the next line, when the Scout has been away and walks back in', async () => {
    const { click } = await playToCollectSign();
    await wait(TRAVEL_SIGN_MS + 200);
    expect(host.querySelector('.tq-dialog__text .tq-sr')!.textContent).toBe('Welcome to the trail, Rowan!');
    await click('Next'); // the Ranger's hello; the collect panel opens

    const placed = world.scene.add.mock.calls.map((c) => c[0] as { name: string; position: { x: number; z: number } });
    const step = world.onUpdate.mock.calls.at(-1)![0] as (dt: number) => void;
    for (const token of placed.filter((o) => o.name === 'pickup:token')) {
      world.player.position.x = token.position.x;
      world.player.position.z = token.position.z;
      step(1 / 60);
    }
    await flush();
    await click('Finish');
    await click('Next'); // cheer

    // The Scout goes back to camp (a trip that tells the zone listeners), then the next stop walks out again.
    await world.travelTo('base-camp');
    await click('Next'); // the intro of the mission card
    await wait(TRAVEL_SIGN_MS + 200);
    expect(world.state.zone).toBe('nature-trail');
    expect(host.querySelector('.tq-nameplate')!.textContent).toBe('Ranger');
    expect(host.querySelector('.tq-dialog__text .tq-sr')!.textContent).toBe('Hi Rowan! Watch for frogs and birds.'); // the second line
    expect(host.textContent).not.toContain('will help you there'); // the Den Chief named the Ranger once today
  }, 15000);

  it('dispose stops the idle-hint timer and every listener the app added', async () => {
    const started = vi.spyOn(globalThis, 'setInterval');
    const stopped = vi.spyOn(globalThis, 'clearInterval');
    try {
      const { app } = boot(storeWithScout());
      buttonByText(host, 'Play').click();
      await app.ready;
      await flush();
      const hintTimer = started.mock.results[started.mock.calls.findIndex(([, ms]) => ms === 250)]?.value;
      expect(hintTimer).toBeDefined();
      const zoneListeners = world.listeners.size;
      expect(zoneListeners).toBeGreaterThan(0);

      app.dispose();
      expect(stopped).toHaveBeenCalledWith(hintTimer);
      expect(world.listeners.size).toBe(zoneListeners - 1);

      // The overlay watcher is gone: a dialog opening afterwards does not touch the input switch.
      world.input.setEnabled.mockClear();
      const dialog = document.createElement('div');
      dialog.className = 'tq-overlay';
      host.appendChild(dialog);
      dialog.remove();
      await flush();
      expect(world.input.setEnabled).not.toHaveBeenCalled();
      app.dispose(); // safe to call again
    } finally {
      started.mockRestore();
      stopped.mockRestore();
    }
  });

  it('dispose cancels a greeting that has not opened yet', async () => {
    const { app } = boot(storeWithScout(), '2026-10-03', { autoGreet: true, greetingDelayMs: 40 });
    buttonByText(host, 'Play').click();
    await app.ready;
    app.dispose();
    await wait(120);
    expect(host.querySelector('.tq-overlay')).toBeNull(); // the Den Chief never opened by himself
    expect(app.session!.busy).toBe(false);
  });

  it('dispose takes down a toast and its timer', async () => {
    const { app } = boot(storeWithScout());
    buttonByText(host, 'Play').click();
    await app.ready;
    await flush();
    const talk = world.setDenChiefHandler.mock.calls.at(-1)![0] as () => void;
    talk(); // a session is now busy
    await flush();
    (world.setReturnHandler.mock.calls.at(-1)![0] as () => void)(); // "Back to camp" mid-stop: a toast
    expect(host.querySelector('.tq-toast')).not.toBeNull();
    app.dispose();
    expect(host.querySelector('.tq-toast')).toBeNull();
    (world.setReturnHandler.mock.calls.at(-1)![0] as () => void)(); // a stale handler does nothing now
    expect(host.querySelector('.tq-toast')).toBeNull();
    expect(world.travelTo).not.toHaveBeenCalled();
  });

  it('dispose stops a trail that is waiting at the trail sign', async () => {
    const { app } = await playToCollectSign();
    app.dispose();
    await wait(TRAVEL_SIGN_MS + 200);
    expect(world.travelTo).not.toHaveBeenCalled(); // the walk to the Nature Trail never happens
    expect(world.state.zone).toBe('base-camp');
    expect(host.querySelector('[data-tq-nonmodal="true"]')).toBeNull();
  });

  it('the Back to camp sign walks home, except in the middle of a stop', async () => {
    await play();
    const sign = world.setReturnHandler.mock.calls.at(-1)![0] as () => void;
    world.state.zone = 'nature-trail';
    sign();
    await flush();
    expect(world.travelTo).toHaveBeenCalledWith('base-camp');

    world.travelTo.mockClear();
    world.state.zone = 'nature-trail';
    const talk = world.setDenChiefHandler.mock.calls.at(-1)![0] as () => void;
    talk(); // a session is now busy
    await flush();
    sign();
    await flush();
    expect(world.travelTo).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Tap Back to leave this stop.');
  });
});

describe('app: zone guides', () => {
  const doneToday = { current: 5, best: 5, lastTrailDate: '2026-10-03', embers: 0 };

  async function play(store = storeWithScout()) {
    const booted = boot(store);
    buttonByText(host, 'Play').click();
    await booted.app.ready;
    await flush();
    world.placeAtGuide.mockClear(); // arriving put the Scout by the Den Chief; only what the guides do counts here
    return booted;
  }

  let seen: GameEvent[];
  let off: () => void;
  beforeEach(() => {
    seen = [];
    off = events.on((event) => seen.push(event));
  });
  afterEach(() => off());

  const speaker = (): string | null => host.querySelector('.tq-nameplate')?.textContent ?? null;
  /** What the dialog on screen says (the clean copy, not the typewriter span). */
  const pageText = (): string => host.querySelector('.tq-dialog__text .tq-sr')?.textContent ?? '';
  const choices = (): string[] => Array.from(host.querySelectorAll('.tq-dialog__choices button')).map((b) => b.textContent ?? '');
  const next = async (): Promise<void> => {
    buttonByText(host, 'Next').click();
    await flush();
  };

  it('gives the world a handler for talking to a guide, once', async () => {
    await play();
    expect(world.setGuideTalkHandler).toHaveBeenCalledTimes(1);
    expect(typeof world.setGuideTalkHandler.mock.calls[0]![0]).toBe('function');
  });

  it('goes greeting, what the place is for, one tip, then points back to the Den Chief while the trail waits', async () => {
    await play();
    await talkToZoneGuide('ranger');

    // The first time today: the greeting says the Den Chief sent the Scout. The nameplate is the role.
    expect(speaker()).toBe('Ranger');
    expect(pageText()).toBe('Hi Rowan! Den Chief said you were coming! I am the Ranger.');
    expect(choices()).toEqual([]);
    await next();
    expect(speaker()).toBe('Ranger');
    expect(pageText()).toBe('This is the Nature Trail. Come here to learn about the outdoors.');
    await next();
    expect(pageText()).toBe('Stay on the trail. It keeps plants safe.');
    await next();
    expect(pageText()).toBe('Den Chief is waiting with your trail. Want to head back to camp?');
    expect(choices()).toEqual(['Take me to camp', 'Look around']);

    // The Den Chief starts the trail, not the Ranger: nothing has begun and the Scout has not moved yet.
    expect(world.placeAtGuide).not.toHaveBeenCalled();
    buttonByText(host, 'Take me to camp').click();
    await flush();
    expect(world.placeAtGuide).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.tq-overlay')).toBeNull();
    expect(speaker()).toBeNull();
  });

  it('"Look around" closes the talk and leaves the Scout where they are', async () => {
    await play();
    await talkToZoneGuide('coach');
    await next();
    await next();
    await next();
    expect(speaker()).toBe('Coach');
    buttonByText(host, 'Look around').click();
    await flush();
    expect(world.placeAtGuide).not.toHaveBeenCalled();
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('ends on a goodbye, with no way back to camp to offer, once today\'s trail is done', async () => {
    await play(storeWithScout(doneToday));
    await talkToZoneGuide('mayor');
    await next();
    await next();
    await next();
    expect(speaker()).toBe('Mayor');
    expect(pageText()).toBe('Goodbye, Rowan! Come see us again.');
    expect(choices()).toEqual([]);
    expect(host.textContent).not.toContain('Take me to camp');
    await next();
    expect(host.querySelector('.tq-overlay')).toBeNull();
    expect(world.placeAtGuide).not.toHaveBeenCalled();
  });

  it('is plain "again" the second time, and the tips take turns', async () => {
    await play();
    const talkThrough = async (): Promise<string[]> => {
      await talkToZoneGuide('ranger');
      const pages = [pageText()];
      for (let i = 0; i < 3; i += 1) {
        await next();
        pages.push(pageText());
      }
      buttonByText(host, 'Look around').click();
      await flush();
      return pages;
    };
    const first = await talkThrough();
    const second = await talkThrough();
    const third = await talkThrough();
    const fourth = await talkThrough();

    expect(first[0]).toContain('Den Chief said you were coming');
    expect(second[0]).toBe('Hi again, Rowan! Nice day for a hike.');
    expect(new Set([first[2], second[2], third[2]]).size).toBe(3); // three tips, three talks
    expect(fourth[2]).toBe(first[2]); // and round again
    expect(first[2]).toBe(GUIDE_LINES.ranger.tips[0]!.grade2);
  });

  it('is a new first meeting on another day', async () => {
    const { app } = await play();
    await talkToZoneGuide('camp-cook');
    expect(pageText()).toContain('Den Chief said you were coming');
    for (let i = 0; i < 3; i += 1) await next();
    buttonByText(host, 'Look around').click();
    await flush();

    app.setToday('2026-10-04');
    await talkToZoneGuide('camp-cook');
    expect(pageText()).toContain('Den Chief said you were coming');
  });

  it('uses the Arrow of Light wording for an older Scout', async () => {
    const original = fixtureRank.readingLevel;
    fixtureRank.readingLevel = 'grade5';
    try {
      await play();
      await talkToZoneGuide('ranger');
      expect(pageText()).toBe('Hi Rowan! Den Chief said you were coming. I am the Ranger, and this is my trail.');
      await next();
      expect(pageText()).toBe('This is the Nature Trail. Here you learn to enjoy the outdoors and take care of it.');
      await next();
      await next();
      expect(pageText()).toBe("Den Chief is waiting with today's trail. Want to head back to camp?");
    } finally {
      fixtureRank.readingLevel = original;
    }
  });

  it('uses the Den Chief\'s name for this Scout when a profile renames them', async () => {
    const store = storeWithScout(undefined, (p) => {
      p.guideName = 'Chief Sam';
    });
    await play(store);
    await talkToZoneGuide('ranger');
    expect(pageText()).toContain('Chief Sam said you were coming');
  });

  it('tells the event bus about the talk and every page, for the sound layer', async () => {
    await play();
    await talkToZoneGuide('firefighter');
    for (let i = 0; i < 3; i += 1) await next();
    buttonByText(host, 'Look around').click();
    await flush();

    expect(seen.filter((e) => e.type === 'guide-talk')).toEqual([{ type: 'guide-talk', guide: 'firefighter' }]);
    expect(seen.filter((e) => e.type === 'dialog-open')).toHaveLength(4);
    expect(seen.filter((e) => e.type === 'dialog-advance')).toHaveLength(4);
    // The talk is announced before its first page opens.
    expect(seen.findIndex((e) => e.type === 'guide-talk')).toBeLessThan(seen.findIndex((e) => e.type === 'dialog-open'));
  });

  it('does not open while the Den Chief is talking or a stop is running, and says why', async () => {
    await play();
    const talk = world.setDenChiefHandler.mock.calls.at(-1)![0] as () => void;
    talk();
    await flush();
    expect(speaker()).toBe('Den Chief');
    const before = host.querySelectorAll('.tq-overlay').length;

    await talkToZoneGuide('ranger');
    expect(speaker()).toBe('Den Chief'); // still the Den Chief's page
    expect(host.querySelectorAll('.tq-overlay')).toHaveLength(before);
    expect(Array.from(host.querySelectorAll('.tq-toast')).map((t) => t.textContent)).toContain('Finish this stop first!');
    expect(seen.some((e) => e.type === 'guide-talk')).toBe(false);
  });

  it('never opens a second talk on top of the first', async () => {
    await play();
    await talkToZoneGuide('ranger');
    await talkToZoneGuide('coach');
    expect(host.querySelectorAll('.tq-overlay')).toHaveLength(1);
    expect(speaker()).toBe('Ranger');
    expect(seen.filter((e) => e.type === 'guide-talk')).toHaveLength(1);
  });

  it('does nothing when nobody is playing', async () => {
    boot(storeWithScout()); // the picker is up
    await flush();
    const before = host.querySelectorAll('.tq-overlay').length;
    await talkToZoneGuide('ranger');
    expect(host.querySelectorAll('.tq-overlay')).toHaveLength(before);
    expect(seen.some((e) => e.type === 'guide-talk')).toBe(false);
  });
});
