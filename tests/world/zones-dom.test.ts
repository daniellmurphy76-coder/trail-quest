// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { labelSprite } from '../../src/world/placeholder-zone';
import { createZone, ZONE_IDS } from '../../src/world/zones';

// The other zone tests run in node, where there is no canvas. With a DOM (and maybe no 2D canvas
// context, as in this fake one) the zones must build just the same.
describe('placeholder zones with a DOM present', () => {
  it('build every zone and keep the landmark signposts, label or not', () => {
    const deps = { onTalkToDenChief: vi.fn(), onReturnToBaseCamp: vi.fn() };
    for (const id of ZONE_IDS.filter((z) => z !== 'base-camp')) {
      const zone = createZone(id, deps);
      for (const landmark of Object.keys(zone.landmarks ?? {})) {
        expect(zone.root.getObjectByName(`landmark:${landmark}`)).toBeDefined();
      }
    }
  });

  it('labelSprite never throws: it gives a sprite or null', () => {
    const sprite = labelSprite('Library');
    expect(sprite === null || sprite.isSprite).toBe(true);
  });
});
