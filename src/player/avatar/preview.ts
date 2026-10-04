/**
 * A small 3D stage for the avatar editor: its own WebGL renderer on a canvas, a studio light (a
 * warm key and a soft fill from the camera's side, plus a sky light) so a face turned to the camera
 * reads, the Scout on a round patch of grass that turns slowly, and drag to turn it.
 * Owns everything it makes; `dispose()` frees the rig, the lights, and the GL context.
 *
 * `createAvatarPreview` returns null when WebGL is not available (or the canvas cannot make a
 * context), so the editor can still work without a picture.
 */
import * as THREE from 'three';
import type { RankId } from '../../activities/types';
import type { AvatarConfig } from '../../save/types';
import { buildAvatar } from './rig';

export interface AvatarPreview {
  /** Show a new look. */
  setConfig(config: AvatarConfig): void;
  /** Turn the Scout by `radians` (a Turn button, or a drag). */
  turn(radians: number): void;
  /** Re-measure the canvas. Called by a ResizeObserver; call it yourself after a layout change. */
  resize(): void;
  /** Stop drawing and free the renderer, the rig and the stage. */
  dispose(): void;
}

export interface AvatarPreviewOptions {
  rank?: RankId;
}

const FOV = 28;
const LOOK_AT_Y = 0.98;
/** The figure and its pose fit inside this box (width, height), so the camera backs off to match. */
const FIT_WIDTH = 1.9;
const FIT_HEIGHT = 2.5;
const SPIN_SPEED = 0.7; // radians per second
const DRAG_TURN = 0.012; // radians per pixel
const START_YAW = 0.55;
const STAGE_CENTER = new THREE.Vector3(0, 0.9, 0);
const LIGHT_DISTANCE = 8;

/**
 * The stage lights. The camera sits on +z and the Scout's face is +z at yaw 0, so both direct lights
 * shine from the camera's side, high and to either hand: a face turned to the camera gets the key
 * at about 0.72 and the fill at about 0.76 (the old side sun gave 0.37). The key (front, high, left)
 * keeps the shadow; the fill (front, low, right) is cool and soft and never shadows. Between them
 * the face is lit at every turn that shows it to the camera. The sky light is warm below, not green.
 */
export const PREVIEW_KEY_DIRECTION = new THREE.Vector3(-0.35, 0.6, 0.72).normalize();
export const PREVIEW_FILL_DIRECTION = new THREE.Vector3(0.6, 0.25, 0.75).normalize();

export interface PreviewLights {
  hemisphere: THREE.HemisphereLight;
  key: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
}

/** The three lights of the stage, not yet in a scene (add the two directional lights and their targets). */
export function createPreviewLights(): PreviewLights {
  const hemisphere = new THREE.HemisphereLight(0xcfe3f5, 0xb8a68c, 1.1);

  const key = new THREE.DirectionalLight(0xfff1d6, 2.6);
  key.position.copy(PREVIEW_KEY_DIRECTION).multiplyScalar(LIGHT_DISTANCE).add(STAGE_CENTER);
  key.target.position.copy(STAGE_CENTER);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -2;
  key.shadow.camera.right = 2;
  key.shadow.camera.top = 2.5;
  key.shadow.camera.bottom = -2;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 20;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.03;

  const fill = new THREE.DirectionalLight(0xdfe9ff, 0.7);
  fill.position.copy(PREVIEW_FILL_DIRECTION).multiplyScalar(LIGHT_DISTANCE).add(STAGE_CENTER);
  fill.target.position.copy(STAGE_CENTER);
  fill.castShadow = false;

  return { hemisphere, key, fill };
}

export function createAvatarPreview(
  canvas: HTMLCanvasElement,
  config: AvatarConfig,
  options: AvatarPreviewOptions = {},
): AvatarPreview | null {
  const attributes = { antialias: true, alpha: true };
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try {
    gl = (canvas.getContext('webgl2', attributes) ?? canvas.getContext('webgl', attributes)) as
      | WebGLRenderingContext
      | WebGL2RenderingContext
      | null;
  } catch {
    gl = null;
  }
  if (!gl) return null;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true, alpha: true });
  } catch {
    return null;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const reducedMotion =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

  const scene = new THREE.Scene();
  const { hemisphere, key, fill } = createPreviewLights();
  scene.add(hemisphere, key, key.target, fill, fill.target);

  const podiumGeometry = new THREE.CylinderGeometry(1.15, 1.25, 0.14, 28);
  const podiumMaterial = new THREE.MeshLambertMaterial({ color: 0x6aa84f, flatShading: true });
  const podium = new THREE.Mesh(podiumGeometry, podiumMaterial);
  podium.position.y = -0.07;
  podium.receiveShadow = true;
  scene.add(podium);

  const rig = buildAvatar(config, { rank: options.rank, blobShadow: false });
  let yaw = START_YAW;
  rig.root.rotation.y = yaw;
  scene.add(rig.root);
  if (!reducedMotion) rig.play('wave'); // a hello when the editor opens

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 40);

  let width = 0;
  let height = 0;
  const fitCamera = (): void => {
    const half = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const distance = Math.max(FIT_HEIGHT / (2 * half), FIT_WIDTH / (2 * half * camera.aspect));
    camera.position.set(0, LOOK_AT_Y + 0.4, distance);
    camera.lookAt(0, LOOK_AT_Y, 0);
    camera.updateProjectionMatrix();
  };
  const resize = (): void => {
    const w = Math.max(1, Math.round(canvas.clientWidth || 320));
    const h = Math.max(1, Math.round(canvas.clientHeight || 320));
    if (w === width && h === height) return;
    width = w;
    height = h;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    fitCamera();
  };
  resize();

  // Drag to turn.
  let dragging = false;
  let lastX = 0;
  const onDown = (event: PointerEvent): void => {
    dragging = true;
    lastX = event.clientX;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Not every browser (or test DOM) can capture; dragging still works while the pointer is over the canvas.
    }
  };
  const onMove = (event: PointerEvent): void => {
    if (!dragging) return;
    yaw += (event.clientX - lastX) * DRAG_TURN;
    lastX = event.clientX;
  };
  const onUp = (): void => {
    dragging = false;
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  observer?.observe(canvas);

  let frame = 0;
  let last = typeof performance !== 'undefined' ? performance.now() : 0;
  let disposed = false;
  const tick = (now: number): void => {
    if (disposed) return;
    frame = requestAnimationFrame(tick);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (!dragging && !reducedMotion) yaw += dt * SPIN_SPEED;
    rig.root.rotation.y = yaw;
    rig.update(dt, { moving: false, speed: 0 });
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(tick);

  return {
    setConfig(next) {
      rig.setConfig(next);
    },
    turn(radians) {
      yaw += radians;
    },
    resize,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      rig.dispose();
      podiumGeometry.dispose();
      podiumMaterial.dispose();
      key.dispose();
      fill.dispose();
      hemisphere.dispose();
      renderer.dispose();
      // Browsers allow only a few live GL contexts (iPad Safari the fewest), so let this one go now.
      if (typeof renderer.forceContextLoss === 'function') renderer.forceContextLoss();
    },
  };
}
