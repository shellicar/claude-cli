import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { IConversationSession } from '../src/model/ConversationSession.js';
import { IWorkspace, Workspace } from '../src/workspace/Workspace.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

const CWD = '/project';
const CONVERSATION_ID = '11111111-2222-3333-4444-555555555555';
const EXPECTED_ROOT = `/tmp/claude-sdk-cli/${CONVERSATION_ID}/scratchpad`;

/** A session fake exposing only the id the workspace reads; the rest of the contract is unreachable. */
class FakeConversationSession extends IConversationSession {
  readonly #id: string;

  public constructor(id: string) {
    super();
    this.#id = id;
  }

  public get id(): string {
    return this.#id;
  }

  public get turnCount(): number {
    throw new Error('FakeConversationSession: turnCount() not supported');
  }

  public conversationTip(): { messageId: string; queryId: string; turnId: string } | undefined {
    throw new Error('FakeConversationSession: conversationTip() not supported');
  }

  public startFresh(): Promise<void> {
    throw new Error('FakeConversationSession: startFresh() not supported');
  }

  public resume(): Promise<void> {
    throw new Error('FakeConversationSession: resume() not supported');
  }

  public load(): Promise<void> {
    throw new Error('FakeConversationSession: load() not supported');
  }

  public saveSession(): Promise<void> {
    throw new Error('FakeConversationSession: saveSession() not supported');
  }

  public saveConversation(): Promise<void> {
    throw new Error('FakeConversationSession: saveConversation() not supported');
  }

  public createNew(): Promise<void> {
    throw new Error('FakeConversationSession: createNew() not supported');
  }
}

function buildWorkspace(enabled: boolean, conversationId = CONVERSATION_ID, fs = new MemoryFileSystem(undefined, '/home/user', CWD)): IWorkspace {
  const configLoader = new ConfigLoader({ config: { workspace: { enabled } }, sources: [], warnings: [] });
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(MemoryFileSystem)
    .using(() => fs)
    .as(IFileSystem);
  services
    .register(ConfigLoader)
    .using(() => configLoader)
    .asSelf();
  services
    .register(FakeConversationSession)
    .using(() => new FakeConversationSession(conversationId))
    .as(IConversationSession);
  services.register(Workspace).as(IWorkspace);
  return services.buildProvider().resolve(IWorkspace);
}

describe('Workspace.root', () => {
  it('is a scratchpad under the temp directory keyed by conversation', () => {
    const expected = EXPECTED_ROOT;
    const actual = buildWorkspace(true).root();
    expect(actual).toBe(expected);
  });

  it('is absent when the feature is disabled', () => {
    const actual = buildWorkspace(false).root();
    expect(actual).toBeNull();
  });

  it('is absent before a conversation has an id', () => {
    const actual = buildWorkspace(true, '').root();
    expect(actual).toBeNull();
  });

  it('moves with the conversation, so two conversations do not share one scratchpad', () => {
    const expected = '/tmp/claude-sdk-cli/other-conversation/scratchpad';
    const actual = buildWorkspace(true, 'other-conversation').root();
    expect(actual).toBe(expected);
  });

  it('does not move when the session changes working directory mid-conversation', () => {
    const fs = new MemoryFileSystem(undefined, '/home/user', CWD);
    const workspace = buildWorkspace(true, CONVERSATION_ID, fs);
    const expected = workspace.root();
    fs.chdir('/home/user');
    const actual = workspace.root();
    expect(actual).toBe(expected);
  });
});

describe('Workspace.ensure', () => {
  it('creates the scratchpad directory', async () => {
    const fs = new MemoryFileSystem(undefined, '/home/user', CWD);
    await buildWorkspace(true, CONVERSATION_ID, fs).ensure();
    const expected = true;
    const actual = await fs.exists(EXPECTED_ROOT);
    expect(actual).toBe(expected);
  });

  it('creates nothing when the feature is disabled', async () => {
    const fs = new MemoryFileSystem(undefined, '/home/user', CWD);
    await buildWorkspace(false, CONVERSATION_ID, fs).ensure();
    const expected = false;
    const actual = await fs.exists(EXPECTED_ROOT);
    expect(actual).toBe(expected);
  });
});
