import type * as THREE from 'three';
import type { Controller, GUI } from 'lil-gui';
import { DEFAULT_LOOK, diffLook, type LookKey, type LookSettings, type LookStore } from './look';
import type { PostPipeline } from './post';
import { QUALITY_TIERS, type QualityTier } from './quality';

/**
 * Developer tools for tuning the look.
 *
 * - **Stats overlay**: FPS, frame time, draw calls and triangles from `renderer.info`, and the
 *   tier. On in development, and in production with `?stats=1` so the owner can check an iPad.
 *   Small enough to ship; it sits above the joystick at the bottom left, clear of the HUD.
 * - **Look panel** (lil-gui): every `LookSettings` value as a live control, plus "Copy settings"
 *   (the values that differ from the defaults, as JSON on the clipboard and in the console) and
 *   "Reset". Development builds only. lil-gui is loaded with a dynamic import behind
 *   `import.meta.env.DEV`, which a production build replaces with `false`, so the import and the
 *   library are removed from `dist`. `?dev=look` also asks for the panel, but a production build
 *   has no panel to show (it says so in the console).
 *
 * Nothing in here touches the game: it reads `renderer.info` and writes to the `LookStore`.
 */

// ---- flags ------------------------------------------------------------------------------------

export interface DevtoolsFlags {
  /** Show the stats overlay. */
  stats: boolean;
  /** Ask for the look panel (only a development build can honor this). */
  lookPanel: boolean;
}

/**
 * What the address bar and the build ask for. The stats overlay is on in development unless
 * `?stats=0`, and on anywhere with `?stats=1`. The look panel is on in development, or with `?dev=look`.
 */
export function parseDevtoolsFlags(search: string, dev: boolean): DevtoolsFlags {
  const params = new URLSearchParams(search);
  const stats = params.get('stats');
  return {
    stats: dev ? stats !== '0' : stats === '1',
    lookPanel: dev || params.get('dev') === 'look',
  };
}

// ---- stats ------------------------------------------------------------------------------------

export interface StatsSnapshot {
  fps: number;
  /** Average frame time over the interval, in milliseconds. */
  frameMs: number;
  /** The slowest frame in the interval, in milliseconds. */
  worstMs: number;
}

/** Averages frame times over short intervals, so the numbers are readable instead of flickering. */
export class StatsMeter {
  private frames = 0;
  private time = 0;
  private worst = 0;

  constructor(private readonly intervalSeconds = 0.5) {}

  /** One frame took `dt` seconds. Returns a snapshot when an interval has just closed, else null. */
  push(dt: number): StatsSnapshot | null {
    if (!(dt > 0) || !Number.isFinite(dt)) return null;
    this.frames++;
    this.time += dt;
    this.worst = Math.max(this.worst, dt);
    if (this.time < this.intervalSeconds) return null;
    const snapshot = { fps: this.frames / this.time, frameMs: (1000 * this.time) / this.frames, worstMs: this.worst * 1000 };
    this.frames = 0;
    this.time = 0;
    this.worst = 0;
    return snapshot;
  }
}

export interface StatsReadout extends StatsSnapshot {
  calls: number;
  triangles: number;
  /** Draw calls spent on post effects, on top of `calls`. */
  postCalls: number;
  tier: QualityTier;
  /** True while the post pipeline is drawing. */
  post: boolean;
}

/** 950 -> "950", 61300 -> "61.3k", 1250000 -> "1.25M". */
export function formatCount(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 2 : 1).replace(/\.?0+$/, '')}k`;
  return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
}

/** The overlay's text, one string per line. */
export function formatStats(r: StatsReadout): string[] {
  const post = r.post ? ` (+${r.postCalls} post)` : '';
  return [
    `${Math.round(r.fps)} fps  ${r.frameMs.toFixed(1)} ms  (worst ${r.worstMs.toFixed(0)})`,
    `${r.calls} calls${post}  ${formatCount(r.triangles)} tris`,
    `tier ${r.tier}${r.post ? '' : '  (no post)'}`,
  ];
}

function createStatsOverlay(host: HTMLElement, read: () => Omit<StatsReadout, keyof StatsSnapshot>): { frame(dt: number): void; dispose(): void } {
  const el = document.createElement('div');
  el.className = 'tq-stats';
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'fixed',
    left: 'calc(12px + env(safe-area-inset-left, 0px))',
    // Above the virtual joystick's resting ring (120px tall, 24px up), clear of the HUD card at the top.
    bottom: 'calc(160px + env(safe-area-inset-bottom, 0px))',
    zIndex: '9',
    padding: '4px 8px',
    borderRadius: '6px',
    background: 'rgba(0, 0, 0, 0.6)',
    color: '#fff',
    font: '12px/1.35 ui-monospace, Menlo, Consolas, monospace',
    whiteSpace: 'pre',
    pointerEvents: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  host.appendChild(el);

  const meter = new StatsMeter();
  return {
    frame(dt: number): void {
      const snapshot = meter.push(dt);
      if (!snapshot) return;
      el.textContent = formatStats({ ...snapshot, ...read() }).join('\n');
    },
    dispose(): void {
      el.remove();
    },
  };
}

// ---- panel layout -----------------------------------------------------------------------------

type KeysOf<V> = { [K in LookKey]: LookSettings[K] extends V ? K : never }[LookKey];
type NumberKey = KeysOf<number>;
type ColorKey = KeysOf<string>;
type BooleanKey = KeysOf<boolean>;

export type LookControl =
  | { kind: 'number'; key: NumberKey; folder: string; label: string; min: number; max: number; step: number }
  | { kind: 'color'; key: ColorKey; folder: string; label: string }
  | { kind: 'boolean'; key: BooleanKey; folder: string; label: string };

/** Every `LookSettings` key once, grouped for the panel. Ranges are wide enough to explore, not just nudge. */
export const LOOK_CONTROLS: readonly LookControl[] = [
  { kind: 'number', key: 'exposure', folder: 'Exposure and grade', label: 'exposure', min: 0.4, max: 2, step: 0.01 },
  { kind: 'number', key: 'saturation', folder: 'Exposure and grade', label: 'saturation', min: -1, max: 1, step: 0.01 },
  { kind: 'number', key: 'contrast', folder: 'Exposure and grade', label: 'contrast', min: -1, max: 1, step: 0.01 },
  { kind: 'number', key: 'warmth', folder: 'Exposure and grade', label: 'warmth', min: -1, max: 1, step: 0.01 },

  { kind: 'color', key: 'sunColor', folder: 'Sun', label: 'color' },
  { kind: 'number', key: 'sunIntensity', folder: 'Sun', label: 'intensity', min: 0, max: 8, step: 0.05 },
  { kind: 'number', key: 'sunAzimuth', folder: 'Sun', label: 'azimuth', min: 0, max: 360, step: 1 },
  { kind: 'number', key: 'sunElevation', folder: 'Sun', label: 'elevation', min: 5, max: 85, step: 1 },

  { kind: 'color', key: 'hemiSkyColor', folder: 'Sky light', label: 'hemisphere sky' },
  { kind: 'color', key: 'hemiGroundColor', folder: 'Sky light', label: 'hemisphere ground' },
  { kind: 'number', key: 'hemiIntensity', folder: 'Sky light', label: 'hemisphere', min: 0, max: 3, step: 0.01 },
  { kind: 'number', key: 'envIntensity', folder: 'Sky light', label: 'environment map', min: 0, max: 4, step: 0.01 },

  { kind: 'color', key: 'skyZenithColor', folder: 'Sky and fog', label: 'sky top' },
  { kind: 'color', key: 'fogColor', folder: 'Sky and fog', label: 'fog and horizon' },
  { kind: 'number', key: 'fogNear', folder: 'Sky and fog', label: 'fog near', min: 0, max: 200, step: 1 },
  { kind: 'number', key: 'fogFar', folder: 'Sky and fog', label: 'fog far', min: 20, max: 400, step: 1 },

  { kind: 'number', key: 'aoRadius', folder: 'Ambient occlusion', label: 'radius', min: 0.1, max: 4, step: 0.05 },
  { kind: 'number', key: 'aoIntensity', folder: 'Ambient occlusion', label: 'intensity', min: 0, max: 8, step: 0.1 },
  { kind: 'boolean', key: 'aoHalfRes', folder: 'Ambient occlusion', label: 'half resolution' },

  { kind: 'number', key: 'bloomThreshold', folder: 'Bloom', label: 'threshold', min: 0, max: 3, step: 0.01 },
  { kind: 'number', key: 'bloomIntensity', folder: 'Bloom', label: 'intensity', min: 0, max: 4, step: 0.01 },
  { kind: 'number', key: 'bloomRadius', folder: 'Bloom', label: 'radius', min: 0, max: 1, step: 0.01 },
];

/** The JSON "Copy settings" produces: only what differs from the defaults. */
export function changedSettingsJson(look: LookSettings): string {
  return JSON.stringify(diffLook(DEFAULT_LOOK, look), null, 2);
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Not a secure page (a dev server opened by LAN address) or no permission: use the fallback.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    Object.assign(area.style, { position: 'fixed', opacity: '0', pointerEvents: 'none' });
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

// ---- the panel (development builds only) --------------------------------------------------------

type PanelState = LookSettings & { tier: QualityTier };

async function openLookPanel(options: DevtoolsOptions): Promise<{ dispose(): void } | null> {
  // The one place lil-gui is loaded. A production build replaces `import.meta.env.DEV` with
  // `false`, removing this branch, the import in it, and with them the whole library.
  if (!import.meta.env.DEV) return null;
  const { default: LilGui } = await import('lil-gui');

  const { look } = options;
  const state: PanelState = { ...look.get(), tier: options.tier.get() };
  const gui: GUI = new LilGui({ title: 'Look (dev)', width: 280 });
  // Typing a number must not walk the Scout.
  for (const type of ['keydown', 'keyup']) gui.domElement.addEventListener(type, (event) => event.stopPropagation());

  const controllers: Controller[] = [];
  const folders = new Map<string, GUI>();
  for (const control of LOOK_CONTROLS) {
    let folder = folders.get(control.folder);
    if (!folder) {
      folder = gui.addFolder(control.folder);
      if (folders.size > 0) folder.close();
      folders.set(control.folder, folder);
    }
    const controller =
      control.kind === 'number'
        ? folder.add(state, control.key, control.min, control.max, control.step)
        : control.kind === 'color'
          ? folder.addColor(state, control.key)
          : folder.add(state, control.key);
    controller.name(control.label).onChange((value: unknown) => {
      look.set({ [control.key]: value } as Partial<LookSettings>);
    });
    controllers.push(controller);
  }

  const quality = gui.addFolder('Quality');
  quality.close();
  controllers.push(
    quality
      .add(state, 'tier', [...QUALITY_TIERS])
      .name('tier (draws as the iPad would)')
      .onChange((value: QualityTier) => options.tier.set(value)),
  );

  const actions = {
    copy: async (): Promise<void> => {
      const json = changedSettingsJson(look.get());
      console.log('[look] changed from the defaults:\n' + json);
      const ok = await copyToClipboard(json);
      copyButton.name(ok ? 'Copied' : 'Copy failed (see console)');
      setTimeout(() => copyButton.name('Copy settings'), 1500);
    },
    reset: (): void => {
      look.reset();
    },
  };
  const copyButton = gui.add(actions, 'copy').name('Copy settings');
  gui.add(actions, 'reset').name('Reset');

  // Keep the controls honest when the look changes from somewhere else (the console, Reset).
  const stop = look.subscribe((next) => {
    Object.assign(state, next);
    for (const controller of controllers) controller.updateDisplay();
  });

  return {
    dispose(): void {
      stop();
      gui.destroy();
    },
  };
}

// ---- entry point -------------------------------------------------------------------------------

export interface DevtoolsOptions {
  renderer: THREE.WebGLRenderer;
  /** The HUD layer; the stats overlay goes in here. */
  ui: HTMLElement;
  look: LookStore;
  post: PostPipeline;
  /** The quality tier in use, and how to change it (the panel's tier control). */
  tier: { get(): QualityTier; set(tier: QualityTier): void };
  /** Defaults to the address bar. */
  search?: string;
  /** Defaults to `import.meta.env.DEV`. */
  dev?: boolean;
}

export interface Devtools {
  /** Call once per drawn frame, after drawing, with the frame time in seconds. */
  frame(dt: number): void;
  dispose(): void;
}

export function initDevtools(options: DevtoolsOptions): Devtools {
  const dev = options.dev ?? import.meta.env.DEV;
  const flags = parseDevtoolsFlags(options.search ?? window.location.search, dev);

  const stats = flags.stats
    ? createStatsOverlay(options.ui, () => ({
        calls: options.renderer.info.render.calls,
        triangles: options.renderer.info.render.triangles,
        postCalls: options.post.stats.postCalls,
        tier: options.post.tier,
        post: options.post.active,
      }))
    : null;

  let panel: { dispose(): void } | null = null;
  let disposed = false;
  if (flags.lookPanel) {
    if (!import.meta.env.DEV) {
      console.info('The look panel is only in development builds (npm run dev). Use ?stats=1 for the frame counter.');
    } else {
      openLookPanel(options)
        .then((opened) => {
          if (disposed) opened?.dispose();
          else panel = opened;
        })
        .catch((err: unknown) => console.warn('The look panel could not open.', err));
    }
  }

  return {
    frame(dt: number): void {
      stats?.frame(dt);
    },
    dispose(): void {
      disposed = true;
      stats?.dispose();
      panel?.dispose();
      panel = null;
    },
  };
}
