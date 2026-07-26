import type { FsOperation, Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import type { z } from 'zod';

/** A V2 tool, self-describing the same way a V1 `defineTool` definition is: it carries its own
 *  `model` (zod schema), so the Tools V2 registry never needs a second, hand-copied schema to
 *  validate a stage against — the tool IS the source of truth for its own shape. `operation`
 *  and `run` are exactly `orchestrate-core`'s `ToolV2` contract; `defineToolV2` just pairs that
 *  contract with the description/model a wire tool entry and a stage's input validation both
 *  need. */
export type ToolV2Definition<TSchema extends z.ZodType> = {
  name: string;
  description: string;
  operation: 'none' | FsOperation;
  model: TSchema;
  /** Fills in a value the tool's own injected dependency (e.g. `IFileSystem`) knows, for a
   *  field the schema leaves optional — e.g. `Program.cwd` defaulting to `fs.cwd()`. Runs
   *  once, right after `model.parse()`, so Policy sees the resolved value the same way it
   *  would see an explicitly-supplied one. Deliberately NOT expressed as a schema default:
   *  a schema is a pure data shape and must never depend on an injected runtime dependency
   *  (`fs`, `process`) to be evaluated — that coupling would make the schema itself
   *  untestable in isolation and impossible to reuse against a fake. */
  resolveDefaults?: (input: z.infer<TSchema>) => z.infer<TSchema>;
  run: (input: z.infer<TSchema>, upstream: Stream<unknown> | AsyncIterable<unknown> | undefined, stderr: string[]) => ToolV2Result<string>;
};

export function defineToolV2<TSchema extends z.ZodType>(def: ToolV2Definition<TSchema>): ToolV2Definition<TSchema> {
  return def;
}
