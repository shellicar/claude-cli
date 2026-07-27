import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import type { ConsumerMessage, DurableConfig, SdkMessage, ThinkingEffort } from '@shellicar/claude-sdk';
import { ApprovalCoordinator, Conversation, IConversation, IDurableConfigProvider, IOrchestrateEngine, ISdkMessagePublisher, IToolRegistry, IToolsClockListener, ITurnRunner, QueryRunner, ToolRegistry } from '@shellicar/claude-sdk';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import type { CommandSpec, ExitStatus, IExecutor, SpawnOpts } from '@shellicar/exec-core';
import { describe, expect, it } from 'vitest';
import { OrchestrateEngine } from '../../src/Orchestrate/OrchestrateEngine.js';
import { createToolsV2Registry } from '../../src/Orchestrate/registry.js';
import { PolicyStore } from '../../src/Policy/PolicyStore.js';
import { RefStore } from '../../src/RefStore/RefStore.js';
import { passthroughSips } from '../helpers.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';
import { MemoryObjectStore } from '../MemoryObjectStore.js';
import { RecordingMemoryStore } from '../RecordingMemoryStore.js';

// ---------------------------------------------------------------------------
// Full-stack proof that ESC-cancel reaches a running Orchestrate/Program call:
// real QueryRunner, real ApprovalCoordinator, real OrchestrateEngine, real
// ToolsV2Registry, real orchestrate-core execute(), real Program tool. The one
// faked seam is the OS process itself (FakeExecutor never spawns a real one) —
// everything above that boundary is production code.
// ---------------------------------------------------------------------------

type RunParams = Parameters<InstanceType<typeof ITurnRunner>['run']>;
type RunResult = Awaited<ReturnType<InstanceType<typeof ITurnRunner>['run']>>;

class FakeTurnRunner extends ITurnRunner {
  readonly #responses: RunResult[];
  public constructor(responses: RunResult[]) {
    super();
    this.#responses = [...responses];
  }
  public async run(conversation: RunParams[0], _durable: RunParams[1], _turnInput: RunParams[2]): Promise<RunResult> {
    const next = this.#responses.shift();
    if (next == null) {
      throw new Error('FakeTurnRunner: no more scripted results');
    }
    const content = next.blocks.map((b) => (b.type === 'tool_use' ? { type: 'tool_use' as const, id: b.id, name: b.name, input: b.input } : { type: 'text' as const, text: (b as { text: string }).text }));
    conversation.push({ role: 'assistant', content });
    return next;
  }
}

class FakeSdkPublisher extends ISdkMessagePublisher {
  public readonly messages: SdkMessage[] = [];
  public send(msg: SdkMessage): void {
    this.messages.push(msg);
  }
  public close(): void {}
  public drain(): Promise<void> {
    return Promise.resolve();
  }
}

class NoopToolsClock extends IToolsClockListener {
  public toolsStarted(): void {}
  public toolsStopped(): void {}
}

class NoopLogger extends ILogger {
  public trace(): void {}
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

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
  public updateIdentityBody(): void {}
  public async resolveSystemPromptsFor(): Promise<void> {}
  public async resolveSkillCatalogue(): Promise<void> {}
  public needsSystemPromptResolve(): boolean {
    return false;
  }
  public getEffectiveModel(): string {
    return this.#config.model;
  }
  public getEffectiveThinkingEnabled(): boolean {
    return false;
  }
  public getEffectiveEffort(): ThinkingEffort | undefined {
    return undefined;
  }
}

/** Behaves like a real spawned process that never finishes on its own: `run` only settles once
 *  the caller's `signal` aborts, at which point it reports the same shape a real killed process
 *  would (`exitCode: null`). Records whether it was ever actually asked to run. */
function hangingExecutor(): { executor: IExecutor; started: Promise<void> } {
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const executor: IExecutor = {
    async run(_cmd: CommandSpec, opts: SpawnOpts = {}): Promise<ExitStatus> {
      markStarted();
      return new Promise<ExitStatus>((resolvePromise) => {
        opts.signal?.addEventListener('abort', () => resolvePromise({ exitCode: null, signal: 'SIGTERM' }));
      });
    },
  };
  return { executor, started };
}

function toolUseResult(id: string, name: string, input: Record<string, unknown>): RunResult {
  return { blocks: [{ type: 'tool_use', id, name, input }], stopReason: 'tool_use', contextManagementOccurred: false, usage: { inputTokens: 1, cacheCreationTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0, cacheReadTokens: 0, outputTokens: 1 } };
}

function endTurnResult(): RunResult {
  return { blocks: [{ type: 'text', text: 'done' }], stopReason: 'end_turn', contextManagementOccurred: false, usage: { inputTokens: 1, cacheCreationTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0, cacheReadTokens: 0, outputTokens: 1 } };
}

function makeStack(responses: RunResult[], executor: IExecutor) {
  const registry = createToolsV2Registry({ fs: new MemoryFileSystem(), executor, refStore: new RefStore(new MemoryObjectStore()), sips: passthroughSips, logger: new NoopLogger(), memoryStore: new RecordingMemoryStore() });
  const policyStore = new PolicyStore([{ default: 'allow' }], registry);
  const orchestrateEngine = new OrchestrateEngine(registry, policyStore, new NoopLogger());
  const conversation = new Conversation();
  const approval = new ApprovalCoordinator();
  const channel = new FakeSdkPublisher();
  const durableProvider = new FakeDurableConfigProvider({ model: 'claude-opus-4-5' as DurableConfig['model'], maxTokens: 1024, tools: [] });

  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(ITurnRunner)
    .using(() => new FakeTurnRunner(responses))
    .asSelf();
  services
    .register(Conversation)
    .using(() => conversation)
    .asSelf()
    .as(IConversation);
  services
    .register(IToolRegistry)
    .using(() => new ToolRegistry([], new NoopLogger()))
    .asSelf();
  services
    .register(IOrchestrateEngine)
    .using(() => orchestrateEngine)
    .asSelf();
  services
    .register(ApprovalCoordinator)
    .using(() => approval)
    .asSelf();
  services
    .register(ISdkMessagePublisher)
    .using(() => channel)
    .asSelf();
  services
    .register(IDurableConfigProvider)
    .using(() => durableProvider)
    .asSelf();
  services
    .register(ILogger)
    .using(() => new NoopLogger())
    .asSelf();
  services
    .register(IToolsClockListener)
    .using(() => new NoopToolsClock())
    .asSelf();
  services.register(QueryRunner).asSelf();
  const queryRunner = services.buildProvider().resolve(QueryRunner);
  return { queryRunner, approval, channel, conversation };
}

describe('ESC-cancel — full stack, one Program call away from real process control', () => {
  it('kills the fake process when a cancel arrives mid-run', async () => {
    const { executor, started } = hangingExecutor();
    const stack = makeStack([toolUseResult('tu_1', 'Program', { program: 'sleep', args: ['5'] }), endTurnResult()], executor);

    const runPromise = stack.queryRunner.run({ messages: ['run it'], abortController: new AbortController() });
    await started;
    stack.approval.handle({ type: 'cancel' } as ConsumerMessage);
    await runPromise;

    const actual = stack.channel.messages.find((m) => m.type === 'tool_result');
    expect(actual).toMatchObject({ isError: true, cancelled: true });
  });

  it('does not cancel the query itself on a single ESC', async () => {
    const { executor, started } = hangingExecutor();
    const stack = makeStack([toolUseResult('tu_1', 'Program', { program: 'sleep', args: ['5'] }), endTurnResult()], executor);

    const runPromise = stack.queryRunner.run({ messages: ['run it'], abortController: new AbortController() });
    await started;
    stack.approval.handle({ type: 'cancel' } as ConsumerMessage);
    await runPromise;

    const actual = stack.approval.cancelled;
    expect(actual).toBe(false);
  });
});
