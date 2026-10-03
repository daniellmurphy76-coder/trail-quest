import type { ZoneId } from '../activities/types';

/**
 * Every zone, in the order the Places buttons list them: the hub first, then the rest in the
 * order of the ZoneId type. Pure data (no Three.js), so lines and screens can import it freely.
 */
export const ZONE_IDS: readonly ZoneId[] = [
  'base-camp',
  'fitness-field',
  'nature-trail',
  'town-square',
  'safety-station',
  'campfire-circle',
];

/** Words for the zones, used by the travel sign and the Places buttons. */
export const ZONE_LABELS: Record<ZoneId, string> = {
  'base-camp': 'Base Camp',
  'fitness-field': 'Fitness Field',
  'nature-trail': 'Nature Trail',
  'town-square': 'Town Square',
  'safety-station': 'Safety Station',
  'campfire-circle': 'Campfire Circle',
};
