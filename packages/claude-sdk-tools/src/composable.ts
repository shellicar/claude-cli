import { type AnyToolDefinition, defineTool, ToolOperation } from '@shellicar/claude-sdk';
import { z } from 'zod';
import { type ContentStream, type FilesStream, flattenContent, flattenFiles, type Stream } from './stream';

// Edge tokens. A stage may declare 'any' (accepts either kind) and 'same' (emits what it received).
export type EdgeIn = 'files' | 'content' | 'any' | null; // null = source (no upstream)
export type EdgeOut = 'files' | 'content' | 'same';

// Edge token → its stream value, for typing reconcile/run. 'any' widens to the union.
type StreamForNonNull<K extends EdgeIn> = K extends 'files' ? FilesStream : K extends 'content' ? ContentStream : Stream;
type StreamOut<K extends EdgeOut> = K extends 'files' ? FilesStream : K extends 'content' ? ContentStream : Stream; // 'same' → union

// Canonical = the model fields plus the consumed stream (absent for a source).
export type Canonical<M, TIn extends EdgeIn> = TIn extends null ? M : M & { input: StreamForNonNull<TIn> };

export type ComposableTool<TModel extends z.ZodType = z.ZodType, TIn extends EdgeIn = EdgeIn, TOut extends EdgeOut = EdgeOut> = {
  name: string;
  description: string;
  operation: 'read';

  // FACE 1 — MODEL. Pure: the fields the model writes for this tool and only those. Never imports a
  // stream schema; no `content`/`input` field; no field made optional for a pipe position. This is
  // the wire schema when the tool is registered standalone.
  model: TModel;
  input_examples: z.input<TModel>[];

  // FACE 2 — PIPE. Edge types as tokens, NOT schemas. `in: null` declares a source. The only thing
  // Pipe type-checks.
  pipe: { in: TIn; out: TOut };

  // FACE 3 — CANONICAL: `run` sees only the canonical the reconciler builds — never `model` (the
  // schema) or `pipe`. The reconciler itself is `reconcileDefault`, applied once by whoever runs the
  // tool (the Pipe, or `toStandalone`), so the model/stream bridge lives in exactly one place.
  run: (canonical: Canonical<z.output<TModel>, TIn>) => Promise<StreamOut<TOut>>;
};

/** The reconciler — the sole place model and stream meet. A stage grafts the upstream stream under a
 *  fixed `input` key; a source has no upstream and passes its model through. Applied once by the Pipe
 *  / toStandalone runner, not declared per tool. */
export function reconcile(model: unknown, upstream: Stream | undefined): unknown {
  return upstream === undefined ? model : { ...(model as object), input: upstream };
}

export function defineComposable<TModel extends z.ZodType, TIn extends EdgeIn, TOut extends EdgeOut>(def: ComposableTool<TModel, TIn, TOut>): ComposableTool<TModel, TIn, TOut> {
  return def;
}

/** Thrown by a stage/source handler when it cannot act on an item. Pipe catches it and builds the
 *  fatal `{ step, tool, error, input }` object. A fatal error aborts the pipe. */
export class PipeStepError extends Error {}

/** Adapt a composable source for top-level registration: wire schema = its model; output = the
 *  flattened terminus text. A thrown PipeStepError (or any error) becomes a fatal object. */
export function toStandalone(t: ComposableTool): AnyToolDefinition {
  // The erase boundary: `t.model` is the generic `z.ZodType`, so defineTool infers an `unknown`
  // input face. AnyToolDefinition is that same erased form (see its `ToolHandler<never>` note), so
  // the standalone tool is reconciled to it here, the one place model and registry meet.
  const tool = defineTool({
    name: t.name,
    description: t.description,
    operation: ToolOperation.Read,
    input_schema: t.model,
    output_schema: z.union([z.string(), z.object({ tool: z.string(), error: z.string() })]),
    input_examples: t.input_examples as Record<string, unknown>[],
    handler: async (model: unknown) => {
      try {
        const out = await t.run(reconcile(model, undefined) as never);
        return { textContent: out.kind === 'files' ? flattenFiles(out) : flattenContent(out) };
      } catch (err) {
        return { textContent: { tool: t.name, error: err instanceof Error ? err.message : String(err) } };
      }
    },
  });
  // ToolHandler<never> contravariance makes neither face assignable to the other directly; the
  // erase cast is the documented move at this boundary (see AnyToolDefinition's note).
  return tool as unknown as AnyToolDefinition;
}
