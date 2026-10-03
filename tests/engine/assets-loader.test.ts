import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetLibrary, parseManifest } from '../../src/engine/assets';

const GOOD_MANIFEST = {
  version: 1,
  models: {
    'tree.test': { path: 'assets/models/none/tree.glb', pack: 'none', scale: 1, yOffset: 0 },
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('AssetLibrary (no GLBs are loaded here)', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('does nothing when disabled', async () => {
    const fetchManifest = vi.fn();
    const lib = new AssetLibrary({ enabled: false, fetchManifest });
    await lib.load(['tree.test']);
    expect(fetchManifest).not.toHaveBeenCalled();
    expect(lib.has('tree.test')).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('is off by default under Vitest', () => {
    expect(new AssetLibrary().enabled).toBe(false);
  });

  it('reads the manifest from BASE_URL once and warns once if it is missing', async () => {
    const fetchManifest = vi.fn(async () => jsonResponse({}, 404));
    const lib = new AssetLibrary({ enabled: true, baseUrl: '/trail-quest/', fetchManifest });
    await lib.load(['tree.test']);
    await lib.load(['rock.test', 'tree.test']);
    expect(fetchManifest).toHaveBeenCalledTimes(1);
    expect(fetchManifest).toHaveBeenCalledWith('/trail-quest/assets/manifest.json');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(lib.has('tree.test')).toBe(false);
  });

  it('warns once per id that is not in the manifest', async () => {
    const fetchManifest = vi.fn(async () => jsonResponse(GOOD_MANIFEST));
    const lib = new AssetLibrary({ enabled: true, fetchManifest });
    await lib.load(['nope.one', 'nope.one']);
    await lib.load(['nope.one']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(lib.has('nope.one')).toBe(false);
  });

  it('warns once when the manifest request itself fails', async () => {
    const fetchManifest = vi.fn(async () => {
      throw new TypeError('offline');
    });
    const lib = new AssetLibrary({ enabled: true, fetchManifest });
    await expect(lib.load(['tree.test'])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('gives callers safe answers for models that are not loaded', () => {
    const lib = new AssetLibrary({ enabled: false });
    expect(lib.has('tree.test')).toBe(false);
    expect(lib.clips('tree.test')).toEqual([]);
    expect(lib.clip('tree.test', 'idle')).toBeUndefined();
    expect(lib.instanced('tree.test', 4)).toBeUndefined();
    expect(lib.animator('tree.test', {} as never)).toBeUndefined();
    expect(() => lib.instance('tree.test')).toThrow(/not loaded/);
  });
});

describe('parseManifest', () => {
  it('accepts a good manifest and copies animations', () => {
    const parsed = parseManifest({
      version: 1,
      models: { 'character.test': { path: 'a.glb', pack: 'p', scale: 2, yOffset: 0, animations: { idle: 'idle' } } },
    });
    expect(parsed.models['character.test']?.animations).toEqual({ idle: 'idle' });
  });

  it('rejects bad shapes with a readable message', () => {
    expect(() => parseManifest(null)).toThrow(/not an object/);
    expect(() => parseManifest({ version: 2, models: {} })).toThrow(/version/);
    expect(() => parseManifest({ version: 1 })).toThrow(/no models/);
    expect(() => parseManifest({ version: 1, models: { x: { pack: 'p', scale: 1, yOffset: 0 } } })).toThrow(/no path/);
    expect(() => parseManifest({ version: 1, models: { x: { path: 'a', pack: 'p', scale: 0, yOffset: 0 } } })).toThrow(/scale/);
  });
});
