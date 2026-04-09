import { readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

// Validate changes.jsonl files against the @shellicar/changes JSON schema.
// The schema is generated from this repo's changes.config.json, so the
// allowed categories are baked into the schema and enforced by ajv.

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..');

const schemaPath = resolve(repoRoot, 'schema/shellicar-changes.schema.json');

const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);

async function main() {
  const argvFiles = process.argv.slice(2);
  let files: string[];
  if (argvFiles.length > 0) {
    files = argvFiles;
  } else {
    files = [];
    for await (const entry of glob('**/changes.jsonl', {
      cwd: repoRoot,
      exclude: (p) => p.includes('node_modules') || p.includes('.git') || p.includes('dist'),
    })) {
      files.push(resolve(repoRoot, entry));
    }
    if (files.length === 0) {
      console.error('no changes.jsonl files found');
      process.exit(2);
    }
  }

  type Failure = { file: string; line: number; message: string };
  const failures: Failure[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch (err) {
      failures.push({ file, line: 0, message: `cannot read file: ${(err as Error).message}` });
      continue;
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw === undefined || raw.trim() === '') {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        failures.push({ file, line: i + 1, message: `invalid JSON: ${(err as Error).message}` });
        continue;
      }

      if (!validate(parsed)) {
        failures.push({
          file,
          line: i + 1,
          message: JSON.stringify(validate.errors, null, 2),
        });
        continue;
      }
    }
  }

  if (failures.length > 0) {
    for (const f of failures) {
      console.error(`error validating ${f.file}:${f.line}`);
      console.error(f.message);
    }
    const n = failures.length;
    console.error(`\n${n} error${n === 1 ? '' : 's'}`);
    process.exit(1);
  }

  console.log('no errors found');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
