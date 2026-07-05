import { DatabaseSync } from 'node:sqlite';
import { Clock, Instant, ZoneId } from '@js-joda/core';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { type AnyToolDefinition, CacheTtl, type ConsumerMessage, Conversation, type DurableConfig, IDurableConfigProvider } from '@shellicar/claude-sdk';
import { RefStore } from '@shellicar/claude-sdk-tools/RefStore';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { sdkConfigSchema } from '../src/cli-config/schema.js';
import { AgentMessageHandler } from '../src/controller/AgentMessageHandler.js';
import { logger } from '../src/logger.js';
import { ApprovalNotifier } from '../src/model/ApprovalNotifier.js';
import { ConversationSession } from '../src/model/ConversationSession.js';
import { SqliteSessionStore } from '../src/persistence/SqliteSessionStore.js';
import { ConversationState } from '../src/model/ConversationState.js';
import { IProcessLauncher } from '../src/model/IProcessLauncher.js';
import { StatusState } from '../src/model/StatusState.js';
import { ToolApprovalState } from '../src/model/ToolApprovalState.js';
import { AppToolsService } from '../src/setup/AppToolsService.js';
import { ConsumerChannel } from '../src/setup/ConsumerChannel.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';
import { MemoryObjectStore } from './MemoryObjectStore.js';

class NoopLauncher extends IProcessLauncher {
  public launch(): void {}
}

// Counts persist calls so the turn_content → save wiring can be verified without
// touching the filesystem.
class FakeConversationSession extends ConversationSession {
  public saveCount = 0;
  public override async saveConversation(): Promise<void> {
    this.saveCount++;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const flush = () => new Promise((resolve) => setImmediate(resolve));

function makeConfig(overrides: Partial<DurableConfig> = {}): DurableConfig {
  return {
    model: 'claude-test' as DurableConfig['model'],
    maxTokens: 1024,
    tools: [],
    cacheTtl: CacheTtl.FiveMinutes,
    ...overrides,
  };
}

type OptsOverrides = {
  config?: Partial<DurableConfig>;
  cwd?: string;
  store?: RefStore;
  statusState?: StatusState;
  conversationState?: ConversationState;
  toolApprovalState?: ToolApprovalState;
  onSend?: (msg: ConsumerMessage) => void;
  session?: ConversationSession;
};

// AgentMessageHandler reads only `.config` off the provider; the rest are stubs.
class FakeDurableConfigProvider extends IDurableConfigProvider {
  readonly #config: DurableConfig;
  public constructor(config: DurableConfig) {
    super();
    this.#config = config;
  }
  public get config(): DurableConfig {
    return this.#config;
  }
  public update(): void {}
  public async resolveSystemPromptsFor(): Promise<void> {}
  public needsSystemPromptResolve(): boolean {
    return false;
  }
  public getEffectiveModel(): string {
    return this.#config.model;
  }
  public getEffectiveThinkingEnabled(): boolean {
    return false;
  }
  public getEffectiveEffort(): undefined {
    return undefined;
  }
}

// ConversationState injects Clock; build it through a container.
function buildConversationState(): ConversationState {
  const services = createServiceCollection();
  services.register(Clock).to(Clock, () => Clock.fixed(Instant.ofEpochMilli(0), ZoneId.UTC));
  services.register(ConversationState).to(ConversationState);
  return services.buildProvider().resolve(ConversationState);
}

// Full default SDK config: supplies config.permissions (the source for
// #getMatrix via buildPermissionMatrix) and config.hooks.approvalNotify (read
// by ApprovalNotifier). The DurableConfig (model/tools/cacheTtl) is separate.
const fullConfig = sdkConfigSchema.parse({});

function makeHandler(overrides: OptsOverrides = {}) {
  const conversationState = overrides.conversationState ?? buildConversationState();
  const toolApprovalState = overrides.toolApprovalState ?? new ToolApprovalState();
  const statusState = overrides.statusState ?? new StatusState('test');
  const store = overrides.store ?? new RefStore(new MemoryObjectStore());
  const fs = new MemoryFileSystem({}, '/home/user', '/test');
  const conversation = new Conversation();
  const session = overrides.session ?? new FakeConversationSession();
  const durableConfig = makeConfig(overrides.config);
  const configLoader = {
    get config() {
      return fullConfig;
    },
  } as unknown as ConfigLoader<any>;
  const appTools = { tools: durableConfig.tools, permissionTools: durableConfig.tools, store, refTransform: (_name: string, output: unknown) => output } satisfies AppToolsService;

  // ConsumerChannel delivers asynchronously (queues + microtask pump), so a capturing test must
  // await a flush after the handler sends before reading what was captured.
  const channel = new ConsumerChannel();
  if (overrides.onSend) {
    const onSend = overrides.onSend;
    channel.subscribe(async (m) => {
      onSend(m);
    });
  }

  const services = createServiceCollection();
  services.register(Clock).to(Clock, () => Clock.fixed(Instant.ofEpochMilli(0), ZoneId.UTC));
  services.register(ILogger).to(ILogger, () => logger);
  services.register(IDurableConfigProvider).to(IDurableConfigProvider, () => new FakeDurableConfigProvider(durableConfig));
  services.register(ConsumerChannel).to(ConsumerChannel, () => channel);
  services.register(AppToolsService).to(AppToolsService, () => appTools);
  services.register(StatusState).to(StatusState, () => statusState);
  services.register(ConfigLoader).to(ConfigLoader, () => configLoader);
  services.register(IProcessLauncher).to(IProcessLauncher, () => new NoopLauncher());
  services.register(ApprovalNotifier).to(ApprovalNotifier);
  services.register(ConversationState).to(ConversationState, () => conversationState);
  services.register(ToolApprovalState).to(ToolApprovalState, () => toolApprovalState);
  services.register(IFileSystem).to(IFileSystem, () => fs);
  services.register(Conversation).to(Conversation, () => conversation);
  services.register(SqliteSessionStore).to(SqliteSessionStore, () => new SqliteSessionStore(new DatabaseSync(':memory:')));
  services.register(ConversationSession).to(ConversationSession, () => session);
  services.register(AgentMessageHandler).to(AgentMessageHandler);
  const handler = services.buildProvider().resolve(AgentMessageHandler);
  return { handler, conversationState, toolApprovalState, statusState, session, conversation, fs };
}

// Builds a real ConversationSession over the given fs + conversation, for reload assertions.
function buildRealSession(fs: IFileSystem, conversation: Conversation): ConversationSession {
  const services = createServiceCollection();
  services.register(IFileSystem).to(IFileSystem, () => fs);
  services.register(Conversation).to(Conversation, () => conversation);
  services.register(SqliteSessionStore).to(SqliteSessionStore, () => new SqliteSessionStore(new DatabaseSync(':memory:')));
  services.register(ConversationSession).to(ConversationSession);
  return services.buildProvider().resolve(ConversationSession);
}

/** Fire the full block lifecycle for a client tool: tool_batch_start (if first) → tool_use_start → tool_use_input_stop. */
function streamTool(handler: AgentMessageHandler, id: string, name: string, input: Record<string, unknown> = {}, isFirst = true): void {
  if (isFirst) {
    handler.handle({ type: 'tool_batch_start' });
  }
  handler.handle({ type: 'tool_use_start', id, name });
  handler.handle({ type: 'tool_use_input_stop', id, input });
}

/** Find the most recent tools block content (active first, then last sealed). */
function toolsBlockContent(state: ConversationState): string {
  if (state.activeBlock?.type === 'tools') {
    return state.activeBlock.content;
  }
  const sealed = [...state.sealedBlocks].reverse().find((b) => b.type === 'tools');
  return sealed?.content ?? '';
}

function makeTool(name: string, operation: AnyToolDefinition['operation']): AnyToolDefinition {
  return {
    name,
    description: 'test',
    operation,
    input_schema: z.object({}),
    output_schema: z.unknown(),
    input_examples: [],
    handler: async () => ({ textContent: undefined }),
  };
}

// ---------------------------------------------------------------------------
// query_summary
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — query_summary', () => {
  it('transitions to meta block', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'query_summary', systemPrompts: 1, userMessages: 2, assistantMessages: 1, thinkingBlocks: 0 });
    const expected = 'meta';
    const actual = conversationState.activeBlock?.type;
    expect(actual).toBe(expected);
  });

  it('streams the model and parts joined by ·', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'query_summary', systemPrompts: 1, userMessages: 2, assistantMessages: 1, thinkingBlocks: 0 });
    const expected = '\uD83E\uDD16 claude-test\n1 system \u00b7 2 user \u00b7 1 assistant';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });

  it('uses the configured model name in the streamed line', () => {
    const { handler, conversationState } = makeHandler({ config: { model: 'claude-opus-4-1' as DurableConfig['model'] } });
    handler.handle({ type: 'query_summary', systemPrompts: 1, userMessages: 1, assistantMessages: 1, thinkingBlocks: 0 });
    const expected = true;
    const actual = conversationState.activeBlock?.content.includes('claude-opus-4-1') ?? false;
    expect(actual).toBe(expected);
  });

  it('includes thinking block count when non-zero', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'query_summary', systemPrompts: 1, userMessages: 1, assistantMessages: 1, thinkingBlocks: 3 });
    const expected = true;
    const actual = conversationState.activeBlock?.content.includes('3 thinking') ?? false;
    expect(actual).toBe(expected);
  });

  it('omits thinking count when zero', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'query_summary', systemPrompts: 1, userMessages: 1, assistantMessages: 1, thinkingBlocks: 0 });
    const expected = false;
    const actual = conversationState.activeBlock?.content.includes('thinking') ?? false;
    expect(actual).toBe(expected);
  });

  it('appends systemReminder on a new line when set', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'query_summary', systemPrompts: 1, userMessages: 1, assistantMessages: 1, thinkingBlocks: 0, systemReminder: '[git delta] untracked: +1' });
    const expected = '\uD83E\uDD16 claude-test\n1 system \u00b7 1 user \u00b7 1 assistant\n[git delta] untracked: +1';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });

  it('streamed line ends at stats when systemReminder is absent', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'query_summary', systemPrompts: 1, userMessages: 1, assistantMessages: 1, thinkingBlocks: 0 });
    const expected = '\uD83E\uDD16 claude-test\n1 system \u00b7 1 user \u00b7 1 assistant';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// message_thinking
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — message_thinking', () => {
  it('streams the thinking text into the open thinking block', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'block_enter', blockType: 'thinking' });
    handler.handle({ type: 'message_thinking', text: 'hmm' });
    const expected = 'hmm';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// message_text
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — message_text', () => {
  it('streams the text into the open response block', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'block_enter', blockType: 'text' });
    handler.handle({ type: 'message_text', text: 'hello' });
    const expected = 'hello';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// message_compaction_start
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — block_enter', () => {
  it('opens a thinking block', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'block_enter', blockType: 'thinking' });
    const expected = 'thinking';
    const actual = conversationState.activeBlock?.type;
    expect(actual).toBe(expected);
  });

  it('opens a response block for text', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'block_enter', blockType: 'text' });
    const expected = 'response';
    const actual = conversationState.activeBlock?.type;
    expect(actual).toBe(expected);
  });

  it('opens a compaction block', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'block_enter', blockType: 'compaction' });
    const expected = 'compaction';
    const actual = conversationState.activeBlock?.type;
    expect(actual).toBe(expected);
  });
});

describe('AgentMessageHandler — tool_batch_start', () => {
  it('opens a tools block', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_batch_start' });
    const expected = 'tools';
    const actual = conversationState.activeBlock?.type;
    expect(actual).toBe(expected);
  });

  it('resets tool state on a fresh batch', () => {
    const { handler, conversationState } = makeHandler();
    streamTool(handler, 'toolu_01', 'ReadFile');
    handler.handle(makeUsage(1000)); // seals first batch
    handler.handle({ type: 'tool_batch_start' }); // second batch
    // New block, maps reset — only the fresh batch is in the active block
    const expected = '';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });
});

describe('AgentMessageHandler — block_exit', () => {
  it('seals the thinking block', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'block_enter', blockType: 'thinking' });
    handler.handle({ type: 'message_thinking', text: 'some thought' });
    handler.handle({ type: 'block_exit', blockType: 'thinking' });
    const expected = null;
    const actual = conversationState.activeBlock;
    expect(actual).toBe(expected);
  });

  it('seals the response block', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'block_enter', blockType: 'text' });
    handler.handle({ type: 'message_text', text: 'hello' });
    handler.handle({ type: 'block_exit', blockType: 'text' });
    const expected = null;
    const actual = conversationState.activeBlock;
    expect(actual).toBe(expected);
  });

  it('does not seal the tools block on tool_use exit', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_batch_start' });
    handler.handle({ type: 'block_exit', blockType: 'tool_use' });
    const expected = 'tools';
    const actual = conversationState.activeBlock?.type;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// message_compaction
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — message_compaction', () => {
  it('streams the summary into the open compaction block', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'block_enter', blockType: 'compaction' });
    handler.handle({ type: 'message_compaction', summary: 'context trimmed' });
    const expected = 'context trimmed';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// done
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — done', () => {
  it('does not append to the active block on end_turn', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'message_text', text: 'hi' });
    handler.handle({ type: 'done', stopReason: 'end_turn' });
    const expected = 'hi';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });

  it('streams a stop annotation for non-end_turn reasons', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'message_text', text: 'hi' });
    handler.handle({ type: 'done', stopReason: 'max_tokens' });
    const expected = true;
    const actual = conversationState.activeBlock?.content.includes('[stop: max_tokens]') ?? false;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// error
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — error', () => {
  it('does not transition to a new block', () => {
    const { handler, conversationState } = makeHandler();
    conversationState.transitionBlock('meta');
    handler.handle({ type: 'error', message: 'oops' });
    const expected = 'meta';
    const actual = conversationState.activeBlock?.type;
    expect(actual).toBe(expected);
  });

  it('streams an error annotation into the active block', () => {
    const { handler, conversationState } = makeHandler();
    conversationState.transitionBlock('meta');
    handler.handle({ type: 'error', message: 'oops' });
    const expected = true;
    const actual = conversationState.activeBlock?.content.includes('[error: oops]') ?? false;
    expect(actual).toBe(expected);
  });

  it('opens a notice block when there is no active block', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'error', message: 'oops' });
    const expected = 'notice';
    const actual = conversationState.activeBlock?.type;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// tool_error
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — tool_error', () => {
  it('opens a notice block (no active block at dispatch time)', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_error', name: 'EditFile', input: { file: 'x.ts' }, error: 'oops' });
    const expected = 'notice';
    const actual = conversationState.activeBlock?.type;
    expect(actual).toBe(expected);
  });

  it('streams tool name in the error line', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_error', name: 'EditFile', input: { file: 'x.ts' }, error: 'boom' });
    const expected = true;
    const actual = conversationState.activeBlock?.content.includes('EditFile error') ?? false;
    expect(actual).toBe(expected);
  });

  it('includes the error message in the output', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_error', name: 'EditFile', input: { file: 'x.ts' }, error: 'bad things' });
    const expected = true;
    const actual = conversationState.activeBlock?.content.includes('bad things') ?? false;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// tool_use_start
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — tool_use_start', () => {
  it('sets the block content to the tool name on start', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_batch_start' });
    handler.handle({ type: 'tool_use_start', id: 'toolu_01', name: 'ReadFile' });
    const expected = 'ReadFile';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });

  it('annotates the active tools block with the token delta on the next message_usage', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle(makeUsage(1000));
    handler.handle({ type: 'tool_batch_start' });
    handler.handle({ type: 'tool_use_start', id: 'toolu_01', name: 'ReadFile' });
    handler.handle(makeUsage(1500));
    const expected = true;
    const actual = toolsBlockContent(conversationState).includes('+500');
    expect(actual).toBe(expected);
  });

  it('includes both tool names in the content after a second tool starts', () => {
    const { handler, conversationState } = makeHandler();
    // Both tools arrive in the same batch (same message from Claude)
    handler.handle({ type: 'tool_batch_start' });
    handler.handle({ type: 'tool_use_start', id: 'toolu_01', name: 'ReadFile' });
    handler.handle({ type: 'tool_use_input_stop', id: 'toolu_01', input: {} });
    handler.handle({ type: 'tool_use_start', id: 'toolu_02', name: 'WriteFile' });
    // tool1 resolved to its summary (trailing \n), tool2 still streaming (no \n)
    const expected = 'ReadFile\nWriteFile';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// server_tool_use_start
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — server_tool_use_start', () => {
  it('sets the block content to the server-tool prefix and name on start', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_batch_start' });
    handler.handle({ type: 'server_tool_use_start', id: 'srvtoolu_01', name: 'web_search' });
    const expected = '\uD83C\uDF10 web_search';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// server_tool_use
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — server_tool_use', () => {
  it('resolves to the formatted summary, renders pending phase with trailing newline', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_batch_start' });
    handler.handle({ type: 'server_tool_use_start', id: 'srvtoolu_01', name: 'web_search' });
    handler.handle({ type: 'server_tool_use', id: 'srvtoolu_01', name: 'web_search', input: { query: 'test' } });
    const expected = '\uD83C\uDF10 web_search(test)\n';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// server_tool_result
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — server_tool_result', () => {
  it('renders the done phase with ✅', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_batch_start' });
    handler.handle({ type: 'server_tool_use_start', id: 'srvtoolu_01', name: 'web_search' });
    handler.handle({ type: 'server_tool_use', id: 'srvtoolu_01', name: 'web_search', input: { query: 'test' } });
    handler.handle({ type: 'server_tool_result', id: 'srvtoolu_01', name: 'web_search', result: {} });
    const expected = '\uD83C\uDF10 web_search(test) \u2705\n';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// tool_use_input_delta
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — tool_use_input_delta', () => {
  it('streams the partial JSON appended to the tool name', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_batch_start' });
    handler.handle({ type: 'tool_use_start', id: 'toolu_01', name: 'ReadFile' });
    handler.handle({ type: 'tool_use_input_delta', id: 'toolu_01', partialJson: '{"path":"/foo' });
    // streaming phase: name + partialInput, no trailing \n
    const expected = 'ReadFile{"path":"/foo';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });

  it('does not transition the block', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_batch_start' });
    handler.handle({ type: 'tool_use_start', id: 'toolu_01', name: 'ReadFile' });
    handler.handle({ type: 'tool_use_input_delta', id: 'toolu_01', partialJson: '{"path":"/foo' });
    const expected = 'tools';
    const actual = conversationState.activeBlock?.type;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// tool_use_input_stop
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — tool_use_input_stop', () => {
  it('resolves the tool to its summary when input stops', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_batch_start' });
    handler.handle({ type: 'tool_use_start', id: 'toolu_01', name: 'ReadFile' });
    // The input arrives parsed on the stop event; the tool flips to its resolved view.
    handler.handle({ type: 'tool_use_input_stop', id: 'toolu_01', input: { path: '/test/foo.ts' } });
    const expected = 'ReadFile(foo.ts)\n';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// tool_approval_request
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — tool_approval_request', () => {
  it('renders the resolved view synchronously before any approval work', () => {
    const toolApprovalState = new ToolApprovalState();
    // Hold the approval open so we can inspect phase-3 state synchronously
    const neverResolves = new Promise<boolean>(() => {});
    toolApprovalState.requestApproval = () => neverResolves;
    const { handler, conversationState } = makeHandler({
      config: { tools: [makeTool('DeleteFile', 'delete')] },
      toolApprovalState,
    });
    streamTool(handler, 'toolu_01', 'DeleteFile');
    handler.handle({ type: 'tool_approval_request', requestId: 'toolu_01', name: 'DeleteFile', input: {} });
    // pending phase: formatToolSummary('DeleteFile', {}) → 'DeleteFile'; render → 'DeleteFile\n'
    const expected = 'DeleteFile\n';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });

  it('tells the model an unknown tool was not found, not that the user rejected it', async () => {
    const sends: ConsumerMessage[] = [];
    const { handler } = makeHandler({ onSend: (m) => sends.push(m) });
    streamTool(handler, 'toolu_01', 'Unknown');
    handler.handle({ type: 'tool_approval_request', requestId: 'toolu_01', name: 'Unknown', input: {} });
    await flush();
    const response = sends.find((m) => m.type === 'tool_approval_response');
    const expected = true;
    const actual = response?.type === 'tool_approval_response' && response.approved === false && (response.reason?.includes('Tool not found: Unknown') ?? false);
    expect(actual).toBe(expected);
  });

  it('a pipe with an unknown step is reported as tool-not-found, naming the step', async () => {
    const sends: ConsumerMessage[] = [];
    const { handler } = makeHandler({ config: { tools: [makeTool('Find', 'read')] }, onSend: (m) => sends.push(m) });
    const pipeInput = {
      steps: [
        { tool: 'Find', input: { path: '.' } },
        { tool: 'Nope', input: {} },
      ],
    };
    streamTool(handler, 'toolu_01', 'Pipe', pipeInput);
    handler.handle({ type: 'tool_approval_request', requestId: 'toolu_01', name: 'Pipe', input: pipeInput });
    await flush();
    const response = sends.find((m) => m.type === 'tool_approval_response');
    const expected = true;
    const actual = response?.type === 'tool_approval_response' && response.approved === false && (response.reason?.includes('Tool not found: Nope') ?? false);
    expect(actual).toBe(expected);
  });

  it('records auto-approved status for a read tool', () => {
    const { handler, conversationState } = makeHandler({ config: { tools: [makeTool('Find', 'read')] } });
    streamTool(handler, 'toolu_01', 'Find');
    handler.handle({ type: 'tool_approval_request', requestId: 'toolu_01', name: 'Find', input: {} });
    const expected = true;
    const actual = conversationState.activeBlock?.content.includes('\u2705') ?? false;
    expect(actual).toBe(expected);
  });

  it('records manual approval after user input for a delete tool', async () => {
    const toolApprovalState = new ToolApprovalState();
    const { handler, conversationState } = makeHandler({
      config: { tools: [makeTool('DeleteFile', 'delete')] },
      toolApprovalState,
    });
    streamTool(handler, 'toolu_01', 'DeleteFile');
    handler.handle({ type: 'tool_approval_request', requestId: 'toolu_01', name: 'DeleteFile', input: {} });
    toolApprovalState.resolveNextApproval(true);
    await flush();
    const expected = true;
    const actual = conversationState.activeBlock?.content.includes('\u2705') ?? false;
    expect(actual).toBe(expected);
  });

  it('records manual denial after user input for a delete tool', async () => {
    const toolApprovalState = new ToolApprovalState();
    const { handler, conversationState } = makeHandler({
      config: { tools: [makeTool('DeleteFile', 'delete')] },
      toolApprovalState,
    });
    streamTool(handler, 'toolu_01', 'DeleteFile');
    handler.handle({ type: 'tool_approval_request', requestId: 'toolu_01', name: 'DeleteFile', input: {} });
    toolApprovalState.resolveNextApproval(false);
    await flush();
    const expected = true;
    const actual = conversationState.activeBlock?.content.includes('\u274C') ?? false;
    expect(actual).toBe(expected);
  });

  it('renders all pending tools simultaneously while manual approval is awaited', () => {
    const toolApprovalState = new ToolApprovalState();
    const neverResolves = new Promise<boolean>(() => {});
    toolApprovalState.requestApproval = () => neverResolves;
    const { handler, conversationState } = makeHandler({
      config: { tools: [makeTool('DeleteFile', 'delete')] },
      toolApprovalState,
    });
    streamTool(handler, 'toolu_01', 'DeleteFile');
    streamTool(handler, 'toolu_02', 'DeleteFile', {}, false); // same batch
    handler.handle({ type: 'tool_approval_request', requestId: 'toolu_01', name: 'DeleteFile', input: {} });
    handler.handle({ type: 'tool_approval_request', requestId: 'toolu_02', name: 'DeleteFile', input: {} });
    // both in 'pending' phase
    const expected = 'DeleteFile\nDeleteFile\n';
    const actual = conversationState.activeBlock?.content ?? '';
    expect(actual).toBe(expected);
  });

  it('shows both tools approved after both auto-approvals complete', () => {
    const { handler, conversationState } = makeHandler({
      config: { tools: [makeTool('Find', 'read'), makeTool('ReadFile', 'read')] },
    });
    streamTool(handler, 'toolu_01', 'Find');
    streamTool(handler, 'toolu_02', 'ReadFile', {}, false); // same batch
    handler.handle({ type: 'tool_approval_request', requestId: 'toolu_01', name: 'Find', input: {} });
    handler.handle({ type: 'tool_approval_request', requestId: 'toolu_02', name: 'ReadFile', input: {} });
    const expected = 'Find \u2705\nReadFile \u2705\n';
    const actual = conversationState.activeBlock?.content ?? '';
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// message_usage
// ---------------------------------------------------------------------------

function makeUsage(inputTokens: number): { type: 'message_usage'; inputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; outputTokens: number; costUsd: number; contextWindow: number } {
  return { type: 'message_usage', inputTokens, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 100, costUsd: 0.001, contextWindow: 200_000 };
}

describe('AgentMessageHandler — message_usage without prior tools', () => {
  it('updates usage on the status state', () => {
    const { handler, statusState } = makeHandler();
    handler.handle(makeUsage(1000));
    const expected = 1000;
    const actual = statusState.totalInputTokens;
    expect(actual).toBe(expected);
  });

  it('does not create a block when no tool batch is open', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle(makeUsage(1000));
    const expected = null;
    const actual = conversationState.activeBlock;
    expect(actual).toBe(expected);
  });

  it('seals the active tools block', () => {
    const { handler, conversationState } = makeHandler();
    streamTool(handler, 'r1', 'Find');
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'Find', input: { path: '.' } });
    handler.handle(makeUsage(1000));
    const expected = null;
    const actual = conversationState.activeBlock;
    expect(actual).toBe(expected);
  });

  it('second tool_use_start after message_usage opens a fresh tools block', () => {
    const { handler, conversationState } = makeHandler();
    streamTool(handler, 'r1', 'Find');
    handler.handle(makeUsage(1000));
    streamTool(handler, 'r2', 'ReadFile');
    const expected = 'ReadFile\n';
    const actual = conversationState.activeBlock?.content;
    expect(actual).toBe(expected);
  });
});

describe('AgentMessageHandler — message_usage delta annotation', () => {
  it('annotates the tools block with token delta after a tool batch', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle(makeUsage(1000));
    streamTool(handler, 'r1', 'Find');
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'Find', input: { path: '.' } });
    handler.handle(makeUsage(1500));
    const expected = true;
    const actual = toolsBlockContent(conversationState).includes('+500');
    expect(actual).toBe(expected);
  });

  it('a second tool turn appends its own annotation', () => {
    // Each tool turn seals its own block at message_usage; the second turn's
    // sealed block carries its own per-turn delta annotation.
    const { handler, conversationState } = makeHandler();
    handler.handle(makeUsage(1000));
    streamTool(handler, 'r1', 'Find');
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'Find', input: { path: '.' } });
    handler.handle(makeUsage(1500));
    streamTool(handler, 'r2', 'Find');
    handler.handle({ type: 'tool_approval_request', requestId: 'r2', name: 'Find', input: { path: '.' } });
    handler.handle(makeUsage(1700));
    const expected = true;
    const actual = toolsBlockContent(conversationState).includes('+200');
    expect(actual).toBe(expected);
  });

  it('computes the second batch delta from the post-first-batch usage', () => {
    // The +200 (not +700) confirms the delta is computed from lastUsage=1500 (set by
    // the previous turn's message_usage), not from the pre-tools usage of 1000.
    const { handler, conversationState } = makeHandler();
    handler.handle(makeUsage(1000));
    streamTool(handler, 'r1', 'Find');
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'Find', input: { path: '.' } });
    handler.handle(makeUsage(1500));
    streamTool(handler, 'r2', 'Find');
    handler.handle({ type: 'tool_approval_request', requestId: 'r2', name: 'Find', input: { path: '.' } });
    handler.handle(makeUsage(1700));
    const expected = true;
    const actual = toolsBlockContent(conversationState).includes('+200');
    expect(actual).toBe(expected);
  });

  it('first turn annotation is preserved in its sealed block after the second turn starts', () => {
    // message_usage seals the tools block; the first turn's +500 annotation is
    // in that sealed block even after the second turn opens a new tools block.
    const { handler, conversationState } = makeHandler();
    handler.handle(makeUsage(1000));
    streamTool(handler, 'r1', 'Find');
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'Find', input: { path: '.' } });
    handler.handle(makeUsage(1500)); // seals first tools block with +500
    streamTool(handler, 'r2', 'Find'); // second turn opens a fresh tools block
    const expected = true;
    const firstToolsBlock = conversationState.sealedBlocks.find((b) => b.type === 'tools');
    const actual = firstToolsBlock?.content.includes('+500') ?? false;
    expect(actual).toBe(expected);
  });

  it('computes one delta from the pre-tools usage for multiple tools in a single turn', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle(makeUsage(1000));
    // Two tools in the same batch (same message from Claude)
    streamTool(handler, 'r1', 'Find');
    streamTool(handler, 'r2', 'Find', {}, false);
    handler.handle({ type: 'tool_approval_request', requestId: 'r1', name: 'Find', input: { path: '.' } });
    handler.handle({ type: 'tool_approval_request', requestId: 'r2', name: 'Find', input: { path: '.' } });
    handler.handle(makeUsage(1800));
    const expected = true;
    const actual = toolsBlockContent(conversationState).includes('+800');
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// message_compaction with lastUsage
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — message_compaction annotation', () => {
  it('appends context-usage annotation when lastUsage is known', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle(makeUsage(150_000));
    handler.handle({ type: 'message_compaction', summary: 'trimmed' });
    const expected = true;
    const actual = conversationState.activeBlock?.content.includes('compacted at') ?? false;
    expect(actual).toBe(expected);
  });

  it('omits annotation when lastUsage is not yet known', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'message_compaction', summary: 'trimmed' });
    const expected = false;
    const actual = conversationState.activeBlock?.content.includes('compacted at') ?? false;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// tool-data capture (history view)
// ---------------------------------------------------------------------------

/** The tools block entries, active first then the last sealed tools block. */
function toolsBlockEntries(state: ConversationState) {
  if (state.activeBlock?.type === 'tools') {
    return state.activeBlock.tools ?? [];
  }
  const sealed = [...state.sealedBlocks].reverse().find((b) => b.type === 'tools');
  return sealed?.tools ?? [];
}

describe('AgentMessageHandler — tool-data capture', () => {
  it('captures the client tool input on the tools block entry', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_batch_start' });
    handler.handle({ type: 'tool_use_start', id: 't1', name: 'ReadFile' });
    handler.handle({ type: 'tool_use_input_stop', id: 't1', input: { path: 'a.ts' } });
    const expected = { path: 'a.ts' };
    const actual = toolsBlockEntries(conversationState)[0]?.input;
    expect(actual).toEqual(expected);
  });

  it('captures the client tool output from a tool_result event', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_batch_start' });
    handler.handle({ type: 'tool_use_start', id: 't1', name: 'ReadFile' });
    handler.handle({ type: 'tool_use_input_stop', id: 't1', input: { path: 'a.ts' } });
    handler.handle({ type: 'tool_result', id: 't1', content: 'file contents', isError: false });
    const expected = 'file contents';
    const actual = toolsBlockEntries(conversationState)[0]?.output;
    expect(actual).toBe(expected);
  });

  it('captures the server tool output from a server_tool_result event', () => {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_batch_start' });
    handler.handle({ type: 'server_tool_use_start', id: 's1', name: 'web_search' });
    handler.handle({ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'x' } });
    handler.handle({ type: 'server_tool_result', id: 's1', name: 'web_search', result: 'a result' });
    const expected = 'a result';
    const actual = toolsBlockEntries(conversationState)[0]?.output;
    expect(actual).toBe(expected);
  });
});

describe('AgentMessageHandler — Primary tools content unchanged', () => {
  // Output capture must not alter the content string Primary renders. Drive the
  // identical sequence with and without the tool_result (output) event and
  // assert the tools-block content string is byte-identical; only the entries
  // (which Primary never reads) differ.
  function driveToContent(withResult: boolean): string {
    const { handler, conversationState } = makeHandler();
    handler.handle({ type: 'tool_batch_start' });
    handler.handle({ type: 'tool_use_start', id: 't1', name: 'ReadFile' });
    handler.handle({ type: 'tool_use_input_stop', id: 't1', input: { path: 'a.ts' } });
    if (withResult) {
      handler.handle({ type: 'tool_result', id: 't1', content: 'file contents', isError: false });
    }
    return toolsBlockContent(conversationState);
  }

  it('produces identical content with and without the output event', () => {
    const expected = driveToContent(false);
    const actual = driveToContent(true);
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// persistence — send-time (query_summary) and after-assistant (turn_content)
// ---------------------------------------------------------------------------

describe('AgentMessageHandler — persistence', () => {
  it('persists on send when a request goes out', async () => {
    const session = new FakeConversationSession();
    const { handler } = makeHandler({ session });
    handler.handle({ type: 'query_summary', systemPrompts: 1, userMessages: 1, assistantMessages: 0, thinkingBlocks: 0 });
    await flush();
    const expected = 1;
    const actual = session.saveCount;
    expect(actual).toBe(expected);
  });

  it('persists once when a turn completes', async () => {
    const session = new FakeConversationSession();
    const { handler } = makeHandler({ session });
    handler.handle({ type: 'turn_content', blocks: [] });
    await flush();
    const expected = 1;
    const actual = session.saveCount;
    expect(actual).toBe(expected);
  });

  it('keeps a sent user message across a death before the assistant replies', async () => {
    const session = new ConversationSession();
    const { handler, conversation, fs } = makeHandler({ session });
    await session.resume('conv-1');
    conversation.push({ role: 'user', content: [{ type: 'text', text: 'resume me' }] });
    // The send: query_summary fires before the request. No turn_content follows — the
    // process dies mid-response. The sent user message must still be on disk.
    handler.handle({ type: 'query_summary', systemPrompts: 1, userMessages: 1, assistantMessages: 0, thinkingBlocks: 0 });
    await flush();
    const restored = new Conversation();
    const restoredSession = buildRealSession(fs, restored);
    await restoredSession.resume('conv-1');
    const expected = 1;
    const actual = restored.messages.length;
    expect(actual).toBe(expected);
  });
});
