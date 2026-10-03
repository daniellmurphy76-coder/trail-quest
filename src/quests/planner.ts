/**
 * Today's Trail planner. Pure: profile + content + date in, a trail out.
 *
 * Vocabulary used below:
 * - Learn activity: what a player can learn and review in-game. A requirement's own
 *   activity, or for a field mission its practice activity (see learnActivityOf).
 * - Active adventure: the first incomplete required adventure, Bobcat first.
 */
import type { ActivityContext, ActivitySpec } from '../activities/types';
import {
  isAdventureComplete,
  isReviewable,
  learnActivityOf,
  requiredAdventuresInOrder,
} from '../content/load';
import { ZONE_BY_CATEGORY, type Adventure, type RankContent, type Requirement } from '../content/types';
import type { Profile, RequirementStatus, StopKind } from '../save/types';
import type { PlanOptions, TodaysTrail, TrailPlanner, TrailStop } from './types';

/**
 * What `planTrail` accepts beyond the contract's PlanOptions. `excludeRequirementIds` is for
 * "keep going": the extra trails after today's first leave out whatever today already used, so
 * the Scout never gets the same warm-up, mission card or step twice in one day.
 */
export interface PlanTrailOptions extends PlanOptions {
  /** Requirement ids that must not appear in any stop of the trail. */
  excludeRequirementIds?: readonly string[];
}

/** How the UI should run a stop. 'approval' is the parent PIN screen, not an activity. */
export type StopStage = NonNullable<ActivityContext['stage']> | 'approval';

interface Entry {
  adventure: Adventure;
  requirement: Requirement;
  /** Position in content order, used to break ties. */
  order: number;
}

function flatten(content: RankContent): Entry[] {
  const entries: Entry[] = [];
  for (const adventure of content.adventures) {
    for (const requirement of adventure.requirements) {
      entries.push({ adventure, requirement, order: entries.length });
    }
  }
  return entries;
}

/**
 * The learn activity the game can actually run: `learnActivityOf`, unless `options.implemented`
 * is given and does not list its type. An unavailable learn activity counts as none at all.
 */
function availableLearnOf(requirement: Requirement, options: PlanOptions): ActivitySpec | undefined {
  const learn = learnActivityOf(requirement);
  if (!learn) return undefined;
  if (options.implemented && !options.implemented.has(learn.type)) return undefined;
  return learn;
}

function statusOf(profile: Profile, requirement: Requirement): RequirementStatus {
  return profile.requirements[requirement.id]?.status ?? 'available';
}

/** First sentence of the kid text, falling back to the whole text. */
export function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = /^.*?[.!?](?=\s|$)/s.exec(trimmed);
  return match ? match[0] : trimmed;
}

function makeStop(
  kind: StopKind,
  adventure: Adventure,
  requirement: Requirement,
  activity: ActivitySpec,
): TrailStop {
  return {
    kind,
    requirementId: requirement.id,
    adventureId: adventure.id,
    activity,
    zone: ZONE_BY_CATEGORY[adventure.category],
    title: firstSentence(requirement.kidText),
  };
}

/** True when a "choose N" adventure already has its N done, so remaining picks are extras. */
function isExtraChoice(adventure: Adventure, requirement: Requirement, profile: Profile): boolean {
  const { choose } = adventure;
  if (!choose || !choose.from.includes(requirement.id)) return false;
  if (statusOf(profile, requirement) === 'done') return false;
  const done = choose.from.filter((id) => profile.requirements[id]?.status === 'done').length;
  return done >= choose.count;
}

function incompleteRequired(profile: Profile, content: RankContent): Adventure[] {
  return requiredAdventuresInOrder(content).filter(
    (adventure) => !isAdventureComplete(adventure, profile.requirements),
  );
}

function pickNewStep(
  profile: Profile,
  adventures: Adventure[],
  options: PlanOptions,
  exclude: ReadonlySet<string>,
): TrailStop | undefined {
  for (const adventure of adventures) {
    for (const requirement of adventure.requirements) {
      if (exclude.has(requirement.id)) continue;
      const learn = availableLearnOf(requirement, options);
      if (!learn) continue;
      const progress = profile.requirements[requirement.id];
      if (progress?.learnedAt !== undefined || progress?.status === 'done') continue;
      if (isExtraChoice(adventure, requirement, profile)) continue;
      return makeStop('new-step', adventure, requirement, learn);
    }
  }
  return undefined;
}

function pickFieldCheck(
  profile: Profile,
  content: RankContent,
  adventures: Adventure[],
  options: PlanOptions,
  exclude: ReadonlySet<string>,
): TrailStop | undefined {
  // A mission waiting on the parent comes first, wherever it is.
  const searchOrder = [
    ...requiredAdventuresInOrder(content),
    ...content.adventures.filter((adventure) => !adventure.required),
  ];
  for (const adventure of searchOrder) {
    for (const requirement of adventure.requirements) {
      if (exclude.has(requirement.id)) continue;
      if (statusOf(profile, requirement) === 'pending-approval') {
        return makeStop('field-check', adventure, requirement, requirement.activity);
      }
    }
  }

  const active = adventures[0];
  if (!active) return undefined;
  const open = active.requirements.filter((requirement) => {
    if (requirement.activity.type !== 'fieldMission' || exclude.has(requirement.id)) return false;
    const status = statusOf(profile, requirement);
    if (status === 'done' || status === 'pending-approval') return false;
    return !isExtraChoice(active, requirement, profile);
  });
  // Prefer missions the kid has already learned (or that have nothing to learn first).
  const ready = open.find(
    (requirement) =>
      availableLearnOf(requirement, options) === undefined ||
      profile.requirements[requirement.id]?.learnedAt !== undefined,
  );
  const pick = ready ?? open[0];
  return pick ? makeStop('field-check', active, pick, pick.activity) : undefined;
}

/**
 * Pick something to review: the due card that has waited longest (ties: lower box, then
 * content order), else the most recently learned item. Ids in `exclude` are never picked.
 */
function pickReview(
  profile: Profile,
  content: RankContent,
  today: string,
  kind: 'warm-up' | 'bonus',
  exclude: ReadonlySet<string>,
  options: PlanOptions,
): TrailStop | undefined {
  const entries = flatten(content);
  const byId = new Map(entries.map((entry) => [entry.requirement.id, entry]));
  const reviewableLearn = (entry: Entry): ActivitySpec | undefined => {
    const learn = availableLearnOf(entry.requirement, options);
    return learn && isReviewable(learn) ? learn : undefined;
  };

  let due: { entry: Entry; learn: ActivitySpec; dueOn: string; box: number } | undefined;
  for (const [id, card] of Object.entries(profile.review)) {
    const entry = byId.get(id);
    if (!entry || exclude.has(id) || card.dueOn > today) continue;
    const learn = reviewableLearn(entry);
    if (!learn) continue;
    const better =
      !due ||
      card.dueOn < due.dueOn ||
      (card.dueOn === due.dueOn &&
        (card.box < due.box || (card.box === due.box && entry.order < due.entry.order)));
    if (better) due = { entry, learn, dueOn: card.dueOn, box: card.box };
  }
  if (due) return makeStop(kind, due.entry.adventure, due.entry.requirement, due.learn);

  let recent: { entry: Entry; learn: ActivitySpec; when: string } | undefined;
  for (const entry of entries) {
    if (exclude.has(entry.requirement.id)) continue;
    const progress = profile.requirements[entry.requirement.id];
    if (!progress || (progress.learnedAt === undefined && progress.status !== 'done')) continue;
    const learn = reviewableLearn(entry);
    if (!learn) continue;
    const when = progress.learnedAt ?? progress.completedAt ?? '';
    if (!recent || when >= recent.when) recent = { entry, learn, when };
  }
  return recent
    ? makeStop(kind, recent.entry.adventure, recent.entry.requirement, recent.learn)
    : undefined;
}

/**
 * The optional fourth stop, offered after the three are done. Picks a review item that is
 * not in `excludeRequirementIds` (pass the requirement ids already used in today's trail).
 */
export function planBonusStop(
  profile: Profile,
  content: RankContent,
  today: string,
  excludeRequirementIds: readonly string[] = [],
  options: PlanOptions = {},
): TrailStop | undefined {
  return pickReview(profile, content, today, 'bonus', new Set(excludeRequirementIds), options);
}

/** How the UI should run this stop, given the profile's current progress. */
export function stageForStop(profile: Profile, stop: TrailStop): StopStage {
  if (stop.kind === 'new-step') return 'new';
  if (stop.kind !== 'field-check') return 'review';
  const status = profile.requirements[stop.requirementId]?.status;
  if (status === 'pending-approval') return 'approval';
  return status === 'in-progress' ? 'check-in' : 'handout';
}

/**
 * Build today's trail: warm-up, new-step, field-check (each only if available).
 * If there is nothing new at all (no new-step and no field-check) the trail is a single
 * bonus review. The trail is empty only when content has nothing learned to review.
 * "Keep going" calls this again after a trail with `excludeRequirementIds` set to what
 * today already used; the trail is empty when there is nothing left for today.
 */
export function planTrail(
  profile: Profile,
  content: RankContent,
  today: string,
  options: PlanTrailOptions = {},
): TodaysTrail {
  const exclude: ReadonlySet<string> = new Set(options.excludeRequirementIds ?? []);
  const adventures = incompleteRequired(profile, content);
  const newStep = pickNewStep(profile, adventures, options, exclude);
  const fieldCheck = pickFieldCheck(profile, content, adventures, options, exclude);

  let stops: TrailStop[];
  if (!newStep && !fieldCheck) {
    const bonus = pickReview(profile, content, today, 'bonus', exclude, options);
    stops = bonus ? [bonus] : [];
  } else {
    const warmUp = pickReview(profile, content, today, 'warm-up', exclude, options);
    stops = [warmUp, newStep, fieldCheck].filter((stop): stop is TrailStop => stop !== undefined);
  }
  return { date: today, profileId: profile.id, stops, completedStops: 0 };
}

export function createPlanner(): TrailPlanner {
  return { plan: planTrail };
}
