/**
 * Today's Trail, played: the session logic behind talking to the Den Chief.
 *
 * Everything the session needs from the outside world (dialogs, activities, the PIN pad, saving,
 * the clock, timers) comes in through `SessionDeps`, so this file never touches the DOM and the
 * tests drive it with mocks. The app wires the real versions in src/game/app.ts.
 *
 * What counts as a completed stop on the trail:
 *   - a finished activity (completed: true), including a check-in the kid confirmed;
 *   - a field mission handout (the card was shown, which is all a handout does).
 * A stop the kid backed out of, or a parent approval that did not happen, is not counted. It
 * earns nothing and costs nothing: the Den Chief says something kind and the trail moves on.
 */
import type { ActivityContext, ActivityResult, ActivityType, FieldMissionParams, ZoneId } from '../activities/types';
import type { RankContent } from '../content/types';
import { planBonusStop, planTrail, stageForStop } from '../quests/planner';
import {
  approveFieldMission,
  completeAdventuresIfDone,
  finishSession,
  recordStopResult,
} from '../quests/progress';
import type { TodaysTrail, TrailStop } from '../quests/types';
import type { Profile, StopKind } from '../save/types';
import { line, lineLevelOf, PARENT_TEXT, ZONE_LABELS, type LineKey, type LineVars } from './lines';
import { activeStreak, isTrailDoneToday } from './streak';

/** How long the "walking to the Nature Trail" card stays up. */
export const TRAVEL_SIGN_MS = 1200;

export type ActivityStage = NonNullable<ActivityContext['stage']>;

export interface DenChiefDialog {
  text: string;
  /** One button per choice; resolves with the index. Omit for a single "Next" button. */
  choices?: string[];
}

export interface ApprovalInfo {
  /** The mission title (content text). */
  title: string;
  /** What the parent should look for. Content text, shown to the parent. */
  parentNote?: string;
  /** The mission steps, so the parent can see what was asked. */
  steps: string[];
}

export interface SummaryInfo {
  stopsDone: number;
  stopsTotal: number;
  /** XP gained since the session began. */
  xpEarned: number;
  /** The saved streak after the session. */
  streak: number;
  /** True when this session lit today's campfire. */
  streakLit: boolean;
  /** Names of adventures completed during the session. */
  badges: string[];
  /** True when a bonus stop can be offered. */
  bonusAvailable: boolean;
}

export type SummaryChoice = 'bonus' | 'explore';

export interface SessionDeps {
  content: RankContent;
  /** Activity types the game can run; passed to the planner so trails never offer anything else. */
  implemented: ReadonlySet<ActivityType>;
  /** The active profile as it is right now. Read fresh each time; `persist` replaces it. */
  getProfile(): Profile;
  /** Store the new version of the profile (replace it in the save and write it out). */
  persist(profile: Profile): void;
  /** Local date, YYYY-MM-DD. */
  today(): string;
  /** Milliseconds, only ever subtracted from itself. */
  now(): number;
  wait(ms: number): Promise<void>;

  /** A Den Chief speech bubble. Resolves with the chosen index (0 for "Next"). */
  showDialog(dialog: DenChiefDialog): Promise<number>;
  /** Run one activity at Base Camp. Never rejects for player error. */
  runActivity(stop: TrailStop, stage: ActivityStage): Promise<ActivityResult>;
  /** Show the trail sign card. Returns a function that removes it. */
  showTrailSign(text: string): () => void;
  /** The approval screen. Resolves true when the kid hands the screen to a parent. */
  showApproval(info: ApprovalInfo): Promise<boolean>;
  hasPin(): boolean;
  /** Ask for the PIN. Resolves true when it is right, false when cancelled. */
  askPin(request: { title: string; subtitle: string }): Promise<boolean>;
  /** Ask for a new PIN twice. Resolves the PIN, or null when cancelled. */
  askNewPin(request: { title: string; subtitle: string; confirmTitle: string }): Promise<string | null>;
  /** Store a new PIN. May reject (for example when the page is not secure). */
  setPin(pin: string): Promise<void>;
  showBadge(info: { adventureId: string; adventureName: string }): Promise<void>;
  showSummary(info: SummaryInfo): Promise<SummaryChoice>;
  /**
   * ZONE-TRAVEL HOOK. Called after the trail sign when a stop belongs to a zone other than Base
   * Camp. Today every activity runs at Base Camp anyway, so the app leaves this unset. When real
   * zones exist, implement the walk here (load the zone, move the player, then resolve).
   */
  travelToZone?(zone: ZoneId): Promise<void>;
}

export type TrailItemStatus = 'done' | 'next' | 'later';

export interface TrailView {
  /** 'done-today': the campfire is lit; 'empty': nothing to do; 'ready': the stops are listed. */
  state: 'ready' | 'done-today' | 'empty';
  items: { kind: StopKind; title: string; status: TrailItemStatus }[];
}

/**
 * How a conversation with the Den Chief ended:
 *   'trail'       the Scout played today's trail;
 *   'bonus'       the Scout took a bonus stop;
 *   'look-around' the Scout chose "Look around first" and is free to explore;
 *   'none'        nothing was started (nothing to do today, or a bonus was turned down), or the
 *                 Den Chief was already busy.
 */
export type TalkOutcome = 'trail' | 'bonus' | 'look-around' | 'none';

export interface Session {
  /** What happens when the player talks to the Den Chief. Ignored while one is already running. */
  talk(): Promise<TalkOutcome>;
  /** Today's stops with their status, for the trail panel. */
  view(): TrailView;
  /** True when today's trail is done and a bonus stop is waiting (the Start button says "Bonus stop"). */
  bonusAvailable(): boolean;
  readonly busy: boolean;
}

export type GreetingKind = 'first' | 'streak' | 'returning' | 'done' | 'nothing';

export interface GreetingInput {
  profile: Profile;
  today: string;
  /** How many stops today's trail has (0 when there is nothing to do). */
  stopCount: number;
}

/** True until the Scout has finished a session: the Den Chief explains the game on the first one. */
export function isFirstSession(profile: Profile): boolean {
  return profile.sessions.length === 0;
}

/**
 * Which greeting the Den Chief gives: the trail is already done today (offer a bonus), there is
 * nothing to do, the very first session, a returning Scout with a streak, or just returning.
 */
export function chooseGreeting({ profile, today, stopCount }: GreetingInput): GreetingKind {
  if (isTrailDoneToday(profile, today)) return 'done';
  if (stopCount === 0) return 'nothing';
  if (isFirstSession(profile)) return 'first';
  if (activeStreak(profile.streak, today) >= 1) return 'streak';
  return 'returning';
}

/** The requirement ids already used today: the current trail plus every session logged today. */
function usedToday(profile: Profile, date: string, trail: TodaysTrail | undefined): string[] {
  const ids = new Set<string>();
  if (trail && trail.date === date) for (const stop of trail.stops) ids.add(stop.requirementId);
  for (const log of profile.sessions) {
    if (log.date !== date) continue;
    for (const stop of log.stops) ids.add(stop.requirementId);
  }
  return [...ids];
}

function introKey(kind: StopKind, stage: ActivityStage | 'approval'): LineKey {
  if (kind === 'warm-up') return 'stopWarmUp';
  if (kind === 'new-step') return 'stopNewStep';
  if (kind === 'bonus') return 'stopBonus';
  if (stage === 'approval') return 'stopFieldApproval';
  return stage === 'check-in' ? 'stopFieldCheckIn' : 'stopFieldHandout';
}

interface StopOutcome {
  counted: boolean;
  /** Adventures this stop completed, in order. */
  completed: { adventureId: string; adventureName: string }[];
}

export function createSession(deps: SessionDeps): Session {
  const level = lineLevelOf(deps.content.readingLevel);
  const planOptions = { implemented: deps.implemented };

  let trail: TodaysTrail | undefined;
  let outcomes: ('done' | 'skipped' | undefined)[] = [];
  /** True once the trail in memory has been played to the end and logged. */
  let finished = false;
  let busy = false;

  const vars = (extra: LineVars = {}): LineVars => {
    const profile = deps.getProfile();
    return {
      name: profile.name,
      guide: profile.guideName,
      streak: activeStreak(profile.streak, deps.today()),
      xp: profile.xp,
      ...extra,
    };
  };
  const say = (key: LineKey, extra?: LineVars): string => line(key, level, vars(extra));

  /** Today's plan: made once, then kept so the stops do not change as progress is saved. */
  function currentTrail(): TodaysTrail {
    const date = deps.today();
    const profile = deps.getProfile();
    const stale =
      !trail ||
      trail.date !== date ||
      trail.profileId !== profile.id ||
      (finished && !isTrailDoneToday(profile, date));
    if (stale) {
      trail = planTrail(profile, deps.content, date, planOptions);
      outcomes = [];
      finished = false;
    }
    return trail as TodaysTrail;
  }

  function nextBonus(date: string): TrailStop | undefined {
    const profile = deps.getProfile();
    return planBonusStop(profile, deps.content, date, usedToday(profile, date, trail), planOptions);
  }

  /** Ask a parent to approve a mission. True only when the PIN was right (or has just been set). */
  async function askParent(stop: TrailStop): Promise<boolean> {
    const spec = stop.activity;
    const params: FieldMissionParams | undefined = spec.type === 'fieldMission' ? spec.params : undefined;
    const proceed = await deps.showApproval({
      title: params?.title ?? stop.title,
      parentNote: params?.parentNote,
      steps: params?.kidSteps ?? [],
    });
    if (!proceed) return false;
    if (!deps.hasPin()) {
      const pin = await deps.askNewPin({
        title: PARENT_TEXT.newPinTitle,
        subtitle: PARENT_TEXT.newPinSubtitle,
        confirmTitle: PARENT_TEXT.newPinConfirmTitle,
      });
      if (pin === null) return false;
      try {
        await deps.setPin(pin);
      } catch {
        return false; // the app has already told the parent why
      }
      return true; // they just typed it twice; no third PIN screen
    }
    return deps.askPin({ title: PARENT_TEXT.enterPinTitle, subtitle: PARENT_TEXT.approvePinSubtitle });
  }

  /** Play one stop from intro to cheer, record it and save. */
  async function playStop(stop: TrailStop, date: string): Promise<StopOutcome> {
    const stage = stageForStop(deps.getProfile(), stop);
    await deps.showDialog({ text: `${say(introKey(stop.kind, stage))} ${stop.title}` });

    if (stop.zone !== 'base-camp') {
      const closeSign = deps.showTrailSign(say('travel', { zone: ZONE_LABELS[stop.zone] }));
      try {
        await deps.wait(TRAVEL_SIGN_MS);
        // ZONE-TRAVEL HOOK: real zone travel plugs in here. Until then the activity runs at Base Camp.
        await deps.travelToZone?.(stop.zone);
      } finally {
        closeSign();
      }
    }

    let counted: boolean;
    let waitingOnParent = false;
    let declinedApproval = false;
    let next: Profile;

    if (stage === 'approval') {
      const approved = await askParent(stop);
      next = deps.getProfile();
      counted = approved;
      declinedApproval = !approved;
      if (approved) next = approveFieldMission(next, stop.requirementId, date);
    } else {
      const result = await deps.runActivity(stop, stage);
      // A handout only ever shows the card, so it resolves completed: false and still counts.
      const recorded: ActivityResult = stage === 'handout' ? { ...result, completed: false } : result;
      counted = stage === 'handout' || result.completed;
      next = recordStopResult(deps.getProfile(), stop, recorded, date, deps.content);
      if (stage === 'check-in' && result.completed) {
        // The kid says it is done. If a parent is here, approve it now; otherwise it waits.
        if (await askParent(stop)) {
          next = approveFieldMission(next, stop.requirementId, date);
        } else {
          waitingOnParent = true;
        }
      }
    }

    const before = deps.getProfile();
    const knownAdventures = new Set(Object.keys(before.adventures));
    next = completeAdventuresIfDone(next, deps.content, date);
    const completed = Object.keys(next.adventures)
      .filter((id) => !knownAdventures.has(id))
      .map((id) => ({
        adventureId: id,
        adventureName: deps.content.adventures.find((a) => a.id === id)?.name ?? id,
      }));
    deps.persist(next);

    const gained = next.xp - before.xp;
    let key: LineKey;
    if (declinedApproval) key = 'parentLater';
    else if (!counted) key = 'backedOut';
    else if (stage === 'handout') key = 'cheerHandout';
    else if (waitingOnParent) key = 'cheerWaiting';
    else key = gained > 0 ? 'cheerXp' : 'cheerPlain';
    await deps.showDialog({ text: say(key, { xp: gained }) });

    for (const badge of completed) await deps.showBadge(badge);
    return { counted, completed };
  }

  /** Bonus stops, one after another for as long as the Scout wants them. */
  async function bonusLoop(first: TrailStop, date: string): Promise<void> {
    let stop: TrailStop | undefined = first;
    while (stop) {
      const startedAt = deps.now();
      const outcome = await playStop(stop, date);
      if (!outcome.counted) return;
      const seconds = Math.max(0, Math.round((deps.now() - startedAt) / 1000));
      const log: TodaysTrail = { date, profileId: deps.getProfile().id, stops: [stop], completedStops: 1 };
      deps.persist(finishSession(deps.getProfile(), log, seconds, date));

      stop = nextBonus(date);
      if (!stop) {
        await deps.showDialog({ text: say('bonusNone') });
        return;
      }
      const choice = await deps.showDialog({
        text: say('bonusMore'),
        choices: ['Another bonus stop', 'Explore camp'],
      });
      if (choice !== 0) return;
    }
  }

  async function runTrail(): Promise<void> {
    const plan = currentTrail();
    const date = plan.date;
    const startXp = deps.getProfile().xp;
    const earned: string[] = [];
    finished = false;
    outcomes = [];

    let startedAt = deps.now();
    for (let i = 0; i < plan.stops.length; i += 1) {
      if (i === 0) startedAt = deps.now(); // the clock starts at the first stop, not the greeting
      const outcome = await playStop(plan.stops[i]!, date);
      outcomes[i] = outcome.counted ? 'done' : 'skipped';
      earned.push(...outcome.completed.map((c) => c.adventureName));
    }

    // finishSession counts the first `completedStops` stops as completed, so put the ones that
    // were really completed first. That keeps the log honest when a middle stop was skipped.
    const doneStops = plan.stops.filter((_, i) => outcomes[i] === 'done');
    const skippedStops = plan.stops.filter((_, i) => outcomes[i] !== 'done');
    plan.completedStops = doneStops.length;
    const ordered: TodaysTrail = {
      date,
      profileId: plan.profileId,
      stops: [...doneStops, ...skippedStops],
      completedStops: doneStops.length,
    };
    const seconds = Math.max(0, Math.round((deps.now() - startedAt) / 1000));
    const after = finishSession(deps.getProfile(), ordered, seconds, date);
    deps.persist(after);
    finished = true;

    // A bonus stop is for a Scout who finished the whole trail.
    const bonus = doneStops.length === plan.stops.length ? nextBonus(date) : undefined;
    const choice = await deps.showSummary({
      stopsDone: doneStops.length,
      stopsTotal: plan.stops.length,
      xpEarned: Math.max(0, after.xp - startXp),
      streak: after.streak.current,
      streakLit: after.streak.lastTrailDate === date,
      badges: earned,
      bonusAvailable: bonus !== undefined,
    });
    if (choice === 'bonus' && bonus) await bonusLoop(bonus, date);
  }

  async function offerBonus(): Promise<TalkOutcome> {
    const date = deps.today();
    const bonus = nextBonus(date);
    if (!bonus) {
      await deps.showDialog({ text: say('greetDoneNoBonus') });
      return 'none';
    }
    const choice = await deps.showDialog({
      text: say('greetDone'),
      choices: [say('startBonus'), 'Not now'],
    });
    if (choice !== 0) return 'none';
    await bonusLoop(bonus, date);
    return 'bonus';
  }

  async function talk(): Promise<TalkOutcome> {
    const date = deps.today();
    const profile = deps.getProfile();
    const done = isTrailDoneToday(profile, date);
    const stopCount = done ? 0 : currentTrail().stops.length;
    const kind = chooseGreeting({ profile, today: date, stopCount });

    if (kind === 'done') return offerBonus();
    if (kind === 'nothing') {
      await deps.showDialog({ text: say('greetNothing') });
      return 'none';
    }
    const key: LineKey = kind === 'first' ? 'greetFirst' : kind === 'streak' ? 'greetStreak' : 'greetReturning';
    const choice = await deps.showDialog({ text: say(key), choices: [say('choiceGo'), say('choiceLook')] });
    if (choice !== 0) return 'look-around';
    await runTrail();
    return 'trail';
  }

  return {
    get busy() {
      return busy;
    },
    async talk() {
      if (busy) return 'none';
      busy = true;
      try {
        return await talk();
      } finally {
        busy = false;
      }
    },
    bonusAvailable() {
      const date = deps.today();
      return isTrailDoneToday(deps.getProfile(), date) && nextBonus(date) !== undefined;
    },
    view(): TrailView {
      const date = deps.today();
      const profile = deps.getProfile();
      if (isTrailDoneToday(profile, date) && (!trail || finished)) {
        const played = trail && trail.date === date ? trail : undefined;
        return {
          state: 'done-today',
          items: (played?.stops ?? []).map((stop, i) => ({
            kind: stop.kind,
            title: stop.title,
            status: outcomes[i] === 'done' ? ('done' as const) : ('later' as const),
          })),
        };
      }
      const plan = currentTrail();
      if (plan.stops.length === 0) return { state: 'empty', items: [] };
      const nextIndex = plan.stops.findIndex((_, i) => outcomes[i] === undefined);
      return {
        state: 'ready',
        items: plan.stops.map((stop, i) => ({
          kind: stop.kind,
          title: stop.title,
          status: outcomes[i] === 'done' ? 'done' : i === nextIndex ? 'next' : 'later',
        })),
      };
    },
  };
}
