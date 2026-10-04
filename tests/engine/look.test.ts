import { describe, expect, it, vi } from 'vitest';
import {
  createLookStore,
  DEFAULT_LOOK,
  diffLook,
  LOOK_KEYS,
  mergeLook,
  sunDirection,
  type LookSettings,
} from '../../src/engine/look';

describe('DEFAULT_LOOK', () => {
  it('has every setting the plan names', () => {
    for (const key of [
      'exposure',
      'sunColor',
      'sunIntensity',
      'sunAzimuth',
      'sunElevation',
      'fillIntensity',
      'hemiSkyColor',
      'hemiGroundColor',
      'hemiIntensity',
      'envIntensity',
      'fogColor',
      'fogNear',
      'fogFar',
      'sunGlow',
      'sunGlowSize',
      'aoRadius',
      'aoIntensity',
      'aoHalfRes',
      'bloomThreshold',
      'bloomIntensity',
      'bloomRadius',
      'saturation',
      'contrast',
      'warmth',
    ]) {
      expect(LOOK_KEYS).toContain(key);
    }
  });

  it('is made of finite numbers, #rrggbb colors and booleans, and is frozen', () => {
    expect(Object.isFrozen(DEFAULT_LOOK)).toBe(true);
    for (const key of LOOK_KEYS) {
      const value = DEFAULT_LOOK[key];
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
      else if (typeof value === 'string') expect(value).toMatch(/^#[0-9a-f]{6}$/);
      else expect(typeof value).toBe('boolean');
    }
  });

  it('has a gentle camera fill: lower than the sun, not zero', () => {
    expect(DEFAULT_LOOK.fillIntensity).toBe(0.6);
    expect(DEFAULT_LOOK.fillIntensity).toBeGreaterThan(0);
    expect(DEFAULT_LOOK.fillIntensity).toBeLessThan(DEFAULT_LOOK.sunIntensity / 2);
  });

  it('has a sun glow that reads clearly but softly: on at full strength and the standard size', () => {
    expect(DEFAULT_LOOK.sunGlow).toBe(1);
    expect(DEFAULT_LOOK.sunGlowSize).toBe(1);
  });

  it('is sensible: fog near before far, a high bloom threshold, small grade, a modest ambient occlusion reach', () => {
    expect(DEFAULT_LOOK.fogNear).toBeLessThan(DEFAULT_LOOK.fogFar);
    expect(DEFAULT_LOOK.exposure).toBeGreaterThan(0.5);
    expect(DEFAULT_LOOK.exposure).toBeLessThan(1.6);
    // Sunlit surfaces reach about 0.8 linear luminance; only emissive things should pass the threshold.
    expect(DEFAULT_LOOK.bloomThreshold).toBeGreaterThanOrEqual(0.9);
    for (const grade of [DEFAULT_LOOK.saturation, DEFAULT_LOOK.contrast, DEFAULT_LOOK.warmth]) {
      expect(Math.abs(grade)).toBeLessThanOrEqual(0.5); // subtle
    }
    expect(DEFAULT_LOOK.aoRadius).toBeLessThanOrEqual(2); // low-poly props: contacts only
    expect(DEFAULT_LOOK.aoHalfRes).toBe(false);
  });
});

describe('mergeLook', () => {
  it('lays valid values over the base without changing either argument', () => {
    const base: LookSettings = { ...DEFAULT_LOOK };
    const partial = { exposure: 1.4, sunColor: '#112233', aoHalfRes: true };
    const merged = mergeLook(base, partial);
    expect(merged).toEqual({ ...DEFAULT_LOOK, exposure: 1.4, sunColor: '#112233', aoHalfRes: true });
    expect(merged).not.toBe(base);
    expect(base).toEqual(DEFAULT_LOOK);
    expect(partial).toEqual({ exposure: 1.4, sunColor: '#112233', aoHalfRes: true });
  });

  it('returns a copy of the base for an empty, null or missing partial', () => {
    expect(mergeLook(DEFAULT_LOOK, {})).toEqual(DEFAULT_LOOK);
    expect(mergeLook(DEFAULT_LOOK, null)).toEqual(DEFAULT_LOOK);
    expect(mergeLook(DEFAULT_LOOK)).toEqual(DEFAULT_LOOK);
    expect(mergeLook(DEFAULT_LOOK, {})).not.toBe(DEFAULT_LOOK);
  });

  it('merges one value at a time, so merges compose', () => {
    const a = mergeLook(mergeLook(DEFAULT_LOOK, { fogNear: 10 }), { fogFar: 90 });
    expect(a).toEqual(mergeLook(DEFAULT_LOOK, { fogNear: 10, fogFar: 90 }));
  });

  it('ignores undefined, unknown keys, and the wrong type', () => {
    const merged = mergeLook(DEFAULT_LOOK, {
      exposure: undefined,
      bogus: 5,
      sunIntensity: '3' as unknown as number,
      aoHalfRes: 1 as unknown as boolean,
      sunColor: 7 as unknown as string,
    } as Partial<LookSettings>);
    expect(merged).toEqual(DEFAULT_LOOK);
    expect('bogus' in merged).toBe(false);
  });

  it('ignores numbers that are not finite', () => {
    const merged = mergeLook(DEFAULT_LOOK, { exposure: Number.NaN, fogFar: Number.POSITIVE_INFINITY, aoRadius: Number.NEGATIVE_INFINITY });
    expect(merged).toEqual(DEFAULT_LOOK);
  });

  it('accepts only #rrggbb colors, and lower-cases them', () => {
    expect(mergeLook(DEFAULT_LOOK, { fogColor: '#ABCDEF' }).fogColor).toBe('#abcdef');
    for (const bad of ['red', '#fff', '#12345', '#1234567', 'ffffff', '#gggggg', '']) {
      expect(mergeLook(DEFAULT_LOOK, { fogColor: bad }).fogColor).toBe(DEFAULT_LOOK.fogColor);
    }
  });

  it('accepts zero and negative numbers (they are values, not missing)', () => {
    const merged = mergeLook(DEFAULT_LOOK, { hemiIntensity: 0, warmth: -0.5 });
    expect(merged.hemiIntensity).toBe(0);
    expect(merged.warmth).toBe(-0.5);
  });

  it('takes the camera fill as a number, zero included, and ignores a bad one', () => {
    expect(mergeLook(DEFAULT_LOOK, { fillIntensity: 1.2 }).fillIntensity).toBe(1.2);
    expect(mergeLook(DEFAULT_LOOK, { fillIntensity: 0 }).fillIntensity).toBe(0);
    expect(mergeLook(DEFAULT_LOOK, { fillIntensity: Number.NaN }).fillIntensity).toBe(DEFAULT_LOOK.fillIntensity);
    expect(mergeLook(DEFAULT_LOOK, { fillIntensity: '1' as unknown as number }).fillIntensity).toBe(DEFAULT_LOOK.fillIntensity);
  });

  it('takes the sun glow settings as numbers, zero included, and ignores bad ones', () => {
    expect(mergeLook(DEFAULT_LOOK, { sunGlow: 1.6, sunGlowSize: 0.7 })).toMatchObject({ sunGlow: 1.6, sunGlowSize: 0.7 });
    expect(mergeLook(DEFAULT_LOOK, { sunGlow: 0 }).sunGlow).toBe(0);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '1' as unknown as number]) {
      const merged = mergeLook(DEFAULT_LOOK, { sunGlow: bad, sunGlowSize: bad });
      expect(merged.sunGlow).toBe(DEFAULT_LOOK.sunGlow);
      expect(merged.sunGlowSize).toBe(DEFAULT_LOOK.sunGlowSize);
    }
  });

  it('takes a JSON blob pasted back from Copy settings', () => {
    const copied = JSON.parse(JSON.stringify(diffLook(DEFAULT_LOOK, mergeLook(DEFAULT_LOOK, { exposure: 1.3, sunColor: '#ffeecc' })))) as Partial<LookSettings>;
    expect(mergeLook(DEFAULT_LOOK, copied)).toEqual(mergeLook(DEFAULT_LOOK, { exposure: 1.3, sunColor: '#ffeecc' }));
  });
});

describe('diffLook', () => {
  it('is empty for equal looks and lists only what changed', () => {
    expect(diffLook(DEFAULT_LOOK, { ...DEFAULT_LOOK })).toEqual({});
    const changed = mergeLook(DEFAULT_LOOK, { exposure: 1.4, aoHalfRes: true });
    expect(diffLook(DEFAULT_LOOK, changed)).toEqual({ exposure: 1.4, aoHalfRes: true });
    expect(diffLook(DEFAULT_LOOK, mergeLook(DEFAULT_LOOK, { sunGlow: 0.4 }))).toEqual({ sunGlow: 0.4 });
  });
});

describe('sunDirection', () => {
  const length = (v: readonly number[]): number => Math.hypot(...v);

  it('is a unit vector for any angles', () => {
    for (const azimuth of [0, 70, 180, 359]) {
      for (const elevation of [0, 20, 38, 90]) {
        expect(length(sunDirection({ sunAzimuth: azimuth, sunElevation: elevation }))).toBeCloseTo(1, 12);
      }
    }
  });

  it('turns from +z toward +x and climbs with the elevation', () => {
    const [x0, y0, z0] = sunDirection({ sunAzimuth: 0, sunElevation: 0 });
    expect([x0, y0, z0].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0, 0, 1]);
    const [x1, , z1] = sunDirection({ sunAzimuth: 90, sunElevation: 0 });
    expect(x1).toBeCloseTo(1, 9);
    expect(z1).toBeCloseTo(0, 9);
    expect(sunDirection({ sunAzimuth: 33, sunElevation: 90 })[1]).toBeCloseTo(1, 9);
    expect(sunDirection({ sunAzimuth: 0, sunElevation: 30 })[1]).toBeCloseTo(0.5, 9);
  });

  it('puts the default sun above the horizon on the +x side, so shadows fall toward -x', () => {
    const [x, y, z] = sunDirection(DEFAULT_LOOK);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0.4);
    expect(y).toBeLessThan(0.8);
    expect(z).toBeGreaterThan(0);
  });
});

describe('createLookStore', () => {
  it('starts at the defaults, or at defaults with overrides', () => {
    expect(createLookStore().get()).toEqual(DEFAULT_LOOK);
    expect(createLookStore({ exposure: 0.9 }).get()).toEqual(mergeLook(DEFAULT_LOOK, { exposure: 0.9 }));
  });

  it('sets, tells the listeners what changed, and stops when they unsubscribe', () => {
    const store = createLookStore();
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    const next = store.set({ exposure: 1.3, bogus: 1 } as Partial<LookSettings>);
    expect(next.exposure).toBe(1.3);
    expect(store.get()).toBe(next);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(next, { exposure: 1.3 });
    stop();
    store.set({ exposure: 1.1 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify when nothing changed', () => {
    const store = createLookStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({});
    store.set({ exposure: DEFAULT_LOOK.exposure });
    store.set({ exposure: Number.NaN });
    store.reset();
    expect(listener).not.toHaveBeenCalled();
  });

  it('resets to the defaults and notifies once', () => {
    const store = createLookStore();
    store.set({ exposure: 1.5, fogNear: 5 });
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.reset()).toEqual(DEFAULT_LOOK);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![1]).toEqual({ exposure: DEFAULT_LOOK.exposure, fogNear: DEFAULT_LOOK.fogNear });
  });

  it('survives a listener that unsubscribes itself while being called', () => {
    const store = createLookStore();
    const calls: string[] = [];
    const stopA = store.subscribe(() => {
      calls.push('a');
      stopA();
    });
    store.subscribe(() => calls.push('b'));
    store.set({ exposure: 1.2 });
    store.set({ exposure: 1.3 });
    expect(calls).toEqual(['a', 'b', 'b']);
  });
});
