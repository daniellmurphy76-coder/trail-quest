import * as THREE from 'three';

/** Owns the WebGLRenderer: sizing, pixel ratio, and teardown. */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  private w = 1;
  private h = 1;
  private dirty = true;
  private readonly resizeListeners: Array<(width: number, height: number) => void> = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true });
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

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.dirty) this.applySize();
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
