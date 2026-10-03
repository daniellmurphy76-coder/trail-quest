import { showDialog } from '../ui/dialog';
import type { ActivityController, ActivityParamsByType, ActivityResult, ActivityType } from './types';

export const COMING_SOON_TEXT = 'This stop is still being built. Come back soon!';

/**
 * Stand-in for an activity type that is not built yet: a friendly card with a Next button.
 * It resolves `{ completed: false, attempts: 0 }`, so nothing is earned and nothing is lost.
 */
export function comingSoonActivity<T extends ActivityType>(type: T): ActivityController<T> {
  return {
    type,
    async run(host: HTMLElement, _params: ActivityParamsByType[T]): Promise<ActivityResult> {
      await showDialog(host, { speaker: 'Trail Sign', text: COMING_SOON_TEXT });
      return { completed: false, attempts: 0 };
    },
  };
}
