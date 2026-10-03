import { describe, expect, it } from 'vitest';
import {
  detectQuality,
  getQuality,
  parseQualityOverride,
  qualitySettings,
  QUALITY_SETTINGS,
  type QualityInfo,
} from '../../src/engine/quality';

const laptop: QualityInfo = { coarsePointer: false, hardwareConcurrency: 8, deviceMemory: 8, pixelRatio: 2 };

describe('detectQuality', () => {
  it('gives a mid-range laptop the high tier', () => {
    expect(detectQuality(laptop)).toBe('high');
  });

  it('gives an iPad (touch, no deviceMemory, 8 cores, pixel ratio 2) the medium tier', () => {
    expect(detectQuality({ coarsePointer: true, hardwareConcurrency: 8, pixelRatio: 2 })).toBe('medium');
  });

  it('gives any touch-first device medium, however strong', () => {
    expect(detectQuality({ ...laptop, coarsePointer: true })).toBe('medium');
  });

  it('drops weak hardware to medium', () => {
    expect(detectQuality({ ...laptop, deviceMemory: 4 })).toBe('medium');
    expect(detectQuality({ ...laptop, deviceMemory: 2 })).toBe('medium');
    expect(detectQuality({ ...laptop, hardwareConcurrency: 4 })).toBe('medium');
    expect(detectQuality({ ...laptop, hardwareConcurrency: 2 })).toBe('medium');
  });

  it('keeps high when hints are missing (Safari has no deviceMemory, some browsers hide the core count)', () => {
    expect(detectQuality({ coarsePointer: false, pixelRatio: 2 })).toBe('high');
    expect(detectQuality({ coarsePointer: false, hardwareConcurrency: 10, pixelRatio: 1 })).toBe('high');
  });

  it('drops phone-class pixel ratios to medium', () => {
    expect(detectQuality({ ...laptop, pixelRatio: 3 })).toBe('medium');
    expect(detectQuality({ ...laptop, pixelRatio: 2.5 })).toBe('high');
  });

  it('only ever returns a known tier', () => {
    for (const coarsePointer of [true, false]) {
      for (const cores of [undefined, 1, 4, 5, 16]) {
        for (const memory of [undefined, 0.5, 4, 8]) {
          for (const pixelRatio of [1, 2, 3]) {
            const info: QualityInfo = { coarsePointer, pixelRatio };
            if (cores !== undefined) info.hardwareConcurrency = cores;
            if (memory !== undefined) info.deviceMemory = memory;
            expect(['high', 'medium']).toContain(detectQuality(info));
          }
        }
      }
    }
  });
});

describe('quality settings', () => {
  it('high is a 2048 shadow map reaching 45 units; medium is 1024 reaching 35', () => {
    expect(qualitySettings('high')).toEqual({ tier: 'high', shadowMapSize: 2048, shadowDistance: 45 });
    expect(qualitySettings('medium')).toEqual({ tier: 'medium', shadowMapSize: 1024, shadowDistance: 35 });
    expect(QUALITY_SETTINGS.high.shadowMapSize).toBeGreaterThan(QUALITY_SETTINGS.medium.shadowMapSize);
  });
});

describe('parseQualityOverride', () => {
  it('reads ?quality= from the address bar', () => {
    expect(parseQualityOverride('?quality=medium')).toBe('medium');
    expect(parseQualityOverride('?debug=1&quality=high')).toBe('high');
  });

  it('ignores anything else', () => {
    expect(parseQualityOverride('')).toBeNull();
    expect(parseQualityOverride('?quality=ultra')).toBeNull();
    expect(parseQualityOverride('?other=medium')).toBeNull();
  });
});

describe('getQuality', () => {
  it('reads the browser once and keeps the answer', () => {
    const first = getQuality();
    expect(['high', 'medium']).toContain(first);
    expect(getQuality()).toBe(first);
  });
});
