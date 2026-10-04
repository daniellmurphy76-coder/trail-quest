/** Test helpers: the shipped Scout model, read straight from disk. Not a test file. */
import { readFileSync } from 'node:fs';
import { parseBlockyModel, type BlockyAsset } from '../../src/player/avatar/blocky/model';

export const MODEL_PATH = new URL('../../public/assets/characters/blocky.glb', import.meta.url);

/** The bytes of public/assets/characters/blocky.glb, as the ArrayBuffer GLTFLoader wants. */
export function modelBytes(): ArrayBuffer {
  const buf = readFileSync(MODEL_PATH);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export function modelFileSize(): number {
  return readFileSync(MODEL_PATH).byteLength;
}

/** Parse the shipped model the way the game does. */
export function loadModel(): Promise<BlockyAsset> {
  return parseBlockyModel(modelBytes());
}

export interface GlbJson {
  nodes: Array<{ name: string; mesh?: number; children?: number[]; scale?: number[]; translation?: number[] }>;
  meshes: Array<{ name: string; primitives: Array<{ attributes: Record<string, number> }> }>;
  accessors: Array<{ bufferView: number; byteOffset?: number; count: number; type: string }>;
  bufferViews: Array<{ byteOffset?: number; byteLength: number }>;
  animations: Array<{ name: string }>;
  materials?: unknown[];
  textures?: unknown[];
  images?: unknown[];
}

/** The JSON chunk and the binary chunk of the shipped file. */
export function readGlb(): { json: GlbJson; bin: Buffer } {
  const buf = readFileSync(MODEL_PATH);
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8')) as GlbJson;
  return { json, bin: buf.subarray(20 + jsonLength + 8) };
}

/** A float accessor of the shipped file as a plain array. */
export function floats(glb: { json: GlbJson; bin: Buffer }, index: number): number[] {
  const a = glb.json.accessors[index]!;
  const view = glb.json.bufferViews[a.bufferView]!;
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type]!;
  const start = glb.bin.byteOffset + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  return Array.from(new Float32Array(glb.bin.buffer.slice(start, start + a.count * comps * 4)));
}
