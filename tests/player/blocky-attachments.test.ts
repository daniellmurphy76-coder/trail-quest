import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildHeadAttachments, buildTorsoAttachments } from '../../src/player/avatar/blocky/attachments';
import {
  BUILDS,
  defaultAvatar,
  fillAvatar,
  HAIR_STYLES,
  HAT_STYLES,
  LEG_STYLES,
  type FilledAvatar,
} from '../../src/player/avatar/options';

const look = (patch: Partial<FilledAvatar> = {}): FilledAvatar => fillAvatar({ ...defaultAvatar('wolf'), ...patch });

function box(g: THREE.BufferGeometry): THREE.Box3 {
  g.computeBoundingBox();
  return g.boundingBox!.clone();
}

function vertices(g: THREE.BufferGeometry): number {
  return g.getAttribute('position').count;
}

function finite(g: THREE.BufferGeometry): void {
  for (const name of ['position', 'normal', 'color']) {
    const attribute = g.getAttribute(name);
    expect(attribute, name).toBeDefined();
    for (const v of attribute.array) expect(Number.isFinite(v)).toBe(true);
  }
}

/** How many vertices are painted `hex`. */
function painted(g: THREE.BufferGeometry, hex: string): number {
  const want = new THREE.Color(hex);
  const colors = g.getAttribute('color');
  let n = 0;
  for (let i = 0; i < colors.count; i++) {
    if (Math.abs(colors.getX(i) - want.r) + Math.abs(colors.getY(i) - want.g) + Math.abs(colors.getZ(i) - want.b) < 0.01) n++;
  }
  return n;
}

/** The highest y among vertices painted `hex`. */
function highest(g: THREE.BufferGeometry, hex: string): number {
  const want = new THREE.Color(hex);
  const colors = g.getAttribute('color');
  const pos = g.getAttribute('position');
  let top = -Infinity;
  for (let i = 0; i < colors.count; i++) {
    if (Math.abs(colors.getX(i) - want.r) + Math.abs(colors.getY(i) - want.g) + Math.abs(colors.getZ(i) - want.b) < 0.01) top = Math.max(top, pos.getY(i));
  }
  return top;
}

describe('attachments: head (hair, hat, glasses)', () => {
  describe.each(HAIR_STYLES.map((c) => c.value))('hair %s', (hairStyle) => {
    it.each(HAT_STYLES.map((c) => c.value))('with hat %s builds finite geometry within budget', (hat) => {
      for (const glasses of [false, true]) {
        const g = buildHeadAttachments(look({ hairStyle, hat, glasses }));
        const painted = hairStyle === 'none' || hairStyle === 'buzz' ? hat !== 'none' || glasses : true;
        if (!painted) {
          expect(g).toBeNull();
          continue;
        }
        expect(g).not.toBeNull();
        finite(g!);
        expect(vertices(g!)).toBeGreaterThan(0);
        expect(vertices(g!)).toBeLessThan(4000);
        const b = box(g!);
        expect(b.max.y).toBeLessThan(1.3); // nothing floats far above the head
        expect(b.min.y).toBeGreaterThan(-0.35);
        expect(Math.max(b.max.x, -b.min.x)).toBeLessThan(0.95);
        expect(b.max.z).toBeLessThan(0.95);
        expect(b.min.z).toBeGreaterThan(-0.9); // the bucket and scout brims reach 0.85
        g!.dispose();
      }
    });
  });

  it('a bald or buzz-cut head with nothing on it has nothing to draw (the hair is painted)', () => {
    expect(buildHeadAttachments(look({ hairStyle: 'none', hat: 'none', glasses: false }))).toBeNull();
    expect(buildHeadAttachments(look({ hairStyle: 'buzz', hat: 'none', glasses: false }))).toBeNull();
  });

  it('hair shapes use the hair color, and nothing else when there is no hat', () => {
    for (const hairStyle of ['short', 'spiky', 'curly', 'long'] as const) {
      const g = buildHeadAttachments(look({ hairStyle, hairColor: '#e6c36a', hat: 'none' }))!;
      expect(painted(g, '#e6c36a'), hairStyle).toBe(vertices(g));
    }
  });

  it('ponytail and braids tie with the neckerchief color', () => {
    for (const hairStyle of ['ponytail', 'braids'] as const) {
      const g = buildHeadAttachments(look({ hairStyle, hairColor: '#5a3a24', neckerchief: '#c63d34' }))!;
      expect(painted(g, '#c63d34'), hairStyle).toBeGreaterThan(10);
      expect(painted(g, '#5a3a24'), hairStyle).toBeGreaterThan(10);
    }
    // The ponytail hangs behind the head, the braids hang down the sides.
    expect(box(buildHeadAttachments(look({ hairStyle: 'ponytail' }))!).min.z).toBeLessThan(-0.7);
    expect(box(buildHeadAttachments(look({ hairStyle: 'braids' }))!).max.x).toBeGreaterThan(0.5);
  });

  it('long hair hangs below the head; short hair does not', () => {
    expect(box(buildHeadAttachments(look({ hairStyle: 'long' }))!).min.y).toBeLessThan(-0.1);
    expect(box(buildHeadAttachments(look({ hairStyle: 'short' }))!).min.y).toBeGreaterThan(0.2);
  });

  it('spiky hair reaches above the head and curly hair is bigger than short hair', () => {
    expect(box(buildHeadAttachments(look({ hairStyle: 'spiky' }))!).max.y).toBeGreaterThan(1.05);
    expect(vertices(buildHeadAttachments(look({ hairStyle: 'curly' }))!)).toBeGreaterThan(vertices(buildHeadAttachments(look({ hairStyle: 'short' }))!));
  });

  it.each(['cap', 'bucket', 'beanie', 'scout'] as const)('hat %s sits on the head, in hatColor, and sheds the top of the hair', (hat) => {
    const hairColor = '#e6c36a';
    const bare = buildHeadAttachments(look({ hairStyle: 'spiky', hairColor, hat: 'none' }))!;
    const g = buildHeadAttachments(look({ hairStyle: 'spiky', hairColor, hat, hatColor: '#2f5fa8' }))!;
    expect(painted(g, '#2f5fa8')).toBeGreaterThan(8);
    expect(box(g).max.y).toBeGreaterThan(0.95);
    // Spikes would poke through the hat, so under a hat only the back and the sides of the hair are left.
    expect(highest(g, hairColor)).toBeLessThanOrEqual(0.81);
    expect(highest(bare, hairColor)).toBeGreaterThan(1.0);
  });

  it('the scout hat stays under the Den Chief label height and wider than the head', () => {
    const b = box(buildHeadAttachments(look({ hairStyle: 'none', hat: 'scout' }))!);
    expect(b.max.y).toBeLessThan(1.12);
    expect(b.max.x).toBeGreaterThan(0.8);
  });

  it('glasses sit in front of the face, over both eyes', () => {
    const plain = buildHeadAttachments(look({ hairStyle: 'short', glasses: false }))!;
    const specs = buildHeadAttachments(look({ hairStyle: 'short', glasses: true }))!;
    expect(vertices(specs)).toBeGreaterThan(vertices(plain));
    const only = buildHeadAttachments(look({ hairStyle: 'none', hat: 'none', glasses: true }))!;
    const b = box(only);
    expect(b.max.z).toBeGreaterThan(0.4); // in front of the face (the face is at z = 0.4)
    expect(b.min.z).toBeGreaterThanOrEqual(-0.001); // the arms of the frame run back to the ears, no further
    expect(b.min.x).toBeLessThan(-0.25);
    expect(b.max.x).toBeGreaterThan(0.25);
    expect(b.min.y).toBeGreaterThan(0.2);
    expect(b.max.y).toBeLessThan(0.6);
  });
});

describe('attachments: torso (neckerchief, backpack, skort, Den Chief cord)', () => {
  it.each(LEG_STYLES.map((c) => c.value))('builds for legs %s, every build, with and without the extras', (legs) => {
    for (const build of BUILDS.map((c) => c.value)) {
      for (const backpack of [false, true]) {
        for (const denChiefCord of [false, true]) {
          const g = buildTorsoAttachments(look({ legs, build, backpack }), { denChiefCord });
          finite(g);
          expect(vertices(g)).toBeGreaterThan(0);
          expect(vertices(g)).toBeLessThan(4000);
          g.dispose();
        }
      }
    }
  });

  it('always has a neckerchief worn the Scout way: a collar, the point down the back, the ends through a slide', () => {
    const g = buildTorsoAttachments(look({ neckerchief: '#c63d34' }));
    expect(painted(g, '#c63d34')).toBeGreaterThan(30);
    const b = box(g);
    expect(b.max.y).toBeLessThan(1.2); // stays under the head, which starts at 1.2
    expect(b.min.y).toBeGreaterThan(0.5);
    expect(b.max.z).toBeGreaterThan(0.33); // the ends and the slide lie on the chest (+z)
    expect(painted(g, '#c9a46a')).toBeGreaterThan(0); // the slide

    // The lowest neckerchief point on the back and on the chest: the point hangs long behind,
    // and only the two short ends show in front.
    const lowest = (onBack: boolean): number => {
      const want = new THREE.Color('#c63d34');
      const pos = g.getAttribute('position');
      const col = g.getAttribute('color');
      let min = Infinity;
      for (let i = 0; i < pos.count; i++) {
        const red = Math.abs(col.getX(i) - want.r) + Math.abs(col.getY(i) - want.g) + Math.abs(col.getZ(i) - want.b) < 0.02;
        const back = pos.getZ(i) < -0.33;
        const front = pos.getZ(i) > 0.3;
        if (red && (onBack ? back : front)) min = Math.min(min, pos.getY(i));
      }
      return min;
    };
    expect(lowest(true)).toBeLessThan(0.7);
    expect(lowest(false)).toBeGreaterThan(0.75);
    expect(lowest(true)).toBeLessThan(lowest(false));
  });

  it('a skort adds a flared skirt in the leg color below the waist; shorts and pants do not', () => {
    const skort = buildTorsoAttachments(look({ legs: 'skort', legColor: '#7a56b8' }));
    const shorts = buildTorsoAttachments(look({ legs: 'shorts', legColor: '#7a56b8' }));
    const pants = buildTorsoAttachments(look({ legs: 'pants', legColor: '#7a56b8' }));
    expect(painted(skort, '#7a56b8')).toBeGreaterThan(10);
    expect(painted(shorts, '#7a56b8')).toBe(0);
    expect(painted(pants, '#7a56b8')).toBe(0);
    expect(vertices(skort)).toBeGreaterThan(vertices(shorts));
    expect(box(skort).min.y).toBeLessThan(0.1);
    expect(box(skort).max.x - box(skort).min.x).toBeGreaterThan(1.1); // flares wider than the 0.8 torso
    expect(box(shorts).min.y).toBeGreaterThan(0.5);
  });

  it('a backpack goes behind, with straps over the front of the shoulders', () => {
    const plain = box(buildTorsoAttachments(look({ backpack: false })));
    const packed = box(buildTorsoAttachments(look({ backpack: true })));
    expect(packed.min.z).toBeLessThan(plain.min.z - 0.2);
    expect(packed.min.z).toBeLessThan(-0.55);
    expect(packed.max.z).toBeGreaterThanOrEqual(plain.max.z);
    expect(vertices(buildTorsoAttachments(look({ backpack: true })))).toBeGreaterThan(vertices(buildTorsoAttachments(look({ backpack: false }))));
  });

  it('the Den Chief cord is yellow, front and back, and only when asked', () => {
    const without = buildTorsoAttachments(look());
    const withCord = buildTorsoAttachments(look(), { denChiefCord: true });
    expect(vertices(withCord)).toBeGreaterThan(vertices(without));
    expect(painted(withCord, '#f2c230')).toBeGreaterThan(40);
    expect(painted(without, '#f2c230')).toBe(0);
    const b = box(withCord);
    expect(b.min.z).toBeLessThan(-0.3); // on the back
    expect(b.max.z).toBeGreaterThan(0.33); // and the front
  });
});
