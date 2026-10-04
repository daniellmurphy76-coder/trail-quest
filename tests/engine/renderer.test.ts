// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Renderer } from '../../src/engine/renderer';

// happy-dom has no WebGL, so the renderer gets a stand-in that only remembers its pixel ratio and size.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeGL {
    shadowMap = { enabled: false, type: 0 };
    toneMapping = 0;
    toneMappingExposure = 1;
    outputColorSpace = '';
    ratio = 1;
    sizes: Array<[number, number]> = [];
    constructor(public params: unknown) {}
    setPixelRatio(value: number): void {
      this.ratio = value;
    }
    getPixelRatio(): number {
      return this.ratio;
    }
    setSize(w: number, h: number): void {
      this.sizes.push([w, h]);
    }
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeGL };
});

interface Fake {
  getPixelRatio(): number;
  sizes: Array<[number, number]>;
}

const made: Renderer[] = [];
let canvas: HTMLCanvasElement;

function make(devicePixelRatio: number): Renderer {
  vi.stubGlobal('devicePixelRatio', devicePixelRatio);
  const renderer = new Renderer(canvas);
  made.push(renderer);
  return renderer;
}
const gl = (r: Renderer): Fake => r.gl as unknown as Fake;

beforeEach(() => {
  canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { value: 1180, configurable: true });
  Object.defineProperty(canvas, 'clientHeight', { value: 820, configurable: true });
});
afterEach(() => {
  for (const renderer of made.splice(0)) renderer.dispose();
  vi.unstubAllGlobals();
});

describe('Renderer pixel ratio', () => {
  it('draws at the screen ratio, never above 2', () => {
    expect(make(1).pixelRatio).toBe(1);
    expect(make(1.5).pixelRatio).toBe(1.5);
    expect(make(2).pixelRatio).toBe(2);
    const dense = make(3);
    expect(dense.pixelRatio).toBe(2);
    expect(gl(dense).getPixelRatio()).toBe(2);
  });

  it('lowers the ratio at once when the limit drops, resizing the surface with the new ratio', () => {
    const r = make(2);
    const before = gl(r).sizes.length;
    r.setPixelRatioLimit(1.5);
    expect(r.pixelRatio).toBe(1.5);
    expect(gl(r).getPixelRatio()).toBe(1.5);
    expect(gl(r).sizes.length).toBe(before + 1);
    expect(gl(r).sizes.at(-1)).toEqual([1180, 820]); // CSS size is unchanged
    expect(r.width).toBe(1180);
    expect(r.height).toBe(820);
  });

  it('tells the resize listeners, with the new ratio already in place (the post pipeline refits its buffers on this)', () => {
    const r = make(2);
    const heard: Array<[number, number, number]> = [];
    r.onResize((w, h) => heard.push([w, h, gl(r).getPixelRatio()]));
    expect(heard).toEqual([[1180, 820, 2]]); // the first call is on registration
    r.setPixelRatioLimit(1.75);
    r.setPixelRatioLimit(1.5);
    r.setPixelRatioLimit(1.25);
    expect(heard.slice(1)).toEqual([
      [1180, 820, 1.75],
      [1180, 820, 1.5],
      [1180, 820, 1.25],
    ]);
  });

  it('steps back up when the limit rises, up to the screen ratio', () => {
    const r = make(2);
    r.setPixelRatioLimit(1.25);
    r.setPixelRatioLimit(2);
    expect(r.pixelRatio).toBe(2);
    expect(gl(r).getPixelRatio()).toBe(2);
  });

  it('does nothing for the same limit twice', () => {
    const r = make(2);
    r.setPixelRatioLimit(1.5);
    const sizes = gl(r).sizes.length;
    const listener = vi.fn();
    r.onResize(listener);
    listener.mockClear();
    r.setPixelRatioLimit(1.5);
    expect(gl(r).sizes.length).toBe(sizes);
    expect(listener).not.toHaveBeenCalled();
  });

  it('cannot draw sharper than the screen: on a 1x screen a higher limit changes nothing and tells nobody', () => {
    const r = make(1);
    const listener = vi.fn();
    r.onResize(listener);
    listener.mockClear();
    r.setPixelRatioLimit(1.5);
    expect(r.pixelRatio).toBe(1);
    expect(gl(r).getPixelRatio()).toBe(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps a limit above 2 at 2, and ignores a limit that is not a positive number', () => {
    const r = make(3);
    r.setPixelRatioLimit(5);
    expect(r.pixelRatio).toBe(2);
    r.setPixelRatioLimit(1.5);
    for (const bad of [0, -1, Number.NaN]) r.setPixelRatioLimit(bad);
    expect(r.pixelRatio).toBe(1.5);
  });

  it('keeps the limit through a window resize', () => {
    const r = make(2);
    r.setPixelRatioLimit(1.5);
    Object.defineProperty(canvas, 'clientWidth', { value: 1024, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 768, configurable: true });
    window.dispatchEvent(new Event('resize'));
    r.beginFrame();
    expect(gl(r).getPixelRatio()).toBe(1.5);
    expect(r.width).toBe(1024);
    expect(r.height).toBe(768);
  });
});
