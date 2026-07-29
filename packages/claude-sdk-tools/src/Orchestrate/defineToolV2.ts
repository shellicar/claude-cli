import type { IScopedProvider } from '@shellicar/core-di';
import type { Operation, Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import type { z } from 'zod';
import type { IEnvProvider } from '../exec-shared.js';

/** A V2 tool, self-describing the same way a V1 `defineTool` definition is: it carries its own
 *  `model` (zod schema), so the Tools V2 registry never needs a second, hand-copied schema to
 *  validate a stage against — the tool IS the source of truth for its own shape. `operation`
 *  and `run` are exactly `orchestrate-core`'s `ToolV2` contract; `defineToolV2` just pairs that
 *  contract with the description/model a wire tool entry and a stage's input validation both
 *  need. */
export type ToolV2Definition<TSchema extends z.ZodType> = {
  name: string;
  description: string;
  operation: Operation;
  model: TSchema;
  /** Excludes this tool from `Orchestrate`'s own `stages` composition — it stays individually
   *  callable (still in `wireTools`), it just can't be dropped into a pipe. For a tool whose real
   *  output doesn't fit `Stream<string>` (e.g. `ReadBinaryFile`'s attachment), being composable
   *  would be a lie: piping a PDF into another stage is meaningless. Absent/false is the ordinary
   *  case — every other V2 tool needs no flag at all. */
  excludeFromStages?: boolean;
  /** Fills in a value the tool's own injected dependency (e.g. `IFileSystem`) knows, for a
   *  field the schema leaves optional — e.g. `Program.cwd` defaulting to `fs.cwd()`. Runs
   *  once, right after `model.parse()`, so Policy sees the resolved value the same way it
   *  would see an explicitly-supplied one. Deliberately NOT expressed as a schema default:
   *  a schema is a pure data shape and must never depend on an injected runtime dependency
   *  (`fs`, `process`) to be evaluated — that coupling would make the schema itself
   *  untestable in isolation and impossible to reuse against a fake. */
  resolveDefaults?: (input: z.infer<TSchema>) => z.infer<TSchema>;
  /** The tool's own one-line rendering of its resolved input for display — a human's approval
   *  prompt, the tools block. Same contract as V1's `ToolDefinition.summarize`: only the tool
   *  itself knows which of its fields matter and in what order, so a central display function
   *  never needs a hardcoded case for it. Absent falls back to the generic marked-path display. */
  summarize?: (input: z.infer<TSchema>) => string;
  /** `scope` is the batch's own DI scope (see `OrchestrateEngine.runBatch`), passed to every V2
   *  tool unconditionally — same contract as V1's `ToolHandler`. Only a tool with a genuinely
   *  per-batch-scoped dependency (e.g. the TS tools' shared tsserver process) ever reads it. */
  run: (input: z.infer<TSchema>, upstream: Stream<unknown> | AsyncIterable<unknown> | undefined, stderr: string[], signal?: AbortSignal, scope?: IScopedProvider, env?: IEnvProvider) => ToolV2Result<string>;
};

export function defineToolV2<TSchema extends z.ZodType>(def: ToolV2Definition<TSchema>): ToolV2Definition<TSchema> {
  return def;
}
