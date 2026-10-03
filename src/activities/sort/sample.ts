import type { SortParams } from '../types';

/** Invented, obviously fake content for the dev harness and tests. Not a real requirement. */
export const SAMPLE_SORT: SortParams = {
  prompt: 'Zip packs for a pretend camp trip. Sort each thing.',
  bins: [
    { id: 'pack', label: 'Pack it' },
    { id: 'leave', label: 'Leave it' },
  ],
  items: [
    { label: 'Pretend tent', bin: 'pack' },
    { label: 'Fake flashlight', bin: 'pack' },
    { label: 'Pretend water jug', bin: 'pack' },
    { label: 'Toy dragon', bin: 'leave' },
    { label: 'Pretend TV', bin: 'leave' },
    { label: 'Giant pretend couch', bin: 'leave' },
  ],
};
