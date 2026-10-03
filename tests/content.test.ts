import { describe, expect, it } from 'vitest';
import { RANKS_DIR, validateRankFiles } from '../scripts/validate-content.mjs';

describe('content/ranks', () => {
  it('validates against the schema and semantic checks', () => {
    // Vocabulary and sentence-length rules are covered by content-vocabulary.test.ts.
    const { errors } = validateRankFiles(RANKS_DIR, { vocabulary: false });
    expect(errors).toEqual([]);
  });
});
