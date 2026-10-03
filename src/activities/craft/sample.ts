import type { CraftParams } from '../types';

/** Invented sample content for the craft activity and its test page. Not from any rank file. */
export const SAMPLE_CRAFT: CraftParams = {
  prompt: 'Zip is going on a hike. Tap what Zip needs for the day bag.',
  result: 'day bag',
  ingredients: [
    { id: 'water', label: 'Water bottle' },
    { id: 'snack', label: 'Trail snack' },
    { id: 'light', label: 'Flashlight' },
    { id: 'hat', label: 'Sun hat' },
  ],
  distractors: [
    { id: 'bowling', label: 'Bowling ball' },
    { id: 'fish', label: 'Goldfish bowl' },
    { id: 'sofa', label: 'Big sofa' },
  ],
};
