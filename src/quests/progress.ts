/**
 * Progress updates for Today's Trail. Every function is pure: it returns a new Profile and
 * never mutates its input. `today` is a local YYYY-MM-DD date string, and the progress
 * timestamps written here (learnedAt, completedAt, approvedAt) use that same format.
 */
import type { ActivityResult } from '../activities/types';
import {
  getRequirement,
  isAdventureComplete,
  isReviewable,
  loadRankContent,
} from '../content/load';
import type { RankContent } from '../content/types';
import {
  LEITNER_INTERVAL_DAYS,
  type Profile,
  type RequirementProgress,
  type ReviewCard,
  type SessionLog,
  type Streak,
} from '../save/types';
import { addDays, daysBetween } from './dates';
import { XP_BY_STOP, type TodaysTrail, type TrailStop } from './types';

export const MAX_SESSIONS = 30;
export const MAX_EMBERS = 3;
/** One ember is earned each time the streak reaches a multiple of this many days. */
export const EMBER_EVERY_DAYS = 7;
/** A completed review scoring below this counts as "wrong": the card goes back to box 0. */
export const REVIEW_PASS_SCORE = 0.6;

function isCorrect(result: ActivityResult): boolean {
  return result.completed && (result.score === undefined || result.score >= REVIEW_PASS_SCORE);
}

/**
 * Next Leitner state for a card. No card yet: a new card in box 0, due tomorrow.
 * Existing card: correct moves up one box (due after that box's interval), wrong goes
 * back to box 0, due tomorrow.
 */
export function nextReviewCard(
  card: ReviewCard | undefined,
  correct: boolean,
  today: string,
): ReviewCard {
  if (!card) {
    return { box: 0, dueOn: addDays(today, LEITNER_INTERVAL_DAYS[0]), lastReviewedOn: today };
  }
  const box: ReviewCard['box'] = correct ? (Math.min(4, card.box + 1) as ReviewCard['box']) : 0;
  return { box, dueOn: addDays(today, LEITNER_INTERVAL_DAYS[box]), lastReviewedOn: today };
}

/**
 * Is the stop's requirement fully digital (its own activity is not a field mission)?
 * A stop only carries the learn activity, which for a field mission is its practice, so
 * the content is needed to tell the two apart. Without `content` the bundled content for
 * the profile's rank is used. If the requirement is in neither, fall back to the stop.
 */
function isDigitalRequirement(profile: Profile, stop: TrailStop, content?: RankContent): boolean {
  const source = content ?? loadRankContent(profile.rank);
  const found = source ? getRequirement(source, stop.requirementId) : undefined;
  return found
    ? found.requirement.activity.type !== 'fieldMission'
    : stop.activity.type !== 'fieldMission';
}

function withRequirement(
  profile: Profile,
  id: string,
  progress: RequirementProgress,
): Profile['requirements'] {
  return { ...profile.requirements, [id]: progress };
}

function recordReview(
  profile: Profile,
  stop: TrailStop,
  result: ActivityResult,
  today: string,
  content?: RankContent,
): Profile {
  // Backing out of a review changes nothing; the card stays due and retry is free.
  if (!result.completed) return { ...profile };
  const id = stop.requirementId;
  const next: Profile = { ...profile, xp: profile.xp + XP_BY_STOP[stop.kind] };
  if (isReviewable(stop.activity)) {
    next.review = { ...profile.review, [id]: nextReviewCard(profile.review[id], isCorrect(result), today) };
  }
  const prev = profile.requirements[id];
  if (prev && result.score !== undefined && isDigitalRequirement(profile, stop, content)) {
    next.requirements = withRequirement(profile, id, {
      ...prev,
      bestScore: Math.max(prev.bestScore ?? 0, result.score),
    });
  }
  return next;
}

function recordFieldMission(profile: Profile, stop: TrailStop, result: ActivityResult, today: string): Profile {
  const id = stop.requirementId;
  const prev = profile.requirements[id];
  if (prev?.status === 'done' || prev?.status === 'pending-approval') return { ...profile };
  const base: RequirementProgress = prev ?? { status: 'available', attempts: 0 };
  if (result.completed) {
    // The kid says it is done. XP waits for the parent.
    return {
      ...profile,
      requirements: withRequirement(profile, id, {
        ...base,
        status: 'pending-approval',
        completedAt: base.completedAt ?? today,
      }),
    };
  }
  // A handout: the card has been shown, the real-world task is under way.
  if (base.status === 'locked' || base.status === 'available') {
    return { ...profile, requirements: withRequirement(profile, id, { ...base, status: 'in-progress' }) };
  }
  return { ...profile };
}

function recordLearn(
  profile: Profile,
  stop: TrailStop,
  result: ActivityResult,
  today: string,
  content?: RankContent,
): Profile {
  const id = stop.requirementId;
  const prev: RequirementProgress = profile.requirements[id] ?? { status: 'available', attempts: 0 };
  const alreadyLearned = prev.learnedAt !== undefined || prev.status === 'done';
  const digital = isDigitalRequirement(profile, stop, content);

  const progress: RequirementProgress = {
    ...prev,
    attempts: prev.attempts + Math.max(1, result.attempts),
  };
  if (digital && result.score !== undefined) {
    progress.bestScore = Math.max(prev.bestScore ?? 0, result.score);
  }
  if (result.completed) {
    progress.learnedAt = prev.learnedAt ?? today;
    if (digital) {
      progress.status = 'done';
      progress.completedAt = prev.completedAt ?? today;
    }
    // A field mission stays as it was: learning the practice does not complete it.
  } else if (digital && (prev.status === 'locked' || prev.status === 'available')) {
    progress.status = 'in-progress';
  }

  const next: Profile = { ...profile, requirements: withRequirement(profile, id, progress) };
  if (result.completed) {
    if (isReviewable(stop.activity)) {
      next.review = { ...profile.review, [id]: nextReviewCard(profile.review[id], isCorrect(result), today) };
    }
    if (!alreadyLearned) next.xp = profile.xp + XP_BY_STOP['new-step'];
  }
  return next;
}

/**
 * Record the outcome of one stop.
 * - warm-up / bonus: a completed review moves the Leitner card and awards XP each time.
 * - new-step: completing the learn activity sets learnedAt, creates the review card and
 *   awards XP once per requirement. A digital requirement also becomes done; a field
 *   mission keeps its status because the real-world part is still to do.
 * - field-check: a handout (not completed) sets in-progress; a completed check-in sets
 *   pending-approval. No XP until the parent approves.
 * `content` is only needed to tell a digital requirement from a field mission's practice;
 * it defaults to the bundled content for the profile's rank.
 */
export function recordStopResult(
  profile: Profile,
  stop: TrailStop,
  result: ActivityResult,
  today: string,
  content?: RankContent,
): Profile {
  if (stop.kind === 'warm-up' || stop.kind === 'bonus') {
    return recordReview(profile, stop, result, today, content);
  }
  if (stop.kind === 'field-check' || stop.activity.type === 'fieldMission') {
    return recordFieldMission(profile, stop, result, today);
  }
  return recordLearn(profile, stop, result, today, content);
}

/** Parent approval: pending-approval becomes done and the field-check XP is awarded. */
export function approveFieldMission(profile: Profile, requirementId: string, today: string): Profile {
  const prev = profile.requirements[requirementId];
  if (prev?.status !== 'pending-approval') return { ...profile };
  return {
    ...profile,
    xp: profile.xp + XP_BY_STOP['field-check'],
    requirements: withRequirement(profile, requirementId, {
      ...prev,
      status: 'done',
      completedAt: prev.completedAt ?? today,
      approvedAt: today,
    }),
  };
}

/** Mark newly complete adventures with completedAt and a `badge:<adventureId>` unlock. */
export function completeAdventuresIfDone(profile: Profile, content: RankContent, today: string): Profile {
  const adventures = { ...profile.adventures };
  const unlocks = [...profile.unlocks];
  for (const adventure of content.adventures) {
    if (adventures[adventure.id]) continue;
    if (!isAdventureComplete(adventure, profile.requirements)) continue;
    adventures[adventure.id] = { completedAt: today };
    const badge = `badge:${adventure.id}`;
    if (!unlocks.includes(badge)) unlocks.push(badge);
  }
  return { ...profile, adventures, unlocks };
}

/**
 * Advance the daily streak for a completed trail on `today`.
 * Same day: no change. Next day: +1. One missed day with an ember: the ember is used and
 * +1. Anything longer: back to 1. An ember is earned at every 7th consecutive day (max 3).
 */
export function advanceStreak(streak: Streak, today: string): Streak {
  const last = streak.lastTrailDate;
  let current = 1;
  let embers = streak.embers;
  if (last !== undefined) {
    const gap = daysBetween(last, today);
    if (gap <= 0) return { ...streak };
    if (gap === 1) {
      current = streak.current + 1;
    } else if (gap === 2 && embers > 0) {
      embers -= 1;
      current = streak.current + 1;
    }
  }
  if (current > streak.current && current % EMBER_EVERY_DAYS === 0) {
    embers = Math.min(MAX_EMBERS, embers + 1);
  }
  return { current, best: Math.max(streak.best, current), lastTrailDate: today, embers };
}

/**
 * Close the session: append a SessionLog (newest last, capped at 30) and, if every
 * non-bonus stop was completed, advance the streak. Stops are completed in order, so the
 * first `trail.completedStops` stops count as completed. xpEarned is derived from those
 * stops; a field-check counts only if the parent approved it today.
 */
export function finishSession(
  profile: Profile,
  trail: TodaysTrail,
  durationSec: number,
  today: string,
): Profile {
  const stops = trail.stops.map((stop, index) => ({
    kind: stop.kind,
    requirementId: stop.requirementId,
    completed: index < trail.completedStops,
  }));

  let xpEarned = 0;
  for (const stop of stops) {
    if (!stop.completed) continue;
    if (stop.kind === 'field-check') {
      const progress = profile.requirements[stop.requirementId];
      if (progress?.status === 'done' && progress.approvedAt === today) {
        xpEarned += XP_BY_STOP['field-check'];
      }
    } else {
      xpEarned += XP_BY_STOP[stop.kind];
    }
  }

  const log: SessionLog = { date: today, stops, xpEarned, durationSec };
  const next: Profile = { ...profile, sessions: [...profile.sessions, log].slice(-MAX_SESSIONS) };

  const trailDone = stops.some((s) => s.completed) && stops.filter((s) => s.kind !== 'bonus').every((s) => s.completed);
  if (trailDone) next.streak = advanceStreak(profile.streak, today);
  return next;
}
