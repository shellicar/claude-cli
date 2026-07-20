import { defineTool, ToolOperation } from '@shellicar/claude-sdk';
import { z } from 'zod';
import { type ComposableTool, type EdgeIn, PipeStepError, reconcile } from '../composable';
import { flattenContent, flattenFiles, type Stream, type StreamKind } from '../stream';
import { PipeToolInputSchema } from './schema';

const FatalSchema = z.object({ step: z.number().int(), tool: z.string(), error: z.string(), input: z.unknown() });

const fatal = (step: number, tool: string, error: string, input: unknown) => ({ step, tool, error, input });

// A tool whose declared `in` accepts the current edge. A source (in === null) is valid only at the
// start (edge === null). 'any' accepts either stream kind; otherwise the kinds must match.
function edgeAccepts(toolIn: EdgeIn, edge: StreamKind | null): boolean {
  if (toolIn === null) {
    return edge === null;
  }
  if (edge === null) {
    return false;
  }
  return toolIn === 'any' || toolIn === edge;
}

// 'same' preserves the current edge; otherwise the tool's declared out kind.
function resolveOut(toolOut: 'files' | 'content' | 'same', edge: StreamKind | null): StreamKind {
  return toolOut === 'same' ? (edge as StreamKind) : toolOut;
}

export function createPipe(tools: ComposableTool[]) {
  const registry = new Map(tools.map((t) => [t.name, t]));

  return defineTool({
    name: 'Pipe',
    description: 'Run a sequence of composable read tools as a pipeline. Start with a source (Find, Paths); follow with stages (Read, Match, Head, Tail, Range). Each step writes only its own fields — the stream flows between steps automatically.',
    operation: ToolOperation.Read,
    input_schema: PipeToolInputSchema,
    output_schema: z.union([z.string(), FatalSchema]),
    input_examples: [
      {
        steps: [
          { tool: 'Find', input: { path: 'src', pattern: '\\.ts$' } },
          { tool: 'Read', input: {} },
          { tool: 'Match', input: { pattern: 'TODO' } },
        ],
      },
      {
        steps: [
          { tool: 'Paths', input: { paths: ['src/index.ts'] } },
          { tool: 'Read', input: {} },
          { tool: 'Head', input: { count: 30 } },
        ],
      },
    ],
    handler: async (input) => {
      // ---- PRE-FLIGHT: validate the whole chain by type before running anything ----
      const resolved: { tool: ComposableTool; model: unknown }[] = [];
      let edge: StreamKind | null = null; // null = nothing produced yet; a source must come first
      for (const [i, step] of input.steps.entries()) {
        const tool = registry.get(step.tool);
        if (!tool) {
          return { textContent: fatal(i, step.tool, `Unknown tool. Available: ${[...registry.keys()].join(', ')}`, step.input) };
        }
        if (!edgeAccepts(tool.pipe.in, edge)) {
          const why = edge === null ? `${step.tool} is not a source — a pipe must start with Find or Paths` : `${step.tool} consumes ${tool.pipe.in}, but the previous step emits ${edge}`;
          return { textContent: fatal(i, step.tool, why, step.input) };
        }
        const parsed = tool.model.safeParse(step.input); // MODEL FACE ONLY — no content graft
        if (!parsed.success) {
          return { textContent: fatal(i, step.tool, parsed.error.message, step.input) };
        }
        resolved.push({ tool, model: parsed.data });
        edge = resolveOut(tool.pipe.out, edge);
      }

      // ---- RUN: thread the typed stream through reconcile → run ----
      let stream: Stream | undefined;
      for (const [i, { tool, model }] of resolved.entries()) {
        try {
          const canonical = reconcile(model, stream);
          stream = await tool.run(canonical as never);
        } catch (err) {
          // Run-time fatal: a thrown handler (a PipeStepError for a missing Paths path, an unreadable
          // or binary Read, or any other throw) is mapped to the same fatal object. The raw throw
          // never escapes the pipe.
          const message = err instanceof PipeStepError ? err.message : err instanceof Error ? err.message : String(err);
          return { textContent: fatal(i, tool.name, message, input.steps[i].input) };
        }
      }

      // ---- TERMINUS: flatten the final stream (the fixed projection) ----
      const out = stream as Stream;
      return { textContent: out.kind === 'files' ? flattenFiles(out) : flattenContent(out) };
    },
  });
}
