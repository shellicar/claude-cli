import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta.mjs';
import { IToolRegistry } from '../public/interfaces';
import type { AnyToolDefinition, ILogger, ToolExecuteResult, TransformToolResult } from '../public/types';

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
 * - Execute a tool by name: validate input against the cached Zod schema,
 *   call the handler, apply an optional transform hook to the output, return
 *   the content (stringified if the handler returned a non-string value).
 *
 * NOT responsibilities:
 * - Approval. The query runner requests approval separately before calling
 *   `execute`.
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
  readonly #tools: Map<string, { definition: AnyToolDefinition; wire: BetaToolUnion }>;

  public constructor(tools: AnyToolDefinition[], logger?: ILogger) {
    super();
    this.#logger = logger;
    this.#tools = new Map();
    for (const tool of tools) {
      const wire: BetaToolUnion = {
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema.toJSONSchema({ target: 'draft-07', io: 'input' }) as Anthropic.Tool['input_schema'],
        input_examples: tool.input_examples,
      };
      this.#tools.set(tool.name, { definition: tool, wire });
    }
  }

  public get wireTools(): BetaToolUnion[] {
    return Array.from(this.#tools.values()).map((t) => t.wire);
  }

  public async execute(name: string, input: unknown, transform?: TransformToolResult): Promise<ToolExecuteResult> {
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

    this.#logger?.debug('tool_call', { name, input });
    const handler = entry.definition.handler as (input: unknown) => Promise<unknown>;
    try {
      const output = await handler(parseResult.data);
      this.#logger?.debug('tool_result', { name, output });
      const transformed = transform ? transform(name, output) : output;
      const content = typeof transformed === 'string' ? transformed : JSON.stringify(transformed);
      return { kind: 'success', content };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.#logger?.debug('tool_handler_error', { name, error: message });
      return { kind: 'handler_error', error: message };
    }
  }
}
