/** Size budgets for committed models. Shared by `assets-report.mjs` and `tests/engine/assets.test.ts`. */

export const KB = 1024;
export const MB = 1024 * 1024;

/** Every character model must stay under this. */
export const CHARACTER_BUDGET = 1.5 * MB;
/** Every other model (props, animals, buildings, street pieces, pickups) must stay under this. */
export const PROP_BUDGET = 300 * KB;
/** All committed models together. */
export const TOTAL_BUDGET = 12 * MB;
/** Every nature model together: trees, rocks, plants, stumps, logs, path stones, and the tents, fences, and bridge. */
export const NATURE_TOTAL_BUDGET = 4 * MB;
/** Pack folders that hold nature models (see `isNatureModel`). */
export const NATURE_PACKS = ['kaykit-forest-nature', 'trail-quest-original', 'kenney-nature-kit'];

/** True for a manifest entry that belongs to the nature art (counted against `NATURE_TOTAL_BUDGET`). */
export function isNatureModel(entry) {
  return NATURE_PACKS.includes(entry.pack);
}

/** The byte budget for one model id. */
export function budgetFor(id) {
  return id.startsWith('character.') ? CHARACTER_BUDGET : PROP_BUDGET;
}
