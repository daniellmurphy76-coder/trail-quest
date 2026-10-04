// @vitest-environment happy-dom
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  changedSettingsJson,
  formatCount,
  formatStats,
  initDevtools,
  LOOK_CONTROLS,
  parseDevtoolsFlags,
  StatsMeter,
} from '../../src/engine/devtools';
import { createLookStore, DEFAULT_LOOK, LOOK_KEYS, mergeLook } from '../../src/engine/look';
import type { PostPipeline } from '../../src/engine/post';

describe('parseDevtoolsFlags', () => {
  it('in development: stats and the panel are on, and ?stats=0 hides the stats', () => {
    expect(parseDevtoolsFlags('', true)).toEqual({ stats: true, lookPanel: true });
    expect(parseDevtoolsFlags('?stats=0', true)).toEqual({ stats: false, lookPanel: true });
  });

  it('in production: nothing is on, except stats with ?stats=1, and the panel is only asked for with ?dev=look', () => {
    expect(parseDevtoolsFlags('', false)).toEqual({ stats: false, lookPanel: false });
    expect(parseDevtoolsFlags('?stats=1', false)).toEqual({ stats: true, lookPanel: false });
    expect(parseDevtoolsFlags('?stats=true', false).stats).toBe(false);
    expect(parseDevtoolsFlags('?dev=look', false)).toEqual({ stats: false, lookPanel: true });
    expect(parseDevtoolsFlags('?dev=other', false).lookPanel).toBe(false);
    expect(parseDevtoolsFlags('?quality=low&stats=1&dev=look', false)).toEqual({ stats: true, lookPanel: true });
  });
});

describe('StatsMeter', () => {
  it('reports once per interval, with the average frame time and the worst frame', () => {
    const meter = new StatsMeter(0.5);
    let snapshot = null;
    for (let i = 0; i < 29; i++) expect(meter.push(1 / 60)).toBeNull();
    for (let i = 0; i < 5 && !snapshot; i++) snapshot = meter.push(1 / 60);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.fps).toBeCloseTo(60, 0);
    expect(snapshot!.frameMs).toBeCloseTo(16.67, 1);
    expect(snapshot!.worstMs).toBeCloseTo(16.67, 1);
  });

  it('sees the worst frame and starts a fresh interval after each report', () => {
    const meter = new StatsMeter(0.1);
    expect(meter.push(0.01)).toBeNull();
    expect(meter.push(0.05)).toBeNull();
    const first = meter.push(0.04)!;
    expect(first.worstMs).toBeCloseTo(50, 6);
    expect(first.frameMs).toBeCloseTo(33.33, 1);
    const second = meter.push(0.2)!;
    expect(second.worstMs).toBeCloseTo(200, 6);
    expect(second.fps).toBeCloseTo(5, 6);
  });

  it('ignores frame times that are not positive numbers', () => {
    const meter = new StatsMeter(0.1);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(meter.push(bad)).toBeNull();
    expect(meter.push(0.2)!.fps).toBeCloseTo(5, 6);
  });
});

describe('formatting', () => {
  it('shortens counts', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(950)).toBe('950');
    expect(formatCount(1000)).toBe('1k');
    expect(formatCount(1250)).toBe('1.25k');
    expect(formatCount(61300)).toBe('61.3k');
    expect(formatCount(120000)).toBe('120k');
    expect(formatCount(1250000)).toBe('1.25M');
  });

  it('puts fps, frame time, draw calls, triangles and the tier on three lines', () => {
    const lines = formatStats({ fps: 59.6, frameMs: 16.78, worstMs: 21.4, calls: 42, triangles: 61300, postCalls: 18, tier: 'high', post: true });
    expect(lines).toEqual(['60 fps  16.8 ms  (worst 21)', '42 calls (+18 post)  61.3k tris', 'tier high']);
  });

  it('leaves out the post cost and flags it when the pipeline is not running', () => {
    const lines = formatStats({ fps: 30, frameMs: 33.3, worstMs: 40, calls: 40, triangles: 900, postCalls: 0, tier: 'low', post: false });
    expect(lines[1]).toBe('40 calls  900 tris');
    expect(lines[2]).toBe('tier low  (no post)');
  });
});

describe('the panel layout', () => {
  it('has a control for every look setting, exactly once', () => {
    const keys = LOOK_CONTROLS.map((c) => c.key);
    expect([...keys].sort()).toEqual([...LOOK_KEYS].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('matches each control to its value type, and every default sits inside its range', () => {
    for (const control of LOOK_CONTROLS) {
      const value = DEFAULT_LOOK[control.key];
      if (control.kind === 'number') {
        expect(typeof value).toBe('number');
        expect(control.min).toBeLessThan(control.max);
        expect(control.step).toBeGreaterThan(0);
        expect(value as number).toBeGreaterThanOrEqual(control.min);
        expect(value as number).toBeLessThanOrEqual(control.max);
      } else if (control.kind === 'color') {
        expect(typeof value).toBe('string');
      } else {
        expect(typeof value).toBe('boolean');
      }
    }
  });

  it('has a camera fill slider from 0 to 2 in the Sun folder', () => {
    const fill = LOOK_CONTROLS.find((c) => c.key === 'fillIntensity');
    expect(fill?.kind).toBe('number');
    if (fill?.kind !== 'number') return;
    expect(fill.folder).toBe('Sun');
    expect(fill.min).toBe(0);
    expect(fill.max).toBe(2);
    expect(DEFAULT_LOOK.fillIntensity).toBeGreaterThanOrEqual(fill.min);
    expect(DEFAULT_LOOK.fillIntensity).toBeLessThanOrEqual(fill.max);
  });

  it('has the sun glow sliders in the Sky and fog folder, with the defaults inside their ranges', () => {
    const strength = LOOK_CONTROLS.find((c) => c.key === 'sunGlow');
    const size = LOOK_CONTROLS.find((c) => c.key === 'sunGlowSize');
    for (const control of [strength, size]) {
      expect(control?.kind).toBe('number');
      if (control?.kind !== 'number') return;
      expect(control.folder).toBe('Sky and fog');
      expect(DEFAULT_LOOK[control.key]).toBeGreaterThanOrEqual(control.min);
      expect(DEFAULT_LOOK[control.key]).toBeLessThanOrEqual(control.max);
    }
    // Strength can be turned right off, and up to double. Size never reaches 0 (the shader divides by it).
    if (strength?.kind === 'number') expect([strength.min, strength.max]).toEqual([0, 2]);
    if (size?.kind === 'number') expect(size.min).toBeGreaterThan(0);
  });

  it('keeps the sun elevation off the zenith, where the shadow box has no horizontal axis', () => {
    const elevation = LOOK_CONTROLS.find((c) => c.key === 'sunElevation');
    expect(elevation?.kind === 'number' && elevation.max).toBeLessThan(90);
  });
});

describe('changedSettingsJson (Copy settings)', () => {
  it('is an empty object for the defaults', () => {
    expect(changedSettingsJson(DEFAULT_LOOK)).toBe('{}');
  });

  it('includes the sun glow settings when they are changed', () => {
    const tuned = mergeLook(DEFAULT_LOOK, { sunGlow: 0.5, sunGlowSize: 1.4 });
    expect(JSON.parse(changedSettingsJson(tuned))).toEqual({ sunGlow: 0.5, sunGlowSize: 1.4 });
  });

  it('holds only what changed, and pastes back into mergeLook', () => {
    const tuned = mergeLook(DEFAULT_LOOK, { exposure: 1.2, sunColor: '#ffeeaa', aoHalfRes: true, fillIntensity: 0.9 });
    const json = changedSettingsJson(tuned);
    expect(JSON.parse(json)).toEqual({ exposure: 1.2, sunColor: '#ffeeaa', aoHalfRes: true, fillIntensity: 0.9 });
    expect(mergeLook(DEFAULT_LOOK, JSON.parse(json))).toEqual(tuned);
  });
});

describe('initDevtools in a production build', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const options = (search: string, ui: HTMLElement) => ({
    renderer: { info: { render: { calls: 44, triangles: 61300 } } } as unknown as THREE.WebGLRenderer,
    ui,
    look: createLookStore(),
    post: { stats: { calls: 44, triangles: 61300, postCalls: 17 }, tier: 'medium', active: true } as unknown as PostPipeline,
    tier: { get: () => 'medium' as const, set: () => {} },
    search,
    dev: false,
  });

  it('shows nothing by default', () => {
    const ui = document.createElement('div');
    document.body.appendChild(ui);
    const tools = initDevtools(options('', ui));
    tools.frame(1);
    expect(ui.children).toHaveLength(0);
    expect(document.querySelector('.lil-gui')).toBeNull();
    tools.dispose();
  });

  it('shows the stats overlay with ?stats=1, and fills it in once an interval has passed', () => {
    const ui = document.createElement('div');
    document.body.appendChild(ui);
    const tools = initDevtools(options('?stats=1', ui));
    const overlay = ui.querySelector<HTMLElement>('.tq-stats')!;
    expect(overlay).not.toBeNull();
    expect(overlay.style.pointerEvents).toBe('none'); // never in the way of a tap
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
    for (let i = 0; i < 40; i++) tools.frame(1 / 60);
    expect(overlay.textContent).toContain('fps');
    expect(overlay.textContent).toContain('44 calls (+17 post)');
    expect(overlay.textContent).toContain('61.3k tris');
    expect(overlay.textContent).toContain('tier medium');
    tools.dispose();
    expect(ui.querySelector('.tq-stats')).toBeNull();
  });

  it('opens no look panel in production, even when ?stats=1 is on', () => {
    const ui = document.createElement('div');
    document.body.appendChild(ui);
    const tools = initDevtools(options('?stats=1', ui));
    expect(document.querySelector('.lil-gui')).toBeNull();
    tools.dispose();
  });
});

// ---- lil-gui must stay out of the production bundle ----------------------------------------------

const SRC = resolve(__dirname, '../../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs)$/.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });
}

/** The relative modules a file imports or re-exports, statically (type-only imports are erased and do not count). */
function staticImports(source: string): string[] {
  const found: string[] = [];
  const pattern = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
  for (const match of source.matchAll(pattern)) found.push(match[1]!);
  return found;
}

function resolveModule(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

describe('lil-gui stays out of production code paths', () => {
  const files = sourceFiles(SRC);

  it('is never imported statically by anything under src', () => {
    for (const file of files) {
      const imports = staticImports(readFileSync(file, 'utf8'));
      expect(imports.filter((spec) => spec === 'lil-gui' || spec.startsWith('lil-gui/')), relative(SRC, file)).toEqual([]);
    }
  });

  it('is not reachable from the production entry (src/main.ts) through static imports', () => {
    const seen = new Set<string>();
    const queue = [join(SRC, 'main.ts')];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of staticImports(readFileSync(file, 'utf8'))) {
        expect(spec, `${relative(SRC, file)} imports ${spec}`).not.toMatch(/^lil-gui/);
        if (spec.startsWith('.')) {
          const next = resolveModule(file, spec);
          if (next) queue.push(next);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(20); // the walk really did cross the app
    expect([...seen].some((f) => f.endsWith('devtools.ts'))).toBe(true); // the stats overlay ships; lil-gui does not
  });

  it('is only loaded by a dynamic import in devtools.ts, behind import.meta.env.DEV', () => {
    const loaders = files.filter((f) => /import\(\s*['"]lil-gui/.test(readFileSync(f, 'utf8')));
    expect(loaders.map((f) => relative(SRC, f).replace(/\\/g, '/'))).toEqual(['engine/devtools.ts']);
    const source = readFileSync(loaders[0]!, 'utf8');
    const guard = source.indexOf('if (!import.meta.env.DEV) return null;');
    const load = source.indexOf("import('lil-gui')");
    expect(guard).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(guard);
    // Same function: nothing that ends a function between the guard and the import.
    expect(source.slice(guard, load)).not.toMatch(/\n}\n/);
  });

  it('is a dev dependency, not a runtime one', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.dependencies['lil-gui']).toBeUndefined();
    expect(pkg.devDependencies['lil-gui']).toBeDefined();
    expect(pkg.dependencies['postprocessing']).toBeDefined();
    expect(pkg.dependencies['n8ao']).toBeDefined();
  });
});

describe('the console notice for ?dev=look outside development', () => {
  it('says the panel is development only (and does not try to open one)', () => {
    vi.stubEnv('DEV', false);
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const ui = document.createElement('div');
    const tools = initDevtools({
      renderer: { info: { render: { calls: 0, triangles: 0 } } } as unknown as THREE.WebGLRenderer,
      ui,
      look: createLookStore(),
      post: { stats: { calls: 0, triangles: 0, postCalls: 0 }, tier: 'high', active: true } as unknown as PostPipeline,
      tier: { get: () => 'high' as const, set: () => {} },
      search: '?dev=look',
      dev: false,
    });
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]![0])).toMatch(/development/);
    expect(document.querySelector('.lil-gui')).toBeNull();
    tools.dispose();
    info.mockRestore();
    vi.unstubAllEnvs();
  });
});

describe('the look panel in a development build', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  /** The lil-gui controller row whose label is `name` (labels are unique enough within one folder). */
  function row(name: string): HTMLElement {
    const rows = [...document.querySelectorAll<HTMLElement>('.lil-controller')];
    const found = rows.find((r) => r.querySelector('.lil-name')?.textContent === name);
    if (!found) throw new Error(`no control named ${name}`);
    return found;
  }

  async function openPanel() {
    const look = createLookStore();
    const tierSet = vi.fn();
    const tools = initDevtools({
      renderer: { info: { render: { calls: 0, triangles: 0 } } } as unknown as THREE.WebGLRenderer,
      ui: document.body,
      look,
      post: { stats: { calls: 0, triangles: 0, postCalls: 0 }, tier: 'high', active: true } as unknown as PostPipeline,
      tier: { get: () => 'high' as const, set: tierSet },
      search: '?stats=0',
      dev: true,
    });
    await vi.waitFor(() => expect(document.querySelector('.lil-gui.lil-root')).not.toBeNull());
    return { look, tierSet, tools };
  }

  it('opens with a labelled control for every setting, plus the tier, Copy settings and Reset', async () => {
    const { tools } = await openPanel();
    const labels = [...document.querySelectorAll('.lil-controller .lil-name')].map((n) => n.textContent);
    for (const control of LOOK_CONTROLS) expect(labels, control.label).toContain(control.label);
    expect(labels).toContain('tier (draws as the iPad would)');
    expect(labels).toContain('Copy settings');
    expect(labels).toContain('Reset');
    expect(document.querySelector('.tq-stats')).toBeNull(); // ?stats=0
    tools.dispose();
    expect(document.querySelector('.lil-gui')).toBeNull();
  });

  it('has the sun glow controls in the Sky and fog folder, and they drive the look', async () => {
    const { look, tools } = await openPanel();
    for (const label of ['sun glow', 'sun glow size']) {
      expect(row(label).closest('.lil-gui')?.querySelector('.lil-title')?.textContent, label).toBe('Sky and fog');
    }
    look.set({ sunGlow: 0.35 });
    expect(row('sun glow').querySelector('input')!.value).toBe('0.35');
    tools.dispose();
  });

  it('shows a change made from outside (the console) in its controls', async () => {
    const { look, tools } = await openPanel();
    look.set({ exposure: 1.37 });
    expect(row('exposure').querySelector('input')!.value).toBe('1.37');
    tools.dispose();
  });

  it('Reset puts the defaults back', async () => {
    const { look, tools } = await openPanel();
    look.set({ exposure: 1.5, fogNear: 5 });
    row('Reset').querySelector('button')!.click();
    expect(look.get()).toEqual(DEFAULT_LOOK);
    expect(row('exposure').querySelector('input')!.value).toBe(String(DEFAULT_LOOK.exposure));
    tools.dispose();
  });

  it('Copy settings puts only the changed values on the clipboard, as JSON, and logs them', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { look, tools } = await openPanel();
    look.set({ exposure: 1.3, sunColor: '#ffeecc', sunGlow: 0.6 });
    row('Copy settings').querySelector('button')!.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(JSON.parse(writeText.mock.calls[0]![0] as string)).toEqual({ exposure: 1.3, sunColor: '#ffeecc', sunGlow: 0.6 });
    expect(String(log.mock.calls[0]![0])).toContain('"exposure": 1.3');
    tools.dispose();
  });

  it('keeps typing in the panel away from the game (no walking while editing a number)', async () => {
    const { tools } = await openPanel();
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    row('exposure').querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
    expect(seen).not.toHaveBeenCalled();
    window.removeEventListener('keydown', seen);
    tools.dispose();
  });

  it('closes cleanly if the tools are disposed before the panel has loaded', async () => {
    const look = createLookStore();
    const tools = initDevtools({
      renderer: { info: { render: { calls: 0, triangles: 0 } } } as unknown as THREE.WebGLRenderer,
      ui: document.body,
      look,
      post: { stats: { calls: 0, triangles: 0, postCalls: 0 }, tier: 'high', active: true } as unknown as PostPipeline,
      tier: { get: () => 'high' as const, set: () => {} },
      search: '?stats=0',
      dev: true,
    });
    tools.dispose(); // the dynamic import has not resolved yet
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(document.querySelector('.lil-gui')).toBeNull();
  });
});
