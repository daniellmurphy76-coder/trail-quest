/**
 * Rank content loading and pure helpers over a RankContent.
 * Real rank files live in content/ranks/*.json; every helper below takes the content as
 * an argument so tests can feed it a synthetic fixture.
 */
import type { ActivitySpec, RankId } from '../activities/types';
import type { RequirementProgress } from '../save/types';
import {
  REVIEWABLE_TYPES,
  type Adventure,
  type RankContent,
  type Requirement,
} from './types';

const RANK_ORDER: RankId[] = ['lion', 'tiger', 'wolf', 'bear', 'webelos', 'arrow-of-light'];

const rankFiles = import.meta.glob<RankContent>('../../content/ranks/*.json', {
  eager: true,
  import: 'default',
});

/** All bundled rank files, in program order (lion first). */
export function listRankContent(): RankContent[] {
  return Object.values(rankFiles).sort(
    (a, b) => RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank),
  );
}

export function loadRankContent(rank: RankId): RankContent | undefined {
  return listRankContent().find((content) => content.rank === rank);
}

export function getAdventure(content: RankContent, id: string): Adventure | undefined {
  return content.adventures.find((adventure) => adventure.id === id);
}

export function getRequirement(
  content: RankContent,
  id: string,
): { requirement: Requirement; adventure: Adventure } | undefined {
  for (const adventure of content.adventures) {
    const requirement = adventure.requirements.find((r) => r.id === id);
    if (requirement) return { requirement, adventure };
  }
  return undefined;
}

/** Required adventures with `bobcat` first, then the rest in content order. */
export function requiredAdventuresInOrder(content: RankContent): Adventure[] {
  const required = content.adventures.filter((adventure) => adventure.required);
  return [
    ...required.filter((adventure) => adventure.category === 'bobcat'),
    ...required.filter((adventure) => adventure.category !== 'bobcat'),
  ];
}

/** True for requirements that are part of a "choose N" set rather than always required. */
export function isOptionalRequirement(adventure: Adventure, requirement: Requirement): boolean {
  return requirement.optional === true || (adventure.choose?.from.includes(requirement.id) ?? false);
}

/**
 * An adventure is complete when every non-optional requirement is done and, if it has a
 * `choose` rule, at least `choose.count` of `choose.from` are done.
 */
export function isAdventureComplete(
  adventure: Adventure,
  progress: Record<string, RequirementProgress>,
): boolean {
  const isDone = (id: string) => progress[id]?.status === 'done';
  const requiredDone = adventure.requirements
    .filter((requirement) => !isOptionalRequirement(adventure, requirement))
    .every((requirement) => isDone(requirement.id));
  if (!requiredDone) return false;
  if (!adventure.choose) return true;
  return adventure.choose.from.filter(isDone).length >= adventure.choose.count;
}

/** Knowledge activities re-enter the warm-up rotation; the rest do not. */
export function isReviewable(activity: ActivitySpec): boolean {
  return REVIEWABLE_TYPES.has(activity.type);
}

/**
 * The activity a player can learn and review in-game: the requirement's own activity
 * unless it is a field mission, in which case its `practice` activity (if any).
 */
export function learnActivityOf(requirement: Requirement): ActivitySpec | undefined {
  if (requirement.activity.type !== 'fieldMission') return requirement.activity;
  return requirement.practice;
}

export function isFieldMission(requirement: Requirement): boolean {
  return requirement.activity.type === 'fieldMission';
}
