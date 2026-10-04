// @vitest-environment happy-dom
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { estimateLabelSize, NUDGE_GAP, OVERLAP_GAP } from '../../src/engine/label-layout';
import { WorldLabels, type WorldLabel } from '../../src/engine/labels';
import { createZone, ZONE_IDS } from '../../src/world/zones';

const W = 1280;
const H = 720;

let host: HTMLElement;
let labels: WorldLabels;
let camera: THREE.PerspectiveCamera;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  // Looking down -z from z = 10: a world point on the axis lands in the middle of the screen.
  camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 200);
  camera.position.set(0, 0, 10);
  labels = new WorldLabels(host, camera);
});

afterEach(() => {
  labels.dispose();
  host.remove();
  vi.restoreAllMocks();
});

/** A label on the camera axis, `distance` units in front of the camera. */
function onAxis(text: string, distance: number, extra: Partial<Parameters<WorldLabels['add']>[0]> = {}): WorldLabel {
  return labels.add({ text, position: new THREE.Vector3(0, 0, 10 - distance), ...extra });
}

const hiddenClass = (label: WorldLabel): boolean => label.element.classList.contains('is-hidden');
const container = (): HTMLElement => host.querySelector('.tq-labels')!;

describe('WorldLabels: place labels from zone data', () => {
  const deps = { onTalkToDenChief: vi.fn(), onReturnToBaseCamp: vi.fn() };

  it('shows every place name a zone carries as a DOM label', () => {
    for (const id of ZONE_IDS.filter((z) => z !== 'base-camp')) {
      const zone = createZone(id, deps);
      labels.setPlaceLabels(zone.labels ?? []);
      const shown = [...container().querySelectorAll('.tq-label.tq-place')].map((e) => e.textContent);
      expect(shown, id).toEqual((zone.labels ?? []).map((l) => l.text));
      expect(shown.length, id).toBeGreaterThan(0);
    }
  });

  it('replaces the names on every zone swap, and clears them for a zone with none', () => {
    labels.setPlaceLabels([{ text: 'Library', position: new THREE.Vector3(0, 0, 0) }]);
    labels.setPlaceLabels([
      { text: 'Footbridge', position: new THREE.Vector3(1, 0, 0) },
      { text: 'Campsite', position: new THREE.Vector3(2, 0, 0) },
    ]);
    expect([...container().querySelectorAll('.tq-place')].map((e) => e.textContent)).toEqual(['Footbridge', 'Campsite']);
    labels.setPlaceLabels([]);
    expect(container().querySelectorAll('.tq-place')).toHaveLength(0);
  });

  it('puts a place name on screen over its anchor, and takes it off when the anchor is behind the camera', () => {
    labels.setPlaceLabels([
      { text: 'In front', position: new THREE.Vector3(0, 0, 0) },
      { text: 'Behind', position: new THREE.Vector3(0, 0, 40) },
    ]);
    labels.update(W, H);
    const [front, behind] = [...container().querySelectorAll<HTMLElement>('.tq-place')] as [HTMLElement, HTMLElement];
    expect(front.classList.contains('is-hidden')).toBe(false);
    expect(front.style.opacity).toBe('1.00');
    expect(front.style.transform).toMatch(/^translate\(/);
    expect(behind.classList.contains('is-hidden')).toBe(true);
    expect(behind.style.opacity).toBe('0');
  });
});

describe('WorldLabels: layout in the page', () => {
  it('shows a label in range at full strength, hides it past the range, and leaves a priority label alone', () => {
    const mid = onAxis('Mid', 29);
    const far = onAxis('Far', 40);
    const priority = onAxis('Pickup', 100, { priority: true });
    labels.update(W, H);
    expect(mid.element.style.opacity).toBe('1.00');
    expect(hiddenClass(mid)).toBe(false);
    expect(hiddenClass(far)).toBe(true);
    expect(priority.element.style.opacity).toBe('1.00');
    expect(hiddenClass(priority)).toBe(false);
  });

  it('hides a label switched off, and shows it again when switched on', () => {
    const tag = onAxis('Tag', 8);
    labels.update(W, H);
    expect(hiddenClass(tag)).toBe(false);
    tag.visible = false;
    labels.update(W, H);
    expect(hiddenClass(tag)).toBe(true);
    tag.visible = true;
    labels.update(W, H);
    expect(hiddenClass(tag)).toBe(false);
  });

  it('moves the farther of two overlapping labels up and keeps the nearer where it hangs', () => {
    const near = onAxis('Near', 8);
    const far = onAxis('Far', 12);
    labels.update(W, H);
    expect(near.placement).toMatchObject({ visible: true, nudge: 0 });
    expect(far.placement).toMatchObject({ visible: true, nudge: 1 });
    expect(far.placement!.top).toBeCloseTo(near.placement!.top - (far.height + NUDGE_GAP), 6);
  });

  it('slides a label clear of a HUD card measured from the page', () => {
    const hud = document.createElement('div');
    hud.className = 'tq-hud';
    host.appendChild(hud);
    // The label hangs from the middle of the screen (640, 360); the card sits across its box.
    const rect = { left: 400, top: 330, right: 880, bottom: 380, width: 480, height: 50, x: 400, y: 330 } as DOMRect;
    hud.getBoundingClientRect = () => rect;
    const tag = onAxis('Tag', 8);
    labels.update(W, H);
    expect(tag.placement!.visible).toBe(true);
    expect(tag.placement!.top + tag.height).toBeLessThanOrEqual(rect.top - OVERLAP_GAP);
  });

  it('skips HUD parts that are not drawn (no size) or not in the page', () => {
    const hud = document.createElement('div');
    hud.className = 'tq-hud';
    host.appendChild(hud); // happy-dom reports a 0 by 0 box: a hidden card
    const tag = onAxis('Tag', 8);
    labels.update(W, H);
    expect(tag.placement).toMatchObject({ visible: true, nudge: 0 });
  });
});

describe('WorldLabels: type size and measuring', () => {
  it('uses a 20px type size on a laptop and 22px on a touch screen', () => {
    expect(container().style.getPropertyValue('--tq-label-size')).toBe('20px');
    const coarse = vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: query === '(pointer: coarse)' }) as MediaQueryList,
    );
    labels.remeasure();
    expect(container().style.getPropertyValue('--tq-label-size')).toBe('22px');
    coarse.mockRestore();
    labels.remeasure();
    expect(container().style.getPropertyValue('--tq-label-size')).toBe('20px');
  });

  it('guesses a size from the text where the page cannot measure, and measures again when the text changes', () => {
    const tag = onAxis('Tag', 8);
    labels.update(W, H);
    expect(tag.width).toBe(estimateLabelSize('Tag', 20).width);
    expect(tag.height).toBe(estimateLabelSize('Tag', 20).height);
    tag.setText('A much longer name tag');
    labels.update(W, H);
    expect(tag.width).toBe(estimateLabelSize('A much longer name tag', 20).width);
  });

  it('uses the size the page reports when it can', () => {
    const tag = onAxis('Tag', 8);
    Object.defineProperty(tag.element, 'offsetWidth', { value: 150, configurable: true });
    Object.defineProperty(tag.element, 'offsetHeight', { value: 38, configurable: true });
    labels.update(W, H);
    expect([tag.width, tag.height]).toEqual([150, 38]);
    expect(tag.placement!.left).toBeCloseTo(W / 2 - 75, 6);
  });

  it('reads the page once for the HUD, not once per label per frame', () => {
    for (let i = 0; i < 12; i++) onAxis(`Label ${i}`, 5 + i);
    labels.update(W, H); // the first frame measures the HUD
    const reads = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    for (let frame = 0; frame < 30; frame++) labels.update(W, H);
    expect(reads).not.toHaveBeenCalled();
    labels.update(W + 100, H); // a resize measures again
    expect(reads).toHaveBeenCalled();
  });

  it('removes a label from the page', () => {
    const tag = onAxis('Tag', 8);
    labels.remove(tag);
    expect(container().querySelector('.tq-label')).toBeNull();
    expect(() => labels.update(W, H)).not.toThrow();
  });
});
