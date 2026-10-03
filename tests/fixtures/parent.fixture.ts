/** A Scout part way through the synthetic fixture rank, shared by the Parent mode tests. */
import { doneReq, learnedReq, makeProfile } from './profile.fixture';
import { ADVENTURE, ID } from './rank.fixture';

/**
 * Required adventures need 4 + 4 + 3 requirements, so this Scout is 6 of 11 (55%).
 * Test Trek 2 of 4 (one waiting for a parent), Test Camp 1 of 4 (one learned, one waiting),
 * Test Pick 3 of 3 with its badge. Last played 2026-10-02, streak 3, XP 120, 2 approvals pending.
 */
export function busyProfile(overrides: Parameters<typeof makeProfile>[0] = {}) {
  return makeProfile({
    xp: 120,
    streak: { current: 3, best: 5, lastTrailDate: '2026-10-02', embers: 1 },
    requirements: {
      [ID.trekCollect]: doneReq(),
      [ID.trekNavigate]: doneReq(),
      [ID.trekChore]: { status: 'pending-approval', attempts: 1, learnedAt: '2026-09-21', completedAt: '2026-09-30' },
      [ID.campQuiz]: doneReq(),
      [ID.campChore]: learnedReq('2026-09-18'),
      [ID.campErrand]: { status: 'pending-approval', attempts: 1 },
      // Test Pick: rhythm plus three of the optional ones; only two count toward the badge.
      [ID.pickRhythm]: doneReq(),
      [ID.pickQuiz]: doneReq(),
      [ID.pickSequence]: doneReq(),
      [ID.pickCraft]: doneReq(),
    },
    adventures: { [ADVENTURE.pick]: { completedAt: '2026-10-01' } },
    sessions: [
      { date: '2026-09-28', stops: [], xpEarned: 20, durationSec: 100 },
      { date: '2026-10-02', stops: [], xpEarned: 20, durationSec: 100 },
      { date: '2026-10-01', stops: [], xpEarned: 20, durationSec: 100 },
    ],
    ...overrides,
  });
}
