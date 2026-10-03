/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32, ICONS, renderIcons } from '../scripts/icons.mjs';

const root = path.resolve(__dirname, '..');
const iconsDir = path.join(root, 'public', 'icons');
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface Png {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  /** Decoded scanlines with the filter byte of each row removed (filter 0 only). */
  pixels: Buffer;
  channels: number;
}

/** Reads the IHDR and decodes the IDAT data of a PNG written with filter type 0 on every row. */
function readPng(file: string): Png {
  const buf = fs.readFileSync(file);
  expect(buf.subarray(0, 8).equals(SIGNATURE), `${file} starts with the PNG signature`).toBe(true);
  expect(buf.toString('ascii', 12, 16)).toBe('IHDR');
  expect(buf.readUInt32BE(8)).toBe(13);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24]!;
  const colorType = buf[25]!;

  const idat: Buffer[] = [];
  let offset = 8;
  let sawEnd = false;
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    expect(buf.readUInt32BE(offset + 8 + length), `${type} chunk CRC`).toBe(
      crc32(buf.subarray(offset + 4, offset + 8 + length)),
    );
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') sawEnd = true;
    offset += 12 + length;
  }
  expect(sawEnd, 'has an IEND chunk').toBe(true);

  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  expect(raw.length, 'IDAT holds one filter byte plus the pixels for each row').toBe(height * (1 + width * channels));
  const pixels = Buffer.alloc(height * width * channels);
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * channels);
    expect(raw[row], `row ${y} uses filter None`).toBe(0);
    raw.copy(pixels, y * width * channels, row + 1, row + 1 + width * channels);
  }
  return { width, height, bitDepth, colorType, pixels, channels };
}

const pixelAt = (png: Png, x: number, y: number): number[] => {
  const i = (y * png.width + x) * png.channels;
  return Array.from(png.pixels.subarray(i, i + png.channels));
};

const EXPECTED: Record<string, number> = {
  'icon-192.png': 192,
  'icon-512.png': 512,
  'apple-touch-icon.png': 180,
  'maskable-512.png': 512,
};

describe('app icons', () => {
  it('has all four PNG files, each a real PNG of the right size', () => {
    for (const [file, size] of Object.entries(EXPECTED)) {
      const full = path.join(iconsDir, file);
      expect(fs.existsSync(full), `${file} exists`).toBe(true);
      const png = readPng(full);
      expect(png.width, `${file} width`).toBe(size);
      expect(png.height, `${file} height`).toBe(size);
      expect(png.bitDepth).toBe(8);
    }
  });

  it('keeps the script and the expected list in step', () => {
    expect(Object.fromEntries(ICONS.map((i) => [i.file, i.size]))).toEqual(EXPECTED);
  });

  it('makes the iOS icon opaque and the "any" icons rounded with transparent corners', () => {
    const apple = readPng(path.join(iconsDir, 'apple-touch-icon.png'));
    expect(apple.colorType, 'RGB, no alpha channel').toBe(2);
    expect(pixelAt(apple, 0, 0)).toEqual([0x2f, 0x6b, 0x3a]);

    for (const file of ['icon-192.png', 'icon-512.png']) {
      const png = readPng(path.join(iconsDir, file));
      expect(png.colorType).toBe(6);
      expect(pixelAt(png, 0, 0)[3], `${file} corner is transparent`).toBe(0);
      expect(pixelAt(png, Math.floor(png.width / 2), 4)[3], `${file} edge is opaque`).toBe(255);
    }
  });

  it('draws the maskable icon full-bleed with the mark inside the safe circle', () => {
    const png = readPng(path.join(iconsDir, 'maskable-512.png'));
    expect(png.colorType).toBe(2);
    const background = [0x2f, 0x6b, 0x3a];
    const centre = png.width / 2;
    const safeRadius = 0.4 * png.width;
    let marked = 0;
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        const pixel = pixelAt(png, x, y);
        if (pixel.every((v, i) => v === background[i])) continue;
        marked++;
        // Every non-background pixel sits inside the circle Android guarantees to keep.
        expect(Math.hypot(x + 0.5 - centre, y + 0.5 - centre)).toBeLessThanOrEqual(safeRadius);
      }
    }
    expect(marked, 'the mark is drawn').toBeGreaterThan(1000);
  });

  it('is what the script produces (same pixels, whatever zlib does to the bytes)', () => {
    for (const { file, png } of renderIcons()) {
      const tmp = path.join(iconsDir, file);
      const fresh = zlib.inflateSync(png.subarray(png.indexOf('IDAT') + 4, png.indexOf('IEND') - 8));
      const committed = fs.readFileSync(tmp);
      const onDisk = zlib.inflateSync(committed.subarray(committed.indexOf('IDAT') + 4, committed.indexOf('IEND') - 8));
      expect(fresh.equals(onDisk), `${file} matches scripts/icons.mjs`).toBe(true);
    }
  });
});

describe('icons are wired up', () => {
  it('lists the PNGs in the web app manifest, with a maskable one', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public', 'manifest.webmanifest'), 'utf8')) as {
      icons: { src: string; sizes: string; type: string; purpose?: string }[];
    };
    const find = (src: string) => manifest.icons.find((i) => i.src === src);
    expect(find('icons/icon-192.png')).toMatchObject({ sizes: '192x192', type: 'image/png', purpose: 'any' });
    expect(find('icons/icon-512.png')).toMatchObject({ sizes: '512x512', type: 'image/png', purpose: 'any' });
    expect(find('icons/maskable-512.png')).toMatchObject({ sizes: '512x512', type: 'image/png', purpose: 'maskable' });
    expect(find('favicon.svg')).toMatchObject({ type: 'image/svg+xml' });
    for (const icon of manifest.icons) {
      expect(fs.existsSync(path.join(root, 'public', icon.src)), `${icon.src} exists`).toBe(true);
    }
  });

  it('links the apple touch icon and names the home-screen app in index.html', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    expect(html).toContain('<link rel="apple-touch-icon" href="%BASE_URL%icons/apple-touch-icon.png"');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Trail Quest"');
  });
});
