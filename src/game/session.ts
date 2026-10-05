/**
 * Today's Trail, played: the session logic behind talking to the Den Chief.
 *
 * Everything the session needs from the outside world (dialogs, activities, the PIN pad, saving,
 * the clock, timers) comes in through `SessionDeps`, so this file never touches the DOM and the
 * tests drive it with mocks. The app wires the real versions in src/game/app.ts.
 *
 * Before a learn activity the Den Chief teaches (see screens/lesson.ts): a new step always shows
 * its lesson; a warm-up or bonus review offers "Remind me" or "I remember!" once per requirement
 * per day. A lesson with a poster (the whole Scout Oath on one screen) shows it right after the
 * intro line and before the lesson lines, and "Remind me" shows it again. After a finished trail the summary offers "Keep going!", which plans a fresh trail from
 * the updated profile (leaving out what today already used) and plays it the same way, as many
 * times as the Scout likes. Each trail is its own session log; the streak moves once per day.
 *
 * A stop in another zone: the Den Chief names that zone's guide before the walk (once per zone
 * per day, `guideRoleAt`), and the guide says hello after it (`greetAtZone`), before the activity.
 * The app supplies both, so this file never imports the npc modules.
 *
 * What counts as a completed stop on the trail:
 *   - a finished activity (completed: true), including a check-in the kid confirmed;
 *   - a field mission handout (the card was shown, which is all a handout does).
 * A stop the kid backed out of, or a parent approval that did not happen, is not counted. It
 * earns nothing and costs nothing: the Den Chief says something kind and the trail moves on.
 *
 * Rewards and sound hang off events, not imports. The session emits on the event bus (travel,
 * mission-approved, stop-complete, title-earned, badge-earned, cosmetic-unlocked, trail-complete,
 * session-start and session-end); src/game/effects.ts draws confetti and the sound layer plays
 * effects from the same events. A stop that pushes XP past a trail title, or earns a cosmetic
 * (see rewards.ts), says so with a toast and an unlock card. Nothing is ever taken away.
 */
import type { ActivityContext, ActivityResult, ActivityType, FieldMissionParams, ZoneId } from '../activities/types';
import { getRequirement } from '../content/load';
import type { RankContent } from '../content/types';
import { planTrail, stageForStop, type StopStage } from '../quests/planner';
import {
  approveFieldMission,
  completeAdventuresIfDone,
  finishSession,
  recordStopResult,
} from '../quests/progress';
import type { CosmeticGroup } from '../player/avatar/options';
import type { TodaysTrail, TrailStop } from '../quests/types';
import type { Profile, StopKind } from '../save/types';
import { events as gameEvents, type EventBus } from './events';
import { line, lineLevelOf, PARENT_TEXT, ZONE_LABELS, type LineKey, type LineVars } from './lines';
import { cosmeticById, evaluateUnlocks, titleEarnedBetween, titleForXp, withCosmetics } from './rewards';
import { lessonPlan, playLesson } from './screens/lesson';
import { activeStreak, isTrailDoneToday } from './streak';

/** How long the "walking to the Nature Trail" card stays up. */
export const TRAVEL_SIGN_MS = 1200;

export type ActivityStage = NonNullable<ActivityContext['stage']>;

export interface DenChiefDialog {
  text: string;
  /** One button per choice; resolves with the index. Omit for a single "Next" button. */
  choices?: string[];
}

/** A poster page for the teaching flow: the full text, plus the Den Chief's line for under the title. */
export interface PosterInfo {
  title: string;
  lines: string[];
  hint: string;
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
  /** XP gained during this trail. */
  xpEarned: number;
  /** The saved streak after the session. */
  streak: number;
  /** True when the campfire is lit for today. */
  streakLit: boolean;
  /** Names of adventures completed during the trail. */
  badges: string[];
  /** True when there is another trail to keep going with. */
  keepGoingAvailable: boolean;
  /** The Scout's trail title after the session ("Trail Walker"). */
  title?: string;
  /** Set when a stop on this trail earned a new title. */
  newTitle?: string;
  /** Names of the cosmetics earned during this trail ("Scout hat"). */
  unlocks?: string[];
}

/** A cosmetic the Scout has just earned, for the unlock card. */
export interface UnlockInfo {
  /** Bare cosmetic id ('hat-scout'). */
  id: string;
  /** What to call it ("Scout hat"). */
  label: string;
  group: CosmeticGroup;
}

export type SummaryChoice = 'keep-going' | 'explore';

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
  /** The poster page: every line of the title's text on one screen. Resolves when the Scout taps Next. */
  showPoster(poster: PosterInfo): Promise<void>;
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
  /** The event bus to emit on. Defaults to the game's one bus; tests pass their own. */
  events?: EventBus;
  /** A cheer from the Scout's avatar when a stop is done. The app wires `world.player.celebrate`. */
  celebrate?(): void;
  /** A short message at the top of the screen (a new trail title). */
  showToast?(text: string): void;
  /** The "You earned a new hat!" card. Resolves when the Scout taps Great. Left out, nothing is shown. */
  showUnlock?(info: UnlockInfo): Promise<void>;
  /**
   * ZONE-TRAVEL HOOK. Called after the trail sign when a stop belongs to a zone other than Base
   * Camp. Today every activity runs at Base Camp anyway, so the app leaves this unset. When real
   * zones exist, implement the walk here (load the zone, move the player, then resolve).
   */
  travelToZone?(zone: ZoneId): Promise<void>;
  /**
   * The role of the guide who works in a zone ("Ranger"), or undefined when it has none. The Den
   * Chief names them before the walk. Left out, the Den Chief introduces nobody.
   */
  guideRoleAt?(zone: ZoneId): string | undefined;
  /**
   * The guide's welcome after the walk, before the activity opens: one short page of dialog.
   * Resolves when the Scout taps through it. Left out, the Scout goes straight to the activity.
   * The app decides whether there is a guide to hear from; a failure here never stops the trail.
   */
  greetAtZone?(zone: ZoneId): Promise<void>;
}

export type TrailItemStatus = 'done' | 'next' | 'later';

export interface TrailView {
  /**
   * 'done-today': the campfire is lit and no trail is running; 'empty': nothing to do;
   * 'ready': the stops of the trail being played (or about to be) are listed.
   */
  state: 'ready' | 'done-today' | 'empty';
  items: { kind: StopKind; title: string; status: TrailItemStatus }[];
}

/**
 * How a conversation with the Den Chief ended:
 *   'trail'       the Scout played today's trail (and maybe kept going after it);
 *   'keep-going'  the trail was already done and the Scout kept going with more;
 *   'look-around' the Scout chose "Look around first" and is free to explore;
 *   'none'        nothing was started (nothing to do right now, or keeping going was turned down),
 *                 or the Den Chief was already busy.
 */
export type TalkOutcome = 'trail' | 'keep-going' | 'look-around' | 'none';

export interface Session {
  /** What happens when the player talks to the Den Chief. Ignored while one is already running. */
  talk(): Promise<TalkOutcome>;
  /** The stops of the current trail with their status, for the trail panel and the HUD dots. */
  view(): TrailView;
  /** True when today's trail is done and more is waiting (the Start button says "Keep going!"). */
  keepGoingAvailable(): boolean;
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
 * Which greeting the Den Chief gives: the trail is already done today (offer to keep going), there
 * is nothing to do, the very first session, a returning Scout with a streak, or just returning.
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
  /** Names of the cosmetics this stop earned. */
  unlocked: string[];
  /** The trail title this stop reached, if it reached a new one. */
  newTitle?: string;
}

export function createSession(deps: SessionDeps): Session {
  const level = lineLevelOf(deps.content.readingLevel);
  const planOptions = { implemented: deps.implemented };
  const bus = deps.events ?? gameEvents;
  /** Reward effects must never stop a trail: a hook that throws is logged and skipped. */
  const safely = (fn: (() => void) | undefined): void => {
    try {
      fn?.();
    } catch (error) {
      console.warn('session hook failed', error);
    }
  };

  /** The trail in memory: today's first one, or the one the Scout is keeping going with. */
  let trail: TodaysTrail | undefined;
  let outcomes: ('done' | 'skipped' | undefined)[] = [];
  /** True once the trail in memory has been played to the end and logged. */
  let finished = false;
  let busy = false;
  /** `date:requirementId` of every review already offered "Remind me" today. */
  const reminded = new Set<string>();
  /** `date:zone` of every zone guide the Den Chief has already introduced today. */
  const introduced = new Set<string>();

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

  /**
   * The trail to keep going with: planned fresh from the profile as it is now, leaving out every
   * requirement today already used. Undefined when there is nothing left for today.
   */
  function planMore(date: string): TodaysTrail | undefined {
    const profile = deps.getProfile();
    const plan = planTrail(profile, deps.content, date, {
      ...planOptions,
      excludeRequirementIds: usedToday(profile, date, trail),
    });
    return plan.stops.length > 0 ? plan : undefined;
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

  /**
   * Teach before the activity. A new step always gets its lesson. A review offers "Remind me" or
   * "I remember!" the first time it runs that day, and shows the lesson only for "Remind me".
   * Field missions have nothing to teach here: their practice is taught as its own new step.
   */
  async function teach(stop: TrailStop, stage: StopStage, date: string): Promise<void> {
    if (stage !== 'new' && stage !== 'review') return;
    const review = stage === 'review';
    if (review) {
      const key = `${date}:${stop.requirementId}`;
      if (reminded.has(key)) return;
      reminded.add(key);
    }
    const requirement = getRequirement(deps.content, stop.requirementId)?.requirement;
    const plan = lessonPlan({ lesson: requirement?.lesson, kidText: requirement?.kidText ?? stop.title }, level, review);
    await playLesson(
      (page) => deps.showDialog(page),
      plan,
      (poster) => deps.showPoster({ title: poster.title, lines: poster.lines, hint: say('posterHint') }),
    );
  }

  /** The Den Chief says who will help in a zone: the first time that zone comes up each day. */
  async function introduceGuide(zone: ZoneId, date: string): Promise<void> {
    const role = deps.guideRoleAt?.(zone);
    if (role === undefined) return;
    const key = `${date}:${zone}`;
    if (introduced.has(key)) return;
    introduced.add(key);
    await deps.showDialog({ text: say('introGuide', { role, zone: ZONE_LABELS[zone] }) });
  }

  /** Play one stop from intro to cheer, record it and save. */
  async function playStop(stop: TrailStop, date: string): Promise<StopOutcome> {
    const stage = stageForStop(deps.getProfile(), stop);
    await deps.showDialog({ text: `${say(introKey(stop.kind, stage))} ${stop.title}` });
    // The Den Chief teaches at Base Camp, before any walk to another zone.
    await teach(stop, stage, date);

    if (stop.zone !== 'base-camp') {
      await introduceGuide(stop.zone, date);
      const closeSign = deps.showTrailSign(say('travel', { zone: ZONE_LABELS[stop.zone] }));
      bus.emit({ type: 'travel', zone: stop.zone });
      try {
        await deps.wait(TRAVEL_SIGN_MS);
        // ZONE-TRAVEL HOOK: real zone travel plugs in here. Until then the activity runs at Base Camp.
        await deps.travelToZone?.(stop.zone);
      } finally {
        closeSign();
      }
      // The zone's guide says hello now that the Scout has walked in, before the activity opens.
      try {
        await deps.greetAtZone?.(stop.zone);
      } catch (error) {
        console.warn('guide greeting failed', error);
      }
    }

    let counted: boolean;
    let waitingOnParent = false;
    let declinedApproval = false;
    let approvedNow = false;
    let next: Profile;

    if (stage === 'approval') {
      const approved = await askParent(stop);
      next = deps.getProfile();
      counted = approved;
      declinedApproval = !approved;
      if (approved) {
        next = approveFieldMission(next, stop.requirementId, date);
        approvedNow = true;
      }
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
          approvedNow = true;
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
    // Cosmetics the Scout has now earned (XP, a badge, an approved mission): saved with the stop.
    const freshCosmetics = evaluateUnlocks(next, deps.content);
    next = withCosmetics(next, freshCosmetics);
    deps.persist(next);

    const gained = next.xp - before.xp;
    if (approvedNow) bus.emit({ type: 'mission-approved', requirementId: stop.requirementId });
    if (counted) {
      bus.emit({ type: 'stop-complete', kind: stop.kind, xp: gained });
      safely(() => deps.celebrate?.());
    }
    const newTitle = titleEarnedBetween(before.xp, next.xp);
    if (newTitle !== undefined) {
      bus.emit({ type: 'title-earned', title: newTitle });
      safely(() => deps.showToast?.(say('titleEarned', { trailTitle: newTitle })));
    }

    let key: LineKey;
    if (declinedApproval) key = 'parentLater';
    else if (!counted) key = 'backedOut';
    else if (stage === 'handout') key = 'cheerHandout';
    else if (waitingOnParent) key = 'cheerWaiting';
    else key = gained > 0 ? 'cheerXp' : 'cheerPlain';
    await deps.showDialog({ text: say(key, { xp: gained }) });

    for (const badge of completed) {
      bus.emit({ type: 'badge-earned', adventureId: badge.adventureId });
      await deps.showBadge(badge);
    }
    const unlocked = await announceUnlocks(freshCosmetics);
    return { counted, completed, unlocked, ...(newTitle !== undefined ? { newTitle } : {}) };
  }

  /** Tell the Scout about each new cosmetic: an event (confetti, sound), then the card. Returns their names. */
  async function announceUnlocks(ids: readonly string[]): Promise<string[]> {
    const names: string[] = [];
    for (const id of ids) {
      const lock = cosmeticById(id);
      if (!lock) continue;
      bus.emit({ type: 'cosmetic-unlocked', id });
      names.push(lock.label);
      if (deps.showUnlock) await deps.showUnlock({ id, label: lock.label, group: lock.group });
    }
    return names;
  }

  /**
   * Play every stop of `plan`, log it as its own session and show the summary. Resolves with the
   * next trail when the Scout picks "Keep going!", else undefined. Each trail is announced with
   * `session-start` and `session-end`, even when something throws on the way.
   */
  async function playTrail(plan: TodaysTrail): Promise<TodaysTrail | undefined> {
    bus.emit({ type: 'session-start' });
    try {
      return await runTrail(plan);
    } finally {
      bus.emit({ type: 'session-end' });
    }
  }

  async function runTrail(plan: TodaysTrail): Promise<TodaysTrail | undefined> {
    const date = plan.date;
    const startXp = deps.getProfile().xp;
    const earned: string[] = [];
    const unlockedNames: string[] = [];
    let newTitle: string | undefined;
    trail = plan;
    finished = false;
    outcomes = [];

    let startedAt = deps.now();
    for (let i = 0; i < plan.stops.length; i += 1) {
      if (i === 0) startedAt = deps.now(); // the clock starts at the first stop, not the greeting
      const outcome = await playStop(plan.stops[i]!, date);
      outcomes[i] = outcome.counted ? 'done' : 'skipped';
      earned.push(...outcome.completed.map((c) => c.adventureName));
      unlockedNames.push(...outcome.unlocked);
      if (outcome.newTitle !== undefined) newTitle = outcome.newTitle;
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
    let after = finishSession(deps.getProfile(), ordered, seconds, date);
    // A finished trail can light the streak, and a streak can earn something (star eyes).
    const streakCosmetics = evaluateUnlocks(after, deps.content);
    after = withCosmetics(after, streakCosmetics);
    deps.persist(after);
    finished = true;
    if (doneStops.length > 0 && doneStops.length === plan.stops.length) {
      bus.emit({ type: 'trail-complete', stops: doneStops.length });
    }
    unlockedNames.push(...(await announceUnlocks(streakCosmetics)));

    // Keeping going is for a Scout who finished the whole trail.
    const more = doneStops.length === plan.stops.length ? planMore(date) : undefined;
    const choice = await deps.showSummary({
      stopsDone: doneStops.length,
      stopsTotal: plan.stops.length,
      xpEarned: Math.max(0, after.xp - startXp),
      streak: after.streak.current,
      streakLit: after.streak.lastTrailDate === date,
      badges: earned,
      keepGoingAvailable: more !== undefined,
      title: titleForXp(after.xp),
      ...(newTitle !== undefined ? { newTitle } : {}),
      unlocks: unlockedNames,
    });
    if (choice !== 'keep-going') return undefined;
    if (!more) {
      await deps.showDialog({ text: say('allDone') });
      return undefined;
    }
    return more;
  }

  /** A trail, then another for as long as the Scout keeps going and the planner has stops. */
  async function trailLoop(first: TodaysTrail): Promise<void> {
    let plan: TodaysTrail | undefined = first;
    while (plan) plan = await playTrail(plan);
  }

  /** Today's trail is already done: offer to keep going, or say everything is done for now. */
  async function offerKeepGoing(): Promise<TalkOutcome> {
    const more = planMore(deps.today());
    if (!more) {
      await deps.showDialog({ text: say('allDone') });
      return 'none';
    }
    const choice = await deps.showDialog({
      text: say('greetDone'),
      choices: [say('choiceKeepGoing'), say('choiceLookAround')],
    });
    if (choice !== 0) return 'none';
    await trailLoop(more);
    return 'keep-going';
  }

  async function talk(): Promise<TalkOutcome> {
    const date = deps.today();
    const profile = deps.getProfile();
    const plan = isTrailDoneToday(profile, date) ? undefined : currentTrail();
    const kind = chooseGreeting({ profile, today: date, stopCount: plan?.stops.length ?? 0 });

    if (kind === 'done') return offerKeepGoing();
    if (kind === 'nothing' || !plan) {
      await deps.showDialog({ text: say('greetNothing') });
      return 'none';
    }
    const key: LineKey = kind === 'first' ? 'greetFirst' : kind === 'streak' ? 'greetStreak' : 'greetReturning';
    const choice = await deps.showDialog({ text: say(key), choices: [say('choiceGo'), say('choiceLook')] });
    if (choice !== 0) return 'look-around';
    await trailLoop(plan);
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
    keepGoingAvailable() {
      const date = deps.today();
      return isTrailDoneToday(deps.getProfile(), date) && planMore(date) !== undefined;
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
