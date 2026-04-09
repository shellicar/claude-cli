import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

const ConfigSchema = z.object({
  categories: z.record(z.string(), z.string()),
});

const config = ConfigSchema.parse(JSON.parse(readFileSync('../changes.config.json', 'utf-8')));

const categoryKeys = Object.keys(config.categories);
if (categoryKeys.length === 0) {
  throw new Error('changes.config.json has no categories defined');
}

const ChangeEntry = z.object({
  type: z.literal('change').optional(),
  description: z.string(),
  category: z.enum(categoryKeys as [string, ...string[]]),
  semver: z.enum(['major', 'minor', 'patch']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

const ReleaseMarker = z.object({
  type: z.literal('release'),
  version: z.string(),
  date: z.string(),
  tag: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

const Entry = z.union([ReleaseMarker, ChangeEntry]);

const outfile = '../schema/shellicar-changes.schema.json';

const schema = Entry.toJSONSchema({ target: 'draft-07', io: 'input' });
const json = JSON.stringify(schema, null, 2);

writeFileSync(outfile, json);
