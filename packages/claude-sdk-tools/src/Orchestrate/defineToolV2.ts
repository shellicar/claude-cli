import type { IScopedProvider } from '@shellicar/core-di';
import type { Operation, Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import type { IEnvProvider } from '../exec-shared.js';

/** Meta key marking the one field an `Xargs` stage fills from what was piped into it. Same
 *  mechanism as `isPath`: the mark rides on the schema, so the tool stays the single source of
 *  truth for its own shape and a caller never names the field. */
export const XARGS_TARGET = 'xargsTarget';

/** The array field piped values are collected into. `Program.args` and `Read.paths` are the shape:
 *  the tool's own argument list, the way a command's argv is what real `xargs` appends to. */
export function xargsTarget<TSchema extends z.ZodType>(schema: TSchema): TSchema {
  return schema.meta({ [XARGS_TARGET]: true }) as TSchema;
}

function unwrap(schema: z.ZodType): z.ZodType {
  let current = schema;
  while (current instanceof z.ZodOptional || current instanceof z.ZodNullable || current instanceof z.ZodDefault) {
    current = current.unwrap() as z.ZodType;
  }
  return current;
}

/** The mark is read from the field as written and from what it wraps, since marking an already
 *  optional field puts it on the wrapper while marking a bare one puts it on the type itself. */
function isMarked(field: z.ZodType): boolean {
  const meta = field.meta() as Record<string, unknown> | undefined;
  const innerMeta = unwrap(field).meta() as Record<string, unknown> | undefined;
  return meta?.[XARGS_TARGET] === true || innerMeta?.[XARGS_TARGET] === true;
}

/** Every field of a tool's own model carrying the mark. More than one is a defect in the tool,
 *  which is why `defineToolV2` refuses it rather than leaving a pipeline to discover it. */
export function xargsTargetKeys(model: z.ZodType): string[] {
  const object = unwrap(model);
  if (!(object instanceof z.ZodObject)) {
    return [];
  }
  return Object.entries(object.shape as Record<string, z.ZodType>)
    .filter(([, field]) => isMarked(field))
    .map(([key]) => key);
}

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
  /** Settles the parts of this tool's input only it knows how to settle, before the stage is
   *  judged. `Program` resolves `$NAME` in its command line here, against the environment the call
   *  will spawn under, so a rule matching on arguments sees the arguments the process receives
   *  rather than the text that produced them. */
  settleInput?: (input: z.infer<TSchema>, env: IEnvProvider) => z.infer<TSchema>;
  /** Whether this tool reads what a `|` pipes into it. False (the default) means a pipe into it
   *  would be discarded, so the join is rejected up front instead of silently producing nothing;
   *  such a tool takes piped values through an `Xargs` and its marked field instead. */
  readsUpstream?: boolean;
  /** `scope` is the batch's own DI scope (see `OrchestrateEngine.runBatch`), passed to every V2
   *  tool unconditionally — same contract as V1's `ToolHandler`. Only a tool with a genuinely
   *  per-batch-scoped dependency (e.g. the TS tools' shared tsserver process) ever reads it. */
  run: (input: z.infer<TSchema>, upstream: Stream<unknown> | AsyncIterable<unknown> | undefined, stderr: string[], signal?: AbortSignal, scope?: IScopedProvider, env?: IEnvProvider) => ToolV2Result<string>;
};

export function defineToolV2<TSchema extends z.ZodType>(def: ToolV2Definition<TSchema>): ToolV2Definition<TSchema> {
  const targets = xargsTargetKeys(def.model);
  if (targets.length > 1) {
    throw new Error(`${def.name}: a tool can mark at most one xargs target field, but marks ${targets.join(', ')}`);
  }
  return def;
}
