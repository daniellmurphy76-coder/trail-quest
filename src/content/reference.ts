/**
 * The Scout Book's text: the Oath, the Law, the mottos and the outdoor codes, from
 * content/reference.json. These are things a Scout learns whole and looks up again, so they live
 * apart from the rank files.
 *
 *   { oath:        { title, lines },
 *     law:         { title, points: [{ word, meaning }] },
 *     cubMotto:    { title, lines },   bsaMotto:   { title, lines },
 *     bsaSlogan:   { title, lines },   outdoorCode: { title, lines },
 *     leaveNoTrace: { title, lines } }
 *
 * The file may be missing or only partly filled in while the content is written, so nothing here
 * throws: `normalizeReference` keeps what is usable and drops the rest, and `loadReference` falls
 * back to an empty reference. The Scout Book shows a friendly empty page for anything absent.
 */

/** A titled block of lines, shown as a poster. */
export interface ReferenceText {
  title: string;
  lines: string[];
}

/** One point of the Scout Law: the word and what it means in plain words. */
export interface LawPoint {
  word: string;
  meaning: string;
}

export interface ReferenceLaw {
  title: string;
  points: LawPoint[];
}

export interface ReferenceContent {
  oath?: ReferenceText;
  law?: ReferenceLaw;
  cubMotto?: ReferenceText;
  bsaMotto?: ReferenceText;
  bsaSlogan?: ReferenceText;
  outdoorCode?: ReferenceText;
  leaveNoTrace?: ReferenceText;
}

const TEXT_KEYS = ['oath', 'cubMotto', 'bsaMotto', 'bsaSlogan', 'outdoorCode', 'leaveNoTrace'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const cleanText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function textOf(value: unknown): ReferenceText | undefined {
  if (!isRecord(value) || !Array.isArray(value.lines)) return undefined;
  const lines = value.lines.map(cleanText).filter((line) => line !== '');
  return lines.length > 0 ? { title: cleanText(value.title), lines } : undefined;
}

function lawOf(value: unknown): ReferenceLaw | undefined {
  if (!isRecord(value) || !Array.isArray(value.points)) return undefined;
  const points: LawPoint[] = [];
  for (const point of value.points) {
    if (!isRecord(point)) continue;
    const word = cleanText(point.word);
    if (word !== '') points.push({ word, meaning: cleanText(point.meaning) });
  }
  return points.length > 0 ? { title: cleanText(value.title), points } : undefined;
}

/** Keep the usable parts of whatever was loaded. Anything that is not the right shape is left out. */
export function normalizeReference(raw: unknown): ReferenceContent {
  if (!isRecord(raw)) return {};
  const out: ReferenceContent = {};
  for (const key of TEXT_KEYS) {
    const text = textOf(raw[key]);
    if (text) out[key] = text;
  }
  const law = lawOf(raw.law);
  if (law) out.law = law;
  return out;
}

const files = import.meta.glob<unknown>('../../content/reference.json', { eager: true, import: 'default' });

let loaded: ReferenceContent | undefined;

/** The bundled reference content, or an empty one when content/reference.json is missing. */
export function loadReference(): ReferenceContent {
  loaded ??= normalizeReference(Object.values(files)[0]);
  return loaded;
}
