import { describe, expect, it, vi } from 'vitest';
import type { ActivityResult, ActivityType } from '../../src/activities/types';
import type { RankContent } from '../../src/content/types';
import {
  chooseGreeting,
  createSession,
  isFirstSession,
  TRAVEL_SIGN_MS,
  type ActivityStage,
  type SessionDeps,
  type SummaryInfo,
} from '../../src/game/session';
import { activeStreak } from '../../src/game/streak';
import type { TrailStop } from '../../src/quests/types';
import type { Profile } from '../../src/save/types';
import { card, doneReq, makeProfile, TODAY } from '../fixtures/profile.fixture';
import { fixtureRank, ID } from '../fixtures/rank.fixture';

const IMPLEMENTED: ReadonlySet<ActivityType> = new Set(['quiz', 'sequence', 'fieldMission']);

/**
 * Three stops on the fixture content: warm-up (camp quiz, review), new-step (camp chore practice,
 * a sequence) and a field-check handout (camp errand, a mission with no practice).
 */
function threeStops(): Partial<Profile> {
  return {
    requirements: { [ID.campQuiz]: doneReq() },
    review: { [ID.campQuiz]: card(0, '2026-10-02') },
  };
}

/** Content reduced to the one Bobcat mission with no practice: the trail is just its field check. */
function errandOnly(): RankContent {
  const camp = fixtureRank.adventures.find((a) => a.id === 'wolf.test-camp')!;
  return { ...fixtureRank, adventures: [{ ...camp, requirements: camp.requirements.filter((r) => r.id === ID.campErrand) }] };
}

interface Harness {
  deps: SessionDeps;
  profile: () => Profile;
  stages: ActivityStage[];
  dialogs: { text: string; choices?: string[] }[];
  summaries: SummaryInfo[];
  clock: { ms: number };
  order: string[];
}

interface HarnessOptions {
  profile?: Partial<Profile>;
  content?: RankContent;
  /** Result for each activity run. */
  result?: (stop: TrailStop, stage: ActivityStage) => ActivityResult;
  hasPin?: boolean;
  pinRight?: boolean;
  newPin?: string | null;
  proceed?: boolean;
  /** Which dialog choice to pick; the greeting's first choice starts the trail. */
  choose?: (text: string, choices?: string[]) => number;
  summaryChoice?: 'bonus' | 'explore';
  today?: string;
}

function harness(options: HarnessOptions = {}): Harness {
  let profile = makeProfile(options.profile);
  const stages: ActivityStage[] = [];
  const dialogs: { text: string; choices?: string[] }[] = [];
  const summaries: SummaryInfo[] = [];
  const order: string[] = [];
  const clock = { ms: 1_000_000 };
  let pinSet = options.hasPin ?? true;

  const deps: SessionDeps = {
    content: options.content ?? fixtureRank,
    implemented: IMPLEMENTED,
    getProfile: () => profile,
    persist: vi.fn((next: Profile) => {
      order.push('persist');
      profile = next;
    }),
    today: () => options.today ?? TODAY,
    now: () => clock.ms,
    wait: vi.fn(async () => {}),
    showDialog: vi.fn(async (dialog) => {
      dialogs.push(dialog);
      // A long pause at the greeting proves the clock starts at the first stop, not before.
      if (dialog.choices) clock.ms += 100_000;
      return options.choose ? options.choose(dialog.text, dialog.choices) : 0;
    }),
    runActivity: vi.fn(async (stop, stage) => {
      stages.push(stage);
      order.push(`run:${stop.kind}`);
      clock.ms += 30_000;
      if (options.result) return options.result(stop, stage);
      return stage === 'handout' ? { completed: false, attempts: 1 } : { completed: true, attempts: 1, score: 1 };
    }),
    showTrailSign: vi.fn(() => () => {}),
    showApproval: vi.fn(async () => {
      order.push('approval-screen');
      return options.proceed ?? true;
    }),
    hasPin: () => pinSet,
    askPin: vi.fn(async () => {
      order.push('ask-pin');
      return options.pinRight ?? true;
    }),
    askNewPin: vi.fn(async () => {
      order.push('ask-new-pin');
      return options.newPin === undefined ? '1234' : options.newPin;
    }),
    setPin: vi.fn(async () => {
      order.push('set-pin');
      pinSet = true;
    }),
    showBadge: vi.fn(async () => {
      order.push('badge');
    }),
    showSummary: vi.fn(async (info) => {
      summaries.push(info);
      return options.summaryChoice ?? 'explore';
    }),
  };
  return { deps, profile: () => profile, stages, dialogs, summaries, clock, order };
}

const kindsLogged = (profile: Profile) => profile.sessions.at(-1)!.stops.map((s) => `${s.kind}:${s.completed}`);

describe('session: running the trail', () => {
  it('runs the stops in order with the right stage for each', async () => {
    const h = harness({ profile: threeStops() });
    await createSession(h.deps).talk();

    expect(h.order.filter((o) => o.startsWith('run:'))).toEqual(['run:warm-up', 'run:new-step', 'run:field-check']);
    expect(h.stages).toEqual(['review', 'new', 'handout']);
    // The activity gets the stop's own spec to run.
    const stops = vi.mocked(h.deps.runActivity).mock.calls.map(([stop]) => stop.requirementId);
    expect(stops).toEqual([ID.campQuiz, ID.campChore, ID.campErrand]);
    expect(h.summaries).toHaveLength(1);
    expect(h.summaries[0]).toMatchObject({ stopsDone: 3, stopsTotal: 3 });
  });

  it('says a short line for each kind of stop and then the stop title', async () => {
    const h = harness({ profile: threeStops() });
    await createSession(h.deps).talk();
    const texts = h.dialogs.map((d) => d.text);
    expect(texts.some((t) => t.startsWith('Warm-up time!') && t.includes('Test step 1 of wolf.test-camp.'))).toBe(true);
    expect(texts.some((t) => t.startsWith('A new step!'))).toBe(true);
    expect(texts.some((t) => t.startsWith('Field check!'))).toBe(true);
  });

  it('counts a field mission handout as a completed stop and marks the mission in progress', async () => {
    const h = harness({ profile: threeStops() });
    await createSession(h.deps).talk();
    // The handout resolved completed: false, and still counts for the trail.
    expect(vi.mocked(h.deps.runActivity).mock.results[2]).toBeDefined();
    expect(h.summaries[0]!.stopsDone).toBe(3);
    const after = h.profile();
    expect(after.requirements[ID.campErrand]!.status).toBe('in-progress');
    expect(after.streak.current).toBe(1);
    expect(kindsLogged(after)).toEqual(['warm-up:true', 'new-step:true', 'field-check:true']);
    expect(h.dialogs.some((d) => d.text.startsWith('Here is your mission'))).toBe(true);
  });

  it('records progress with the content and awards XP', async () => {
    const h = harness({ profile: threeStops() });
    await createSession(h.deps).talk();
    const after = h.profile();
    expect(after.requirements[ID.campChore]!.learnedAt).toBe(TODAY);
    expect(after.review[ID.campChore]).toBeDefined();
    // warm-up 10 + new step 20; the handout earns nothing.
    expect(after.xp).toBe(30);
    expect(h.summaries[0]!.xpEarned).toBe(30);
    expect(h.dialogs.some((d) => d.text.includes('You earned 10 XP.'))).toBe(true);
    expect(h.dialogs.some((d) => d.text.includes('You earned 20 XP.'))).toBe(true);
  });

  it('calls persist after every stop and once more when the session is logged', async () => {
    const h = harness({ profile: threeStops() });
    await createSession(h.deps).talk();
    expect(h.deps.persist).toHaveBeenCalledTimes(4);
    // Each persist comes right after its activity: run, persist, run, persist, ...
    const flow = h.order.filter((o) => o === 'persist' || o.startsWith('run:'));
    expect(flow).toEqual(['run:warm-up', 'persist', 'run:new-step', 'persist', 'run:field-check', 'persist', 'persist']);
  });

  it('runs finishSession exactly once: one log, one streak step, duration from the first stop', async () => {
    const h = harness({ profile: threeStops() });
    await createSession(h.deps).talk();
    const after = h.profile();
    expect(after.sessions).toHaveLength(1);
    expect(after.sessions[0]).toMatchObject({ date: TODAY, xpEarned: 30 });
    expect(after.streak).toMatchObject({ current: 1, lastTrailDate: TODAY });
    // Three activities of 30 seconds each. The 100 second pause at the greeting is not counted.
    expect(after.sessions[0]!.durationSec).toBe(90);
  });

  it('shows the summary with the streak and no badge when none was earned', async () => {
    const h = harness({ profile: threeStops() });
    await createSession(h.deps).talk();
    expect(h.summaries[0]).toMatchObject({ streak: 1, streakLit: true, badges: [] });
  });
});

describe('session: backing out', () => {
  it('does not count a stop the kid backed out of, and moves on kindly', async () => {
    const h = harness({
      profile: threeStops(),
      result: (stop, stage) =>
        stop.kind === 'new-step'
          ? { completed: false, attempts: 1 }
          : stage === 'handout'
            ? { completed: false, attempts: 1 }
            : { completed: true, attempts: 1, score: 1 },
    });
    await createSession(h.deps).talk();

    // All three stops were offered.
    expect(vi.mocked(h.deps.runActivity)).toHaveBeenCalledTimes(3);
    const summary = h.summaries[0]!;
    expect(summary.stopsDone).toBe(2);
    expect(summary.stopsTotal).toBe(3);
    expect(summary.xpEarned).toBe(10); // only the warm-up
    expect(summary.streakLit).toBe(false);
    expect(summary.bonusAvailable).toBe(false);
    expect(h.dialogs.some((d) => d.text.startsWith('That is okay!'))).toBe(true);

    const after = h.profile();
    expect(after.requirements[ID.campChore]?.learnedAt).toBeUndefined();
    expect(after.streak.current).toBe(0);
    // The log puts the stops that were really completed first, so it stays honest.
    expect(kindsLogged(after)).toEqual(['warm-up:true', 'field-check:true', 'new-step:false']);
    expect(after.sessions).toHaveLength(1);
  });

  it('treats every stop backed out as a trail with nothing done', async () => {
    const h = harness({ profile: threeStops(), result: () => ({ completed: false, attempts: 0 }) });
    const session = createSession(h.deps);
    await session.talk();
    // A handout still counts, because it only ever shows the card; the other two do not.
    expect(h.summaries[0]!.stopsDone).toBe(1);
    expect(h.profile().xp).toBe(0);
  });
});

describe('session: field check with the parent', () => {
  const pending: Partial<Profile> = {
    requirements: { [ID.campErrand]: { status: 'pending-approval', attempts: 1, completedAt: '2026-10-01' } },
  };

  it('shows the approval screen, asks for the PIN, then approves', async () => {
    const h = harness({ profile: pending, content: errandOnly() });
    await createSession(h.deps).talk();

    expect(h.stages).toEqual([]); // approval is not an activity
    const gate = h.order.filter((o) => ['approval-screen', 'ask-pin', 'ask-new-pin'].includes(o));
    expect(gate).toEqual(['approval-screen', 'ask-pin']);
    expect(h.deps.askNewPin).not.toHaveBeenCalled();

    const mission = vi.mocked(h.deps.showApproval).mock.calls[0]![0];
    expect(mission.title).toBe('Test camp errand');
    expect(mission.steps.length).toBeGreaterThan(0);

    const after = h.profile();
    expect(after.requirements[ID.campErrand]).toMatchObject({ status: 'done', approvedAt: TODAY });
    expect(after.xp).toBe(30);
    expect(h.summaries[0]).toMatchObject({ stopsDone: 1, stopsTotal: 1, xpEarned: 30 });
  });

  it('sets a PIN first when there is none, and does not ask for it a third time', async () => {
    const h = harness({ profile: pending, content: errandOnly(), hasPin: false });
    await createSession(h.deps).talk();

    expect(h.order.filter((o) => ['approval-screen', 'ask-new-pin', 'set-pin', 'ask-pin'].includes(o))).toEqual([
      'approval-screen',
      'ask-new-pin',
      'set-pin',
    ]);
    const request = vi.mocked(h.deps.askNewPin).mock.calls[0]![0];
    expect(request.subtitle).toMatch(/accidental approvals/);
    expect(h.deps.setPin).toHaveBeenCalledWith('1234');
    expect(h.profile().requirements[ID.campErrand]!.status).toBe('done');
  });

  it('does not approve when the PIN is cancelled, and says it will ask again', async () => {
    const h = harness({ profile: pending, content: errandOnly(), pinRight: false });
    await createSession(h.deps).talk();
    const after = h.profile();
    expect(after.requirements[ID.campErrand]!.status).toBe('pending-approval');
    expect(after.xp).toBe(0);
    expect(h.summaries[0]).toMatchObject({ stopsDone: 0, stopsTotal: 1 });
    expect(h.dialogs.some((d) => d.text.startsWith('No problem.'))).toBe(true);
  });

  it('does not ask for a PIN when the kid taps Not now on the approval screen', async () => {
    const h = harness({ profile: pending, content: errandOnly(), proceed: false });
    await createSession(h.deps).talk();
    expect(h.deps.askPin).not.toHaveBeenCalled();
    expect(h.profile().requirements[ID.campErrand]!.status).toBe('pending-approval');
  });

  it('does not approve when a new PIN is cancelled', async () => {
    const h = harness({ profile: pending, content: errandOnly(), hasPin: false, newPin: null });
    await createSession(h.deps).talk();
    expect(h.deps.setPin).not.toHaveBeenCalled();
    expect(h.profile().requirements[ID.campErrand]!.status).toBe('pending-approval');
  });

  it('chains the approval after a check-in the kid confirms', async () => {
    const h = harness({
      content: errandOnly(),
      profile: { requirements: { [ID.campErrand]: { status: 'in-progress', attempts: 1 } } },
      result: () => ({ completed: true, attempts: 1 }),
    });
    await createSession(h.deps).talk();
    expect(h.stages).toEqual(['check-in']);
    expect(h.order.filter((o) => ['approval-screen', 'ask-pin'].includes(o))).toEqual(['approval-screen', 'ask-pin']);
    expect(h.profile().requirements[ID.campErrand]!.status).toBe('done');
    expect(h.summaries[0]!.xpEarned).toBe(30);
  });

  it('leaves a confirmed check-in waiting when no parent is there, and still counts the stop', async () => {
    const h = harness({
      content: errandOnly(),
      profile: { requirements: { [ID.campErrand]: { status: 'in-progress', attempts: 1 } } },
      result: () => ({ completed: true, attempts: 1 }),
      proceed: false,
    });
    await createSession(h.deps).talk();
    expect(h.profile().requirements[ID.campErrand]!.status).toBe('pending-approval');
    expect(h.summaries[0]!.stopsDone).toBe(1);
    expect(h.dialogs.some((d) => d.text.includes('approve it later'))).toBe(true);
  });

  it('does not count a check-in when the kid says not yet', async () => {
    const h = harness({
      content: errandOnly(),
      profile: { requirements: { [ID.campErrand]: { status: 'in-progress', attempts: 1 } } },
      result: () => ({ completed: false, attempts: 1 }),
    });
    await createSession(h.deps).talk();
    expect(h.deps.showApproval).not.toHaveBeenCalled();
    expect(h.summaries[0]!.stopsDone).toBe(0);
    expect(h.profile().requirements[ID.campErrand]!.status).toBe('in-progress');
  });
});

describe('session: badges', () => {
  const finishing = (extra: Partial<Profile> = {}): Partial<Profile> => ({
    requirements: { [ID.campErrand]: { status: 'pending-approval', attempts: 1 } },
    ...extra,
  });

  it('shows a badge card when a stop completes an adventure', async () => {
    const h = harness({ profile: finishing(), content: errandOnly() });
    await createSession(h.deps).talk();
    expect(h.deps.showBadge).toHaveBeenCalledWith({ adventureId: 'wolf.test-camp', adventureName: 'Test Camp' });
    expect(h.profile().adventures['wolf.test-camp']).toBeDefined();
    expect(h.profile().unlocks).toContain('badge:wolf.test-camp');
    expect(h.summaries[0]!.badges).toEqual(['Test Camp']);
    // The card comes after the approval and the Den Chief cheer.
    expect(h.order.indexOf('badge')).toBeGreaterThan(h.order.indexOf('ask-pin'));
    const cheer = h.dialogs.findIndex((d) => d.text.includes('You earned 30 XP.'));
    expect(cheer).toBeGreaterThan(-1);
  });

  it('does not show a badge twice', async () => {
    const h = harness({
      profile: finishing({ adventures: { 'wolf.test-camp': { completedAt: '2026-10-01' } } }),
      content: errandOnly(),
    });
    await createSession(h.deps).talk();
    expect(h.deps.showBadge).not.toHaveBeenCalled();
  });

  it('shows no badge when the adventure is not finished', async () => {
    const h = harness({ profile: threeStops() });
    await createSession(h.deps).talk();
    expect(h.deps.showBadge).not.toHaveBeenCalled();
  });
});

describe('session: other zones', () => {
  it('shows the trail sign for 1.2 seconds, then runs the activity at Base Camp', async () => {
    // Bobcat is done, so the new step is in the Trek (outdoors, the nature trail).
    const h = harness({
      profile: {
        requirements: {
          [ID.campQuiz]: doneReq(),
          [ID.campChore]: doneReq(),
          [ID.campSort]: doneReq(),
          [ID.campErrand]: doneReq(),
        },
      },
    });
    const travel = vi.fn(async () => {});
    h.deps.travelToZone = travel;
    await createSession(h.deps).talk();

    expect(h.deps.showTrailSign).toHaveBeenCalledWith('Walking to the Nature Trail…');
    expect(h.deps.wait).toHaveBeenCalledWith(TRAVEL_SIGN_MS);
    expect(TRAVEL_SIGN_MS).toBe(1200);
    expect(travel).toHaveBeenCalledWith('nature-trail');
    expect(h.stages.length).toBeGreaterThan(0);
  });

  it('shows no sign for a stop at Base Camp', async () => {
    const h = harness({ profile: threeStops() });
    await createSession(h.deps).talk();
    expect(h.deps.showTrailSign).not.toHaveBeenCalled();
  });

  it('removes the sign even if travel throws', async () => {
    const closeSign = vi.fn();
    const h = harness({
      profile: {
        requirements: { [ID.campQuiz]: doneReq(), [ID.campChore]: doneReq(), [ID.campSort]: doneReq(), [ID.campErrand]: doneReq() },
      },
    });
    h.deps.showTrailSign = vi.fn(() => closeSign);
    h.deps.travelToZone = vi.fn(async () => {
      throw new Error('no road');
    });
    await expect(createSession(h.deps).talk()).rejects.toThrow('no road');
    expect(closeSign).toHaveBeenCalledTimes(1);
  });
});

describe('session: greetings', () => {
  const lit = (): Partial<Profile> => ({
    ...threeStops(),
    streak: { current: 3, best: 3, lastTrailDate: TODAY, embers: 0 },
  });

  it('picks the greeting from the state', () => {
    const base = { today: TODAY, stopCount: 3 };
    expect(chooseGreeting({ profile: makeProfile(), ...base })).toBe('first');
    expect(chooseGreeting({ profile: makeProfile(), ...base, stopCount: 0 })).toBe('nothing');
    const played = { sessions: [{ date: '2026-10-01', stops: [], xpEarned: 0, durationSec: 60 }] };
    expect(
      chooseGreeting({
        profile: makeProfile({ ...played, streak: { current: 2, best: 2, lastTrailDate: '2026-10-02', embers: 0 } }),
        ...base,
      }),
    ).toBe('streak');
    expect(
      chooseGreeting({
        profile: makeProfile({ ...played, streak: { current: 5, best: 5, lastTrailDate: '2026-09-20', embers: 0 } }),
        ...base,
      }),
    ).toBe('returning');
    expect(chooseGreeting({ profile: makeProfile({ ...played }), ...base })).toBe('returning');
    // Done today beats everything else, even an empty plan.
    expect(chooseGreeting({ profile: makeProfile({ streak: { current: 1, best: 1, lastTrailDate: TODAY, embers: 0 } }), ...base, stopCount: 0 })).toBe('done');
  });

  it('greets the very first session by name and explains the game: a trail, three stops, the campfire', async () => {
    const h = harness({ profile: { ...threeStops(), name: 'Rowan', guideName: 'Captain Sam' } });
    await createSession(h.deps).talk();
    const greeting = h.dialogs[0]!;
    expect(greeting.text).toContain('Hi Rowan, I am Captain Sam!');
    expect(greeting.text).toContain('A trail is three quick stops.');
    expect(greeting.text).toContain('campfire');
    expect(greeting.choices).toEqual(["Let's go!", 'Look around first']);
  });

  it('detects the first session: nothing finished yet', () => {
    expect(isFirstSession(makeProfile())).toBe(true);
    expect(isFirstSession(makeProfile({ sessions: [{ date: '2026-10-01', stops: [], xpEarned: 0, durationSec: 60 }] }))).toBe(false);
  });

  it('gives a later day the same two choices, with the hello and not the explanation', async () => {
    const h = harness({
      profile: {
        ...threeStops(),
        name: 'Rowan',
        sessions: [{ date: '2026-10-02', stops: [], xpEarned: 0, durationSec: 60 }],
        streak: { current: 0, best: 2, embers: 0 },
      },
    });
    await createSession(h.deps).talk();
    expect(h.dialogs[0]!.text).toContain('Welcome back, Rowan!');
    expect(h.dialogs[0]!.text).not.toContain('A trail is');
    expect(h.dialogs[0]!.choices).toEqual(["Let's go!", 'Look around first']);
  });

  it('greets a returning Scout with the streak', async () => {
    const h = harness({
      profile: {
        ...threeStops(),
        name: 'Rowan',
        sessions: [{ date: '2026-10-02', stops: [], xpEarned: 0, durationSec: 60 }],
        streak: { current: 4, best: 4, lastTrailDate: '2026-10-02', embers: 0 },
      },
    });
    await createSession(h.deps).talk();
    expect(h.dialogs[0]!.text).toContain('Welcome back, Rowan!');
    expect(h.dialogs[0]!.text).toContain('Day 4');
  });

  it('uses the grade 5 wording for the Arrow of Light content', async () => {
    const content: RankContent = { ...fixtureRank, readingLevel: 'grade5' };
    const h = harness({ profile: threeStops(), content });
    await createSession(h.deps).talk();
    expect(h.dialogs[0]!.text).toContain('A trail is three quick stops: warm-up, new step, field check.');
  });

  it('offers a bonus stop when the trail is already done today', async () => {
    const h = harness({ profile: lit() });
    await createSession(h.deps).talk();
    expect(h.dialogs[0]!.text).toBe('Your trail is done today. Want a bonus stop?');
    expect(h.dialogs[0]!.choices).toEqual(['Bonus stop', 'Not now']);
    expect(h.stages).toEqual(['review']);
    expect(vi.mocked(h.deps.runActivity).mock.calls[0]![0].kind).toBe('bonus');
  });

  it('says goodbye when the trail is done and there is no bonus to offer', async () => {
    const h = harness({
      profile: { streak: { current: 1, best: 1, lastTrailDate: TODAY, embers: 0 } },
    });
    await createSession(h.deps).talk();
    expect(h.dialogs).toHaveLength(1);
    expect(h.dialogs[0]!.text).toContain('Your trail is done today. Great job!');
    expect(h.dialogs[0]!.choices).toBeUndefined();
    expect(h.deps.runActivity).not.toHaveBeenCalled();
  });

  it('says there is nothing to do when the plan is empty', async () => {
    const onlyCollect: RankContent = {
      ...fixtureRank,
      adventures: [{ ...fixtureRank.adventures[0]!, requirements: [fixtureRank.adventures[0]!.requirements[0]!] }],
    };
    const h = harness({ profile: { name: 'Rowan', requirements: { [ID.trekCollect]: doneReq() } }, content: onlyCollect });
    await createSession(h.deps).talk();
    expect(h.dialogs).toHaveLength(1);
    expect(h.dialogs[0]!.text).toContain('I have no new stops today');
    expect(h.deps.runActivity).not.toHaveBeenCalled();
  });

  it('starts nothing when the kid chooses to look around first, and says so', async () => {
    const h = harness({ profile: threeStops(), choose: () => 1 });
    await expect(createSession(h.deps).talk()).resolves.toBe('look-around');
    expect(h.deps.runActivity).not.toHaveBeenCalled();
    expect(h.deps.persist).not.toHaveBeenCalled();
    expect(h.profile().sessions).toHaveLength(0);
  });

  it('tells the caller how the conversation ended', async () => {
    // Played the trail.
    const played = harness({ profile: threeStops() });
    await expect(createSession(played.deps).talk()).resolves.toBe('trail');

    // Nothing to do today, or a trail that is done with no bonus left: nothing started.
    const done = harness({ profile: { streak: { current: 1, best: 1, lastTrailDate: TODAY, embers: 0 } } });
    await expect(createSession(done.deps).talk()).resolves.toBe('none');

    // A bonus offered and taken, then turned down.
    const lit = { ...threeStops(), streak: { current: 3, best: 3, lastTrailDate: TODAY, embers: 0 } };
    const taken = harness({ profile: lit });
    await expect(createSession(taken.deps).talk()).resolves.toBe('bonus');
    const declined = harness({ profile: lit, choose: () => 1 });
    await expect(createSession(declined.deps).talk()).resolves.toBe('none');
  });

  it('reports whether a bonus stop is waiting, for the Start button', () => {
    const lit = { ...threeStops(), streak: { current: 3, best: 3, lastTrailDate: TODAY, embers: 0 } };
    expect(createSession(harness({ profile: lit }).deps).bonusAvailable()).toBe(true);
    // Not done yet: the Start button says "Start today's trail", never "Bonus stop".
    expect(createSession(harness({ profile: threeStops() }).deps).bonusAvailable()).toBe(false);
    // Done, but nothing learned to review.
    const bare = harness({ profile: { streak: { current: 1, best: 1, lastTrailDate: TODAY, embers: 0 } } });
    expect(createSession(bare.deps).bonusAvailable()).toBe(false);
  });

  it('never plans a type the game cannot run', async () => {
    const h = harness({ profile: threeStops() });
    await createSession(h.deps).talk();
    for (const [stop] of vi.mocked(h.deps.runActivity).mock.calls) {
      if (stop.kind !== 'field-check') expect(IMPLEMENTED.has(stop.activity.type)).toBe(true);
    }
  });
});

describe('session: bonus stop and the summary', () => {
  it('offers a bonus stop that skips what today already used, and logs it', async () => {
    const h = harness({
      profile: {
        requirements: { [ID.campQuiz]: doneReq(), [ID.campSort]: doneReq('2026-09-25'), [ID.campChore]: doneReq() },
        review: { [ID.campQuiz]: card(0, '2026-10-02') },
      },
      summaryChoice: 'bonus',
    });
    // The trail: warm-up quiz, new step (none left that is learnable?), field-check.
    await createSession(h.deps).talk();
    expect(h.summaries[0]!.bonusAvailable).toBe(true);

    const calls = vi.mocked(h.deps.runActivity).mock.calls;
    const bonus = calls.at(-1)![0];
    expect(bonus.kind).toBe('bonus');
    const used = calls.slice(0, -1).map(([stop]) => stop.requirementId);
    expect(used).not.toContain(bonus.requirementId);
    expect(calls.at(-1)![1]).toBe('review');

    const after = h.profile();
    expect(after.sessions).toHaveLength(2);
    expect(after.sessions.at(-1)!.stops).toEqual([{ kind: 'bonus', requirementId: bonus.requirementId, completed: true }]);
    expect(after.sessions.at(-1)!.xpEarned).toBe(10);
    expect(after.streak.current).toBe(1); // a bonus never moves the streak twice
  });

  it('offers a bonus only after the whole trail was done', async () => {
    const h = harness({
      profile: threeStops(),
      result: (_stop, stage) => (stage === 'review' ? { completed: false, attempts: 1 } : { completed: true, attempts: 1 }),
    });
    await createSession(h.deps).talk();
    expect(h.summaries[0]!.bonusAvailable).toBe(false);
  });

  it('does not log a bonus stop the kid backed out of', async () => {
    const h = harness({
      profile: {
        requirements: { [ID.campQuiz]: doneReq(), [ID.campSort]: doneReq('2026-09-25') },
        review: { [ID.campQuiz]: card(0, '2026-10-02') },
      },
      summaryChoice: 'bonus',
      result: (stop) => (stop.kind === 'bonus' ? { completed: false, attempts: 1 } : { completed: true, attempts: 1 }),
    });
    await createSession(h.deps).talk();
    expect(h.profile().sessions).toHaveLength(1);
  });

  it('returns to the camp when the kid picks Explore camp', async () => {
    const h = harness({ profile: threeStops(), summaryChoice: 'explore' });
    await createSession(h.deps).talk();
    expect(vi.mocked(h.deps.runActivity)).toHaveBeenCalledTimes(3);
  });
});

describe('session: trail view and busy flag', () => {
  it('lists today stops as up next and later, then done', async () => {
    const h = harness({ profile: threeStops() });
    const session = createSession(h.deps);
    const before = session.view();
    expect(before.state).toBe('ready');
    expect(before.items.map((i) => i.status)).toEqual(['next', 'later', 'later']);
    expect(before.items.map((i) => i.kind)).toEqual(['warm-up', 'new-step', 'field-check']);

    await session.talk();
    const after = session.view();
    expect(after.state).toBe('done-today');
    expect(after.items.map((i) => i.status)).toEqual(['done', 'done', 'done']);
  });

  it('marks only the stops that were done', async () => {
    const h = harness({
      profile: threeStops(),
      result: (stop, stage) =>
        stop.kind === 'new-step' ? { completed: false, attempts: 1 } : stage === 'handout' ? { completed: false, attempts: 1 } : { completed: true, attempts: 1 },
    });
    const session = createSession(h.deps);
    await session.talk();
    // Not lit (a stop was skipped), so the plan is shown again from the new state.
    const view = session.view();
    expect(view.state).toBe('ready');
    expect(view.items.length).toBeGreaterThan(0);
  });

  it('says the trail is done when the campfire is already lit and nothing was played this visit', () => {
    const h = harness({ profile: { streak: { current: 2, best: 2, lastTrailDate: TODAY, embers: 0 } } });
    const view = createSession(h.deps).view();
    expect(view.state).toBe('done-today');
    expect(view.items).toEqual([]);
  });

  it('reports an empty trail when there is nothing to do', () => {
    const onlyCollect: RankContent = {
      ...fixtureRank,
      adventures: [{ ...fixtureRank.adventures[0]!, requirements: [fixtureRank.adventures[0]!.requirements[0]!] }],
    };
    const h = harness({ content: onlyCollect, profile: { requirements: { [ID.trekCollect]: doneReq() } } });
    expect(createSession(h.deps).view()).toEqual({ state: 'empty', items: [] });
  });

  it('ignores a second talk while one is running', async () => {
    let release: (() => void) | undefined;
    const h = harness({ profile: threeStops() });
    h.deps.showDialog = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          release = () => resolve(1); // "Not now" ends the talk
        }),
    );
    const session = createSession(h.deps);
    const first = session.talk();
    expect(session.busy).toBe(true);
    await session.talk(); // ignored: returns at once
    expect(h.deps.showDialog).toHaveBeenCalledTimes(1);
    release?.();
    await first;
    expect(session.busy).toBe(false);
  });

  it('plans again on a new day', async () => {
    let today = TODAY;
    const h = harness({ profile: threeStops() });
    h.deps.today = () => today;
    const session = createSession(h.deps);
    await session.talk();
    expect(session.view().state).toBe('done-today');
    today = '2026-10-04';
    // The streak lit yesterday, so today is a fresh trail again.
    expect(session.view().state).not.toBe('done-today');
  });
});

describe('streak display', () => {
  const streak = (current: number, last: string | undefined, embers = 0) => ({
    current,
    best: current,
    lastTrailDate: last,
    embers,
  });

  it('shows the saved streak while it is still alive', () => {
    expect(activeStreak(streak(4, '2026-10-03'), '2026-10-03')).toBe(4);
    expect(activeStreak(streak(4, '2026-10-02'), '2026-10-03')).toBe(4);
  });

  it('lets an ember cover one missed day, and no more', () => {
    expect(activeStreak(streak(4, '2026-10-01', 1), '2026-10-03')).toBe(4);
    expect(activeStreak(streak(4, '2026-10-01', 0), '2026-10-03')).toBe(0);
    expect(activeStreak(streak(4, '2026-09-29', 3), '2026-10-03')).toBe(0);
  });

  it('is zero before the first trail', () => {
    expect(activeStreak(streak(0, undefined), '2026-10-03')).toBe(0);
  });
});
