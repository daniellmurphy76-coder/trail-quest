import { describe, expect, it } from 'vitest';
import { loadReference, normalizeReference } from '../../src/content/reference';

describe('normalizeReference', () => {
  it('keeps a complete reference as it is', () => {
    const full = {
      oath: { title: 'T', lines: ['a', 'b'] },
      law: { title: 'L', points: [{ word: 'w', meaning: 'm' }] },
      cubMotto: { title: 'c', lines: ['x'] },
      bsaMotto: { title: 'b', lines: ['y'] },
      bsaSlogan: { title: 's', lines: ['z'] },
      outdoorCode: { title: 'o', lines: ['p'] },
      leaveNoTrace: { title: 'n', lines: ['q'] },
    };
    expect(normalizeReference(full)).toEqual(full);
  });

  it('keeps what is usable and drops the rest of a partial file', () => {
    expect(normalizeReference({ oath: { title: 'T', lines: ['a'] } })).toEqual({ oath: { title: 'T', lines: ['a'] } });
    expect(normalizeReference({})).toEqual({});
  });

  it('survives anything that is not the right shape', () => {
    const odd = [undefined, null, 7, 'text', [], { oath: null }, { oath: 'x' }, { law: { points: 'x' } }, { oath: { lines: 5 } }];
    for (const raw of odd) expect(normalizeReference(raw)).toEqual({});
  });

  it('trims text and drops blank lines, and a block with no lines at all', () => {
    expect(normalizeReference({ oath: { title: ' T ', lines: [' a ', '', 3, '  ', 'b'] } })).toEqual({
      oath: { title: 'T', lines: ['a', 'b'] },
    });
    expect(normalizeReference({ oath: { title: 'T', lines: ['', ' '] } })).toEqual({});
  });

  it('allows a missing title, and drops law points with no word', () => {
    expect(normalizeReference({ cubMotto: { lines: ['x'] } })).toEqual({ cubMotto: { title: '', lines: ['x'] } });
    expect(
      normalizeReference({
        law: { title: 'L', points: [{ word: ' Kind ', meaning: ' Be nice. ' }, { meaning: 'no word' }, null, { word: 'Calm' }] },
      }),
    ).toEqual({
      law: {
        title: 'L',
        points: [
          { word: 'Kind', meaning: 'Be nice.' },
          { word: 'Calm', meaning: '' },
        ],
      },
    });
    expect(normalizeReference({ law: { title: 'L', points: [{ meaning: 'x' }] } })).toEqual({});
  });
});

describe('loadReference', () => {
  it('never throws and always gives an object, whether or not content/reference.json exists yet', () => {
    const reference = loadReference();
    expect(typeof reference).toBe('object');
    expect(reference).not.toBeNull();
    expect(loadReference()).toBe(reference); // read once
    // Whatever it holds is in the shape the Scout Book draws.
    for (const [key, value] of Object.entries(reference)) {
      if (key === 'law') expect((value as { points: unknown[] }).points.length).toBeGreaterThan(0);
      else expect((value as { lines: unknown[] }).lines.length).toBeGreaterThan(0);
    }
  });
});
