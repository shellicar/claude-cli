import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaTool } from '@anthropic-ai/sdk/resources/beta.mjs';
import { IToolRegistry } from '../public/interfaces';
import type { AnyToolDefinition, ILogger, ToolResolveResult, ToolRunResult, TransformToolResult } from '../public/types';

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
 *   once, and return either an error (`not_found` / `invalid_input`) or a
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
 *   current tool-not-found vs invalid-input channel-send asymmetry
 *   (Decision 3 in the session log).
 *
 * See `.claude/plans/sdk-shape.md` (Tool registry block) and
 * `.claude/plans/sdk-refactor-playbook.md` (phase 2 step 2) for the design.
 */
export class ToolRegistry extends IToolRegistry {
  readonly #logger: ILogger | undefined;
  readonly #tools: Map<string, { definition: AnyToolDefinition; wire: BetaTool }>;

  public constructor(tools: AnyToolDefinition[], logger?: ILogger) {
    super();
    this.#logger = logger;
    this.#tools = new Map();
    for (const tool of tools) {
      const wire: BetaTool = {
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema.toJSONSchema({ target: 'draft-07', io: 'input' }) as Anthropic.Tool['input_schema'],
        input_examples: tool.input_examples,
      };
      this.#tools.set(tool.name, { definition: tool, wire });
    }
  }

  public get wireTools(): BetaTool[] {
    return Array.from(this.#tools.values()).map((t) => t.wire);
  }

  public resolve(name: string, input: unknown): ToolResolveResult {
    const entry = this.#tools.get(name);
    if (entry == null) {
      this.#logger?.debug('tool_not_found', { name });
      return { kind: 'not_found' };
    }

    const parseResult = entry.definition.input_schema.safeParse(input);
    if (!parseResult.success) {
      const error = parseResult.error.message;
      this.#logger?.debug('tool_parse_error', { name, error: parseResult.error });
      return { kind: 'invalid_input', error };
    }

    // Capture the parsed input and handler reference at resolve time. The
    // returned closure is invoked later by the query runner once approval
    // has settled, and calls the handler directly with the already-parsed
    // value; there is no second safeParse between resolve and run.
    const parsedInput = parseResult.data;
    const logger = this.#logger;
    const handler = entry.definition.handler as (input: unknown) => Promise<unknown>;
    const run = async (transform?: TransformToolResult): Promise<ToolRunResult> => {
      logger?.debug('tool_call', { name, input });
      try {
        const output = await handler(parsedInput);
        logger?.debug('tool_result', { name, output });
        const transformed = transform ? transform(name, output) : output;
        const content = typeof transformed === 'string' ? transformed : JSON.stringify(transformed);
        return { kind: 'success', content };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger?.debug('tool_handler_error', { name, error: message });
        return { kind: 'handler_error', error: message };
      }
    };

    return { kind: 'ready', run };
  }
}
