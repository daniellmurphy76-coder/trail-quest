import { RANKS_DIR, validateRankFiles } from './validate-content.mjs';

const { files, errors } = validateRankFiles(RANKS_DIR);

if (errors.length > 0) {
  for (const e of errors) console.error(e);
  console.error(`\n${errors.length} error(s) in ${files} file(s)`);
  process.exit(1);
}
if (files === 0) {
  console.log('note: no rank files found in content/ranks yet; nothing to lint');
} else {
  console.log(`ok: ${files} file(s)`);
}
