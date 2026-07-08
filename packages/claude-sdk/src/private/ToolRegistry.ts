import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaTool } from '@anthropic-ai/sdk/resources/beta.mjs';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { IToolRegistry } from '../public/interfaces';
import { normalisePaths } from '../public/pathSchema';
import { ToolCancelledError } from '../public/ToolCancelledError';
import { ToolRefusedError } from '../public/ToolRefusedError';
import type { AnyToolDefinition, ToolHandler, ToolResolveResult, ToolRunResult, TransformToolResult } from '../public/types';

/**
 * Long-lived tool registry. Constructed once at consumer setup with the tool
 * definitions. Converts each tool's Zod schema to JSON Schema ONCE at
 * construction and caches the result for both wire-format requests and
 * runtime validation.
 *
 * Responsibilities:
 * - Hold the tool definitions.
 * - Provide the wire-format representation (`wireTools`) for the request
 *   builder.
 * - Resolve a tool_use by name: validate input against the cached Zod schema
 *   once, and return either an error (`unavailable` / `rejected`) or a
 *   `ready` result carrying a `run` closure that calls the handler with the
 *   already-parsed input, applies the optional transform hook, and returns
 *   the content (stringified if the handler returned a non-string value).
 *
 * The resolve/run split exists so the query runner can gate handler
 * execution on approval without a second `safeParse`. The query runner's
 * `#handleTools` parses each `tool_use` input once up front and threads
 * the parsed value through the approval machinery to the handler;
 * this registry preserves that single-parse behaviour by capturing the
 * parsed input inside the `run` closure at resolve time.
 *
 * NOT responsibilities:
 * - Approval. The query runner requests approval separately between
 *   `resolve` and `run`.
 * - `tool_result` block construction. The query runner wraps the returned
 *   content in a `tool_result` block with the correct `tool_use_id`.
 * - Conversation or channel knowledge. The registry returns results; the
 *   query runner decides what to do with them, including preserving the
 *   current channel asymmetry (`unavailable` stays silent, the rest broadcast)
 *   (Decision 3 in the session log).
 *
 * See `.claude/plans/sdk-shape.md` (Tool registry block) and
 * `.claude/plans/sdk-refactor-playbook.md` (phase 2 step 2) for the design.
 */
export class ToolRegistry extends IToolRegistry {
  readonly #logger: ILogger;
  readonly #map: Map<string, { definition: AnyToolDefinition; wire: BetaTool }>;
  // Expands ~ and $VAR in a marked path. Defaults to identity so the many
  // `new ToolRegistry(tools, logger)` call sites (SDK tests) keep compiling and
  // behave unchanged; the composition root injects the real fs-bound expander.
  readonly #expand: (p: string) => string;

  // The wire-map is built eagerly in the constructor, so a bad tool schema
  // fails at composition (buildProvider) rather than on first use. The app's
  // composition root supplies the tools and logger through the factory.
  public constructor(tools: readonly AnyToolDefinition[], logger: ILogger, expand: (p: string) => string = (p) => p) {
    super();
    this.#logger = logger;
    this.#expand = expand;
    this.#map = new Map();
    for (const tool of tools) {
      const wire: BetaTool = {
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema.toJSONSchema({ target: 'draft-07', io: 'input' }) as Anthropic.Tool['input_schema'],
        input_examples: tool.input_examples,
      };
      this.#map.set(tool.name, { definition: tool, wire });
    }
  }

  public get wireTools(): BetaTool[] {
    return Array.from(this.#map.values()).map((t) => t.wire);
  }

  // Replace every isPath-marked field in the raw tool input, in place, with its
  // expanded value — once, before display, permission, and handler read it. The
  // resolver descends into a nested tool input (a Pipe step) via its own schema.
  public normaliseInputPaths(name: string, input: Record<string, unknown>): void {
    const schema = this.#map.get(name)?.definition.input_schema;
    if (schema == null) {
      return;
    }
    normalisePaths(schema, input, this.#expand, (toolName) => this.#map.get(toolName)?.definition.input_schema);
  }

  public resolve(name: string, input: unknown): ToolResolveResult {
    const entry = this.#map.get(name);
    if (entry == null) {
      this.#logger.debug('tool_not_found', { name });
      return { kind: 'unavailable', name };
    }

    const parseResult = entry.definition.input_schema.safeParse(input);
    if (!parseResult.success) {
      const reason = parseResult.error.message;
      this.#logger.debug('tool_parse_error', { name, error: parseResult.error });
      return { kind: 'rejected', reason };
    }

    // Capture the parsed input and handler reference at resolve time. The
    // returned closure is invoked later by the query runner once approval
    // has settled, and calls the handler directly with the already-parsed
    // value; there is no second safeParse between resolve and run.
    const parsedInput = parseResult.data;
    const logger = this.#logger;
    const handler = entry.definition.handler as ToolHandler<unknown>;
    const run = async (transform?: TransformToolResult, signal?: AbortSignal): Promise<ToolRunResult> => {
      const startMs = Date.now();
      logger?.debug('tool_call', { name, input });
      try {
        const { textContent, attachments } = await handler(parsedInput, signal);
        logger?.debug('tool_result', { name, output: textContent });
        const transformed = transform ? transform(name, textContent) : textContent;
        const content = typeof transformed === 'string' ? transformed : JSON.stringify(transformed);
        return attachments !== undefined ? { kind: 'ok', content, blocks: attachments } : { kind: 'ok', content };
      } catch (err) {
        if (err instanceof ToolCancelledError) {
          const elapsedMs = Date.now() - startMs;
          logger?.debug('tool_cancelled', { name, elapsedMs });
          return { kind: 'cancelled', elapsedMs };
        }
        if (err instanceof ToolRefusedError) {
          logger?.debug('tool_refused', { name, reason: err.message });
          return { kind: 'refused', reason: err.message };
        }
        const error = err instanceof Error ? err.message : String(err);
        logger?.debug('tool_failed', { name, error });
        return { kind: 'failed', error };
      }
    };

    return { kind: 'ready', run };
  }
}
