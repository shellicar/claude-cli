import { EventEmitter } from 'node:events';
import { type CanUseTool, type Options, type Query, query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { READ_ONLY_TOOLS } from './config.js';

export interface SessionEvents {
  message: [msg: SDKMessage];
  activeChanged: [active: boolean];
}

export class QuerySession extends EventEmitter<SessionEvents> {
  private sessionId: string | undefined;
  private resumeAt: string | undefined;
  private abort: AbortController | undefined;
  private activeQuery: Query | undefined;
  private aborted = false;
  private additionalDirs: string[] = [];
  public canUseTool: CanUseTool | undefined;
  public systemPromptAppend: string | undefined;
  public disableTools = false;

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

  public addDirectory(dir: string): void {
    if (!this.additionalDirs.includes(dir)) {
      this.additionalDirs.push(dir);
    }
  }

  public getAdditionalDirectories(): readonly string[] {
    return this.additionalDirs;
  }

  public async send(input: string, onMessage: (msg: SDKMessage) => void): Promise<void> {
    this.aborted = false;
    const abort = new AbortController();
    this.abort = abort;

    const options: Options = {
      model: 'claude-opus-4-6',
      cwd: process.cwd(),
      settingSources: ['local', 'project', 'user'],
      allowedTools: this.disableTools ? [] : [...READ_ONLY_TOOLS],
      maxTurns: 100,
      includePartialMessages: true,
      abortController: abort,
      ...(this.sessionId ? { resume: this.sessionId } : {}),
      ...(this.resumeAt ? { resumeSessionAt: this.resumeAt } : {}),
      ...(this.canUseTool ? { canUseTool: this.canUseTool } : {}),
      ...(this.additionalDirs.length > 0 ? { additionalDirectories: this.additionalDirs } : {}),
      ...(this.systemPromptAppend ? { systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const, append: this.systemPromptAppend } } : {}),
    } satisfies Options;

    const q = query({ prompt: input, options });
    this.activeQuery = q;
    this.emit('activeChanged', true);

    let pendingSessionId: string | undefined;

    this.on('message', onMessage);
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
      this.off('message', onMessage);
      this.abort = undefined;
      this.activeQuery = undefined;
      this.resumeAt = undefined;
      this.emit('activeChanged', false);
    }
  }

  public cancel(): void {
    this.aborted = true;
    this.abort?.abort();
    this.activeQuery?.close();
  }
}
