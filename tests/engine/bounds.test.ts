import { describe, expect, it } from 'vitest';
import { clampToBounds, perimeterPoint, squareBounds } from '../../src/world/bounds';

const bounds = { minX: -25, maxX: 25, minZ: -20, maxZ: 30 };

describe('clampToBounds', () => {
  it('leaves points inside alone', () => {
    expect(clampToBounds(3, -4, bounds)).toEqual({ x: 3, z: -4 });
    expect(clampToBounds(25, 30, bounds)).toEqual({ x: 25, z: 30 });
  });

  it('clamps each axis independently', () => {
    expect(clampToBounds(40, 0, bounds)).toEqual({ x: 25, z: 0 });
    expect(clampToBounds(-99, -99, bounds)).toEqual({ x: -25, z: -20 });
    expect(clampToBounds(0, 99, bounds)).toEqual({ x: 0, z: 30 });
  });
});

describe('squareBounds', () => {
  it('is centered on the origin', () => {
    expect(squareBounds(25)).toEqual({ minX: -25, maxX: 25, minZ: -25, maxZ: 25 });
  });
});

describe('perimeterPoint', () => {
  it('starts at a corner and walks the four edges clockwise', () => {
    expect(perimeterPoint(0, 10)).toEqual({ x: -10, z: -10 });
    expect(perimeterPoint(0.125, 10)).toEqual({ x: 0, z: -10 });
    expect(perimeterPoint(0.25, 10)).toEqual({ x: 10, z: -10 });
    expect(perimeterPoint(0.5, 10)).toEqual({ x: 10, z: 10 });
    expect(perimeterPoint(0.75, 10)).toEqual({ x: -10, z: 10 });
  });

  it('always lies on the square edge', () => {
    for (let i = 0; i < 200; i++) {
      const p = perimeterPoint(i / 200, 27);
      expect(Math.max(Math.abs(p.x), Math.abs(p.z))).toBeCloseTo(27, 10);
    }
  });

  it('wraps u outside [0, 1)', () => {
    expect(perimeterPoint(1.25, 10)).toEqual(perimeterPoint(0.25, 10));
  });
});
