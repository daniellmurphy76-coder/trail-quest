import { describe, expect, it } from 'vitest';
import {
  AUTO_DOWNGRADE_DEFAULTS,
  AutoDowngrade,
  detectQuality,
  getQuality,
  lowerTier,
  MAX_PIXEL_RATIO,
  parseQualityOverride,
  parseScaleOverride,
  QUALITY_SETTINGS,
  QUALITY_TIERS,
  qualitySettings,
  renderScaleLadder,
  setQuality,
  type AutoChange,
  type AutoDowngradeOptions,
  type QualityInfo,
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

describe('renderScaleLadder', () => {
  it('on a 2x screen steps 2, 1.75, 1.5, 1.25', () => {
    expect(renderScaleLadder(2)).toEqual([2, 1.75, 1.5, 1.25]);
  });

  it('never goes above 2, so a 3x screen gets the same steps as a 2x one', () => {
    expect(MAX_PIXEL_RATIO).toBe(2);
    expect(renderScaleLadder(3)).toEqual([2, 1.75, 1.5, 1.25]);
  });

  it('has no step on a 1x screen, or on one with nothing sensible to lower', () => {
    expect(renderScaleLadder(1)).toEqual([1]);
    expect(renderScaleLadder(0.75)).toEqual([0.75]);
    expect(renderScaleLadder(1.25)).toEqual([1.25]);
    expect(renderScaleLadder(1.3)).toEqual([1.3]); // 1.25 is too close to be worth a buffer rebuild
  });

  it('starts at the screen ratio and steps down to the floor of 1.25', () => {
    expect(renderScaleLadder(1.5)).toEqual([1.5, 1.25]);
    expect(renderScaleLadder(1.8)).toEqual([1.8, 1.5, 1.25]);
  });

  it('treats a missing or broken ratio as 1x', () => {
    for (const bad of [0, -2, Number.NaN]) expect(renderScaleLadder(bad)).toEqual([1]);
  });

  it('only ever goes down, one rung at a time, and never below 1.25 on a screen that has it', () => {
    for (const ratio of [1.25, 1.5, 1.75, 2, 2.625, 3]) {
      const ladder = renderScaleLadder(ratio);
      for (let i = 1; i < ladder.length; i++) expect(ladder[i]!).toBeLessThan(ladder[i - 1]!);
      expect(Math.min(...ladder)).toBeGreaterThanOrEqual(1.25);
    }
  });
});

describe('parseScaleOverride', () => {
  it('caps the pixel ratio from the address bar', () => {
    expect(parseScaleOverride('?scale=1.25')).toBe(1.25);
    expect(parseScaleOverride('?quality=medium&scale=1.5&stats=1')).toBe(1.5);
  });

  it('keeps the number between 0.5 and 2', () => {
    expect(parseScaleOverride('?scale=3')).toBe(2);
    expect(parseScaleOverride('?scale=0.1')).toBe(0.5);
  });

  it('ignores anything else', () => {
    for (const search of ['', '?scale=', '?scale=big', '?scale=0', '?scale=-1', '?Scale=1.5']) expect(parseScaleOverride(search)).toBeNull();
  });
});

type Change = { at: number; change: AutoChange };

/** Feed `seconds` of frames, each `frameMs` long. Returns every change with the second it happened at. */
function run(monitor: AutoDowngrade, frameMs: number, seconds: number, startAt = 0): Change[] {
  const changes: Change[] = [];
  const dt = frameMs / 1000;
  let t = startAt;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    t += dt;
    const change = monitor.sample(dt);
    if (change) changes.push({ at: t - startAt, change });
  }
  return changes;
}

/** A change as a short label: a tier's name, or the new pixel ratio. */
const label = (change: AutoChange): string | number => (change.kind === 'tier' ? change.tier : change.pixelRatio);
const labels = (changes: Change[]): Array<string | number> => changes.map((c) => label(c.change));

// Frame times that add up exactly, so a window of them closes on a whole frame count.
const SLOW = 1 / 32; // 31.25 ms: over the 22 ms threshold
const MID = 5 / 256; // 19.5 ms: under the threshold, but not comfortable
const FAST = 1 / 64; // 15.6 ms: comfortable

/** A monitor with one-second windows, no warm-up and a four second recovery, so a test reads as windows. */
function quick(pixelRatio: number, extra: AutoDowngradeOptions = {}): AutoDowngrade {
  return new AutoDowngrade('high', { pixelRatio, windowSeconds: 1, warmupSeconds: 0, recoverSeconds: 4, ...extra });
}

/** Feed `count` whole one-second windows of frames of `dt` seconds each. */
function windows(monitor: AutoDowngrade, dt: number, count: number): Array<string | number> {
  const out: Array<string | number> = [];
  const frames = Math.ceil(1 / dt);
  for (let w = 0; w < count; w++) {
    for (let i = 0; i < frames; i++) {
      const change = monitor.sample(dt);
      if (change) out.push(label(change));
    }
  }
  return out;
}

describe('AutoDowngrade', () => {
  it('uses a 3 second window and a 22 ms threshold', () => {
    expect(AUTO_DOWNGRADE_DEFAULTS.windowSeconds).toBe(3);
    expect(AUTO_DOWNGRADE_DEFAULTS.thresholdMs).toBe(22);
  });

  it('steps back up only after 10 seconds of 58 fps or better, and assumes a 1x screen', () => {
    expect(AUTO_DOWNGRADE_DEFAULTS.recoverSeconds).toBe(10);
    expect(1000 / AUTO_DOWNGRADE_DEFAULTS.comfortMs).toBeGreaterThanOrEqual(58);
    expect(AUTO_DOWNGRADE_DEFAULTS.comfortMs).toBeLessThan(AUTO_DOWNGRADE_DEFAULTS.thresholdMs);
    expect(AUTO_DOWNGRADE_DEFAULTS.pixelRatio).toBe(1);
  });

  it('leaves a device that holds 60 fps alone', () => {
    const monitor = new AutoDowngrade('high', { pixelRatio: 2 });
    expect(run(monitor, 16.7, 60)).toEqual([]);
    expect(monitor.tier).toBe('high');
    expect(monitor.pixelRatio).toBe(2);
  });

  describe('on a 1x screen (no resolution step)', () => {
    it('drops one tier after a whole slow window, past the warm-up', () => {
      const monitor = new AutoDowngrade('high');
      const drops = run(monitor, 30, 8); // about 33 fps
      expect(drops).toHaveLength(1);
      expect(drops[0]!.change).toEqual({ kind: 'tier', tier: 'medium' });
      // 2 seconds of warm-up, then a 3 second window.
      expect(drops[0]!.at).toBeGreaterThanOrEqual(5);
      expect(drops[0]!.at).toBeLessThan(5.5);
      expect(monitor.tier).toBe('medium');
      expect(monitor.pixelRatio).toBe(1);
    });

    it('keeps going down while it stays slow, one tier per window, and stops at low', () => {
      const monitor = new AutoDowngrade('high');
      const drops = run(monitor, 40, 60);
      expect(labels(drops)).toEqual(['medium', 'low']);
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

    it('treats a ratio of 1 or less the same way: nothing to lower', () => {
      for (const pixelRatio of [1, 0.75]) expect(labels(run(new AutoDowngrade('high', { pixelRatio }), 40, 60))).toEqual(['medium', 'low']);
    });
  });

  describe('on a 2x screen', () => {
    it('lowers the resolution first, one step per window, and only then the tier', () => {
      const monitor = new AutoDowngrade('high', { pixelRatio: 2 });
      const changes = run(monitor, 40, 60);
      expect(labels(changes)).toEqual([1.75, 1.5, 1.25, 'medium', 'low']);
      expect(changes.map((c) => c.change.kind)).toEqual(['resolution', 'resolution', 'resolution', 'tier', 'tier']);
      for (let i = 1; i < changes.length; i++) expect(changes[i]!.at - changes[i - 1]!.at).toBeGreaterThan(4.9); // warm-up after each
      expect(monitor.tier).toBe('low');
      expect(monitor.pixelRatio).toBe(1.25);
    });

    it('is the iPad path on medium: three resolution steps, then low', () => {
      expect(labels(run(new AutoDowngrade('medium', { pixelRatio: 2 }), 40, 60))).toEqual([1.75, 1.5, 1.25, 'low']);
    });

    it('keeps the tier while there are resolution steps left, and the ratio once the tier starts to fall', () => {
      const monitor = new AutoDowngrade('high', { pixelRatio: 2 });
      run(monitor, 40, 5.5);
      expect(monitor.tier).toBe('high');
      expect(monitor.pixelRatio).toBe(1.75);
      run(monitor, 40, 10);
      expect(monitor.pixelRatio).toBe(1.25);
      expect(monitor.tier).toBe('high');
      run(monitor, 40, 5);
      expect(monitor.tier).toBe('medium');
      expect(monitor.pixelRatio).toBe(1.25);
    });

    it('stops at the floor: 1.25 is the lowest ratio it ever asks for', () => {
      const ratios = run(new AutoDowngrade('high', { pixelRatio: 2 }), 40, 120)
        .map((c) => c.change)
        .flatMap((c) => (c.kind === 'resolution' ? [c.pixelRatio] : []));
      expect(Math.min(...ratios)).toBe(1.25);
    });

    it('caps a denser screen at 2 and starts a 1.5x screen at 1.5', () => {
      expect(labels(run(new AutoDowngrade('high', { pixelRatio: 3 }), 40, 60))).toEqual([1.75, 1.5, 1.25, 'medium', 'low']);
      expect(labels(run(new AutoDowngrade('high', { pixelRatio: 1.5 }), 40, 60))).toEqual([1.25, 'medium', 'low']);
    });

    it('only acts when the average is above the threshold', () => {
      expect(run(new AutoDowngrade('high', { pixelRatio: 2 }), 21.9, 30)).toEqual([]);
      expect(run(new AutoDowngrade('high', { pixelRatio: 2 }), 22.5, 30)).toHaveLength(5); // three steps, medium, low
      expect(run(new AutoDowngrade('high', { pixelRatio: 2, thresholdMs: 30 }), 28, 30)).toEqual([]);
    });
  });

  describe('stepping the resolution back up', () => {
    it('does it once the frames have been comfortable for about 14 seconds (2 of warm-up, then 4 windows)', () => {
      const monitor = new AutoDowngrade('high', { pixelRatio: 2 });
      const down = run(monitor, 40, 6);
      expect(labels(down)).toEqual([1.75]);
      const up = run(monitor, 16, 60);
      expect(labels(up)).toEqual([2]);
      // Seconds from the step down to the step up (the first run kept going after the step down).
      const gap = 6 - down[0]!.at + up[0]!.at;
      expect(gap).toBeGreaterThanOrEqual(13.9);
      expect(gap).toBeLessThan(14.6);
      expect(monitor.pixelRatio).toBe(2);
      expect(monitor.tier).toBe('high');
    });

    it('goes up one rung at a time, each after its own comfortable run', () => {
      const monitor = quick(2);
      expect(windows(monitor, SLOW, 2)).toEqual([1.75, 1.5]);
      expect(windows(monitor, FAST, 3)).toEqual([]);
      expect(windows(monitor, FAST, 1)).toEqual([1.75]);
      expect(windows(monitor, FAST, 3)).toEqual([]);
      expect(windows(monitor, FAST, 1)).toEqual([2]);
      expect(windows(monitor, FAST, 30)).toEqual([]); // the top: nothing sharper to go to
    });

    it('is not fooled by frames that are merely fine: under the threshold but not comfortable', () => {
      const monitor = quick(2);
      windows(monitor, SLOW, 1);
      expect(windows(monitor, MID, 60)).toEqual([]);
      expect(monitor.pixelRatio).toBe(1.75);
    });

    it('starts the count again after a window that is not comfortable', () => {
      const monitor = quick(2);
      windows(monitor, SLOW, 1);
      expect(windows(monitor, FAST, 3)).toEqual([]);
      expect(windows(monitor, MID, 1)).toEqual([]);
      expect(windows(monitor, FAST, 3)).toEqual([]); // three again, not four
      expect(windows(monitor, FAST, 1)).toEqual([2]);
    });

    it('does not go above the top rung of a device that never needed to step down', () => {
      expect(windows(quick(2), FAST, 100)).toEqual([]);
    });

    it('is off when recoverSeconds is 0', () => {
      const monitor = quick(2, { recoverSeconds: 0 });
      windows(monitor, SLOW, 1);
      expect(windows(monitor, FAST, 100)).toEqual([]);
      expect(monitor.pixelRatio).toBe(1.75);
    });

    it('closes a rung that failed when it was tried again, so it cannot flip back and forth', () => {
      const monitor = quick(2);
      expect(windows(monitor, SLOW, 1)).toEqual([1.75]);
      expect(windows(monitor, FAST, 4)).toEqual([2]); // tries 2 again...
      expect(windows(monitor, SLOW, 1)).toEqual([1.75]); // ...it fails...
      expect(windows(monitor, FAST, 100)).toEqual([]); // ...and 2 is never tried a third time
      expect(monitor.pixelRatio).toBe(1.75);
    });

    it('tries every rung at most once more, then settles', () => {
      const monitor = quick(2);
      const seen: Array<string | number> = [];
      for (let cycle = 0; cycle < 8; cycle++) seen.push(...windows(monitor, SLOW, 1), ...windows(monitor, FAST, 4));
      // Each slow window steps down; each comfortable run steps up once, except onto a closed rung.
      expect(seen).toEqual([1.75, 2, 1.75, 1.5, 1.75, 1.5, 1.25, 1.5, 1.25, 'medium', 'low']);
    });

    it('never steps up after a tier was dropped, however fast it gets', () => {
      const monitor = quick(2);
      expect(windows(monitor, SLOW, 4)).toEqual([1.75, 1.5, 1.25, 'medium']);
      expect(windows(monitor, FAST, 100)).toEqual([]);
      expect(monitor.tier).toBe('medium');
      expect(monitor.pixelRatio).toBe(1.25);
      const flat = quick(1);
      expect(windows(flat, SLOW, 1)).toEqual(['medium']);
      expect(windows(flat, FAST, 100)).toEqual([]);
    });
  });

  it('judges the average of the window, not single frames', () => {
    const monitor = new AutoDowngrade('high', { pixelRatio: 2 });
    // Alternate 10 ms and 30 ms frames: the average is 20 ms, under the threshold, though half the frames are over it.
    const changes: AutoChange[] = [];
    for (let i = 0; i < 2000; i++) {
      const change = monitor.sample(i % 2 === 0 ? 0.01 : 0.03);
      if (change) changes.push(change);
    }
    expect(changes).toEqual([]);
  });

  it('only drops a tier when the average is above the threshold', () => {
    expect(run(new AutoDowngrade('high'), 21.9, 30)).toEqual([]);
    expect(run(new AutoDowngrade('high'), 22.5, 30)).toHaveLength(2); // medium, then low
    expect(run(new AutoDowngrade('high', { thresholdMs: 30 }), 28, 30)).toEqual([]);
  });

  it('is not fooled by one long stall (a hitch, a shader compile) in an otherwise fast window', () => {
    const monitor = new AutoDowngrade('high', { pixelRatio: 2 });
    run(monitor, 16, 2.5); // warm-up
    const changes: AutoChange[] = [];
    for (let i = 0; i < 180; i++) {
      const change = monitor.sample(i === 90 ? 2 : 0.016); // one two-second stall
      if (change) changes.push(change);
    }
    run(monitor, 16, 10);
    expect(changes).toEqual([]);
    expect(monitor.tier).toBe('high');
    expect(monitor.pixelRatio).toBe(2);
  });

  it('ignores the warm-up: slow frames before the game settles do not count', () => {
    const monitor = new AutoDowngrade('high', { pixelRatio: 2 });
    expect(run(monitor, 60, 1.9)).toEqual([]); // slow, but inside the 2 second warm-up
    expect(run(monitor, 16, 30)).toEqual([]);
    expect(monitor.tier).toBe('high');
    expect(monitor.pixelRatio).toBe(2);
  });

  it('ignores frame times that are not positive numbers', () => {
    const monitor = new AutoDowngrade('high');
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(monitor.sample(bad)).toBeNull();
    expect(run(monitor, 16, 30)).toEqual([]);
  });

  it('starts measuring again when the tier is set from outside, and keeps the resolution it has', () => {
    const monitor = new AutoDowngrade('high');
    run(monitor, 40, 4.9); // nearly through the first window
    monitor.setTier('high');
    expect(monitor.tier).toBe('high');
    expect(run(monitor, 40, 1.9)).toEqual([]); // warm-up again
    expect(labels(run(monitor, 40, 6))).toEqual(['medium']);
    monitor.setTier('low');
    expect(run(monitor, 60, 20)).toEqual([]); // nowhere lower to go

    const sharp = quick(2);
    windows(sharp, SLOW, 1);
    sharp.setTier('high');
    expect(sharp.pixelRatio).toBe(1.75);
    expect(windows(sharp, SLOW, 1)).toEqual([1.5]);
  });

  it('takes its numbers from the options', () => {
    const monitor = new AutoDowngrade('medium', { windowSeconds: 1, warmupSeconds: 0, thresholdMs: 10 });
    const changes = run(monitor, 15, 1.2);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.change).toEqual({ kind: 'tier', tier: 'low' });
    expect(changes[0]!.at).toBeLessThan(1.1);
  });
});
