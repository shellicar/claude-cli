/**
 * Display state for a single tool use — server or client — within a response.
 *
 * Phase progression:
 *   client: streaming → pending → approved | denied | error
 *   server: streaming → pending → done
 *
 * AgentMessageHandler holds the ordered list of these and rebuilds the tools
 * active block from `toolOrder.map(id => toolObjects.get(id).render()).join('')`
 * on every state change.
 */
export type ToolKind = 'client' | 'server';

type Phase =
  | 'streaming' // receiving input deltas
  | 'pending' // client: input complete, resolved view shown, awaiting approval; server: awaiting result
  | 'approved' // client: user approved ✅
  | 'denied' // client: user denied ❌
  | 'error' // client: handler error 💥
  | 'done'; // server: result received ✅

export class ToolObject {
  public readonly id: string;
  public readonly kind: ToolKind;
  public readonly name: string;
  #partialInput = '';
  #resolvedView: string | null = null;
  #phase: Phase = 'streaming';

  public constructor(id: string, kind: ToolKind, name: string) {
    this.id = id;
    this.kind = kind;
    this.name = name;
  }

  /** Accumulate streaming JSON. */
  public appendInput(chunk: string): void {
    this.#partialInput += chunk;
  }

  /**
   * Transition to the resolved view — visible while the user is asked to approve
   * (client) or while waiting for the server result (server).
   */
  public resolve(view: string): void {
    this.#resolvedView = view;
    this.#phase = 'pending';
  }

  public approve(): void {
    this.#phase = 'approved';
  }

  public deny(): void {
    this.#phase = 'denied';
  }

  public error(): void {
    this.#phase = 'error';
  }

  /** Server tool result received. */
  public complete(): void {
    this.#phase = 'done';
  }

  /** Current display line for this tool. Trailing \n in all non-streaming phases. */
  public render(): string {
    switch (this.#phase) {
      case 'streaming':
        return `${this.kind === 'server' ? '🌐 ' : ''}${this.name}${this.#partialInput}`;
      case 'pending':
        return this.kind === 'server'
          ? // biome-ignore lint/style/noNonNullAssertion: pending is only reached via resolve()
            `🌐 ${this.#resolvedView!}\n`
          : // biome-ignore lint/style/noNonNullAssertion: pending is only reached via resolve()
            `${this.#resolvedView!}\n`;
      case 'approved':
        // biome-ignore lint/style/noNonNullAssertion: approved is only reached after resolve()
        return `${this.#resolvedView!} ✅\n`;
      case 'denied':
        // biome-ignore lint/style/noNonNullAssertion: denied is only reached after resolve()
        return `${this.#resolvedView!} ❌\n`;
      case 'error':
        return `${this.#resolvedView ?? this.name} 💥\n`;
      case 'done':
        // biome-ignore lint/style/noNonNullAssertion: done is only reached after resolve()
        return `🌐 ${this.#resolvedView!} ✅\n`;
    }
  }
}
