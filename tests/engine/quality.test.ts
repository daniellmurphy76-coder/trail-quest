import { describe, expect, it } from 'vitest';
import {
  AUTO_DOWNGRADE_DEFAULTS,
  AutoDowngrade,
  detectQuality,
  getQuality,
  lowerTier,
  parseQualityOverride,
  QUALITY_SETTINGS,
  QUALITY_TIERS,
  qualitySettings,
  setQuality,
  type QualityInfo,
  type QualityTier,
} from '../../src/engine/quality';

describe('tiers', () => {
  it('are high, medium and low, best first', () => {
    expect(QUALITY_TIERS).toEqual(['high', 'medium', 'low']);
    for (const tier of QUALITY_TIERS) expect(qualitySettings(tier).tier).toBe(tier);
  });

  it('high turns everything on, with full-resolution ambient occlusion', () => {
    const { post } = QUALITY_SETTINGS.high;
    expect(post).toMatchObject({ enabled: true, ao: true, aoHalfRes: false, bloom: true, smaa: true });
  });

  it('medium (the iPad) keeps ambient occlusion at half resolution with fewer samples, plus bloom and SMAA', () => {
    const { post } = QUALITY_SETTINGS.medium;
    expect(post).toMatchObject({ enabled: true, ao: true, aoHalfRes: true, aoQuality: 'Performance', bloom: true, smaa: true });
    expect(QUALITY_SETTINGS.high.post.aoQuality).toBe('Medium'); // more samples than the iPad's 'Performance'
    expect(post.bloomLevels).toBeLessThan(QUALITY_SETTINGS.high.post.bloomLevels);
  });

  it('low is plain rendering: no post pipeline, no ambient occlusion, no bloom, no SMAA', () => {
    expect(QUALITY_SETTINGS.low.post).toMatchObject({ enabled: false, ao: false, bloom: false, smaa: false });
  });

  it('get cheaper down the list: shadow map size and reach never grow', () => {
    for (let i = 1; i < QUALITY_TIERS.length; i++) {
      const better = qualitySettings(QUALITY_TIERS[i - 1]!);
      const worse = qualitySettings(QUALITY_TIERS[i]!);
      expect(worse.shadowMapSize).toBeLessThanOrEqual(better.shadowMapSize);
      expect(worse.shadowDistance).toBeLessThanOrEqual(better.shadowDistance);
    }
  });
});

describe('detectQuality never starts a device on low', () => {
  it('returns only high or medium for every combination of hints', () => {
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

describe('parseQualityOverride', () => {
  it('forces any of the three tiers', () => {
    expect(parseQualityOverride('?quality=high')).toBe('high');
    expect(parseQualityOverride('?quality=medium')).toBe('medium');
    expect(parseQualityOverride('?quality=low')).toBe('low');
    expect(parseQualityOverride('?dev=look&quality=low&stats=1')).toBe('low');
  });

  it('ignores anything else', () => {
    expect(parseQualityOverride('')).toBeNull();
    expect(parseQualityOverride('?quality=ultra')).toBeNull();
    expect(parseQualityOverride('?quality=')).toBeNull();
    expect(parseQualityOverride('?Quality=low')).toBeNull();
  });
});

describe('lowerTier', () => {
  it('steps down one tier at a time and stops at low', () => {
    expect(lowerTier('high')).toBe('medium');
    expect(lowerTier('medium')).toBe('low');
    expect(lowerTier('low')).toBeNull();
  });
});

describe('the session tier', () => {
  it('can be changed after the first read (an automatic downgrade)', () => {
    const first = getQuality();
    expect(QUALITY_TIERS).toContain(first);
    setQuality('low');
    expect(getQuality()).toBe('low');
    setQuality(first);
    expect(getQuality()).toBe(first);
  });
});

/** Feed `seconds` of frames, each `frameMs` long. Returns every drop with the second it happened at. */
function run(monitor: AutoDowngrade, frameMs: number, seconds: number, startAt = 0): Array<{ at: number; tier: QualityTier }> {
  const drops: Array<{ at: number; tier: QualityTier }> = [];
  const dt = frameMs / 1000;
  let t = startAt;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    t += dt;
    const tier = monitor.sample(dt);
    if (tier) drops.push({ at: t - startAt, tier });
  }
  return drops;
}

describe('AutoDowngrade', () => {
  it('uses a 3 second window and a 22 ms threshold', () => {
    expect(AUTO_DOWNGRADE_DEFAULTS.windowSeconds).toBe(3);
    expect(AUTO_DOWNGRADE_DEFAULTS.thresholdMs).toBe(22);
  });

  it('leaves a device that holds 60 fps alone', () => {
    const monitor = new AutoDowngrade('high');
    expect(run(monitor, 16.7, 60)).toEqual([]);
    expect(monitor.tier).toBe('high');
  });

  it('drops one tier after a whole slow window, past the warm-up', () => {
    const monitor = new AutoDowngrade('high');
    const drops = run(monitor, 30, 8); // about 33 fps
    expect(drops).toHaveLength(1);
    expect(drops[0]!.tier).toBe('medium');
    // 2 seconds of warm-up, then a 3 second window.
    expect(drops[0]!.at).toBeGreaterThanOrEqual(5);
    expect(drops[0]!.at).toBeLessThan(5.5);
    expect(monitor.tier).toBe('medium');
  });

  it('keeps going down while it stays slow, one tier per window, and stops at low', () => {
    const monitor = new AutoDowngrade('high');
    const drops = run(monitor, 40, 60);
    expect(drops.map((d) => d.tier)).toEqual(['medium', 'low']);
    expect(monitor.tier).toBe('low');
    expect(drops[1]!.at - drops[0]!.at).toBeGreaterThan(4.9); // warm-up again after the first drop
  });

  it('never goes back up, however fast the frames get afterwards', () => {
    const monitor = new AutoDowngrade('high');
    run(monitor, 40, 6);
    expect(monitor.tier).toBe('medium');
    expect(run(monitor, 8, 120)).toEqual([]);
    expect(monitor.tier).toBe('medium');
  });

  it('judges the average of the window, not single frames', () => {
    const monitor = new AutoDowngrade('high');
    // Alternate 10 ms and 30 ms frames: the average is 20 ms, under the threshold, though half the frames are over it.
    const drops: QualityTier[] = [];
    for (let i = 0; i < 2000; i++) {
      const tier = monitor.sample(i % 2 === 0 ? 0.01 : 0.03);
      if (tier) drops.push(tier);
    }
    expect(drops).toEqual([]);
  });

  it('only drops when the average is above the threshold', () => {
    expect(run(new AutoDowngrade('high'), 21.9, 30)).toEqual([]);
    expect(run(new AutoDowngrade('high'), 22.5, 30)).toHaveLength(2); // medium, then low
    expect(run(new AutoDowngrade('high', { thresholdMs: 30 }), 28, 30)).toEqual([]);
  });

  it('is not fooled by one long stall (a hitch, a shader compile) in an otherwise fast window', () => {
    const monitor = new AutoDowngrade('high');
    run(monitor, 16, 2.5); // warm-up
    const drops: QualityTier[] = [];
    for (let i = 0; i < 180; i++) {
      const tier = monitor.sample(i === 90 ? 2 : 0.016); // one two-second stall
      if (tier) drops.push(tier);
    }
    run(monitor, 16, 10);
    expect(drops).toEqual([]);
    expect(monitor.tier).toBe('high');
  });

  it('ignores the warm-up: slow frames before the game settles do not count', () => {
    const monitor = new AutoDowngrade('high');
    expect(run(monitor, 60, 1.9)).toEqual([]); // slow, but inside the 2 second warm-up
    expect(run(monitor, 16, 30)).toEqual([]);
    expect(monitor.tier).toBe('high');
  });

  it('ignores frame times that are not positive numbers', () => {
    const monitor = new AutoDowngrade('high');
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(monitor.sample(bad)).toBeNull();
    expect(run(monitor, 16, 30)).toEqual([]);
  });

  it('starts measuring again when the tier is set from outside', () => {
    const monitor = new AutoDowngrade('high');
    run(monitor, 40, 4.9); // nearly through the first window
    monitor.setTier('high');
    expect(monitor.tier).toBe('high');
    expect(run(monitor, 40, 1.9)).toEqual([]); // warm-up again
    expect(run(monitor, 40, 6)[0]?.tier).toBe('medium');
    monitor.setTier('low');
    expect(run(monitor, 60, 20)).toEqual([]); // nowhere lower to go
  });

  it('takes its numbers from the options', () => {
    const monitor = new AutoDowngrade('medium', { windowSeconds: 1, warmupSeconds: 0, thresholdMs: 10 });
    const drops = run(monitor, 15, 1.2);
    expect(drops).toHaveLength(1);
    expect(drops[0]!.tier).toBe('low');
    expect(drops[0]!.at).toBeLessThan(1.1);
  });
});
