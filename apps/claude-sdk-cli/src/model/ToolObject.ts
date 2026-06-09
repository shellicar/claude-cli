import EventEmitter from 'node:events';

type ToolObjectEvents = { change: [] };

/**
 * Display state for a single tool use — server or client — within a response.
 *
 * Phase progression:
 *   client: streaming → pending → approved | denied | error
 *   server: streaming → pending → done
 *
 * Emits `change` on every state mutation so subscribers can redraw without
 * being explicitly driven by the caller.
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
    this.#emitter.emit('change');
  }

  /**
   * Transition to the resolved view — visible while the user is asked to approve
   * (client) or while waiting for the server result (server).
   */
  public resolve(view: string): void {
    this.#resolvedView = view;
    this.#phase = 'pending';
    this.#emitter.emit('change');
  }

  public approve(): void {
    this.#phase = 'approved';
    this.#emitter.emit('change');
  }

  public deny(): void {
    this.#phase = 'denied';
    this.#emitter.emit('change');
  }

  public error(): void {
    this.#phase = 'error';
    this.#emitter.emit('change');
  }

  /** Server tool result received. */
  public complete(): void {
    this.#phase = 'done';
    this.#emitter.emit('change');
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
