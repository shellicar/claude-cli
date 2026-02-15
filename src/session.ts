import { EventEmitter } from 'node:events';
import { inspect } from 'node:util';
import { query, type CanUseTool, type Options, type Query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';

export interface SessionEvents {
  message: [msg: SDKMessage];
}

export class QuerySession extends EventEmitter<SessionEvents> {
  private sessionId: string | undefined;
  private abort: AbortController | undefined;
  private activeQuery: Query | undefined;
  private aborted = false;
  canUseTool: CanUseTool | undefined;

  get isActive(): boolean {
    return this.activeQuery !== undefined;
  }

  get wasAborted(): boolean {
    return this.aborted;
  }

  get currentSessionId(): string | undefined {
    return this.sessionId;
  }

  setSessionId(id: string): void {
    this.sessionId = id;
  }

  async send(input: string): Promise<void> {
    this.aborted = false;
    const abort = new AbortController();
    this.abort = abort;

    const options: Options = {
      model: 'claude-opus-4-6',
      cwd: process.cwd(),
      settingSources: ['local', 'project', 'user'],
      maxTurns: 25,
      abortController: abort,
      ...(this.sessionId ? { resume: this.sessionId } : {}),
      ...(this.canUseTool ? { canUseTool: this.canUseTool } : {}),
    } satisfies Options;

    // Log options (excluding functions and abort controller)
    const { abortController, canUseTool, ...loggableOptions } = options;
    console.error(`[sdk-options] ${inspect(loggableOptions, { depth: null, colors: true, compact: true })}`);

    const q = query({ prompt: input, options });
    this.activeQuery = q;

    let pendingSessionId: string | undefined;

    try {
      for await (const msg of q) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          pendingSessionId = msg.session_id;
        }
        if (msg.type === 'result' && pendingSessionId) {
          this.sessionId = pendingSessionId;
        }
        this.emit('message', msg);
      }
    } finally {
      this.abort = undefined;
      this.activeQuery = undefined;
    }
  }

  cancel(): void {
    this.aborted = true;
    this.abort?.abort();
    this.activeQuery?.close();
  }
}
