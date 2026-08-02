import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { Conversation, IConversation } from '@shellicar/claude-sdk';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { logger } from '../src/logger.js';
import { WorkspaceTracker } from '../src/setup/WorkspaceTracker.js';
import { IWorkspace } from '../src/workspace/Workspace.js';

const ROOT = '/tmp/claude-501/conversation/scratchpad';

/** A scratchpad that is simply present or absent; creation and verification are Workspace's own. */
class FakeWorkspace extends IWorkspace {
  readonly #root: string | null;

  public constructor(root: string | null) {
    super();
    this.#root = root;
  }

  public root(): string | null {
    return this.#root;
  }

  public contains(): boolean {
    throw new Error('FakeWorkspace: contains() not supported');
  }

  public resolve(): Promise<string | null> {
    throw new Error('FakeWorkspace: resolve() not supported');
  }
}

function buildTracker(root: string | null, conversation: Conversation): WorkspaceTracker {
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(FakeWorkspace)
    .using(() => new FakeWorkspace(root))
    .as(IWorkspace);
  services
    .register(Conversation)
    .using(() => conversation)
    .asSelf()
    .as(IConversation);
  services
    .register(ILogger)
    .using(() => logger)
    .asSelf();
  services.register(WorkspaceTracker).asSelf();
  return services.buildProvider().resolve(WorkspaceTracker);
}

function withUserMessage(): Conversation {
  const conversation = new Conversation();
  conversation.push({ role: 'user', content: 'hello' });
  return conversation;
}

describe('WorkspaceTracker.scan', () => {
  it('names the scratchpad on the conversation opening message', () => {
    const actual = buildTracker(ROOT, new Conversation()).scan();
    expect(actual).toContain(ROOT);
  });

  it('says nothing once the conversation already has a message', () => {
    const actual = buildTracker(ROOT, withUserMessage()).scan();
    expect(actual).toBeNull();
  });

  it('says nothing when there is no scratchpad to name', () => {
    const actual = buildTracker(null, new Conversation()).scan();
    expect(actual).toBeNull();
  });

  it('tells the model to prefer the scratchpad over the system temp directory', () => {
    const actual = buildTracker(ROOT, new Conversation()).scan();
    expect(actual).toContain('Prefer it over the system temp directory');
  });
});
