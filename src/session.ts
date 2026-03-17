import { EventEmitter } from 'node:events';
import { appendFileSync } from 'node:fs';
import { type CanUseTool, type McpSdkServerConfigWithInstance, type Options, type Query, query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ImageBlockParam, TextBlockParam } from '@anthropic-ai/sdk/resources/messages/messages';
import type { Attachment } from './AttachmentStore.js';
import type { ClaudeModel } from './cli-config/schema.js';
import type { ThinkingEffort } from './cli-config/types.js';
import { READ_ONLY_TOOLS } from './config.js';
import { createShellicarMcpServer } from './mcp/shellicar/createShellicarMcpServer.js';

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
  private sessionModelOverride: ClaudeModel | undefined;
  public canUseTool: CanUseTool | undefined;
  public systemPromptAppend: string | undefined;
  public disableTools = false;
  public removeTools = false;
  public shellicarMcp = false;

  public constructor(
    private model: ClaudeModel,
    private maxTurns: number,
    private thinking: boolean,
    private thinkingEffort: ThinkingEffort,
  ) {
    super();
  }

  public updateConfig(model: ClaudeModel, maxTurns: number, thinking: boolean, thinkingEffort: ThinkingEffort): void {
    this.model = model;
    this.maxTurns = maxTurns;
    this.thinking = thinking;
    this.thinkingEffort = thinkingEffort;
    // sessionModelOverride intentionally not cleared — it must survive config hot reload
  }

  public get activeModel(): ClaudeModel {
    return this.sessionModelOverride ?? this.model;
  }

  public get hasSessionModelOverride(): boolean {
    return this.sessionModelOverride !== undefined;
  }

  public setSessionModelOverride(model: ClaudeModel): void {
    this.sessionModelOverride = model;
  }

  public clearSessionModelOverride(): void {
    this.sessionModelOverride = undefined;
  }

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

  public clearSessionId(): void {
    this.sessionId = undefined;
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

  private buildPrompt(input: string, attachments?: readonly Attachment[]): string | AsyncIterable<SDKUserMessage> {
    if (!attachments || attachments.length === 0) {
      return input;
    }
    const content: Array<ImageBlockParam | TextBlockParam> = [];
    for (const att of attachments) {
      switch (att.kind) {
        case 'image':
          content.push({
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: att.base64 },
          } satisfies ImageBlockParam);
          break;
        case 'text':
          content.push({ type: 'text', text: att.text } satisfies TextBlockParam);
          break;
      }
    }
    content.push({ type: 'text', text: input } satisfies TextBlockParam);

    const message: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: this.sessionId ?? '',
    };

    async function* generateMessages(): AsyncIterable<SDKUserMessage> {
      yield message;
    }
    return generateMessages();
  }

  public async send(input: string, onMessage: (msg: SDKMessage) => void, attachments?: readonly Attachment[], modelOverride?: ClaudeModel): Promise<void> {
    this.aborted = false;
    const abort = new AbortController();
    this.abort = abort;

    const mcpServer: McpSdkServerConfigWithInstance = createShellicarMcpServer({ cwd: process.cwd() });
    const shellicarMcpOptions = this.shellicarMcp
      ? ({
          mcpServers: {
            shellicar: mcpServer,
          },
        } satisfies Options)
      : undefined;

    const options: Options = {
      model: modelOverride ?? this.sessionModelOverride ?? this.model,
      thinking: {
        type: this.thinking ? 'adaptive' : 'disabled',
      },
      ...(this.thinking ? { effort: this.thinkingEffort } : {}),
      cwd: process.cwd(),
      settingSources: ['local', 'project', 'user'],
      allowedTools: this.disableTools ? [] : [...READ_ONLY_TOOLS],
      ...(this.removeTools ? { tools: [] } : {}),
      disallowedTools: ['Bash'],
      ...shellicarMcpOptions,
      maxTurns: this.maxTurns,
      includePartialMessages: true,
      abortController: abort,
      ...(this.sessionId ? { resume: this.sessionId } : {}),
      ...(this.resumeAt ? { resumeSessionAt: this.resumeAt } : {}),
      ...(this.canUseTool ? { canUseTool: this.canUseTool } : {}),
      ...(this.additionalDirs.length > 0 ? { additionalDirectories: this.additionalDirs } : {}),
      ...(this.systemPromptAppend ? { systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const, append: this.systemPromptAppend } } : {}),
    } satisfies Options;

    const prompt = this.buildPrompt(input, attachments);
    const q = query({ prompt, options });
    this.activeQuery = q;
    this.emit('activeChanged', true);

    let pendingSessionId: string | undefined;

    this.on('message', onMessage);
    try {
      for await (const msg of q) {
        // biome-ignore lint/suspicious/noConfusingLabels: esbuild dropLabels strips DEBUG blocks in production
        // biome-ignore lint/correctness/noUnusedLabels: esbuild dropLabels strips DEBUG blocks in production
        DEBUG: {
          const subtype = 'subtype' in msg ? `:${msg.subtype}` : '';
          appendFileSync('/tmp/claude-cli-messages.log', `${new Date().toISOString()} | yield ${msg.type}${subtype}\n`);
        }
        if (msg.type === 'system' && msg.subtype === 'init') {
          pendingSessionId = msg.session_id;
        }
        if (msg.type === 'result' && pendingSessionId) {
          this.sessionId = pendingSessionId;
        }
        this.emit('message', msg);
      }
      // biome-ignore lint/suspicious/noConfusingLabels: esbuild dropLabels strips DEBUG blocks in production
      // biome-ignore lint/correctness/noUnusedLabels: esbuild dropLabels strips DEBUG blocks in production
      DEBUG: appendFileSync('/tmp/claude-cli-messages.log', `${new Date().toISOString()} | generator-exhausted\n`);
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
