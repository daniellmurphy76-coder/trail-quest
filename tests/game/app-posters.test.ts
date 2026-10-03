// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RankId } from '../../src/activities/types';
import { startApp } from '../../src/game/app';
import { createDefaultSave, createProfile, memoryStore, persistSave } from '../../src/save/store';
import { card, doneReq } from '../fixtures/profile.fixture';
import { ID } from '../fixtures/rank.fixture';
import { buttonByText, flush, makeHost, maybeButton } from '../ui/helpers';

// The same stand-in for the 3D world as app-poster.test.ts: the app only touches these members.
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

const { OATH, LAW, CHORE_LINES } = vi.hoisted(() => ({
  OATH: { title: 'The Test Oath', lines: ['Test oath line one.', 'Test oath line two.'] },
  LAW: { title: 'The Test Law', lines: ['Test law point one.', 'Test law point two.', 'Test law point three.'] },
  CHORE_LINES: ['Chore line one.', 'Chore line two.'],
}));

// Test content only: the fixture rank, with two posters on the lesson of the new step (the camp chore).
vi.mock('../../src/content/load', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/content/load')>();
  const { fixtureRank, ID: fixtureIds } = await import('../fixtures/rank.fixture');
  const content = {
    ...fixtureRank,
    adventures: fixtureRank.adventures.map((adventure) => ({
      ...adventure,
      requirements: adventure.requirements.map((r) =>
        r.id === fixtureIds.campChore ? { ...r, lesson: { lines: CHORE_LINES, posters: [OATH, LAW] } } : r,
      ),
    })),
  };
  return {
    ...actual,
    listRankContent: () => [content],
    loadRankContent: (rank: RankId) => (rank === content.rank ? content : undefined),
  };
});

let host: HTMLElement;
beforeEach(() => {
  host = makeHost();
  world.state.zone = 'base-camp';
});

const click = async (text: string): Promise<void> => {
  buttonByText(host, text).click();
  await flush();
};

const listed = (root: ParentNode): string[] =>
  Array.from(root.querySelectorAll('.tq-poster__line')).map((l) => l.textContent ?? '');

/** A Scout with the camp quiz learned (so the warm-up is a review) and the chore as the new step. */
function storeWithWarmUp() {
  const store = memoryStore();
  const save = createDefaultSave();
  const profile = createProfile(save, { name: 'Rowan', rank: 'wolf' });
  profile.streak = { current: 1, best: 1, lastTrailDate: '2026-10-02', embers: 0 };
  profile.sessions = [{ date: '2026-10-02', stops: [], xpEarned: 30, durationSec: 80 }];
  profile.requirements[ID.campQuiz] = doneReq();
  profile.review = { [ID.campQuiz]: card(0, '2026-10-02') };
  persistSave(store, save);
  return store;
}

describe('app: a lesson with the Oath and the Law', () => {
  it('shows two poster pages in order, then the lines, and a Show me pager in the activity', async () => {
    const app = startApp({
      canvas: document.createElement('canvas'),
      ui: host,
      store: storeWithWarmUp(),
      today: '2026-10-03',
      autoGreet: false,
    });
    buttonByText(host, 'Play').click();
    await app.ready;
    await flush();
    const talk = world.setDenChiefHandler.mock.calls.at(-1)![0] as () => void;
    talk();
    await flush();
    await click("Let's go!");

    // Stop 1, the warm-up quiz (no poster): get through it.
    await click('Next'); // intro
    await click('I remember!');
    expect(maybeButton(host, 'Show me')).toBeNull();
    await click('Alpha');
    await click('Finish');
    await click('Next'); // cheer
    expect(host.querySelector('.tq-poster')).toBeNull();

    // Stop 2, the new step: intro, then the Oath on its own page, then the Law on its own page.
    await click('Next'); // "A new step!"
    await click('Next'); // the lesson intro line
    const oath = host.querySelector<HTMLElement>('.tq-poster')!;
    expect(oath.querySelector('h2')!.textContent).toBe(OATH.title);
    expect(listed(oath)).toEqual(OATH.lines);
    expect(host.querySelectorAll('.tq-poster')).toHaveLength(1);
    expect(host.textContent).not.toContain('Test law point one.'); // the Law is not on this screen
    await click('Next'); // the Oath's Next

    const law = host.querySelector<HTMLElement>('.tq-poster')!;
    expect(law.querySelector('h2')!.textContent).toBe(LAW.title);
    expect(listed(law)).toEqual(LAW.lines);
    expect(host.textContent).not.toContain('Test oath line one.'); // and the Oath is gone
    expect(host.textContent).not.toContain('Chore line one.'); // the lines come after both posters
    await click('Next'); // the Law's Next

    expect(host.querySelector('.tq-poster')).toBeNull();
    expect(host.textContent).toContain('Chore line one.');
    await click('Next');
    expect(host.textContent).toContain('Chore line two.');
    await click('Next');

    // The sequence practice is running, with both posters one tap away as a pager.
    expect(host.textContent).toContain('Put the steps in order');
    await click('Show me');
    const peek = host.querySelector<HTMLElement>('.tq-poster')!;
    expect(peek.querySelector('h2')!.textContent).toBe(OATH.title);
    expect(listed(peek)).toEqual(OATH.lines);
    buttonByText(peek, 'Next: The Test Law').click();
    await flush();
    const second = host.querySelector<HTMLElement>('.tq-poster')!;
    expect(second.querySelector('h2')!.textContent).toBe(LAW.title);
    expect(listed(second)).toEqual(LAW.lines);
    buttonByText(second, 'Back').click();
    await flush();
    expect(host.querySelector('.tq-poster')).toBeNull();
    expect(host.textContent).toContain('Put the steps in order'); // still in the activity
  });
});
