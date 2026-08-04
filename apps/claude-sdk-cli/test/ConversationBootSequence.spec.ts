import { Clock, Instant, ZoneId } from '@js-joda/core';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IConfigWatcher } from '@shellicar/claude-core/Config/interfaces';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';
import { CacheTtl, Conversation, IConversation, IDurableConfigProvider } from '@shellicar/claude-sdk';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { AuditStats } from '../src/AuditStats.js';
import { ViewHost } from '../src/app/ViewHost.js';
import { sdkConfigSchema } from '../src/cli-config/schema.js';
import { logger } from '../src/logger.js';
import { IConversationSession } from '../src/model/ConversationSession.js';
import { ConversationState, IConversationState } from '../src/model/ConversationState.js';
import { ISystemIdentity } from '../src/model/ISystemIdentity.js';
import { StatusState } from '../src/model/StatusState.js';
import { HistorySweepScheduler } from '../src/persistence/HistorySweepScheduler.js';
import { ICacheWarning } from '../src/setup/CacheWarning.js';
import { ConversationBootSequence } from '../src/setup/ConversationBootSequence.js';
import { IRuntimeOptions } from '../src/setup/IRuntimeOptions.js';
import { ModelOverrides } from '../src/setup/ModelOverrides.js';
import { ISdkEventBridge } from '../src/setup/SdkEventBridge.js';
import { IShutdownSequence } from '../src/setup/ShutdownSequence.js';
import { IWorkspace, type Refusal } from '../src/workspace/Workspace.js';
import { FakeCacheWarning } from './FakeCacheWarning.js';
import { FakeWorkspace } from './FakeWorkspace.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';
import { MemoryObjectStore } from './MemoryObjectStore.js';

const CONVERSATION_ID = 'boot-conversation';
const REFUSAL = { reason: '/tmp/claude-501 is owned by another user', remedy: 'Nothing on your side can change that; the scratchpad stays off.' };

/**
 * The boot sequence pulls in fifteen collaborators, several of which are concrete classes with no
 * abstract to substitute (`ViewHost`, `HistorySweepScheduler`). Those are stubbed through a cast, the
 * same idiom `Application.spec` already uses for `ViewHost`; giving them abstracts is its own piece
 * of work and does not belong in a change about the scratchpad.
 */
function buildBootSequence(options: { refusal?: Refusal | null; history?: boolean } = {}): { boot: ConversationBootSequence; conversationState: ConversationState } {
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  const conversation = new Conversation();
  if (options.history) {
    conversation.push({ role: 'user', content: 'the earlier ask' });
    conversation.push({ role: 'assistant', content: 'the earlier reply' });
  }

  services
    .register(IFileSystem)
    .using(() => new MemoryFileSystem({}, '/home/user', '/project'))
    .asSelf();
  services
    .register(ILogger)
    .using(() => logger)
    .asSelf();
  services
    .register(Clock)
    .using(() => Clock.fixed(Instant.ofEpochMilli(0), ZoneId.UTC))
    .asSelf();
  services
    .register(ConfigLoader)
    .using(() => new ConfigLoader({ config: sdkConfigSchema.parse({}), sources: [], warnings: [] }))
    .asSelf();
  services
    .register(Conversation)
    .using(() => conversation)
    .asSelf()
    .as(IConversation);
  services.register(ConversationState).asSelf().as(IConversationState);
  services
    .register(IObjectStore)
    .using(() => new MemoryObjectStore())
    .asSelf();
  services
    .register(StatusState)
    .using(() => new StatusState('test'))
    .asSelf();
  services
    .register(FakeWorkspace)
    .using(() => new FakeWorkspace({ refusal: options.refusal ?? null }))
    .as(IWorkspace);
  services
    .register(IConversationSession)
    .using(() => ({ id: CONVERSATION_ID }) as unknown as IConversationSession)
    .asSelf();
  services
    .register(IDurableConfigProvider)
    .using(
      () =>
        ({
          config: { cacheTtl: CacheTtl.OneHour },
          resolveSystemPromptsFor: async () => {},
          resolveSkillCatalogue: async () => {},
          getEffectiveModel: () => 'test-model',
        }) as unknown as IDurableConfigProvider,
    )
    .asSelf();
  services
    .register(ISdkEventBridge)
    .using(() => ({ wire: () => {} }) as unknown as ISdkEventBridge)
    .asSelf();
  services
    .register(ISystemIdentity)
    .using(() => ({ read: async () => ({ state: 'absent' }), path: null }) as unknown as ISystemIdentity)
    .asSelf();
  services
    .register(IConfigWatcher)
    .using(() => ({ watch: () => ({ [Symbol.dispose]: () => {} }) }) as unknown as IConfigWatcher)
    .asSelf();
  services
    .register(IShutdownSequence)
    .using(() => ({ setIdentityWatch: () => {} }) as unknown as IShutdownSequence)
    .asSelf();
  services
    .register(HistorySweepScheduler)
    .using(() => ({ start: () => {} }) as unknown as HistorySweepScheduler)
    .asSelf();
  // A factory supplies the stub, but the planner still walks ModelOverrides' own @dependsOn tokens,
  // so its leaf needs a registration too.
  services
    .register(IRuntimeOptions)
    .using(() => ({}) as unknown as IRuntimeOptions)
    .asSelf();
  services
    .register(ModelOverrides)
    .using(() => ({ model: null, adopt: () => {} }) as unknown as ModelOverrides)
    .asSelf();
  services
    .register(AuditStats)
    .using(() => ({ derive: async () => ({ totals: {}, cached: null, lastModel: null }) }) as unknown as AuditStats)
    .asSelf();
  services
    .register(ICacheWarning)
    .using(() => new FakeCacheWarning())
    .asSelf();
  services
    .register(ViewHost)
    .using(() => ({ renderNow: () => {} }) as unknown as ViewHost)
    .asSelf();
  services.register(ConversationBootSequence).asSelf();

  const provider = services.buildProvider();
  return { boot: provider.resolve(ConversationBootSequence), conversationState: provider.resolve(ConversationState) };
}

const transcript = (state: ConversationState): string[] => state.sealedBlocks.concat(state.activeBlock ? [state.activeBlock] : []).map((b) => b.content);

describe('ConversationBootSequence — the scratchpad notice', () => {
  it('reports a refused scratchpad at startup', async () => {
    const { boot, conversationState } = buildBootSequence({ refusal: REFUSAL });
    await boot.run(undefined);
    expect(transcript(conversationState).join('\n')).toContain('scratchpad unavailable');
  });

  // The reason this has a test: the notice was originally added before the replay, so a resumed
  // conversation buried it above its own history and it was never read.
  it('puts the notice after the replayed history, not above it', async () => {
    const { boot, conversationState } = buildBootSequence({ refusal: REFUSAL, history: true });
    await boot.run(undefined);
    const blocks = transcript(conversationState);
    const expected = true;
    const actual = blocks.findIndex((b) => b.includes('scratchpad unavailable')) > blocks.findIndex((b) => b.includes('the earlier ask'));
    expect(actual).toBe(expected);
  });

  it('says nothing when the scratchpad is available', async () => {
    const { boot, conversationState } = buildBootSequence();
    await boot.run(undefined);
    expect(transcript(conversationState).join('\n')).not.toContain('scratchpad');
  });
});
