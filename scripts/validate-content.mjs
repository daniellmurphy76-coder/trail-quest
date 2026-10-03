import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, '..', 'content', 'schema', 'rank.schema.json');

/** Default location of the rank content files. */
export const RANKS_DIR = resolve(here, '..', 'content', 'ranks');

const ZONES = ['base-camp', 'fitness-field', 'nature-trail', 'town-square', 'safety-station', 'campfire-circle'];

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const nonEmptyArray = (v) => Array.isArray(v) && v.length > 0;

function buildValidator() {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

/** Per-type required-keys checks on activity params. Mirrors src/activities/types.ts. */
function checkParams(type, params, path, err) {
  if (!isObj(params)) {
    err(path, 'params must be an object');
    return;
  }
  const need = (key, test, what) => {
    if (!(key in params)) err(`${path}.${key}`, `missing required key "${key}" for ${type}`);
    else if (!test(params[key])) err(`${path}.${key}`, `"${key}" must be ${what}`);
  };
  const needZone = () => {
    need('zone', isStr, 'a non-empty string');
    if (isStr(params.zone) && !ZONES.includes(params.zone)) {
      err(`${path}.zone`, `unknown zone "${params.zone}" (expected one of ${ZONES.join(', ')})`);
    }
  };

  switch (type) {
    case 'quiz': {
      need('questions', nonEmptyArray, 'a non-empty array');
      if (Array.isArray(params.questions)) {
        params.questions.forEach((q, i) => {
          const qp = `${path}.questions[${i}]`;
          if (!isObj(q)) return err(qp, 'question must be an object');
          if (!isStr(q.prompt)) err(`${qp}.prompt`, 'missing or empty prompt');
          if (!Array.isArray(q.choices)) err(`${qp}.choices`, 'choices must be an array');
          if (typeof q.answer !== 'number' || !Number.isInteger(q.answer)) {
            err(`${qp}.answer`, 'answer must be an integer index');
          } else if (Array.isArray(q.choices) && (q.answer < 0 || q.answer >= q.choices.length)) {
            err(`${qp}.answer`, `answer ${q.answer} is out of range for ${q.choices.length} choice(s)`);
          }
        });
      }
      break;
    }
    case 'sequence':
      need('prompt', isStr, 'a non-empty string');
      need('steps', (v) => Array.isArray(v) && v.length >= 3, 'an array of at least 3 steps');
      break;
    case 'sort': {
      need('prompt', isStr, 'a non-empty string');
      need('bins', nonEmptyArray, 'a non-empty array');
      need('items', nonEmptyArray, 'a non-empty array');
      if (Array.isArray(params.bins) && Array.isArray(params.items)) {
        const binIds = new Set(params.bins.map((b) => b && b.id));
        params.items.forEach((it, i) => {
          if (!isObj(it) || !binIds.has(it.bin)) {
            err(`${path}.items[${i}].bin`, `bin "${isObj(it) ? it.bin : it}" does not match any bins[].id`);
          }
        });
      }
      break;
    }
    case 'collect':
      need('prompt', isStr, 'a non-empty string');
      needZone();
      need('targets', nonEmptyArray, 'a non-empty array');
      break;
    case 'navigate':
      need('prompt', isStr, 'a non-empty string');
      needZone();
      need('waypoints', nonEmptyArray, 'a non-empty array');
      break;
    case 'rhythm':
      need('prompt', isStr, 'a non-empty string');
      need('exercise', isStr, 'a non-empty string');
      need('reps', (v) => typeof v === 'number', 'a number');
      break;
    case 'craft':
      need('prompt', isStr, 'a non-empty string');
      need('result', isStr, 'a non-empty string');
      need('ingredients', nonEmptyArray, 'a non-empty array');
      break;
    case 'fieldMission':
      need('title', isStr, 'a non-empty string');
      need('kidSteps', nonEmptyArray, 'a non-empty array');
      break;
    default:
      break; // unknown types are reported by the JSON Schema enum
  }
}

function checkActivity(activity, path, err) {
  if (isObj(activity) && typeof activity.type === 'string') {
    checkParams(activity.type, activity.params, `${path}.params`, err);
  }
}

/** Cross-reference and params checks that JSON Schema cannot express. */
function checkSemantics(data, err) {
  if (!isObj(data) || !Array.isArray(data.adventures)) return;
  const adventureIds = new Set();
  const requirementIds = new Set();

  data.adventures.forEach((adv, ai) => {
    const ap = `$.adventures[${ai}]`;
    if (!isObj(adv)) return;
    if (typeof adv.id === 'string') {
      if (adventureIds.has(adv.id)) err(`${ap}.id`, `duplicate adventure id "${adv.id}"`);
      adventureIds.add(adv.id);
    }
    const reqIds = new Set();
    const reqs = Array.isArray(adv.requirements) ? adv.requirements : [];
    reqs.forEach((req, ri) => {
      const rp = `${ap}.requirements[${ri}]`;
      if (!isObj(req)) return;
      if (typeof req.id === 'string') {
        if (requirementIds.has(req.id)) err(`${rp}.id`, `duplicate requirement id "${req.id}"`);
        requirementIds.add(req.id);
        reqIds.add(req.id);
        if (typeof adv.id === 'string' && !req.id.startsWith(`${adv.id}.`)) {
          err(`${rp}.id`, `requirement id "${req.id}" must start with "${adv.id}."`);
        }
      }
      checkActivity(req.activity, `${rp}.activity`, err);
      if (req.practice !== undefined) checkActivity(req.practice, `${rp}.practice`, err);
    });
    if (isObj(adv.choose) && Array.isArray(adv.choose.from)) {
      adv.choose.from.forEach((ref, ci) => {
        if (!reqIds.has(ref)) {
          err(`${ap}.choose.from[${ci}]`, `"${ref}" is not a requirement id in adventure "${adv.id}"`);
        }
      });
    }
  });
}

/** Convert an Ajv instancePath like /adventures/0/id into a JSON path like $.adventures[0].id */
function toJsonPath(instancePath) {
  const parts = instancePath.split('/').slice(1);
  let out = '$';
  for (const p of parts) out += /^\d+$/.test(p) ? `[${p}]` : `.${p}`;
  return out;
}

/**
 * Validate every *.json file in `dir` against content/schema/rank.schema.json plus
 * extra semantic checks. Returns { files, errors } with human-readable messages.
 */
export function validateRankFiles(dir) {
  const validate = buildValidator();
  const errors = [];
  let names = [];
  try {
    names = readdirSync(dir)
      .filter((n) => n.endsWith('.json'))
      .sort();
  } catch (e) {
    if (!e || e.code !== 'ENOENT') throw e;
  }

  for (const name of names) {
    const err = (path, msg) => errors.push(`${name} ${path}: ${msg}`);
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    } catch (e) {
      err('$', `invalid JSON (${e.message})`);
      continue;
    }
    if (!validate(data)) {
      for (const e of validate.errors ?? []) {
        const extra = e.params && e.params.additionalProperty ? ` "${e.params.additionalProperty}"` : '';
        err(toJsonPath(e.instancePath), `${e.message}${extra}`);
      }
    }
    checkSemantics(data, err);
  }
  return { files: names.length, errors };
}
