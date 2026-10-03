/**
 * Content lint: schema, semantic checks, and the grade-level vocabulary and
 * sentence-length rules in scripts/vocabulary.mjs. Exits 1 on any error.
 *
 *   node scripts/lint-content.mjs               every error
 *   node scripts/lint-content.mjs --vocab-only  only vocabulary and sentence-length errors
 *   node scripts/lint-content.mjs --summary     flagged words per file and the 25 most frequent
 *
 * The flags only change what is printed. The exit code still reflects every error, so a
 * schema error is never hidden behind a clean vocabulary run.
 */
import { RANKS_DIR, validateRankFiles } from './validate-content.mjs';

const TOP_WORDS = 25;
const OPTIONS = ['--vocab-only', '--summary'];

const args = process.argv.slice(2);
const unknown = args.filter((a) => !OPTIONS.includes(a));
if (unknown.length > 0) {
  console.error(`unknown option(s): ${unknown.join(' ')}`);
  console.error(`usage: node scripts/lint-content.mjs [${OPTIONS.join('] [')}]`);
  process.exit(2);
}
const vocabOnly = args.includes('--vocab-only');
const summary = args.includes('--summary');

/** Count flagged words across all files: word -> { count, reason, perFile }. */
function frequentWords(reports) {
  const words = new Map();
  for (const report of reports) {
    for (const { word, reason } of report.flagged) {
      const entry = words.get(word) ?? { word, count: 0, reason, perFile: new Map() };
      entry.count++;
      entry.perFile.set(report.file, (entry.perFile.get(report.file) ?? 0) + 1);
      words.set(word, entry);
    }
  }
  return [...words.values()].sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}

function printSummary(reports) {
  if (reports.length === 0) {
    console.log('no rank files to summarize');
    return;
  }
  console.log('Flagged words per file (one count per word per string)');
  for (const r of reports) {
    const distinct = new Set(r.flagged.map((f) => f.word)).size;
    console.log(
      `  ${r.file} (grade ${r.grade}): ${r.flagged.length} flagged words (${distinct} distinct) ` +
        `in ${r.strings} strings, ${r.longSentences.length} sentences over the limit`,
    );
  }
  const top = frequentWords(reports).slice(0, TOP_WORDS);
  console.log(`\nTop ${TOP_WORDS} flagged words`);
  if (top.length === 0) console.log('  none');
  const width = Math.max(0, ...top.map((t) => t.word.length));
  for (const t of top) {
    const files = [...t.perFile].map(([file, n]) => `${file.replace(/\.json$/, '')} ${n}`).join(', ');
    console.log(`  ${String(t.count).padStart(4)}  ${t.word.padEnd(width)}  ${t.reason}  [${files}]`);
  }
}

const { files, errors, vocabulary } = validateRankFiles(RANKS_DIR);

if (summary) {
  printSummary(vocabulary.reports);
  const other = errors.length - vocabulary.errors.length;
  if (other > 0) console.error(`\n${other} non-vocabulary error(s); run without --summary to see them`);
} else {
  const shown = vocabOnly ? vocabulary.errors : errors;
  for (const e of shown) console.error(e);
  if (vocabOnly && errors.length > vocabulary.errors.length) {
    console.error(`\n(${errors.length - vocabulary.errors.length} non-vocabulary error(s) hidden; run without --vocab-only)`);
  }
  if (shown.length > 0) console.error(`\n${shown.length} error(s) in ${files} file(s)`);
}

if (errors.length > 0) process.exit(1);
if (!summary) {
  if (files === 0) {
    console.log('note: no rank files found in content/ranks yet; nothing to lint');
  } else {
    console.log(`ok: ${files} file(s)`);
  }
}
