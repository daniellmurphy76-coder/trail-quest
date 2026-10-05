/**
 * The zone guides: grown-up specialists, one for each zone away from Base Camp, whom the Den Chief
 * introduces. Each one is known by a role, never a personal name, so nothing about a guide says boy
 * or girl. This file is the shared contract (ids, zones, role names); looks live in looks.ts and
 * behaviour in guides.ts.
 */
import type { ZoneId } from '../activities/types';

export type GuideId = 'coach' | 'ranger' | 'mayor' | 'firefighter' | 'camp-cook';

/** A zone that has a guide: every zone except Base Camp, which has the Den Chief. */
export type GuideZoneId = Exclude<ZoneId, 'base-camp'>;

export interface GuideInfo {
  id: GuideId;
  zone: GuideZoneId;
  /** What the name tag and the dialog nameplate say, and the {role} in lines ("The Ranger will help you"). */
  role: string;
}

export const GUIDES: readonly GuideInfo[] = [
  { id: 'coach', zone: 'fitness-field', role: 'Coach' },
  { id: 'ranger', zone: 'nature-trail', role: 'Ranger' },
  { id: 'mayor', zone: 'town-square', role: 'Mayor' },
  { id: 'firefighter', zone: 'safety-station', role: 'Firefighter' },
  { id: 'camp-cook', zone: 'campfire-circle', role: 'Camp Cook' },
];

/** The guide who works in this zone, or undefined for Base Camp. */
export function guideForZone(zone: ZoneId): GuideInfo | undefined {
  return GUIDES.find((guide) => guide.zone === zone);
}

/** One guide by id. */
export function guideById(id: GuideId): GuideInfo {
  return GUIDES.find((guide) => guide.id === id)!;
}
