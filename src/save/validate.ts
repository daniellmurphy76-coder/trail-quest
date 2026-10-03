/**
 * Shape checks for save data. Used by migrations (the last step) so that anything loaded
 * from localStorage or imported from a file is known-good before the game touches it.
 * Throws an Error whose message names the field that failed.
 */
import type { RankId } from '../activities/types';
import { isYmd } from '../quests/dates';
import { SAVE_VERSION, type SaveFile } from './types';

const RANKS: readonly string[] = ['lion', 'tiger', 'wolf', 'bear', 'webelos', 'arrow-of-light'];
const STATUSES: readonly string[] = ['locked', 'available', 'in-progress', 'pending-approval', 'done'];
const STOP_KINDS: readonly string[] = ['warm-up', 'new-step', 'field-check', 'bonus'];

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(path: string, expectation: string): never {
  throw new Error(`Save data is not valid: ${path} ${expectation}.`);
}

function record(value: unknown, path: string): Rec {
  if (!isRecord(value)) fail(path, 'must be an object');
  return value;
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'must be text');
  return value;
}

function optStr(value: unknown, path: string): void {
  if (value !== undefined) str(value, path);
}

function num(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(path, 'must be a number that is 0 or more');
  }
  return value;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'must be true or false');
  return value;
}

function ymd(value: unknown, path: string): void {
  if (!isYmd(value)) fail(path, 'must be a date like 2026-10-03');
}

function oneOf(value: unknown, allowed: readonly string[], path: string): void {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    fail(path, `must be one of ${allowed.join(', ')}`);
  }
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'must be a list');
  return value;
}

function checkProfile(raw: unknown, path: string): void {
  const p = record(raw, path);
  if (str(p.id, `${path}.id`) === '') fail(`${path}.id`, 'must not be empty');
  str(p.name, `${path}.name`);
  oneOf(p.rank, RANKS, `${path}.rank`);
  str(p.guideName, `${path}.guideName`);
  bool(p.readAloud, `${path}.readAloud`);
  str(p.createdAt, `${path}.createdAt`);
  num(p.xp, `${path}.xp`);

  const avatar = record(p.avatar, `${path}.avatar`);
  str(avatar.bodyColor, `${path}.avatar.bodyColor`);
  optStr(avatar.hat, `${path}.avatar.hat`);
  optStr(avatar.neckerchief, `${path}.avatar.neckerchief`);

  const streak = record(p.streak, `${path}.streak`);
  num(streak.current, `${path}.streak.current`);
  num(streak.best, `${path}.streak.best`);
  num(streak.embers, `${path}.streak.embers`);
  if (streak.lastTrailDate !== undefined) ymd(streak.lastTrailDate, `${path}.streak.lastTrailDate`);

  for (const [id, value] of Object.entries(record(p.requirements, `${path}.requirements`))) {
    const rp = `${path}.requirements.${id}`;
    const progress = record(value, rp);
    oneOf(progress.status, STATUSES, `${rp}.status`);
    num(progress.attempts, `${rp}.attempts`);
    if (progress.bestScore !== undefined) num(progress.bestScore, `${rp}.bestScore`);
    optStr(progress.learnedAt, `${rp}.learnedAt`);
    optStr(progress.completedAt, `${rp}.completedAt`);
    optStr(progress.approvedAt, `${rp}.approvedAt`);
  }

  for (const [id, value] of Object.entries(record(p.adventures, `${path}.adventures`))) {
    str(record(value, `${path}.adventures.${id}`).completedAt, `${path}.adventures.${id}.completedAt`);
  }

  for (const [id, value] of Object.entries(record(p.review, `${path}.review`))) {
    const rp = `${path}.review.${id}`;
    const card = record(value, rp);
    if (![0, 1, 2, 3, 4].includes(card.box as number)) fail(`${rp}.box`, 'must be 0, 1, 2, 3 or 4');
    ymd(card.dueOn, `${rp}.dueOn`);
    if (card.lastReviewedOn !== undefined) ymd(card.lastReviewedOn, `${rp}.lastReviewedOn`);
  }

  array(p.sessions, `${path}.sessions`).forEach((value, i) => {
    const sp = `${path}.sessions[${i}]`;
    const session = record(value, sp);
    ymd(session.date, `${sp}.date`);
    num(session.xpEarned, `${sp}.xpEarned`);
    num(session.durationSec, `${sp}.durationSec`);
    array(session.stops, `${sp}.stops`).forEach((stopValue, j) => {
      const stop = record(stopValue, `${sp}.stops[${j}]`);
      oneOf(stop.kind, STOP_KINDS, `${sp}.stops[${j}].kind`);
      str(stop.requirementId, `${sp}.stops[${j}].requirementId`);
      bool(stop.completed, `${sp}.stops[${j}].completed`);
    });
  });

  array(p.unlocks, `${path}.unlocks`).forEach((value, i) => str(value, `${path}.unlocks[${i}]`));
}

/** Validate a current-version save. Returns the same object, typed. */
export function validateSave(raw: unknown): SaveFile {
  const save = record(raw, 'save');
  if (save.version !== SAVE_VERSION) fail('version', `must be ${SAVE_VERSION}`);
  array(save.profiles, 'profiles').forEach((profile, i) => checkProfile(profile, `profiles[${i}]`));
  optStr(save.activeProfileId, 'activeProfileId');
  const parent = record(save.parent, 'parent');
  optStr(parent.pinHash, 'parent.pinHash');
  optStr(parent.pinSalt, 'parent.pinSalt');
  return save as unknown as SaveFile;
}

export function isRankId(value: unknown): value is RankId {
  return typeof value === 'string' && RANKS.includes(value);
}
