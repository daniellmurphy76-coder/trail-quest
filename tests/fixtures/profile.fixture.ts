/** Builders for synthetic profiles used in logic tests. All names and ids are invented. */
import type { Profile, RequirementProgress, ReviewCard } from '../../src/save/types';

export const TODAY = '2026-10-03';

export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'test-profile-1',
    name: 'Test Scout',
    rank: 'wolf',
    guideName: 'Den Chief',
    readAloud: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    avatar: { bodyColor: '#3d85c6' },
    xp: 0,
    streak: { current: 0, best: 0, embers: 0 },
    requirements: {},
    adventures: {},
    review: {},
    sessions: [],
    unlocks: [],
    ...overrides,
  };
}

/** A digital requirement that has been learned and completed on `on`. */
export function doneReq(on = '2026-09-20', extra: Partial<RequirementProgress> = {}): RequirementProgress {
  return { status: 'done', attempts: 1, learnedAt: on, completedAt: on, ...extra };
}

/** A field mission whose practice has been learned but which is not done in the real world. */
export function learnedReq(on = '2026-09-20', extra: Partial<RequirementProgress> = {}): RequirementProgress {
  return { status: 'available', attempts: 1, learnedAt: on, ...extra };
}

export function card(box: ReviewCard['box'], dueOn: string): ReviewCard {
  return { box, dueOn, lastReviewedOn: '2026-09-20' };
}

/** Recursively freeze, so a test fails loudly if code mutates its input. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
