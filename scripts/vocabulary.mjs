/**
 * Grade-level vocabulary and sentence-length checks for kid-facing content.
 *
 * Pure functions, no dependencies. `validate-content.mjs` wires these into the content
 * lint; `tests/vocabulary.test.ts` covers them. The rules come from CLAUDE.md, "Players
 * and reading level": Wolf (grade 2) text uses one- and two-syllable everyday words in
 * sentences of 10 words or fewer; Arrow of Light (grade 5) text uses everyday words a
 * 10-year-old says, in sentences of 15 words or fewer, and never school-report words.
 */

/**
 * Where kid-facing text lives in a rank file. Paths use `[]` for "every item of this
 * array". `collectKidStrings` is driven by this table, so it is also the documentation.
 * Anything not listed here (adultText, parentNote, notes, ids, names, URLs) is never
 * checked. Keep this in step with src/activities/types.ts.
 */
export const KID_FACING_FIELDS = {
  /** Fields on the rank file itself. */
  rank: [
    'adventures[].summary',
    'adventures[].requirements[].kidText',
    'adventures[].requirements[].lesson.lines[]',
    'electives[].summary',
  ],
  /** Fields inside `activity.params` and `practice.params` of every requirement, by activity type. */
  params: {
    quiz: ['questions[].prompt', 'questions[].choices[]', 'questions[].explain'],
    sequence: ['prompt', 'steps[]'],
    sort: ['prompt', 'bins[].label', 'items[].label'],
    collect: ['prompt', 'targets[].label', 'targets[].hint'],
    navigate: ['prompt', 'waypoints[].label'],
    rhythm: ['prompt', 'exercise'],
    craft: ['prompt', 'result', 'ingredients[].label', 'distractors[].label'],
    fieldMission: ['title', 'kidSteps[]'],
  },
  /** Adult-only fields. Listed so nobody adds them by accident. */
  never: ['adultText', 'parentNote', 'notes'],
};

/**
 * School-report words that kid text must not use. Matched on the word and on its plain
 * inflections (benefits, participating, specifically). Propose additions here.
 */
export const BLOCKLIST = [
  'benefit', 'benefits', 'method', 'participate', 'participation', 'demonstrate',
  'appropriate', 'obtain', 'prior', 'sufficient', 'assess', 'individual',
  'specific', 'utilize', 'acquire', 'determine', 'identify', 'describe', 'discuss',
  'select', 'locate', 'purchase', 'consume', 'construct', 'require', 'additional',
  'various', 'numerous', 'previous', 'provide', 'indicate', 'observe', 'respond',
  'response', 'option', 'portion', 'process', 'occur', 'ensure', 'maintain', 'aware',
  'consider', 'physical',
];

/**
 * Words from BLOCKLIST that are fine at grade 3 and up. "Physical" is in the Scout Oath;
 * "describe" and "discuss" are ordinary at Arrow of Light. They stay blocked at grade 2.
 */
export const BLOCKLIST_OK_AT_GRADE_5 = ['describe', 'discuss', 'physical'];

/**
 * Long words that pass the syllable and length rules: Scouting terms the content defines
 * or kids hear every week, and ordinary long words kids say. Add a Scouting term only
 * when the content defines it in the same text; do not add "requirement".
 */
export const ALLOWLIST = [
  // Words that are themselves the lesson's subject (My Community voting, first aid), defined where used.
  'majority', 'plurality', 'dehydration',
  // Civics and camping words the lessons define or every Cub Scout hears.
  'citizen', 'citizens', 'overnight', 'campouts',
  // The Scout Oath's own words, and shapes or Cub Scout event names every kid hears.
  'physically', 'mentally', 'morally', 'triangle', 'slingshot', 'pinewood', 'derby',
  // Plain compounds kids say, plus SAFE words the lessons define.
  'handshake', 'toothpaste', 'cardboard', 'skateboard', 'friendship', 'sanitizer', 'assessment', 'backpacks', 'campfires', 'neckerchiefs',
  // Scouting words the content defines or kids hear every week
  'scout', 'scouts', 'scouting', 'bobcat', 'webelos', 'patrol', 'oath', 'law',
  'trustworthy', 'obedient', 'courteous', 'cheerful', 'reverent', 'thrifty',
  'essentials', 'campout', 'campsite', 'campfire', 'compass', 'whistle', 'buddy',
  'uniform', 'neckerchief', 'ceremony', 'adventure', 'adventures', 'america',
  'american', 'conduct',
  // Ordinary long words kids say out loud
  'animal', 'animals', 'family', 'families', 'favorite', 'together', 'remember',
  'tomorrow', 'another', 'everyone', 'everybody', 'anything', 'everything', 'important',
  'exercise', 'exercises', 'energy', 'vegetable', 'vegetables', 'banana', 'strawberry',
  'broccoli', 'tomato', 'potato', 'dinosaur', 'computer', 'library', 'grocery',
  'firefighter', 'playground', 'neighborhood', 'neighbor', 'neighbors', 'emergency',
  'bicycle', 'helmet', 'flashlight', 'sunscreen', 'medical', 'allergies', 'allergy',
  'battery', 'batteries', 'sandwich', 'chocolate', 'calendar', 'holiday', 'holidays',
  'celebrate', 'celebration', 'decorate', 'imagine', 'interesting', 'delicious',
  'beautiful', 'different', 'difficult', 'dangerous', 'careful', 'carefully', 'quietly',
  'suddenly', 'finally', 'usually', 'especially', 'probably', 'actually', 'already',
  'really', 'grandparent', 'grandparents', 'grandmother', 'grandfather', 'telephone',
  'video', 'camera', 'pizza', 'spaghetti', 'ambulance', 'hospital', 'officer',
  'volunteer', 'community', 'recycle', 'recycling', 'material', 'materials', 'equipment',
  'environment', 'supervision', 'nonsectarian',
  // Indefinite pronouns and adverbs, same family as anything and everything
  'something', 'sometimes', 'somewhere', 'somebody', 'anyone', 'anybody', 'anywhere',
  'everywhere', 'nobody',
];

/** Syllable limits and word-length limit by reading level (2 = grade 2 or lower, 5 = grade 3 and up). */
const LEVELS = {
  2: { maxSyllables: 2, maxLetters: 8, maxSentenceWords: 10 },
  5: { maxSyllables: 3, maxLetters: Infinity, maxSentenceWords: 15 },
};

const BLOCK = new Set(BLOCKLIST);
const BLOCK_OK_AT_5 = new Set(BLOCKLIST_OK_AT_GRADE_5);
const ALLOW = new Set(ALLOWLIST);

/** Reading level a grade is held to: grades 0 to 2 behave like 2, grades 3 to 5 like 5. */
export function readingLevel(grade) {
  return Number(grade) <= 2 ? 2 : 5;
}

// ---------------------------------------------------------------------------
// Collecting kid-facing strings

/** Walk `segments` (like ['questions[]', 'choices[]']) through `value`, yielding every string leaf. */
function* walk(value, segments, path) {
  if (segments.length === 0) {
    if (typeof value === 'string' && value.trim() !== '') yield { path, text: value };
    return;
  }
  const [head, ...rest] = segments;
  const isList = head.endsWith('[]');
  const key = isList ? head.slice(0, -2) : head;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  const child = value[key];
  if (child === undefined) return;
  if (isList) {
    if (!Array.isArray(child)) return;
    for (let i = 0; i < child.length; i++) yield* walk(child[i], rest, `${path}.${key}[${i}]`);
  } else {
    yield* walk(child, rest, `${path}.${key}`);
  }
}

function* walkPatterns(value, patterns, path) {
  for (const pattern of patterns) yield* walk(value, pattern.split('.'), path);
}

function* activityStrings(activity, path) {
  if (typeof activity !== 'object' || activity === null) return;
  if (!Object.hasOwn(KID_FACING_FIELDS.params, activity.type)) return;
  yield* walkPatterns(activity.params, KID_FACING_FIELDS.params[activity.type], `${path}.params`);
}

/**
 * Yield `{ path, text }` for every kid-facing string in a parsed rank file, in document
 * order. Paths look like `$.adventures[0].requirements[1].activity.params.questions[0].prompt`.
 * Tolerates malformed input (the schema check reports it) and never yields adult-only text.
 *
 * @param {any} rankFile parsed content/ranks/*.json
 * @returns {Generator<{ path: string, text: string }>}
 */
export function* collectKidStrings(rankFile) {
  if (typeof rankFile !== 'object' || rankFile === null) return;
  const adventures = Array.isArray(rankFile.adventures) ? rankFile.adventures : [];
  for (let ai = 0; ai < adventures.length; ai++) {
    const adv = adventures[ai];
    const ap = `$.adventures[${ai}]`;
    if (typeof adv !== 'object' || adv === null) continue;
    yield* walk(adv, ['summary'], ap);
    const reqs = Array.isArray(adv.requirements) ? adv.requirements : [];
    for (let ri = 0; ri < reqs.length; ri++) {
      const req = reqs[ri];
      const rp = `${ap}.requirements[${ri}]`;
      if (typeof req !== 'object' || req === null) continue;
      yield* walk(req, ['kidText'], rp);
      yield* walk(req, ['lesson', 'lines[]'], rp);
      yield* activityStrings(req.activity, `${rp}.activity`);
      yield* activityStrings(req.practice, `${rp}.practice`);
    }
  }
  const electives = Array.isArray(rankFile.electives) ? rankFile.electives : [];
  for (let ei = 0; ei < electives.length; ei++) yield* walk(electives[ei], ['summary'], `$.electives[${ei}]`);
}

// ---------------------------------------------------------------------------
// Syllables

/**
 * Words the rules below get wrong. Counts are the everyday spoken count, so "every" is
 * two. Keep this short: it is for common words, not a dictionary.
 */
const SYLLABLE_OVERRIDES = new Map(
  Object.entries({
    every: 2, business: 2, rhythm: 2, rhythms: 2, hundred: 2, beyond: 2, lion: 2, lions: 2,
    idea: 3, ideas: 3, area: 3, areas: 3, poem: 2, poems: 2, poet: 2, poets: 2,
    cooperate: 4, cooperation: 5, element: 3, elements: 3, lawyer: 2, science: 2,
    something: 2, sometimes: 2, someone: 2, somebody: 3, somewhere: 2, anyone: 3,
    anybody: 4, anywhere: 3, everyone: 3, everybody: 4, everywhere: 3, everything: 3,
    anything: 3, nobody: 3, homework: 2, lifeguard: 2, baseball: 2, bedtime: 2,
    different: 3, several: 3, evening: 2, family: 3, camera: 3, chocolate: 3, favorite: 3,
    vegetable: 4, interesting: 4, people: 2, being: 2, quiet: 2,
  }),
);

const VOWEL_GROUPS = /[aeiouy]+/g;

/** Vowel pairs that are two syllables ("radio", "giant", "usual"). Each match adds one. */
const HIATUS = [
  /[^cstxq]ia/g, // diary, giant, trial, material, but not special, social, partial
  /[^cstxgnlq]io/g, // radio, studio, serious, violin, but not action, region, million
  /[^cstxgnlq]iu/g, // stadium, medium, aquarium
  /[dvh]eo/g, // video, rodeo, theory
  /[^qg]ua(?=l|te|t)/g, // usual, actual, annual, graduate, but not equal, language
  /iet/g, // quiet, diet, variety, society
  /(?:po|du)e[mt]/g, // poem, poet, duet
  /[aou]y(?=er|or|al|on|ak|ag|ee)/g, // player, mayor, royal, crayon, voyage
  /cre(?=at(?!ur))/g, // create, creative, creating, but not creature
  /^reac(?=t)/g, // react, reaction
  /^real(?=i)/g, // reality, realize
  /^scien/g, // scientist, scientific
  /[rd]ienc/g, // experience, audience, obedience
];

/** Compound starters whose e is silent before the next word: fireplace, homework, sidewalk, somebody. */
const MEDIAL_SILENT_E =
  /^(?:fire|home|life|safe|side|game|time|base|name|space|bike|hike|wave|cake|snake|stone|bone|nose|rose|line|face|place|shape|whale|wire|cave|tape|skate|plane|smoke|rope|pine|some|care)(?=[bcdfghjklmnpqstvwxz][a-z])/;

/** Suffixes that add a full syllable of their own; the base keeps its silent e ("care" + "ful"). */
const SYLLABLE_SUFFIXES = ['ing', 'ly', 'ful', 'less', 'ment', 'ness', 'some'];

/**
 * Estimate the number of syllables in an English word. Counts vowel groups, then adjusts
 * for silent e, silent -ed and -es, consonant+le, qu, a leading y, split vowel pairs, and
 * suffixes like -ing, -ly and -ful. Good enough to separate "game" from "adventure"; it is
 * an estimate, not a dictionary. Returns 0 for text with no letters.
 *
 * @param {string} word
 * @returns {number}
 */
export function syllables(word) {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, '');
  if (w === '') return 0;
  const override = SYLLABLE_OVERRIDES.get(w);
  if (override !== undefined) return override;

  for (const suffix of SYLLABLE_SUFFIXES) {
    if (w.length > suffix.length + 1 && w.endsWith(suffix)) {
      const base = w.slice(0, -suffix.length);
      if (/[aeiouy]/.test(base)) return Math.max(1, syllables(base)) + 1;
    }
  }

  let s = w;
  // "-le" after a consonant is its own syllable (table, tumbled); other endings follow.
  const consonantLe = /[^aeiouyl]le[sd]?$/.test(s);
  if (!consonantLe) {
    let trimmed = s;
    if (/[^aeiouytd]ed$/.test(s)) trimmed = s.slice(0, -2); // walked, loved
    else if (/[^aeiouy]es$/.test(s) && !/(?:[sxzcg]|[cs]h)es$/.test(s)) trimmed = s.slice(0, -2); // makes, cares
    else if (/[^aeiouy]e$/.test(s)) trimmed = s.slice(0, -1); // silent final e: game, hope
    if (/[aeiouy]/.test(trimmed)) s = trimmed;
  }

  s = s.replace(/qu/g, 'q').replace(/^y/, '');
  const groups = s.match(VOWEL_GROUPS);
  let count = groups ? groups.length : 0;
  for (const pattern of HIATUS) count += (s.match(pattern) || []).length;
  if (MEDIAL_SILENT_E.test(s)) count -= 1;
  return Math.max(1, count);
}

// ---------------------------------------------------------------------------
// Words

/** Letters and apostrophes make a word; digits and punctuation separate them. Lowercased. */
export function tokenize(text) {
  const matches = String(text).match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g);
  return matches ? matches.map((m) => m.toLowerCase()) : [];
}

/** Drop a possessive ('s) so "scout's" is checked as "scout". Other apostrophes are kept. */
function cleanWord(token) {
  return token.replace(/['’]s$/, '');
}

/** Letters only, for counting. */
function lettersOf(word) {
  return word.replace(/[^a-z]/g, '');
}

/** The word plus its plain inflections, so "participating" finds "participate". */
function stems(word) {
  const out = new Set([word]);
  const add = (s) => {
    if (s.length >= 3) out.add(s);
  };
  const undouble = (s) => {
    if (s.length > 3 && s[s.length - 1] === s[s.length - 2]) add(s.slice(0, -1));
  };
  if (word.endsWith('ies')) add(`${word.slice(0, -3)}y`);
  if (word.endsWith('ied')) add(`${word.slice(0, -3)}y`);
  if (word.endsWith('es')) add(word.slice(0, -2));
  if (word.endsWith('s') && !word.endsWith('ss')) add(word.slice(0, -1));
  if (word.endsWith('ed')) {
    add(word.slice(0, -2));
    add(word.slice(0, -1));
    undouble(word.slice(0, -2));
  }
  if (word.endsWith('ing')) {
    const base = word.slice(0, -3);
    add(base);
    add(`${base}e`);
    undouble(base);
  }
  if (word.endsWith('ly')) {
    add(word.slice(0, -2));
    if (word.endsWith('ally')) add(word.slice(0, -4));
    if (word.endsWith('ily')) add(`${word.slice(0, -3)}y`);
  }
  return out;
}

/** Why `word` is too hard for `level`, or null when it is fine. `word` is lowercase and clean. */
function flagReason(word, level) {
  // An exact allowlist entry is a deliberate decision (the Scout Oath's own words, for one) and wins.
  if (ALLOW.has(word)) return null;
  const forms = stems(word);
  const rules = LEVELS[level];
  for (const form of forms) {
    if (BLOCK.has(form) && !(level === 5 && BLOCK_OK_AT_5.has(form))) return 'school-report word';
  }
  // Blocked at grade 2 only: fully allowed at grade 3 and up ("physically" is in the Scout Oath).
  if (level === 5) for (const form of forms) if (BLOCK_OK_AT_5.has(form)) return null;
  for (const form of forms) if (ALLOW.has(form)) return null;

  const count = syllables(word);
  if (count > rules.maxSyllables) {
    return `${count} syllables, grade ${level === 2 ? '2' : '5'} allows ${rules.maxSyllables}`;
  }
  // Plural -s does not make a word harder: "backpacks" is as readable as "backpack".
  const base = lettersOf(word).replace(/([^s])s$/, '$1');
  if (base.length > rules.maxLetters) {
    return `${base.length} letters, grade 2 allows ${rules.maxLetters}`;
  }
  return null;
}

/**
 * Check one string for words too hard for `grade`. Each distinct word is reported once.
 * A word is flagged when it is in BLOCKLIST (school-report words), or has too many
 * syllables (3 or more at grade 2 or lower, 4 or more at grade 3 and up), or at grade 2
 * has 9 or more letters, unless it is in ALLOWLIST.
 *
 * @param {string} text
 * @param {number} grade 0 to 5; 0 to 2 are held to the grade 2 rules, 3 to 5 to the grade 5 rules
 * @returns {{ word: string, reason: string }[]}
 */
export function checkVocabulary(text, grade) {
  const level = readingLevel(grade);
  const seen = new Set();
  const found = [];
  for (const token of tokenize(text)) {
    const word = cleanWord(token);
    if (seen.has(word)) continue;
    seen.add(word);
    const reason = flagReason(word, level);
    if (reason) found.push({ word, reason });
  }
  return found;
}

// ---------------------------------------------------------------------------
// Sentences

/** Longest allowed sentence, in words: 10 at grade 2 or lower, 15 at grade 3 and up. */
export function sentenceLimit(grade) {
  return LEVELS[readingLevel(grade)].maxSentenceWords;
}

/** Split on . ! ? (followed by a space or the end) and on line breaks. A "3.5" is not split. */
export function splitSentences(text) {
  return String(text)
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?]['"’”)\]]*)\s+/))
    .map((s) => s.trim())
    .filter((s) => /[A-Za-z0-9]/.test(s));
}

/** Count the words in a sentence: whitespace-separated pieces that contain a letter or digit. */
export function countWords(sentence) {
  return String(sentence)
    .replace(/[—–]/g, ' ')
    .split(/\s+/)
    .filter((piece) => /[A-Za-z0-9]/.test(piece)).length;
}

/**
 * Find sentences longer than the limit for `grade`.
 *
 * @param {string} text
 * @param {number} grade
 * @returns {{ sentence: string, words: number, limit: number }[]}
 */
export function checkSentences(text, grade) {
  const limit = sentenceLimit(grade);
  const long = [];
  for (const sentence of splitSentences(text)) {
    const words = countWords(sentence);
    if (words > limit) long.push({ sentence, words, limit });
  }
  return long;
}

// ---------------------------------------------------------------------------
// Whole rank file

/** First 60 characters on one line, with "..." when cut. For error messages. */
export function snippet(text) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? `${flat.slice(0, 60)}...` : flat;
}

/**
 * Run both checks over every kid-facing string in a rank file, using the file's own
 * `grade`. Returns one entry per flagged word and one per over-long sentence.
 *
 * @param {any} rankFile parsed rank JSON
 * @returns {{
 *   grade: number,
 *   strings: number,
 *   flagged: { path: string, text: string, word: string, reason: string }[],
 *   longSentences: { path: string, text: string, sentence: string, words: number, limit: number }[],
 * }}
 */
export function lintRankVocabulary(rankFile) {
  const grade = typeof rankFile?.grade === 'number' ? rankFile.grade : 2;
  const flagged = [];
  const longSentences = [];
  let strings = 0;
  for (const { path, text } of collectKidStrings(rankFile)) {
    strings++;
    for (const { word, reason } of checkVocabulary(text, grade)) flagged.push({ path, text, word, reason });
    for (const long of checkSentences(text, grade)) longSentences.push({ path, text, ...long });
  }
  return { grade, strings, flagged, longSentences };
}
