import * as THREE from 'three';

export interface LabelOptions {
  text: string;
  /** World position to follow. Read live every frame, so it may be a moving object's position. */
  position: THREE.Vector3;
  /** Lift the label this many world units above `position`. */
  offsetY?: number;
  /** Shift on screen by this many pixels after projecting (negative is up). Stacks a prompt over a name tag. */
  screenOffsetY?: number;
  /** Extra CSS class, for example `tq-prompt`. */
  className?: string;
  /** Hide when farther than this many world units from the camera. Default: never. */
  maxDistance?: number;
}

/** One DOM label tied to a world position. */
export class WorldLabel {
  readonly element: HTMLDivElement;
  readonly position: THREE.Vector3;
  offsetY: number;
  screenOffsetY: number;
  maxDistance: number;
  /** Set false to hide the label regardless of where it is on screen. */
  visible = true;

  private shown = false;
  private lastTransform = '';

  constructor(options: LabelOptions) {
    this.element = document.createElement('div');
    this.element.className = options.className ? `tq-label ${options.className}` : 'tq-label';
    this.element.textContent = options.text;
    this.position = options.position;
    this.offsetY = options.offsetY ?? 0;
    this.screenOffsetY = options.screenOffsetY ?? 0;
    this.maxDistance = options.maxDistance ?? Infinity;
    this.element.style.display = 'none';
  }

  setText(text: string): void {
    if (this.element.textContent !== text) this.element.textContent = text;
  }

  /** @internal Called by WorldLabels each render. */
  place(screenX: number, screenY: number, onScreen: boolean): void {
    const show = this.visible && onScreen;
    if (show !== this.shown) {
      this.shown = show;
      this.element.style.display = show ? '' : 'none';
    }
    if (!show) return;
    const transform = `translate(${screenX.toFixed(1)}px, ${screenY.toFixed(1)}px) translate(-50%, -100%)`;
    if (transform !== this.lastTransform) {
      this.lastTransform = transform;
      this.element.style.transform = transform;
    }
  }
}

/**
 * Name tags and prompts that follow world positions. Call `update` once per rendered frame,
 * after the camera has moved. Labels behind the camera are hidden.
 */
export class WorldLabels {
  private readonly container: HTMLDivElement;
  private readonly labels = new Set<WorldLabel>();
  private readonly tmp = new THREE.Vector3();

  constructor(
    host: HTMLElement,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    this.container = document.createElement('div');
    this.container.className = 'tq-labels';
    host.appendChild(this.container);
  }

  add(options: LabelOptions): WorldLabel {
    const label = new WorldLabel(options);
    this.labels.add(label);
    this.container.appendChild(label.element);
    return label;
  }

  remove(label: WorldLabel): void {
    if (this.labels.delete(label)) label.element.remove();
  }

  /** Project every label to the screen. `width` and `height` are the canvas size in CSS pixels. */
  update(width: number, height: number): void {
    this.camera.updateMatrixWorld();
    const view = this.camera.matrixWorldInverse;
    const projection = this.camera.projectionMatrix;
    const near = this.camera.near;

    for (const label of this.labels) {
      const v = this.tmp.copy(label.position);
      v.y += label.offsetY;
      v.applyMatrix4(view); // camera space: the camera looks down -z
      const depth = -v.z;
      if (depth <= near || depth > label.maxDistance) {
        label.place(0, 0, false);
        continue;
      }
      v.applyMatrix4(projection); // normalized device coordinates, -1..1
      const onScreen = v.x > -1.2 && v.x < 1.2 && v.y > -1.2 && v.y < 1.2;
      label.place(
        (v.x * 0.5 + 0.5) * width,
        (-v.y * 0.5 + 0.5) * height + label.screenOffsetY,
        onScreen,
      );
    }
  }

  dispose(): void {
    this.labels.clear();
    this.container.remove();
  }
}
