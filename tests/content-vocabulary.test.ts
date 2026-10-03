import { describe, expect, it } from 'vitest';
import { RANKS_DIR, validateRankFiles } from '../scripts/validate-content.mjs';

describe('content/ranks vocabulary', () => {
  // enable once the content pass lands: the two rank files are being rewritten against
  // `npm run lint:content`. Switch to `it` when `node scripts/lint-content.mjs --vocab-only` is clean.
  it('kid-facing strings pass the grade-level vocabulary and sentence-length rules', () => {
    const { vocabulary } = validateRankFiles(RANKS_DIR);
    expect(vocabulary.errors).toEqual([]);
  });
});
