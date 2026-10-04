// @vitest-environment happy-dom
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createZone, ZONE_IDS } from '../../src/world/zones';

// The other zone tests run in node, where there is no canvas. With a DOM (and maybe no 2D canvas
// context, as in this fake one) the zones must build just the same.
describe('placeholder zones with a DOM present', () => {
  const deps = { onTalkToDenChief: vi.fn(), onReturnToBaseCamp: vi.fn() };

  it('build every zone and keep the landmark signposts, label or not', () => {
    for (const id of ZONE_IDS.filter((z) => z !== 'base-camp')) {
      const zone = createZone(id, deps);
      for (const landmark of Object.keys(zone.landmarks ?? {})) {
        expect(zone.root.getObjectByName(`landmark:${landmark}`)).toBeDefined();
      }
    }
  });

  it('keep place names as data, so a browser draws no label sprites into the scene', () => {
    for (const id of ZONE_IDS.filter((z) => z !== 'base-camp')) {
      const zone = createZone(id, deps);
      expect(zone.labels?.length, `${id} labels`).toBeGreaterThan(0);
      zone.root.traverse((object) => expect((object as THREE.Sprite).isSprite, `${id} sprite`).not.toBe(true));
    }
  });
});
