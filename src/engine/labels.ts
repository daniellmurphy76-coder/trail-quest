import * as THREE from 'three';
import {
  estimateLabelSize,
  labelFontSize,
  layoutLabels,
  type LabelInput,
  type LabelPlacement,
  type Rect,
} from './label-layout';

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
  /**
   * Never hidden for being crowded and never faded by distance. For the interact prompt, the
   * objective arrow and the pickup and marker names: things the player has to be able to find.
   */
  priority?: boolean;
}

/** A place name to hang in the world (a zone's `labels`). */
export interface PlaceLabelData {
  text: string;
  position: THREE.Vector3;
}

/** One DOM label tied to a world position. */
export class WorldLabel {
  readonly element: HTMLDivElement;
  readonly position: THREE.Vector3;
  offsetY: number;
  screenOffsetY: number;
  maxDistance: number;
  priority: boolean;
  /** Set false to hide the label regardless of where it is on screen. */
  visible = true;

  /** The size of the label box in pixels. Cached: measured again only when the text or type size changes. */
  width = 0;
  height = 0;
  /** What the layout decided last frame (null before the first one). */
  placement: LabelPlacement | null = null;
  /** @internal The size is stale: text or type size changed, or the last measure was only a guess. */
  sizeStale = true;
  /** @internal The size came from the page, not from a guess. */
  measured = false;

  private shown = false;
  private lastTransform = '';
  private lastOpacity = '';

  constructor(options: LabelOptions) {
    this.element = document.createElement('div');
    this.element.className = options.className ? `tq-label ${options.className}` : 'tq-label';
    this.element.textContent = options.text;
    this.position = options.position;
    this.offsetY = options.offsetY ?? 0;
    this.screenOffsetY = options.screenOffsetY ?? 0;
    this.maxDistance = options.maxDistance ?? Infinity;
    this.priority = options.priority ?? false;
    this.element.classList.add('is-hidden');
    this.element.style.opacity = '0';
    this.lastOpacity = '0';
  }

  /** True while the label is on screen (the layout kept it and it is not faded out). */
  get isShown(): boolean {
    return this.shown;
  }

  setText(text: string): void {
    if (this.element.textContent === text) return;
    this.element.textContent = text;
    this.sizeStale = true;
  }

  /** @internal Read the box size from the page, or guess it from the text where the page cannot say. */
  measure(fontPx: number): void {
    const width = this.element.offsetWidth;
    const height = this.element.offsetHeight;
    this.measured = width > 0 && height > 0;
    if (this.measured) {
      this.width = width;
      this.height = height;
    } else {
      const guess = estimateLabelSize(this.element.textContent ?? '', fontPx);
      this.width = guess.width;
      this.height = guess.height;
    }
    this.sizeStale = false;
  }

  /** @internal Called by WorldLabels each frame with what the layout decided. */
  apply(placement: LabelPlacement): void {
    this.placement = placement;
    if (!placement.visible) {
      if (!this.shown) return;
      this.shown = false;
      this.element.style.opacity = '0'; // fades out; the class then hides it for good (see style.css)
      this.lastOpacity = '0';
      this.element.classList.add('is-hidden');
      return;
    }
    const transform = `translate(${placement.left.toFixed(1)}px, ${placement.top.toFixed(1)}px)`;
    if (transform !== this.lastTransform) {
      this.lastTransform = transform;
      this.element.style.transform = transform;
    }
    const opacity = placement.opacity.toFixed(2);
    if (opacity !== this.lastOpacity) {
      this.lastOpacity = opacity;
      this.element.style.opacity = opacity;
    }
    if (!this.shown) {
      this.shown = true;
      this.element.classList.remove('is-hidden');
    }
  }
}

/** The page parts that cover the world: a label under one of these is hard to read, so it moves clear. */
const OBSTACLE_SELECTOR = '.tq-hud, .tq-compass, .tq-world-panel, .tq-dock, .tq-joy.is-rest, .tq-action';
/** How often the HUD boxes are measured again (they change as screens and panels come and go). */
const REMEASURE_SECONDS = 0.5;

/**
 * Name tags, place names and prompts that follow world positions. Call `update` once per rendered
 * frame, after the camera has moved. Where each label lands is decided by `layoutLabels`: it keeps
 * a readable type size at any distance, fades far labels, stays on screen, steers clear of the HUD
 * and of other labels. The work per frame is projection and box math; the page is read only when a
 * label's text changes and every half second (HUD boxes), never once per label per frame.
 */
export class WorldLabels {
  private readonly container: HTMLDivElement;
  private readonly list: WorldLabel[] = [];
  private readonly places: WorldLabel[] = [];
  private readonly inputs: LabelInput[] = [];
  private readonly tmp = new THREE.Vector3();
  private obstacles: Rect[] = [];
  private fontPx = 0;
  private lastMeasure = -Infinity;
  private lastWidth = 0;
  private lastHeight = 0;
  private stale = true;
  private readonly onResize = (): void => {
    this.stale = true;
  };

  constructor(
    private readonly host: HTMLElement,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    this.container = document.createElement('div');
    this.container.className = 'tq-labels';
    host.appendChild(this.container);
    this.applyFontSize();
    window.addEventListener('resize', this.onResize);
  }

  add(options: LabelOptions): WorldLabel {
    const label = new WorldLabel(options);
    this.list.push(label);
    this.container.appendChild(label.element);
    return label;
  }

  remove(label: WorldLabel): void {
    const at = this.list.indexOf(label);
    if (at < 0) return;
    this.list.splice(at, 1);
    label.element.remove();
  }

  /** Replace the place names (a zone's `labels`). An empty list clears them. */
  setPlaceLabels(places: readonly PlaceLabelData[]): void {
    for (const label of this.places) this.remove(label);
    this.places.length = 0;
    for (const place of places) {
      this.places.push(this.add({ text: place.text, position: place.position, className: 'tq-place' }));
    }
  }

  /** Measure the HUD boxes and the type size again now (also done every half second and on resize). */
  remeasure(): void {
    this.lastMeasure = performance.now();
    this.stale = false;
    this.applyFontSize();
    const origin = this.container.getBoundingClientRect();
    this.obstacles = [];
    for (const element of this.host.querySelectorAll(OBSTACLE_SELECTOR)) {
      const r = element.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue; // hidden or not drawn
      this.obstacles.push({
        left: r.left - origin.left,
        top: r.top - origin.top,
        right: r.right - origin.left,
        bottom: r.bottom - origin.top,
      });
    }
    // A label whose size was only a guess gets another chance to be measured.
    for (const label of this.list) if (!label.measured) label.sizeStale = true;
  }

  /** Project every label to the screen and lay them out. `width` and `height` are the canvas size in CSS pixels. */
  update(width: number, height: number): void {
    const resized = width !== this.lastWidth || height !== this.lastHeight;
    this.lastWidth = width;
    this.lastHeight = height;
    if (this.stale || resized || performance.now() - this.lastMeasure >= REMEASURE_SECONDS * 1000) this.remeasure();

    this.camera.updateMatrixWorld();
    const view = this.camera.matrixWorldInverse;
    const projection = this.camera.projectionMatrix;
    const near = this.camera.near;
    const list = this.list;
    this.inputs.length = list.length;

    for (let i = 0; i < list.length; i++) {
      const label = list[i]!;
      const input = (this.inputs[i] ??= { x: 0, y: 0, width: 0, height: 0, distance: 0 });
      input.priority = label.priority;
      input.previous = label.placement;
      input.hidden = !label.visible;
      if (input.hidden) continue;

      const v = this.tmp.copy(label.position);
      v.y += label.offsetY;
      v.applyMatrix4(view); // camera space: the camera looks down -z
      const depth = -v.z;
      input.distance = depth;
      if (depth <= near || depth > label.maxDistance) {
        input.hidden = true;
        continue;
      }
      v.applyMatrix4(projection); // normalized device coordinates, -1..1
      input.x = (v.x * 0.5 + 0.5) * width;
      input.y = (-v.y * 0.5 + 0.5) * height;
      input.shiftY = label.screenOffsetY;
      if (label.sizeStale) label.measure(this.fontPx);
      input.width = label.width;
      input.height = label.height;
    }

    const placements = layoutLabels(this.inputs, { width, height }, this.obstacles);
    for (let i = 0; i < list.length; i++) list[i]!.apply(placements[i]!);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.list.length = 0;
    this.places.length = 0;
    this.container.remove();
  }

  /** The type size follows the screen: bigger on touch. Labels are measured again when it changes. */
  private applyFontSize(): void {
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    const px = labelFontSize(coarse);
    if (px === this.fontPx) return;
    this.fontPx = px;
    this.container.style.setProperty('--tq-label-size', `${px}px`);
    for (const label of this.list) label.sizeStale = true;
  }
}
