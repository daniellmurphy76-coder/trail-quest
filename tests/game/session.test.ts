import { describe, expect, it, vi } from 'vitest';
import type { ActivityResult, ActivityType } from '../../src/activities/types';
import type { RankContent, Requirement } from '../../src/content/types';
import {
  chooseGreeting,
  createSession,
  isFirstSession,
  TRAVEL_SIGN_MS,
  type ActivityStage,
  type PosterInfo,
  type SessionDeps,
  type SummaryChoice,
  type SummaryInfo,
} from '../../src/game/session';
import { activeStreak } from '../../src/game/streak';
import type { TrailStop } from '../../src/quests/types';
import type { Profile } from '../../src/save/types';
import { card, doneReq, makeProfile, TODAY } from '../fixtures/profile.fixture';
import { fixtureRank, ID } from '../fixtures/rank.fixture';
import { LION_ID, lionRank } from './lion-fixture';

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

/** Content with one collect requirement and nothing else: with it done there is nothing left to plan. */
function onlyCollect(): RankContent {
  const trek = fixtureRank.adventures[0]!;
  return { ...fixtureRank, adventures: [{ ...trek, requirements: [trek.requirements[0]!] }] };
}

/** Content reduced to the first `count` quiz requirements of Test Camp: every one a new step in turn. */
function quizzes(count: number): RankContent {
  const camp = fixtureRank.adventures.find((a) => a.id === 'wolf.test-camp')!;
  const template = camp.requirements[0]!;
  const requirements: Requirement[] = Array.from({ length: count }, (_, i) => ({
    ...template,
    id: `wolf.test-camp.${i + 1}`,
    number: String(i + 1),
  }));
  return { ...fixtureRank, adventures: [{ ...camp, requirements }] };
}

/** The fixture with a lesson on one requirement. */
function withLesson(id: string, lines: string[]): RankContent {
  return {
    ...fixtureRank,
    adventures: fixtureRank.adventures.map((adventure) => ({
      ...adventure,
      requirements: adventure.requirements.map((r) => (r.id === id ? { ...r, lesson: { lines } } : r)),
    })),
  };
}

/** The fixture with a lesson and a poster on one requirement. */
function withPoster(id: string, lines: string[], poster: { title: string; lines: string[] }): RankContent {
  return {
    ...fixtureRank,
    adventures: fixtureRank.adventures.map((adventure) => ({
      ...adventure,
      requirements: adventure.requirements.map((r) => (r.id === id ? { ...r, lesson: { lines, poster } } : r)),
    })),
  };
}

/** The fixture with a lesson and several posters on one requirement (the Oath, then the Law). */
function withPosters(id: string, lines: string[], posters: { title: string; lines: string[] }[]): RankContent {
  return {
    ...fixtureRank,
    adventures: fixtureRank.adventures.map((adventure) => ({
      ...adventure,
      requirements: adventure.requirements.map((r) => (r.id === id ? { ...r, lesson: { lines, posters } } : r)),
    })),
  };
}

const litToday = { current: 3, best: 3, lastTrailDate: TODAY, embers: 0 };

interface Harness {
  deps: SessionDeps;
  profile: () => Profile;
  stages: ActivityStage[];
  dialogs: { text: string; choices?: string[] }[];
  /** Every poster page shown, in order. */
  posters: PosterInfo[];
  summaries: SummaryInfo[];
  clock: { ms: number };
  /** A timeline: run:<kind>, persist, dialog:<text>, sign, approval-screen, badge, ... */
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
  /** What to pick on each summary; a function gets the summary and its position (0 for the first). */
  summaryChoice?: SummaryChoice | ((info: SummaryInfo, index: number) => SummaryChoice);
  today?: string;
  implemented?: ReadonlySet<ActivityType>;
}

function harness(options: HarnessOptions = {}): Harness {
  let profile = makeProfile(options.profile);
  const stages: ActivityStage[] = [];
  const dialogs: { text: string; choices?: string[] }[] = [];
  const posters: PosterInfo[] = [];
  const summaries: SummaryInfo[] = [];
  const order: string[] = [];
  const clock = { ms: 1_000_000 };
  let pinSet = options.hasPin ?? true;

  const deps: SessionDeps = {
    content: options.content ?? fixtureRank,
    implemented: options.implemented ?? IMPLEMENTED,
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
      order.push(`dialog:${dialog.text}`);
      // A long pause at a greeting proves the clock starts at the first stop, not before.
      if (dialog.choices && !dialog.choices.includes('Remind me')) clock.ms += 100_000;
      return options.choose ? options.choose(dialog.text, dialog.choices) : 0;
    }),
    showPoster: vi.fn(async (poster: PosterInfo) => {
      posters.push(poster);
      order.push(`poster:${poster.title}`);
    }),
    runActivity: vi.fn(async (stop, stage) => {
      stages.push(stage);
      order.push(`run:${stop.kind}`);
      clock.ms += 30_000;
      if (options.result) return options.result(stop, stage);
      return stage === 'handout' ? { completed: false, attempts: 1 } : { completed: true, attempts: 1, score: 1 };
    }),
    showTrailSign: vi.fn(() => {
      order.push('sign');
      return () => {};
    }),
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
      const index = summaries.length;
      summaries.push(info);
      const pick = options.summaryChoice ?? 'explore';
      return typeof pick === 'function' ? pick(info, index) : pick;
    }),
  };
  return { deps, profile: () => profile, stages, dialogs, posters, summaries, clock, order };
}

const kindsLogged = (profile: Profile) => profile.sessions.at(-1)!.stops.map((s) => `${s.kind}:${s.completed}`);

/** Everything the Den Chief said, in order. */
const said = (h: Harness): string[] => h.order.filter((o) => o.startsWith('dialog:')).map((o) => o.slice(7));
const LESSON_INTRO = 'Let me show you something first.';
const REMIND_ASK = 'Do you remember this one?';

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
    expect(summary.keepGoingAvailable).toBe(false); // keeping going is for a finished trail
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

  it('offers to keep going when the trail is already done today, with Keep going! and Look around', async () => {
    const h = harness({ profile: lit() });
    await createSession(h.deps).talk();
    expect(h.dialogs[0]!.text).toBe('Your trail is done today. Want to keep going?');
    expect(h.dialogs[0]!.choices).toEqual(['Keep going!', 'Look around']);
    // Keep going plans a fresh trail from the profile: the same three kinds of stop.
    expect(h.stages).toEqual(['review', 'new', 'handout']);
    expect(vi.mocked(h.deps.runActivity).mock.calls[0]![0].kind).toBe('warm-up');
  });

  it('says everything is done for now when the trail is done and there is nothing left', async () => {
    const h = harness({
      content: onlyCollect(),
      profile: { name: 'Rowan', requirements: { [ID.trekCollect]: doneReq() }, streak: litToday },
    });
    await createSession(h.deps).talk();
    expect(h.dialogs).toHaveLength(1);
    expect(h.dialogs[0]!.text).toContain('All done for now!');
    expect(h.dialogs[0]!.text).toContain('Rowan');
    expect(h.dialogs[0]!.choices).toBeUndefined();
    expect(h.deps.runActivity).not.toHaveBeenCalled();
  });

  it('says there is nothing to do when the plan is empty', async () => {
    const h = harness({ profile: { name: 'Rowan', requirements: { [ID.trekCollect]: doneReq() } }, content: onlyCollect() });
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

    // A trail that is done with nothing left: nothing started.
    const done = harness({
      content: onlyCollect(),
      profile: { requirements: { [ID.trekCollect]: doneReq() }, streak: litToday },
    });
    await expect(createSession(done.deps).talk()).resolves.toBe('none');

    // Keeping going offered and taken, then turned down with Look around.
    const lit = { ...threeStops(), streak: litToday };
    const taken = harness({ profile: lit });
    await expect(createSession(taken.deps).talk()).resolves.toBe('keep-going');
    const declined = harness({ profile: lit, choose: () => 1 });
    await expect(createSession(declined.deps).talk()).resolves.toBe('none');
  });

  it('reports whether more is waiting, for the Start button', () => {
    const lit = { ...threeStops(), streak: litToday };
    expect(createSession(harness({ profile: lit }).deps).keepGoingAvailable()).toBe(true);
    // Not done yet: the Start button says "Start today's trail", never "Keep going!".
    expect(createSession(harness({ profile: threeStops() }).deps).keepGoingAvailable()).toBe(false);
    // Done, and nothing new and nothing learned to review.
    const bare = harness({
      content: onlyCollect(),
      profile: { requirements: { [ID.trekCollect]: doneReq() }, streak: litToday },
    });
    expect(createSession(bare.deps).keepGoingAvailable()).toBe(false);
  });

  it('never plans a type the game cannot run', async () => {
    const h = harness({ profile: threeStops() });
    await createSession(h.deps).talk();
    for (const [stop] of vi.mocked(h.deps.runActivity).mock.calls) {
      if (stop.kind !== 'field-check') expect(IMPLEMENTED.has(stop.activity.type)).toBe(true);
    }
  });
});

describe('session: teaching before the activity', () => {
  const CHORE_LINES = ['Chore line one.', 'Chore line two.', 'Chore line three.'];
  const KID_TEXT_CHORE = 'Test step 2 of wolf.test-camp. This second sentence is extra.';
  const KID_TEXT_QUIZ = 'Test step 1 of wolf.test-camp. This second sentence is extra.';

  it('shows a new step\'s lesson, one line per page with a Next button, before the activity', async () => {
    // The new step is Test Camp's chore: a field mission whose practice (a sequence) is what runs.
    const h = harness({ profile: threeStops(), content: withLesson(ID.campChore, CHORE_LINES) });
    await createSession(h.deps).talk();

    const run = h.order.indexOf('run:new-step');
    expect(h.order.slice(run - 5, run)).toEqual([
      expect.stringMatching(/^dialog:A new step! /),
      `dialog:${LESSON_INTRO}`,
      'dialog:Chore line one.',
      'dialog:Chore line two.',
      'dialog:Chore line three.',
    ]);
    // Plain pages: no choices, so the dialogue box draws its single Next button.
    for (const dialog of h.dialogs.filter((d) => d.text.startsWith('Chore line') || d.text === LESSON_INTRO)) {
      expect(dialog.choices).toBeUndefined();
    }
    // The practice still runs once, as a new step.
    expect(h.stages).toEqual(['review', 'new', 'handout']);
  });

  it('falls back to one page made from the kidText when the content has no lesson yet', async () => {
    const h = harness({ profile: threeStops() });
    await createSession(h.deps).talk();
    const run = h.order.indexOf('run:new-step');
    expect(h.order.slice(run - 2, run)).toEqual([expect.stringMatching(/^dialog:A new step! /), `dialog:${KID_TEXT_CHORE}`]);
    expect(said(h)).not.toContain(LESSON_INTRO);
  });

  it('asks a warm-up "Remind me" or "I remember!" and shows the lesson after "Remind me"', async () => {
    const h = harness({ profile: threeStops(), content: withLesson(ID.campQuiz, ['Quiz line one.', 'Quiz line two.']) });
    await createSession(h.deps).talk();
    const run = h.order.indexOf('run:warm-up');
    expect(h.order.slice(run - 5, run)).toEqual([
      expect.stringMatching(/^dialog:Warm-up time! /),
      `dialog:${REMIND_ASK}`,
      `dialog:${LESSON_INTRO}`,
      'dialog:Quiz line one.',
      'dialog:Quiz line two.',
    ]);
    const ask = h.dialogs.find((d) => d.text === REMIND_ASK)!;
    expect(ask.choices).toEqual(['Remind me', 'I remember!']);
  });

  it('skips the lesson on a review when the Scout says "I remember!"', async () => {
    const h = harness({
      profile: threeStops(),
      content: withLesson(ID.campQuiz, ['Quiz line one.', 'Quiz line two.']),
      choose: (text) => (text === REMIND_ASK ? 1 : 0),
    });
    await createSession(h.deps).talk();
    const run = h.order.indexOf('run:warm-up');
    expect(h.order.slice(run - 2, run)).toEqual([expect.stringMatching(/^dialog:Warm-up time! /), `dialog:${REMIND_ASK}`]);
    expect(said(h)).not.toContain(LESSON_INTRO);
    expect(said(h)).not.toContain('Quiz line one.');
    // The review itself still runs and counts.
    expect(h.stages[0]).toBe('review');
    expect(h.summaries[0]).toMatchObject({ stopsDone: 3, stopsTotal: 3 });
  });

  it('reminds a review with no lesson from the kidText', async () => {
    const h = harness({ profile: threeStops() });
    await createSession(h.deps).talk();
    const run = h.order.indexOf('run:warm-up');
    expect(h.order.slice(run - 3, run)).toEqual([
      expect.stringMatching(/^dialog:Warm-up time! /),
      `dialog:${REMIND_ASK}`,
      `dialog:${KID_TEXT_QUIZ}`,
    ]);
  });

  it('asks about a review only the first time it runs that day', async () => {
    let backOut = true;
    const h = harness({
      profile: threeStops(),
      result: (stop, stage) => {
        if (stop.kind === 'new-step' && backOut) return { completed: false, attempts: 1 };
        return stage === 'handout' ? { completed: false, attempts: 1 } : { completed: true, attempts: 1, score: 1 };
      },
    });
    const session = createSession(h.deps);
    await session.talk(); // the new step is skipped, so the campfire is not lit
    backOut = false;
    await session.talk(); // the same warm-up comes round again

    const warmUps = vi.mocked(h.deps.runActivity).mock.calls.filter(([stop]) => stop.kind === 'warm-up');
    expect(warmUps).toHaveLength(2);
    expect(warmUps[0]![0].requirementId).toBe(warmUps[1]![0].requirementId);
    expect(said(h).filter((text) => text === REMIND_ASK)).toHaveLength(1);
  });

  it('always shows a new step\'s lesson, even when it is tried again after backing out', async () => {
    let backOut = true;
    const h = harness({
      profile: threeStops(),
      content: withLesson(ID.campChore, CHORE_LINES),
      result: (stop, stage) => {
        if (stop.kind === 'new-step' && backOut) return { completed: false, attempts: 1 };
        return stage === 'handout' ? { completed: false, attempts: 1 } : { completed: true, attempts: 1, score: 1 };
      },
    });
    const session = createSession(h.deps);
    await session.talk();
    backOut = false;
    await session.talk();
    expect(said(h).filter((text) => text === LESSON_INTRO)).toHaveLength(2);
  });

  it('has nothing to teach on a field mission handout, check-in or approval', async () => {
    const h = harness({ profile: threeStops(), content: withLesson(ID.campErrand, ['Never shown.']) });
    await createSession(h.deps).talk();
    const run = h.order.indexOf('run:field-check');
    expect(h.order[run - 1]).toMatch(/^dialog:Field check! /);
    expect(said(h)).not.toContain('Never shown.');
  });

  it('teaches at Base Camp, before the trail sign for another zone', async () => {
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
    await createSession(h.deps).talk();
    const kidText = 'Test step 4 of wolf.test-trek. This second sentence is extra.';
    const page = h.order.indexOf(`dialog:${kidText}`);
    expect(page).toBeGreaterThan(-1);
    expect(h.order.indexOf('sign')).toBeGreaterThan(page);
    expect(h.order.indexOf('run:new-step')).toBeGreaterThan(h.order.indexOf('sign'));
  });
});

describe('session: a lesson with two posters (the Oath, then the Law)', () => {
  const OATH = { title: 'The Test Oath', lines: ['Oath line one.', 'Oath line two.', 'Oath line three.'] };
  const LAW = { title: 'The Test Law', lines: ['Law point one.', 'Law point two.'] };
  const CHORE_LINES = ['Chore line one.', 'Chore line two.'];
  const HINT = 'Here is the whole thing. Read it top to bottom.';

  it('shows each as its own poster page, in order, between the intro line and the lesson lines', async () => {
    const h = harness({ profile: threeStops(), content: withPosters(ID.campChore, CHORE_LINES, [OATH, LAW]) });
    await createSession(h.deps).talk();

    const run = h.order.indexOf('run:new-step');
    expect(h.order.slice(run - 6, run)).toEqual([
      expect.stringMatching(/^dialog:A new step! /),
      `dialog:${LESSON_INTRO}`,
      'poster:The Test Oath',
      'poster:The Test Law',
      'dialog:Chore line one.',
      'dialog:Chore line two.',
    ]);
    // Two pages, never one: the Oath's lines and the Law's lines are not on the same screen.
    expect(h.posters).toEqual([
      { title: OATH.title, lines: OATH.lines, hint: HINT },
      { title: LAW.title, lines: LAW.lines, hint: HINT },
    ]);
    for (const poster of h.posters) {
      const both = OATH.lines.some((l) => poster.lines.includes(l)) && LAW.lines.some((l) => poster.lines.includes(l));
      expect(both).toBe(false);
    }
    expect(h.stages).toEqual(['review', 'new', 'handout']);
  });

  it('still reads the legacy single `poster` as one page', async () => {
    const h = harness({ profile: threeStops(), content: withPoster(ID.campChore, CHORE_LINES, OATH) });
    await createSession(h.deps).talk();
    expect(h.posters.map((p) => p.title)).toEqual(['The Test Oath']);
  });

  it('shows both again after "Remind me" on a review, and neither after "I remember!"', async () => {
    const remind = harness({ profile: threeStops(), content: withPosters(ID.campQuiz, ['Quiz line one.'], [OATH, LAW]) });
    await createSession(remind.deps).talk();
    expect(remind.posters.map((p) => p.title)).toEqual(['The Test Oath', 'The Test Law']);

    const remember = harness({
      profile: threeStops(),
      content: withPosters(ID.campQuiz, ['Quiz line one.'], [OATH, LAW]),
      choose: (text) => (text === REMIND_ASK ? 1 : 0),
    });
    await createSession(remember.deps).talk();
    expect(remember.deps.showPoster).not.toHaveBeenCalled();
  });
});

describe('session: a lesson with a poster', () => {
  const OATH = { title: 'The Test Oath', lines: ['Line one of the whole thing.', 'Line two of the whole thing.', 'Line three.'] };
  const CHORE_LINES = ['Chore line one.', 'Chore line two.'];
  const HINT = 'Here is the whole thing. Read it top to bottom.';

  it('shows the intro line, then the poster page, then the lesson lines, then runs the activity', async () => {
    const h = harness({ profile: threeStops(), content: withPoster(ID.campChore, CHORE_LINES, OATH) });
    await createSession(h.deps).talk();

    const run = h.order.indexOf('run:new-step');
    expect(h.order.slice(run - 5, run)).toEqual([
      expect.stringMatching(/^dialog:A new step! /),
      `dialog:${LESSON_INTRO}`,
      'poster:The Test Oath',
      'dialog:Chore line one.',
      'dialog:Chore line two.',
    ]);
    // Every line goes to the poster page in one piece, with the Den Chief's hint under the title.
    expect(h.posters).toEqual([{ title: OATH.title, lines: OATH.lines, hint: HINT }]);
    // The poster is not also cut into dialogue pages.
    for (const text of OATH.lines) expect(said(h)).not.toContain(text);
    expect(h.stages).toEqual(['review', 'new', 'handout']);
  });

  it('shows no poster page for a lesson without one', async () => {
    const h = harness({ profile: threeStops(), content: withLesson(ID.campChore, CHORE_LINES) });
    await createSession(h.deps).talk();
    expect(h.deps.showPoster).not.toHaveBeenCalled();
    const run = h.order.indexOf('run:new-step');
    expect(h.order.slice(run - 4, run)).toEqual([
      expect.stringMatching(/^dialog:A new step! /),
      `dialog:${LESSON_INTRO}`,
      'dialog:Chore line one.',
      'dialog:Chore line two.',
    ]);
  });

  it('shows the poster again when "Remind me" is picked on a review', async () => {
    const h = harness({ profile: threeStops(), content: withPoster(ID.campQuiz, ['Quiz line one.', 'Quiz line two.'], OATH) });
    await createSession(h.deps).talk();
    const run = h.order.indexOf('run:warm-up');
    expect(h.order.slice(run - 6, run)).toEqual([
      expect.stringMatching(/^dialog:Warm-up time! /),
      `dialog:${REMIND_ASK}`,
      `dialog:${LESSON_INTRO}`,
      'poster:The Test Oath',
      'dialog:Quiz line one.',
      'dialog:Quiz line two.',
    ]);
  });

  it('skips the poster along with the lesson when the Scout says "I remember!"', async () => {
    const h = harness({
      profile: threeStops(),
      content: withPoster(ID.campQuiz, ['Quiz line one.'], OATH),
      choose: (text) => (text === REMIND_ASK ? 1 : 0),
    });
    await createSession(h.deps).talk();
    expect(h.deps.showPoster).not.toHaveBeenCalled();
    expect(h.stages[0]).toBe('review');
  });

  it('shows a new step\'s poster every time it is tried, even after backing out', async () => {
    let backOut = true;
    const h = harness({
      profile: threeStops(),
      content: withPoster(ID.campChore, CHORE_LINES, OATH),
      result: (stop, stage) => {
        if (stop.kind === 'new-step' && backOut) return { completed: false, attempts: 1 };
        return stage === 'handout' ? { completed: false, attempts: 1 } : { completed: true, attempts: 1, score: 1 };
      },
    });
    const session = createSession(h.deps);
    await session.talk();
    backOut = false;
    await session.talk();
    expect(h.posters).toHaveLength(2);
  });
});

describe('session: keep going', () => {
  const keepGoingOnce = (_info: SummaryInfo, index: number): SummaryChoice => (index === 0 ? 'keep-going' : 'explore');

  it('plans a second trail from the updated profile and plays it the same way', async () => {
    const h = harness({ profile: threeStops(), summaryChoice: keepGoingOnce });
    await createSession(h.deps).talk();

    expect(h.summaries).toHaveLength(2);
    expect(h.summaries[0]).toMatchObject({ stopsDone: 3, stopsTotal: 3, keepGoingAvailable: true });
    const calls = vi.mocked(h.deps.runActivity).mock.calls;
    // The first trail as before. The second is planned after it: the camp's chore is learned, so the
    // next new step is the one in the Trek. The mission cards and the warm-up are not repeated.
    expect(calls.map(([stop]) => `${stop.kind}:${stop.requirementId}`)).toEqual([
      `warm-up:${ID.campQuiz}`,
      `new-step:${ID.campChore}`,
      `field-check:${ID.campErrand}`,
      `new-step:${ID.trekChore}`,
    ]);
    expect(h.stages).toEqual(['review', 'new', 'handout', 'new']);
    // The same flow: intro, lesson, sign (a Trek step), activity, cheer, then its own summary.
    const intro = h.order.findIndex((o, i) => i > h.order.indexOf('run:field-check') && o.startsWith('dialog:A new step!'));
    expect(intro).toBeGreaterThan(-1);
    expect(h.order.slice(intro).filter((o) => o === 'sign' || o.startsWith('run:'))).toEqual(['sign', 'run:new-step']);
    expect(h.summaries[1]).toMatchObject({ stopsDone: 1, stopsTotal: 1, xpEarned: 20 });
  });

  it('logs each trail as its own session and moves the streak once for the day', async () => {
    const h = harness({
      profile: { ...threeStops(), streak: { current: 4, best: 4, lastTrailDate: '2026-10-02', embers: 0 } },
      summaryChoice: keepGoingOnce,
    });
    await createSession(h.deps).talk();
    const after = h.profile();

    expect(after.sessions).toHaveLength(2);
    expect(after.sessions.map((log) => log.stops.map((s) => `${s.kind}:${s.completed}`))).toEqual([
      ['warm-up:true', 'new-step:true', 'field-check:true'],
      ['new-step:true'],
    ]);
    expect(after.sessions.map((log) => log.date)).toEqual([TODAY, TODAY]);
    expect(after.sessions[1]!.xpEarned).toBe(20);
    // 4 became 5 for today's first trail; the extra trail does not make it 6.
    expect(after.streak).toEqual({ current: 5, best: 5, lastTrailDate: TODAY, embers: 0 });
    // The first summary said so; the second still shows the lit campfire.
    expect(h.summaries.map((info) => [info.streak, info.streakLit])).toEqual([[5, true], [5, true]]);
  });

  it('keeps XP, learnedAt, review cards and adventure progress accruing', async () => {
    const h = harness({ profile: threeStops(), summaryChoice: keepGoingOnce });
    await createSession(h.deps).talk();
    const after = h.profile();
    // warm-up 10 + new step 20, then another new step 20; the handout earns nothing.
    expect(after.xp).toBe(50);
    expect(after.requirements[ID.campChore]!.learnedAt).toBe(TODAY);
    expect(after.requirements[ID.trekChore]!.learnedAt).toBe(TODAY);
    expect(after.review[ID.trekChore]).toBeDefined();
    expect(after.requirements[ID.campErrand]!.status).toBe('in-progress');
  });

  it('shows the dots of the trail being played, and the finished one afterwards', async () => {
    const h = harness({ profile: threeStops(), summaryChoice: keepGoingOnce });
    const session = createSession(h.deps);
    const seen: { text: string; state: string; statuses: string[] }[] = [];
    const showDialog = h.deps.showDialog;
    h.deps.showDialog = vi.fn(async (dialog) => {
      const view = session.view();
      seen.push({ text: dialog.text, state: view.state, statuses: view.items.map((i) => i.status) });
      return showDialog(dialog);
    });
    await session.talk();

    const secondIntro = seen.filter((entry) => entry.text.startsWith('A new step!')).at(-1)!;
    expect(secondIntro.state).toBe('ready');
    expect(secondIntro.statuses).toEqual(['next']); // one stop on this trail
    const view = session.view();
    expect(view.state).toBe('done-today');
    expect(view.items.map((i) => [i.kind, i.status])).toEqual([['new-step', 'done']]);
  });

  it('does not give the same mission card a second time in one day', async () => {
    const h = harness({ profile: threeStops(), summaryChoice: keepGoingOnce });
    await createSession(h.deps).talk();
    // The handout from the first trail is not turned into a check-in a minute later.
    expect(h.stages).not.toContain('check-in');
    expect(h.stages.filter((stage) => stage === 'handout')).toHaveLength(1);
  });

  it('keeps going until the planner has nothing left, then says everything is done for now', async () => {
    const h = harness({
      profile: { name: 'Rowan' },
      content: quizzes(3),
      summaryChoice: (info) => (info.keepGoingAvailable ? 'keep-going' : 'explore'),
    });
    await expect(createSession(h.deps).talk()).resolves.toBe('trail');

    const ran = vi.mocked(h.deps.runActivity).mock.calls.map(([stop]) => stop.requirementId);
    expect(ran).toEqual(['wolf.test-camp.1', 'wolf.test-camp.2', 'wolf.test-camp.3']);
    expect(h.summaries.map((info) => info.keepGoingAvailable)).toEqual([true, true, false]);
    expect(h.summaries.map((info) => info.xpEarned)).toEqual([20, 20, 20]);
    expect(h.summaries[2]!.badges).toEqual(['Test Camp']);

    const after = h.profile();
    expect(after.sessions).toHaveLength(3);
    expect(after.xp).toBe(60);
    expect(after.streak).toMatchObject({ current: 1, lastTrailDate: TODAY });
    expect(Object.keys(after.review)).toHaveLength(3);
    expect(after.adventures['wolf.test-camp']).toBeDefined();
  });

  it('says everything is done for now when "Keep going!" is picked and the planner is empty', async () => {
    const h = harness({
      profile: { name: 'Rowan' },
      content: quizzes(1),
      summaryChoice: 'keep-going', // no button would be offered, but suppose it is picked
    });
    await createSession(h.deps).talk();
    expect(h.summaries).toHaveLength(1);
    expect(h.summaries[0]!.keepGoingAvailable).toBe(false);
    expect(vi.mocked(h.deps.runActivity)).toHaveBeenCalledTimes(1);
    expect(h.dialogs.at(-1)!.text).toContain('All done for now!');
    expect(h.dialogs.at(-1)!.text).toContain('Rowan');
  });

  it('offers keep going only after the whole trail was done', async () => {
    const h = harness({
      profile: threeStops(),
      result: (_stop, stage) => (stage === 'review' ? { completed: false, attempts: 1 } : { completed: true, attempts: 1 }),
    });
    await createSession(h.deps).talk();
    expect(h.summaries[0]!.keepGoingAvailable).toBe(false);
  });

  it('offers it from the greeting once the trail is done, leaving out what today already used', async () => {
    // A reload: the campfire is lit and the logs show what was played earlier today.
    const played = [ID.campQuiz, ID.campChore, ID.campErrand].map((requirementId) => ({
      kind: 'warm-up' as const,
      requirementId,
      completed: true,
    }));
    const h = harness({
      profile: {
        ...threeStops(),
        streak: litToday,
        sessions: [{ date: TODAY, stops: played, xpEarned: 30, durationSec: 80 }],
      },
    });
    await expect(createSession(h.deps).talk()).resolves.toBe('keep-going');
    expect(h.dialogs[0]!.choices).toEqual(['Keep going!', 'Look around']);
    expect(vi.mocked(h.deps.runActivity).mock.calls.map(([stop]) => stop.requirementId)).toEqual([ID.trekChore]);

    const after = h.profile();
    expect(after.sessions).toHaveLength(2); // its own log
    expect(after.streak.current).toBe(3); // already counted today
    expect(after.xp).toBe(20);
  });

  it('starts nothing when the Scout picks Look around', async () => {
    const h = harness({ profile: { ...threeStops(), streak: litToday }, choose: () => 1 });
    await expect(createSession(h.deps).talk()).resolves.toBe('none');
    expect(h.deps.runActivity).not.toHaveBeenCalled();
    expect(h.profile().sessions).toHaveLength(0);
  });

  it('returns to the camp when the kid picks Explore camp', async () => {
    const h = harness({ profile: threeStops(), summaryChoice: 'explore' });
    await createSession(h.deps).talk();
    expect(vi.mocked(h.deps.runActivity)).toHaveBeenCalledTimes(3);
    expect(h.summaries).toHaveLength(1);
  });

  it('keeps the log honest when a keep-going stop is backed out of', async () => {
    const h = harness({
      profile: threeStops(),
      summaryChoice: keepGoingOnce,
      result: (stop, stage) => {
        if (stop.requirementId === ID.trekChore) return { completed: false, attempts: 1 };
        return stage === 'handout' ? { completed: false, attempts: 1 } : { completed: true, attempts: 1, score: 1 };
      },
    });
    await createSession(h.deps).talk();
    const after = h.profile();
    expect(after.sessions.at(-1)!.stops).toEqual([{ kind: 'new-step', requirementId: ID.trekChore, completed: false }]);
    expect(after.sessions.at(-1)!.xpEarned).toBe(0);
    expect(after.requirements[ID.trekChore]?.learnedAt).toBeUndefined();
    expect(h.summaries[1]).toMatchObject({ stopsDone: 0, stopsTotal: 1, keepGoingAvailable: false });
    expect(after.streak.current).toBe(1);
  });
});

describe('session: a Lion-style rank (grade1)', () => {
  const lion = (extra: Partial<Profile> = {}): Partial<Profile> => ({ rank: 'lion', name: 'Rowan', ...extra });

  it('reads the content as grade1 and uses the younger wording', async () => {
    expect(lionRank.readingLevel).toBe('grade1');
    const h = harness({ profile: lion(), content: lionRank });
    await createSession(h.deps).talk();
    const greeting = h.dialogs[0]!;
    expect(greeting.text).toContain('A trail is three quick stops.');
    expect(greeting.text).not.toContain('warm-up, new step, field check'); // the grade5 wording
    expect(h.dialogs.some((d) => d.text.startsWith("A new step! Let's learn it."))).toBe(true);
  });

  it('plans and plays a trail, then keeps going through the whole rank', async () => {
    const h = harness({
      profile: lion(),
      content: lionRank,
      summaryChoice: (info) => (info.keepGoingAvailable ? 'keep-going' : 'explore'),
    });
    await createSession(h.deps).talk();

    const ran = vi.mocked(h.deps.runActivity).mock.calls.map(([stop]) => `${stop.kind}:${stop.requirementId}`);
    expect(ran).toEqual([
      `new-step:${LION_ID.roarQuiz}`,
      `field-check:${LION_ID.roarErrand}`,
      `new-step:${LION_ID.roarChore}`,
      `field-check:${LION_ID.roarChore}`,
      `new-step:${LION_ID.pawsQuiz}`,
    ]);
    expect(h.stages).toEqual(['new', 'handout', 'new', 'handout', 'new']);
    expect(h.summaries.map((info) => info.keepGoingAvailable)).toEqual([true, true, false]);

    // Each learn stop had its lesson first: the intro, then one page per line.
    const run = h.order.indexOf('run:new-step');
    expect(h.order.slice(run - 4, run)).toEqual([
      `dialog:${LESSON_INTRO}`,
      'dialog:A lion is a big cat.',
      'dialog:Lions live in groups.',
      'dialog:The group is a pride.',
    ]);
    expect(said(h)).toContain('Do the chore in three steps.'); // a field mission's practice has a lesson too
    expect(said(h)).toContain('Lions have big paws.');

    const after = h.profile();
    expect(after.rank).toBe('lion');
    expect(after.xp).toBe(60);
    expect(after.streak).toMatchObject({ current: 1, lastTrailDate: TODAY });
    expect(after.sessions).toHaveLength(3);
    expect(after.adventures['lion.test-paws']).toBeDefined(); // a badge for any rank
    expect(h.summaries[2]!.badges).toEqual(['Test Paws']);
    expect(vi.mocked(h.deps.showBadge)).toHaveBeenCalledWith({ adventureId: 'lion.test-paws', adventureName: 'Test Paws' });
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
