/**
 * Game event bus. The session and activities emit; rewards, sound and effects subscribe.
 * Keeps those features out of each other's files. Payloads are small and serializable.
 */
import type { ZoneId } from '../activities/types';
import type { GuideId } from '../npc/guide-types';
import type { StopKind } from '../save/types';

export type GameEvent =
  | { type: 'ui-tap' }
  | { type: 'dialog-open' }
  | { type: 'dialog-advance' }
  | { type: 'answer-right' }
  | { type: 'answer-wrong' }
  | { type: 'activity-complete'; activityType: string }
  | { type: 'stop-complete'; kind: StopKind; xp: number }
  | { type: 'trail-complete'; stops: number }
  | { type: 'badge-earned'; adventureId: string }
  | { type: 'cosmetic-unlocked'; id: string }
  | { type: 'title-earned'; title: string }
  | { type: 'mission-approved'; requirementId: string }
  | { type: 'travel'; zone: ZoneId }
  | { type: 'guide-talk'; guide: GuideId }
  | { type: 'pickup' }
  | { type: 'waypoint' }
  | { type: 'profile-active'; profileId: string }
  | { type: 'session-start' }
  | { type: 'session-end' };

export type GameEventType = GameEvent['type'];

export interface EventBus {
  emit(event: GameEvent): void;
  /** Subscribe to every event. Returns an unsubscribe function. */
  on(listener: (event: GameEvent) => void): () => void;
}

export function createEventBus(): EventBus {
  const listeners = new Set<(event: GameEvent) => void>();
  return {
    emit(event) {
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch (error) {
          console.warn('event listener failed', event.type, error);
        }
      }
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The one bus the running game uses. Tests may create their own with createEventBus(). */
export const events: EventBus = createEventBus();
