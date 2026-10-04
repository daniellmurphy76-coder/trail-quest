import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LOOK } from '../../src/engine/look';
import { applyGlow, createPostPipeline, GLOW_GAIN, postConfig, removeGlow, restoreGlow, warmthGain, type GlowMaterial } from '../../src/engine/post';
import { QUALITY_TIERS } from '../../src/engine/quality';

describe('postConfig: which effects each tier runs', () => {
  it('high: ambient occlusion at full resolution, bloom, ACES, grade and SMAA', () => {
    expect(postConfig('high')).toEqual({
      composer: true,
      ao: true,
      aoHalfRes: false,
      aoQuality: 'Medium',
      bloom: true,
      bloomLevels: 7,
      toneMapping: true,
      grade: true,
      smaa: true,
    });
  });

  it('medium: ambient occlusion at half resolution with fewer samples, bloom, ACES, grade and SMAA', () => {
    expect(postConfig('medium')).toEqual({
      composer: true,
      ao: true,
      aoHalfRes: true,
      aoQuality: 'Performance',
      bloom: true,
      bloomLevels: 5,
      toneMapping: true,
      grade: true,
      smaa: true,
    });
  });

  it('low: no composer at all, so no ambient occlusion, bloom, grade or SMAA (the renderer does its own tone mapping)', () => {
    expect(postConfig('low')).toMatchObject({ composer: false, ao: false, aoHalfRes: false, bloom: false, toneMapping: false, grade: false, smaa: false });
  });

  it('turns tone mapping and the grade on exactly when the composer is on', () => {
    for (const tier of QUALITY_TIERS) {
      const c = postConfig(tier);
      expect(c.toneMapping).toBe(c.composer);
      expect(c.grade).toBe(c.composer);
    }
  });

  it('only runs effects inside a composer', () => {
    for (const tier of QUALITY_TIERS) {
      const c = postConfig(tier);
      if (!c.composer) expect([c.ao, c.bloom, c.smaa, c.aoHalfRes]).toEqual([false, false, false, false]);
    }
  });

  it('lets the look force half-resolution ambient occlusion on high, but never full resolution on medium', () => {
    expect(postConfig('high', { aoHalfRes: true }).aoHalfRes).toBe(true);
    expect(postConfig('high', { aoHalfRes: false }).aoHalfRes).toBe(false);
    expect(postConfig('medium', { aoHalfRes: false }).aoHalfRes).toBe(true);
    expect(postConfig('low', { aoHalfRes: true }).aoHalfRes).toBe(false); // there is no ambient occlusion to halve
  });

  it('gets cheaper down the tiers: no effect comes back on a lower tier', () => {
    const keys = ['ao', 'bloom', 'smaa'] as const;
    for (let i = 1; i < QUALITY_TIERS.length; i++) {
      const better = postConfig(QUALITY_TIERS[i - 1]!);
      const worse = postConfig(QUALITY_TIERS[i]!);
      for (const key of keys) if (!better[key]) expect(worse[key]).toBe(false);
    }
  });
});

describe('warmthGain', () => {
  it('is neutral at 0, warms red and cools blue when positive, and the reverse when negative', () => {
    expect(warmthGain(0)).toEqual([1, 1, 1]);
    const [r, g, b] = warmthGain(1);
    expect(r).toBeGreaterThan(1);
    expect(b).toBeLessThan(1);
    expect(Math.abs(g - 1)).toBeLessThan(Math.abs(r - 1)); // green barely moves
    const [rc, , bc] = warmthGain(-1);
    expect(rc).toBeLessThan(1);
    expect(bc).toBeGreaterThan(1);
  });

  it('is subtle at the default and stays positive at the extremes', () => {
    const [r, , b] = warmthGain(DEFAULT_LOOK.warmth);
    expect(r - 1).toBeLessThan(0.05);
    expect(1 - b).toBeLessThan(0.08);
    for (const w of [-1, 1]) for (const gain of warmthGain(w)) expect(gain).toBeGreaterThan(0.5);
  });
});

describe('glow: lifting unlit materials so only they bloom', () => {
  const flame = (): THREE.Mesh =>
    new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, toneMapped: false }),
    );
  const embers = (): THREE.Points => new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xffffff, toneMapped: false }));

  it('lifts flames and embers (unlit, not tone mapped) and nothing else', () => {
    const root = new THREE.Group();
    const f = flame();
    const e = embers();
    const lit = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    const unlitButMapped = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const sky = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial({ toneMapped: false }));
    const cloud = new THREE.Sprite(new THREE.SpriteMaterial({ toneMapped: false }));
    root.add(f, e, lit, unlitButMapped, sky, cloud);

    expect(applyGlow(root)).toBe(2);
    expect((f.material as THREE.MeshBasicMaterial).color.r).toBeCloseTo(GLOW_GAIN, 6);
    expect((e.material as THREE.PointsMaterial).color.r).toBeCloseTo(GLOW_GAIN, 6);
    expect((lit.material as THREE.MeshLambertMaterial).color.r).toBe(1);
    expect((unlitButMapped.material as THREE.MeshBasicMaterial).color.r).toBe(1);
    expect(cloud.material.color.r).toBe(1);
  });

  it('lifts a shared material once, however many meshes use it, and however many times it runs', () => {
    const shared = new THREE.MeshBasicMaterial({ color: 0x808080, toneMapped: false });
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BufferGeometry(), shared), new THREE.Mesh(new THREE.BufferGeometry(), shared));
    const before = shared.color.r;
    expect(applyGlow(root, 3)).toBe(1);
    expect(applyGlow(root, 3)).toBe(0);
    expect(shared.color.r).toBeCloseTo(before * 3, 6);
  });

  it('finds materials in arrays and deep in the tree', () => {
    const a = new THREE.MeshBasicMaterial({ toneMapped: false });
    const b = new THREE.MeshBasicMaterial({ toneMapped: false });
    const root = new THREE.Group();
    const inner = new THREE.Group();
    inner.add(new THREE.Mesh(new THREE.BufferGeometry(), [a, b]));
    root.add(inner);
    expect(applyGlow(root)).toBe(2);
  });

  it('puts the painted colors back exactly', () => {
    const root = new THREE.Group();
    const f = flame();
    (f.material as THREE.MeshBasicMaterial).color.setRGB(0.4, 0.7, 0.2);
    root.add(f);
    applyGlow(root);
    removeGlow(root);
    const color = (f.material as THREE.MeshBasicMaterial).color;
    expect([color.r, color.g, color.b]).toEqual([0.4, 0.7, 0.2]);
    expect(Object.keys((f.material as THREE.MeshBasicMaterial).userData)).toHaveLength(0);
    // And it can be lifted again afterwards.
    expect(applyGlow(root)).toBe(1);
    expect(color.r).toBeCloseTo(0.8, 6);
  });

  it('can put materials back after their zone has left the scene (zones are cached across travel)', () => {
    const lifted = new Set<GlowMaterial>();
    const zone = new THREE.Group();
    const f = flame();
    zone.add(f);
    const scene = new THREE.Group();
    scene.add(zone);
    expect(applyGlow(scene, 2, lifted)).toBe(1);
    scene.remove(zone); // the player travels away
    removeGlow(scene); // a scan of the scene no longer finds it...
    expect((f.material as THREE.MeshBasicMaterial).color.r).toBeCloseTo(2, 6);
    restoreGlow(lifted); // ...but the record does
    expect((f.material as THREE.MeshBasicMaterial).color.r).toBe(1);
    expect(Object.keys((f.material as THREE.MeshBasicMaterial).userData)).toHaveLength(0);
  });

  it('picks up materials added later (a zone swap)', () => {
    const root = new THREE.Group();
    expect(applyGlow(root)).toBe(0);
    root.add(flame());
    expect(applyGlow(root)).toBe(1);
  });
});

/** The smallest renderer the pipeline touches before it decides it cannot run. */
function fakeRenderer(overrides: Record<string, unknown> = {}): THREE.WebGLRenderer {
  const renderer = {
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1,
    autoClear: true,
    info: { autoReset: true, render: { calls: 41, triangles: 5300 }, reset: () => {} },
    extensions: { has: () => false },
    getContext: () => ({}),
    render: vi.fn(),
    ...overrides,
  };
  return renderer as unknown as THREE.WebGLRenderer;
}

describe('createPostPipeline without WebGL 2', () => {
  afterEach(() => vi.restoreAllMocks());

  it('draws the scene directly, with a single warning however many frames it draws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const renderer = fakeRenderer();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const post = createPostPipeline(renderer, scene, camera, DEFAULT_LOOK, 'high');
    expect(post.active).toBe(false);
    for (let i = 0; i < 5; i++) post.render(1 / 60);
    expect(renderer.render).toHaveBeenCalledTimes(5);
    expect(renderer.render).toHaveBeenCalledWith(scene, camera);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/WebGL 2/);
    post.setTier('medium'); // still cannot run, still only one warning for this pipeline
    post.render(1 / 60);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('leaves the renderer exactly as it found it', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const renderer = fakeRenderer();
    const post = createPostPipeline(renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), DEFAULT_LOOK, 'high');
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.autoClear).toBe(true);
    expect(renderer.info.autoReset).toBe(true);
    post.dispose();
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.autoClear).toBe(true);
  });

  it('keeps the exposure in step with the look even when drawing directly', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const renderer = fakeRenderer();
    const post = createPostPipeline(renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), DEFAULT_LOOK, 'high');
    expect(renderer.toneMappingExposure).toBe(DEFAULT_LOOK.exposure);
    post.setSettings({ exposure: 1.4 });
    expect(renderer.toneMappingExposure).toBe(1.4);
    post.setSettings({ exposure: Number.NaN });
    expect(renderer.toneMappingExposure).toBe(1.4);
  });

  it('survives a GL context that throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const renderer = fakeRenderer({
      getContext: () => {
        throw new Error('context lost');
      },
    });
    const post = createPostPipeline(renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), DEFAULT_LOOK, 'medium');
    expect(post.active).toBe(false);
    post.render(0.016);
    post.setSize(800, 600);
    post.dispose();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/context lost/);
  });

  it('reports the scene draw calls and no post cost when drawing directly', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const post = createPostPipeline(fakeRenderer(), new THREE.Scene(), new THREE.PerspectiveCamera(), DEFAULT_LOOK, 'high');
    post.render(0.016);
    expect(post.stats).toEqual({ calls: 41, triangles: 5300, postCalls: 0 });
  });

  it('on the low tier draws directly and says nothing: that is what the tier is for', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const renderer = fakeRenderer();
    const post = createPostPipeline(renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), DEFAULT_LOOK, 'low');
    expect(post.tier).toBe('low');
    expect(post.active).toBe(false);
    post.render(0.016);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('tracks the tier it was asked for', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const post = createPostPipeline(fakeRenderer(), new THREE.Scene(), new THREE.PerspectiveCamera(), DEFAULT_LOOK, 'high');
    expect(post.tier).toBe('high');
    post.setTier('medium');
    expect(post.tier).toBe('medium');
    post.setTier('low');
    expect(post.tier).toBe('low');
  });
});

/**
 * Decisions that only show up with a real GL context, pinned at the source so a later edit cannot
 * undo them without a test saying why.
 */
describe('post.ts decisions', () => {
  const source = readFileSync(new URL('../../src/engine/post.ts', import.meta.url), 'utf8');

  it('does ACES tone mapping itself and switches the renderer tone mapping off while it runs', () => {
    expect(source).toContain('ToneMappingMode.ACES_FILMIC');
    expect(source).toContain('renderer.toneMapping = THREE.NoToneMapping');
    expect(source).toContain('renderer.toneMapping = saved.toneMapping');
  });

  it('stops N8AO from scanning for transparent objects, which would draw the scene twice more every frame', () => {
    expect(source).toContain('ao.autoDetectTransparency = false');
    expect(source).toContain('ao.configuration.transparencyAware = false');
  });

  it('smooths with SMAA and no MSAA, and uses half-float buffers so bloom can see light above 1', () => {
    expect(source).toContain('multisampling: 0');
    expect(source).toContain('THREE.HalfFloatType');
    expect(source).toContain('new SMAAEffect');
  });

  it('adds bloom rather than screen-blending it into the HDR buffer', () => {
    expect(source).toContain('BlendFunction.ADD');
  });
});
