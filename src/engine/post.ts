import * as THREE from 'three';
import { N8AOPostPass } from 'n8ao';
import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import { DEFAULT_LOOK, mergeLook, type LookSettings } from './look';
import { qualitySettings, type AoQuality, type QualityTier } from './quality';

/**
 * The post-processing pipeline: what turns the lit scene into the picture.
 *
 *   scene (half-float, linear)  ->  N8AO ambient occlusion  ->  one effect pass:
 *       bloom, ACES filmic tone mapping, saturation, contrast and warmth grade  ->  SMAA
 *
 * - **Ambient occlusion** (N8AO) gives objects soft contact shadows where they meet the ground
 *   and each other. The radius is small, so only contacts darken; trees, tents and the Scout stop
 *   looking pasted on. It is applied to the whole frame, so keep the intensity moderate.
 * - **Bloom** works on linear luminance before tone mapping, with a threshold of 1. Sunlit
 *   surfaces stay under 1 (white canvas reaches about 0.8), so only the things that are lit from
 *   inside glow: the campfire flame, embers, fireflies, lantern globes. Flames, embers and
 *   fireflies are unlit materials painted at 1 or less, so `applyGlow` lifts them to HDR while the
 *   pipeline runs (and `removeGlow` puts them back).
 * - **Tone mapping** is ACES, done here as an effect. The renderer's own tone mapping is turned
 *   off while the pipeline runs (postprocessing's guidance) and restored when it stops. Sky, fog
 *   and clouds are tone mapped like everything else, which is what makes the horizon match.
 * - **Grade** is a light touch after tone mapping: a little saturation, contrast and warmth.
 * - **SMAA** replaces the screen's MSAA, which does not work with ambient occlusion.
 *
 * Which of these run is decided per tier by `postConfig`, a pure function. If the device cannot
 * run the pipeline (no WebGL 2, no half-float targets, or a context error) the scene is drawn
 * directly and one warning is logged.
 */

// ---- pure configuration -------------------------------------------------------------------------

/** Which parts of the pipeline are on. Pure, so it can be tested without WebGL. */
export interface PostConfig {
  /** False: no composer at all. The renderer draws straight to the screen with its own ACES. */
  composer: boolean;
  ao: boolean;
  /** Occlusion at half resolution (the tier says so, or the look's `aoHalfRes` forces it). */
  aoHalfRes: boolean;
  aoQuality: AoQuality;
  bloom: boolean;
  bloomLevels: number;
  /** ACES filmic tone mapping as the last effect. On whenever the composer is. */
  toneMapping: boolean;
  /** The warm saturation, contrast and warmth grade. On whenever the composer is. */
  grade: boolean;
  smaa: boolean;
}

export function postConfig(tier: QualityTier, look: Pick<LookSettings, 'aoHalfRes'> = DEFAULT_LOOK): PostConfig {
  const f = qualitySettings(tier).post;
  return {
    composer: f.enabled,
    ao: f.enabled && f.ao,
    aoHalfRes: f.enabled && f.ao && (f.aoHalfRes || look.aoHalfRes),
    aoQuality: f.aoQuality,
    bloom: f.enabled && f.bloom,
    bloomLevels: f.bloomLevels,
    toneMapping: f.enabled,
    grade: f.enabled,
    smaa: f.enabled && f.smaa,
  };
}

/** Per-channel gain for the warmth knob: -1 is cool, 0 neutral, 1 warm. Red and blue move, green barely. */
export function warmthGain(warmth: number): [number, number, number] {
  return [1 + 0.08 * warmth, 1 + 0.01 * warmth, 1 - 0.12 * warmth];
}

// ---- glow ---------------------------------------------------------------------------------------

/** How far unlit glowing materials are lifted above their painted color while bloom is on. */
export const GLOW_GAIN = 2;
const GLOW_BASE_KEY = 'tqGlowBase';
const GLOW_RESCAN_SECONDS = 2;

export type GlowMaterial = THREE.MeshBasicMaterial | THREE.PointsMaterial;

function glowMaterialsIn(root: THREE.Object3D): Set<GlowMaterial> {
  const found = new Set<GlowMaterial>();
  root.traverse((object) => {
    const target = object as THREE.Mesh & THREE.Points;
    if (!target.isMesh && !target.isPoints) return;
    const list = Array.isArray(target.material) ? target.material : [target.material];
    for (const material of list) {
      const m = material as THREE.MeshBasicMaterial & THREE.PointsMaterial;
      if ((m.isMeshBasicMaterial || m.isPointsMaterial) && m.toneMapped === false) found.add(m);
    }
  });
  return found;
}

/**
 * Lift every unlit, not-tone-mapped material (campfire flames, embers, fireflies) by `gain`, once
 * each, remembering the painted color. Every material lifted is added to `lifted` when given, so
 * the caller can put it back later even if its zone has left the scene. Returns how many were
 * lifted this call.
 */
export function applyGlow(root: THREE.Object3D, gain: number = GLOW_GAIN, lifted?: Set<GlowMaterial>): number {
  let count = 0;
  for (const m of glowMaterialsIn(root)) {
    if (m.userData[GLOW_BASE_KEY]) continue;
    m.userData[GLOW_BASE_KEY] = m.color.toArray();
    m.color.multiplyScalar(gain);
    lifted?.add(m);
    count++;
  }
  return count;
}

/** Put the painted colors back on these materials (the ones `applyGlow` lifted). */
export function restoreGlow(materials: Iterable<GlowMaterial>): void {
  for (const m of materials) {
    const base = m.userData[GLOW_BASE_KEY] as number[] | undefined;
    if (!base) continue;
    m.color.fromArray(base);
    delete m.userData[GLOW_BASE_KEY];
  }
}

/** Put the painted colors back on everything `applyGlow` lifted under `root`. */
export function removeGlow(root: THREE.Object3D): void {
  restoreGlow(glowMaterialsIn(root));
}

/** Changes when something is added to or removed from the scene root (a zone swap). */
function sceneFingerprint(scene: THREE.Object3D): number {
  let h = scene.children.length;
  for (const child of scene.children) h = (Math.imul(h, 31) + child.id) | 0;
  return h;
}

// ---- grade effect -------------------------------------------------------------------------------

/**
 * Warmth and contrast on the tone mapped image. Warmth is a per-channel gain in linear light.
 * Contrast works in a gamma 2.2 space and pivots on mid grey, so it spreads shadows and
 * highlights without changing the overall exposure.
 */
const GRADE_FRAGMENT = /* glsl */ `
  uniform vec3 uWarmth;
  uniform float uContrast;
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 c = max(inputColor.rgb * uWarmth, vec3(0.0));
    vec3 g = pow(c, vec3(1.0 / 2.2));
    g = (g - 0.5) * (1.0 + uContrast) + 0.5;
    outputColor = vec4(pow(clamp(g, 0.0, 1.0), vec3(2.2)), inputColor.a);
  }
`;

class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', GRADE_FRAGMENT, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['uWarmth', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['uContrast', new THREE.Uniform(0)],
      ]),
    });
  }

  set(contrast: number, warmth: number): void {
    (this.uniforms.get('uContrast') as THREE.Uniform<number>).value = contrast;
    const [r, g, b] = warmthGain(warmth);
    (this.uniforms.get('uWarmth') as THREE.Uniform<THREE.Vector3>).value.set(r, g, b);
  }
}

// ---- the pipeline -------------------------------------------------------------------------------

/** Draw calls and triangles of the last frame. `calls` and `triangles` are the scene alone (what the budget counts). */
export interface PostStats {
  calls: number;
  triangles: number;
  /** Extra draw calls spent on post effects (ambient occlusion, bloom, tone mapping, SMAA). */
  postCalls: number;
}

export interface PostPipeline {
  /** The tier in use. */
  readonly tier: QualityTier;
  /** True while the composer is drawing; false when the scene is drawn directly. */
  readonly active: boolean;
  readonly stats: Readonly<PostStats>;
  /** Draw one frame. `dt` is the frame time in seconds. */
  render(dt: number): void;
  /** CSS pixel size of the surface; the renderer has already been resized. */
  setSize(width: number, height: number): void;
  /** Change the look. Only the values this pipeline uses matter; invalid values are ignored. */
  setSettings(partial: Partial<LookSettings>): void;
  /** Rebuild for another tier (an automatic downgrade, or the developer panel). */
  setTier(tier: QualityTier): void;
  /** Stop, give the renderer back its own tone mapping, and free every buffer. */
  dispose(): void;
}

/** A render pass that tells us when the scene itself has been drawn, to split scene from post cost. */
class SceneRenderPass extends RenderPass {
  onRendered: (() => void) | null = null;

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget | null,
    outputBuffer: THREE.WebGLRenderTarget | null,
    deltaTime?: number,
    stencilTest?: boolean,
  ): void {
    super.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest);
    this.onRendered?.();
  }
}

interface Rig {
  composer: EffectComposer;
  ao: N8AOPostPass | null;
  bloom: BloomEffect | null;
  saturation: HueSaturationEffect;
  grade: GradeEffect;
  scenePass: SceneRenderPass;
}

/** Why the pipeline cannot run on this renderer, or null when it can. */
function unsupportedReason(renderer: THREE.WebGLRenderer): string | null {
  try {
    const gl = renderer.getContext();
    if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) return 'WebGL 2 is not available';
    const has = (name: string): boolean => renderer.extensions.has(name);
    if (!has('EXT_color_buffer_float') && !has('EXT_color_buffer_half_float')) return 'half-float render targets are not available';
    return null;
  } catch (err) {
    return `the GL context could not be read (${String(err)})`;
  }
}

export function createPostPipeline(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  settings: LookSettings,
  tier: QualityTier,
): PostPipeline {
  let look = mergeLook(DEFAULT_LOOK, settings);
  let currentTier = tier;
  let config = postConfig(currentTier, look);
  let rig: Rig | null = null;
  let warned = false;

  // What the renderer looked like before the composer took it over, to give back on teardown.
  const saved = { toneMapping: renderer.toneMapping, autoClear: renderer.autoClear, infoAutoReset: renderer.info.autoReset };

  const stats: PostStats = { calls: 0, triangles: 0, postCalls: 0 };
  let sceneCalls = 0;
  let sceneTriangles = 0;

  const size = new THREE.Vector2();
  let bufferWidth = 0;
  let bufferHeight = 0;

  let glowFingerprint = 0;
  let glowTimer = 0;
  /** Everything lifted, so it can all be put back even if its zone is out of the scene by then. */
  const lifted = new Set<GlowMaterial>();

  const warnOnce = (reason: string): void => {
    if (warned) return;
    warned = true;
    console.warn(`Post-processing is off (${reason}); drawing the scene directly.`);
  };

  const applyToRig = (): void => {
    renderer.toneMappingExposure = look.exposure;
    if (!rig) return;
    const { ao, bloom, saturation, grade } = rig;
    if (ao) {
      ao.configuration.aoRadius = look.aoRadius;
      ao.configuration.intensity = look.aoIntensity;
      ao.configuration.halfRes = config.aoHalfRes;
    }
    if (bloom) {
      bloom.luminanceMaterial.threshold = look.bloomThreshold;
      bloom.intensity = look.bloomIntensity;
      bloom.mipmapBlurPass.radius = look.bloomRadius;
    }
    saturation.saturation = look.saturation;
    grade.set(look.contrast, look.warmth);
  };

  const buildRig = (): Rig | null => {
    if (!config.composer) return null;
    const reason = unsupportedReason(renderer);
    if (reason) {
      warnOnce(reason);
      return null;
    }
    try {
      renderer.getDrawingBufferSize(size);
      // Half-float frame buffers hold light above 1 for bloom and tone mapping. No MSAA: it does
      // not work with ambient occlusion, so SMAA does the smoothing instead.
      const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
      const scenePass = new SceneRenderPass(scene, camera);
      scenePass.onRendered = () => {
        sceneCalls = renderer.info.render.calls;
        sceneTriangles = renderer.info.render.triangles;
      };
      composer.addPass(scenePass);

      let ao: N8AOPostPass | null = null;
      if (config.ao) {
        ao = new N8AOPostPass(scene, camera, size.x, size.y);
        ao.setQualityMode(config.aoQuality);
        ao.configuration.distanceFalloff = 1;
        // N8AO scans the scene for transparent things every frame and, finding the clouds,
        // flames and blob shadows, would draw the whole scene twice more. They do not write depth,
        // so they should not occlude anything anyway: switch the scan off.
        ao.configuration.transparencyAware = false;
        ao.autoDetectTransparency = false;
        composer.addPass(ao);
      }

      const effects: Effect[] = [];
      let bloom: BloomEffect | null = null;
      if (config.bloom) {
        bloom = new BloomEffect({
          // Add, not screen: the buffer holds light above 1, and screen blending turns over there.
          blendFunction: BlendFunction.ADD,
          luminanceThreshold: look.bloomThreshold,
          luminanceSmoothing: 0.2,
          mipmapBlur: true,
          intensity: look.bloomIntensity,
          radius: look.bloomRadius,
          levels: config.bloomLevels,
        });
        effects.push(bloom);
      }
      effects.push(new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }));
      const saturation = new HueSaturationEffect({ blendFunction: BlendFunction.SRC, hue: 0, saturation: look.saturation });
      const grade = new GradeEffect();
      effects.push(saturation, grade);
      const mainPass = new EffectPass(camera, ...effects);
      composer.addPass(mainPass);

      let lastPass = mainPass;
      if (config.smaa) {
        lastPass = new EffectPass(camera, new SMAAEffect({ preset: currentTier === 'high' ? SMAAPreset.HIGH : SMAAPreset.MEDIUM }));
        composer.addPass(lastPass);
      }
      lastPass.dithering = true; // the sky is a long smooth gradient; 8-bit output would band it

      // The composer does its own tone mapping and clearing, and counts draw calls by hand.
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.info.autoReset = false;

      bufferWidth = 0;
      bufferHeight = 0;
      return { composer, ao, bloom, saturation, grade, scenePass };
    } catch (err) {
      renderer.toneMapping = saved.toneMapping;
      renderer.autoClear = saved.autoClear;
      renderer.info.autoReset = saved.infoAutoReset;
      warnOnce(`could not build it: ${String(err)}`);
      return null;
    }
  };

  const teardown = (): void => {
    restoreGlow(lifted);
    lifted.clear();
    if (rig) {
      try {
        rig.composer.dispose();
      } catch (err) {
        console.warn('Post-processing teardown failed.', err);
      }
      rig = null;
    }
    renderer.toneMapping = saved.toneMapping;
    renderer.autoClear = saved.autoClear;
    renderer.info.autoReset = saved.infoAutoReset;
  };

  const start = (): void => {
    rig = buildRig();
    glowFingerprint = 0;
    glowTimer = GLOW_RESCAN_SECONDS;
    applyToRig();
  };

  /** Re-fit the buffers when the drawing buffer changed without a resize event (a pixel ratio change). */
  const syncBuffers = (): void => {
    if (!rig) return;
    renderer.getDrawingBufferSize(size);
    if (size.x === bufferWidth && size.y === bufferHeight) return;
    bufferWidth = size.x;
    bufferHeight = size.y;
    renderer.getSize(size);
    rig.composer.setSize(size.x, size.y, false);
  };

  const syncGlow = (dt: number): void => {
    if (!config.bloom) return;
    glowTimer += dt;
    const fingerprint = sceneFingerprint(scene);
    if (fingerprint === glowFingerprint && glowTimer < GLOW_RESCAN_SECONDS) return;
    glowFingerprint = fingerprint;
    glowTimer = 0;
    applyGlow(scene, GLOW_GAIN, lifted);
  };

  const direct = (): void => {
    renderer.render(scene, camera);
    const info = renderer.info.render;
    stats.calls = info.calls;
    stats.triangles = info.triangles;
    stats.postCalls = 0;
  };

  const drawComposed = (dt: number): void => {
    if (!rig) return;
    syncBuffers();
    syncGlow(dt);
    const info = renderer.info;
    info.reset();
    rig.composer.render(dt);
    // `renderer.info` is what the draw-call budget (and the browser checks) read: leave it showing
    // the scene alone, and keep the post cost in `stats`.
    stats.postCalls = info.render.calls - sceneCalls;
    info.render.calls = sceneCalls;
    info.render.triangles = sceneTriangles;
    stats.calls = sceneCalls;
    stats.triangles = sceneTriangles;
  };

  start();

  return {
    get tier() {
      return currentTier;
    },
    get active() {
      return rig !== null;
    },
    stats,
    render(dt: number): void {
      if (!rig) {
        direct();
        return;
      }
      try {
        drawComposed(dt);
      } catch (err) {
        // The first frames are where a broken context or a shader that will not link shows up.
        teardown();
        warnOnce(`it failed while drawing: ${String(err)}`);
        direct();
      }
    },
    setSize(width: number, height: number): void {
      if (!rig) return;
      rig.composer.setSize(width, height, false);
      renderer.getDrawingBufferSize(size);
      bufferWidth = size.x;
      bufferHeight = size.y;
    },
    setSettings(partial: Partial<LookSettings>): void {
      look = mergeLook(look, partial);
      config = postConfig(currentTier, look);
      applyToRig();
    },
    setTier(next: QualityTier): void {
      if (next === currentTier) return;
      teardown();
      currentTier = next;
      config = postConfig(currentTier, look);
      start();
    },
    dispose(): void {
      teardown();
    },
  };
}
