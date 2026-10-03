/**
 * Save migrations. To change the save format:
 *   1. Bump SAVE_VERSION in src/save/types.ts and update the types.
 *   2. Add a step to MIGRATIONS keyed by the version it migrates FROM. It receives the
 *      raw object (version N) and returns the raw object at version N + 1.
 *   3. Update validateSave in src/save/validate.ts to the new shape.
 * Steps run in order, so a v1 save reaches v3 through the 1 step and then the 2 step.
 */
import { SAVE_VERSION, type SaveFile } from './types';
import { validateSave } from './validate';

type Raw = Record<string, unknown>;
export type MigrationStep = (data: Raw) => Raw;

export const MIGRATIONS: Readonly<Record<number, MigrationStep>> = {
  // v1 is the baseline format, so this step changes nothing. Replace it with the real
  // 1 -> 2 conversion when SAVE_VERSION becomes 2.
  1: (data) => data,
};

/** Run every step from `from` up to (not including) `to`. Pure; does not touch `data`. */
export function applyMigrations(
  data: Raw,
  from: number,
  to: number,
  steps: Readonly<Record<number, MigrationStep>> = MIGRATIONS,
): Raw {
  let current: Raw = data;
  for (let version = from; version < to; version++) {
    const step = steps[version];
    if (!step) throw new Error(`Cannot upgrade this save: no step from version ${version}.`);
    current = { ...step(current), version: version + 1 };
  }
  return current;
}

/** Bring any supported save up to the current version and check its shape. */
export function migrate(raw: unknown): SaveFile {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Save data is not an object.');
  }
  const data = raw as Raw;
  const version = data.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error('Save data has no valid version number.');
  }
  if (version > SAVE_VERSION) {
    throw new Error(
      `This save is from a newer version of Trail Quest (version ${version}). Update the game, then try again.`,
    );
  }
  return validateSave(applyMigrations(data, version, SAVE_VERSION));
}
