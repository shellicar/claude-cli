import EventEmitter from 'node:events';
import { GREEN, RED, RESET } from '@shellicar/claude-core/ansi';

type ToolObjectEvents = { change: [] };

/**
 * Display state for a single tool use — server or client — within a response.
 *
 *   client: streaming → pending → denied | running → cancelling → cancelled | ok | failed
 *   server: streaming → pending → done
 *
 * Emits `change` on every state mutation so subscribers can redraw without
 * being explicitly driven by the caller.
 */
export type ToolKind = 'client' | 'server';

export type ToolPhase =
  | 'streaming' // receiving input deltas
  | 'pending' // client: input complete, resolved view shown, awaiting approval; server: awaiting result
  | 'denied' // client: user denied ✘
  | 'running' // client: user approved ✔, execution in flight
  | 'cancelling' // client: ESC requested, waiting for the handler to unwind
  | 'cancelled' // client: execution aborted ✔ ‼️
  | 'ok' // client: execution succeeded ✔ ✅
  | 'failed' // client: execution errored ✔ ❌
  | 'error' // pre-run failure (lookup miss, exception before a handler ran) 💥
  | 'done'; // server: result received ✅

/** Display snapshot of a tool use for the history view. Built by toEntry(). */
export type ToolEntry = {
  name: string;
  kind: ToolKind;
  input: Record<string, unknown> | null;
  output: string | null;
  phase: ToolPhase;
};

export class ToolObject {
  public readonly id: string;
  public readonly kind: ToolKind;
  public readonly name: string;
  #partialInput = '';
  #resolvedView: string | null = null;
  #input: Record<string, unknown> | null = null;
  #output: string | null = null;
  #resultLine: string | null = null;
  #phase: ToolPhase = 'streaming';
  // Set by every mutator, cleared by render(). Caching is safe because the Anthropic API streams
  // content blocks sequentially, never interleaved: at any instant at most one tool in a batch is
  // actually changing, so #redrawTools (AgentMessageHandler) re-rendering every tool on every single
  // tool's change was pure waste for every object except the one that just mutated — not merely
  // usually stale-free, but *always* stale-free, since a tool that isn't the one which just emitted
  // 'change' cannot have mutated concurrently.
  #dirty = true;
  #cachedRender = '';
  readonly #emitter = new EventEmitter<ToolObjectEvents>();

  public constructor(id: string, kind: ToolKind, name: string) {
    this.id = id;
    this.kind = kind;
    this.name = name;
  }

  public on(event: 'change', listener: () => void): void {
    this.#emitter.on(event, listener);
  }

  /** Accumulate streaming JSON. */
  public appendInput(chunk: string): void {
    this.#partialInput += chunk;
    this.#dirty = true;
    this.#emitter.emit('change');
  }

  /**
   * Transition to the resolved view — visible while the user is asked to approve
   * (client) or while waiting for the server result (server).
   */
  public resolve(view: string): void {
    this.#resolvedView = view;
    this.#phase = 'pending';
    this.#dirty = true;
    this.#emitter.emit('change');
  }
  public approve(): void {
    this.#phase = 'running';
    this.#dirty = true;
    this.#emitter.emit('change');
  }

  /** ESC requested while running; the handler has not yet unwound. */
  public cancelling(): void {
    if (this.#phase !== 'running') {
      return;
    }
    this.#phase = 'cancelling';
    this.#dirty = true;
    this.#emitter.emit('change');
  }

  /** Terminal: the handler unwound on cancellation (ToolCancelledError). */
  public cancel(): void {
    this.#phase = 'cancelled';
    this.#dirty = true;
    this.#emitter.emit('change');
  }

  /** Terminal: the tool_result arrived clean. */
  public succeed(): void {
    this.#phase = 'ok';
    this.#dirty = true;
    this.#emitter.emit('change');
  }

  /** Terminal: the tool_result arrived with isError, not a cancel. */
  public fail(): void {
    this.#phase = 'failed';
    this.#dirty = true;
    this.#emitter.emit('change');
  }

  public deny(): void {
    this.#phase = 'denied';
    this.#dirty = true;
    this.#emitter.emit('change');
  }

  public error(): void {
    this.#phase = 'error';
    this.#dirty = true;
    this.#emitter.emit('change');
  }

  /** Server tool result received. */
  public complete(): void {
    this.#phase = 'done';
    this.#dirty = true;
    this.#emitter.emit('change');
  }

  /** Record the tool's fully-parsed input. Emits change to drive a redraw. */
  public setInput(input: Record<string, unknown>): void {
    this.#input = input;
    this.#dirty = true;
    this.#emitter.emit('change');
  }

  /** Record the tool's result content (post-transform). Emits change to drive a redraw. */
  public setOutput(output: string): void {
    this.#output = output;
    this.#dirty = true;
    this.#emitter.emit('change');
  }

  /** A short result-derived suffix (e.g. SearchMemory's hit count + top title), appended to the rendered line once the tool_result arrives. */
  public setResultLine(line: string): void {
    this.#resultLine = line;
    this.#dirty = true;
    this.#emitter.emit('change');
  }

  /** Snapshot for the history view. The render() summary is unchanged and still drives Primary. */
  public toEntry(): ToolEntry {
    return { name: this.name, kind: this.kind, input: this.#input, output: this.#output, phase: this.#phase };
  }

  /**
   * Current display line for this tool. Trailing \n in all non-streaming phases. Memoised: cheap to
   * call for every tool in a batch on every single tool's change (see #redrawTools in
   * AgentMessageHandler), since only the mutated object's cache is actually stale.
   */
  public render(): string {
    if (!this.#dirty) {
      return this.#cachedRender;
    }
    this.#cachedRender = this.#computeRender();
    this.#dirty = false;
    return this.#cachedRender;
  }

  #computeRender(): string {
    const suffix = this.#resultLine ? ` \u2192 ${this.#resultLine}` : '';
    switch (this.#phase) {
      case 'streaming':
        return `${this.kind === 'server' ? '🌐 ' : ''}${this.name}${this.#partialInput}`;
      case 'pending':
        return this.kind === 'server'
          ? // biome-ignore lint/style/noNonNullAssertion: pending is only reached via resolve()
            `🌐 ${this.#resolvedView!}\n`
          : // biome-ignore lint/style/noNonNullAssertion: pending is only reached via resolve()
            `${this.#resolvedView!}\n`;
      case 'running':
        // biome-ignore lint/style/noNonNullAssertion: running is only reached after resolve()
        return `${GREEN}\u2714${RESET} ${this.#resolvedView!}\n`;
      case 'cancelling':
        // biome-ignore lint/style/noNonNullAssertion: cancelling is only reached after resolve()
        return `${GREEN}\u2714${RESET} ${this.#resolvedView!} \u2757\n`;
      case 'cancelled':
        // biome-ignore lint/style/noNonNullAssertion: cancelled is only reached after resolve()
        return `${GREEN}\u2714${RESET} ${this.#resolvedView!} \u203c\ufe0f${suffix}\n`;
      case 'ok':
        // biome-ignore lint/style/noNonNullAssertion: ok is only reached after resolve()
        return `${GREEN}\u2714${RESET} ${this.#resolvedView!} \u2705${suffix}\n`;
      case 'failed':
        // biome-ignore lint/style/noNonNullAssertion: failed is only reached after resolve()
        return `${GREEN}\u2714${RESET} ${this.#resolvedView!} \u274c${suffix}\n`;
      case 'denied':
        // biome-ignore lint/style/noNonNullAssertion: denied is only reached after resolve()
        return `${RED}\u2718${RESET} ${this.#resolvedView!}\n`;
      case 'error':
        return `${this.#resolvedView ?? this.name} 💥\n`;
      case 'done':
        // biome-ignore lint/style/noNonNullAssertion: done is only reached after resolve()
        return `🌐 ${this.#resolvedView!} ✅${suffix}\n`;
    }
  }
}
