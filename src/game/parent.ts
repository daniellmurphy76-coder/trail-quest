/**
 * Parent mode logic: pure helpers over a profile and its rank content. The DOM lives in
 * src/game/screens/parent.ts. Nothing here touches storage.
 */
import { completeAdventuresIfDone, approveFieldMission } from '../quests/progress';
import type { Adventure, RankContent, Requirement } from '../content/types';
import type { Profile, RequirementProgress } from '../save/types';

export type RequirementStatusWord = 'Not yet' | 'Learned' | 'Waiting for approval' | 'Done';

/**
 * A requirement's status in plain words for a parent: Done once approved or finished, Waiting
 * for approval when the Scout says a field mission is done, Learned when the in-game practice is
 * done but the real-world part is not, and Not yet otherwise.
 */
export function requirementStatusWord(progress: RequirementProgress | undefined): RequirementStatusWord {
  if (progress?.status === 'done') return 'Done';
  if (progress?.status === 'pending-approval') return 'Waiting for approval';
  if (progress?.learnedAt !== undefined) return 'Learned';
  return 'Not yet';
}

export const STATUS_ICONS: Record<RequirementStatusWord, string> = {
  'Not yet': '○',
  Learned: '◐',
  'Waiting for approval': '…',
  Done: '✓',
};

export interface PendingApproval {
  requirementId: string;
  adventureName: string;
  /** The mission title, or the requirement's kid text when it is not a field mission. */
  title: string;
  parentNote?: string;
}

function missionTitle(requirement: Requirement): string {
  const spec = requirement.activity;
  return spec.type === 'fieldMission' ? spec.params.title : requirement.kidText;
}

/** Every requirement waiting for a parent, in content order. */
export function pendingApprovals(profile: Profile, content: RankContent | undefined): PendingApproval[] {
  if (!content) return [];
  const pending: PendingApproval[] = [];
  for (const adventure of content.adventures) {
    for (const requirement of adventure.requirements) {
      if (profile.requirements[requirement.id]?.status !== 'pending-approval') continue;
      const spec = requirement.activity;
      pending.push({
        requirementId: requirement.id,
        adventureName: adventure.name,
        title: missionTitle(requirement),
        parentNote: spec.type === 'fieldMission' ? spec.params.parentNote : undefined,
      });
    }
  }
  return pending;
}

/** Approve a waiting field mission, then award any adventure badge it completes. */
export function approveAndAward(
  profile: Profile,
  content: RankContent,
  requirementId: string,
  today: string,
): { profile: Profile; newBadges: string[] } {
  const approved = approveFieldMission(profile, requirementId, today);
  const awarded = completeAdventuresIfDone(approved, content, today);
  const newBadges = Object.keys(awarded.adventures)
    .filter((id) => !profile.adventures[id])
    .map((id) => content.adventures.find((a) => a.id === id)?.name ?? id);
  return { profile: awarded, newBadges };
}

/** Start the Scout over (see `resetProgress` in the save store): name, rank, look and settings stay. */
export { resetProgress as resetProfileProgress } from '../save/store';

/** How many of an adventure's requirements are done, for the parent's list. */
export function adventureProgress(adventure: Adventure, profile: Profile): { done: number; total: number } {
  const total = adventure.requirements.length;
  const done = adventure.requirements.filter((r) => profile.requirements[r.id]?.status === 'done').length;
  return { done, total };
}
