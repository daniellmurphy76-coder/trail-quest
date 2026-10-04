import * as THREE from 'three';
import { DEFAULT_LOOK, type LookSettings } from './look';

/**
 * Owns the WebGLRenderer: tone mapping, shadows, sizing, pixel ratio, and teardown.
 *
 * Tone mapping is ACES with the exposure from the look. That is what draws the scene on its own
 * (the `low` tier, or when the post pipeline cannot run). While the post pipeline is active it
 * switches the renderer's tone mapping off and does ACES itself as the last effect, then puts it
 * back when it stops; see post.ts.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  private w = 1;
  private h = 1;
  private dirty = true;
  private readonly resizeListeners: Array<(width: number, height: number) => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    look: Pick<LookSettings, 'exposure'> = DEFAULT_LOOK,
  ) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true });
    // Filmic tone mapping and sRGB output give the flat Lambert palette some depth.
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = look.exposure;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    // Soft sun shadows. PCFSoftShadowMap was removed in Three r186 (it logs a warning and falls back),
    // and PCFShadowMap is now the soft, hardware-filtered one, so ask for that directly.
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    window.addEventListener('resize', this.markDirty);
    window.addEventListener('orientationchange', this.markDirty);
    // iPad Safari: the visual viewport changes when the toolbar shows or hides.
    window.visualViewport?.addEventListener('resize', this.markDirty);
    this.applySize();
  }

  /** CSS pixel size of the drawing surface. */
  get width(): number {
    return this.w;
  }
  get height(): number {
    return this.h;
  }

  /** Called with the new CSS size whenever the surface changes, before the next render. */
  onResize(listener: (width: number, height: number) => void): void {
    this.resizeListeners.push(listener);
    listener(this.w, this.h);
  }

  /** Follow the look: the exposure used by the renderer's own tone mapping. */
  applyLook(look: Pick<LookSettings, 'exposure'>): void {
    this.gl.toneMappingExposure = look.exposure;
  }

  /**
   * Apply a pending resize (a window resize, an iPad toolbar change). `render` does this for you;
   * call it yourself once per frame when something else draws, such as the post pipeline.
   */
  beginFrame(): void {
    if (this.dirty) this.applySize();
  }

  /** Draw the scene straight to the screen. */
  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.beginFrame();
    this.gl.render(scene, camera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.markDirty);
    window.removeEventListener('orientationchange', this.markDirty);
    window.visualViewport?.removeEventListener('resize', this.markDirty);
    this.resizeListeners.length = 0;
    this.gl.dispose();
  }

  private readonly markDirty = (): void => {
    this.dirty = true;
  };

  private applySize(): void {
    this.dirty = false;
    const vv = window.visualViewport;
    const w = Math.max(1, Math.round(this.canvas.clientWidth || vv?.width || window.innerWidth));
    const h = Math.max(1, Math.round(this.canvas.clientHeight || vv?.height || window.innerHeight));
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.gl.setSize(w, h, false);
    if (w === this.w && h === this.h && this.resizeListeners.length > 0) return;
    this.w = w;
    this.h = h;
    for (const listener of this.resizeListeners) listener(w, h);
  }
}
