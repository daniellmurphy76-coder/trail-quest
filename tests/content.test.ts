import { describe, expect, it } from 'vitest';
import { RANKS_DIR, validateRankFiles } from '../scripts/validate-content.mjs';

describe('content/ranks', () => {
  it('validates against the schema and semantic checks', () => {
    const { errors } = validateRankFiles(RANKS_DIR);
    expect(errors).toEqual([]);
  });
});
