import { EventEmitter } from 'node:events';
import { inspect } from 'node:util';
import { type CanUseTool, type Options, type Query, query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { READ_ONLY_TOOLS } from './config.js';

export interface SessionEvents {
  message: [msg: SDKMessage];
}

export class QuerySession extends EventEmitter<SessionEvents> {
  private sessionId: string | undefined;
  private resumeAt: string | undefined;
  private abort: AbortController | undefined;
  private activeQuery: Query | undefined;
  private aborted = false;
  public canUseTool: CanUseTool | undefined;

  public get isActive(): boolean {
    return this.activeQuery !== undefined;
  }

  public get wasAborted(): boolean {
    return this.aborted;
  }

  public get currentSessionId(): string | undefined {
    return this.sessionId;
  }

  public setSessionId(id: string): void {
    this.sessionId = id;
  }

  public setResumeAt(uuid: string | undefined): void {
    this.resumeAt = uuid;
  }

  public async send(input: string): Promise<void> {
    this.aborted = false;
    const abort = new AbortController();
    this.abort = abort;

    const options: Options = {
      model: 'claude-opus-4-6',
      cwd: process.cwd(),
      settingSources: ['local', 'project', 'user'],
      allowedTools: [...READ_ONLY_TOOLS],
      maxTurns: 25,
      includePartialMessages: true,
      abortController: abort,
      ...(this.sessionId ? { resume: this.sessionId } : {}),
      ...(this.resumeAt ? { resumeSessionAt: this.resumeAt } : {}),
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
      this.resumeAt = undefined;
    }
  }

  public cancel(): void {
    this.aborted = true;
    this.abort?.abort();
    this.activeQuery?.close();
  }
}
