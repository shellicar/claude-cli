import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { logger } from '../src/logger.js';
import { IConversationSession } from '../src/model/ConversationSession.js';
import { IWorkspace, Workspace } from '../src/workspace/Workspace.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

const CWD = '/project';
const CONVERSATION_ID = '11111111-2222-3333-4444-555555555555';
const EXPECTED_ROOT = `/tmp/claude-501/${CONVERSATION_ID}/scratchpad`;

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

// Only the slice Workspace reads, so the fake config cannot drift into standing in for the whole
// schema, and a test that reaches for anything else fails to compile.
const workspaceOnlySchema = z.object({ workspace: z.object({ enabled: z.boolean() }) });
type TestConfigLoader = ConfigLoader<typeof workspaceOnlySchema>;

function buildWorkspaceWith(configLoader: TestConfigLoader, conversationId = CONVERSATION_ID, fs = new MemoryFileSystem(undefined, '/home/user', CWD)): IWorkspace {
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
  services
    .register(ILogger)
    .using(() => logger)
    .asSelf();
  services.register(Workspace).as(IWorkspace);
  return services.buildProvider().resolve(IWorkspace);
}

function buildWorkspace(enabled: boolean, conversationId = CONVERSATION_ID, fs = new MemoryFileSystem(undefined, '/home/user', CWD)): IWorkspace {
  return buildWorkspaceWith(loaderFor(enabled), conversationId, fs);
}

const loaderFor = (enabled: boolean): TestConfigLoader => new ConfigLoader<typeof workspaceOnlySchema>({ config: { workspace: { enabled } }, sources: [], warnings: [] });

const BASE = '/tmp/claude-501';
const OTHER_USER = 502;

async function resolved(enabled: boolean, conversationId = CONVERSATION_ID, fs = new MemoryFileSystem(undefined, '/home/user', CWD)): Promise<IWorkspace> {
  const workspace = buildWorkspace(enabled, conversationId, fs);
  await workspace.resolve();
  return workspace;
}

describe('Workspace.root', () => {
  it('is a scratchpad under the temp directory keyed by conversation', async () => {
    const expected = EXPECTED_ROOT;
    const actual = (await resolved(true)).root();
    expect(actual).toBe(expected);
  });

  it('is absent until the scratchpad has been created and checked', () => {
    const actual = buildWorkspace(true).root();
    expect(actual).toBeNull();
  });

  it('is absent when the feature is disabled', async () => {
    const actual = (await resolved(false)).root();
    expect(actual).toBeNull();
  });

  it('is absent before a conversation has an id', async () => {
    const actual = (await resolved(true, '')).root();
    expect(actual).toBeNull();
  });

  it('is absent on a platform with no user id to separate one user from another', async () => {
    const fs = new MemoryFileSystem(undefined, '/home/user', CWD);
    fs.setUid(null);
    const actual = (await resolved(true, CONVERSATION_ID, fs)).root();
    expect(actual).toBeNull();
  });

  it('moves with the conversation, so two conversations do not share one scratchpad', async () => {
    const expected = '/tmp/claude-501/other-conversation/scratchpad';
    const actual = (await resolved(true, 'other-conversation')).root();
    expect(actual).toBe(expected);
  });

  it('does not move when the session changes working directory mid-conversation', async () => {
    const fs = new MemoryFileSystem(undefined, '/home/user', CWD);
    const workspace = await resolved(true, CONVERSATION_ID, fs);
    const expected = workspace.root();
    fs.chdir('/home/user');
    const actual = workspace.root();
    expect(actual).toBe(expected);
  });
});

describe('Workspace.resolve', () => {
  it('creates the scratchpad directory', async () => {
    const fs = new MemoryFileSystem(undefined, '/home/user', CWD);
    await resolved(true, CONVERSATION_ID, fs);
    const expected = true;
    const actual = await fs.exists(EXPECTED_ROOT);
    expect(actual).toBe(expected);
  });

  it('creates the shared base readable only by its owner', async () => {
    const fs = new MemoryFileSystem(undefined, '/home/user', CWD);
    await resolved(true, CONVERSATION_ID, fs);
    const expected = 0o700;
    const actual = (await fs.lstat(BASE)).mode;
    expect(actual).toBe(expected);
  });

  it('creates nothing when the feature is disabled', async () => {
    const fs = new MemoryFileSystem(undefined, '/home/user', CWD);
    await resolved(false, CONVERSATION_ID, fs);
    const expected = false;
    const actual = await fs.exists(EXPECTED_ROOT);
    expect(actual).toBe(expected);
  });

  it('reports no refusal when the scratchpad is ready', async () => {
    const workspace = buildWorkspace(true);
    const actual = await workspace.resolve();
    expect(actual).toBeNull();
  });

  it('refuses a base directory owned by another user', async () => {
    const fs = new MemoryFileSystem(undefined, '/home/user', CWD);
    fs.setDirectory(BASE, { uid: OTHER_USER });
    const workspace = buildWorkspace(true, CONVERSATION_ID, fs);
    await workspace.resolve();
    expect(workspace.root()).toBeNull();
  });

  it('names the owner as the reason it refused', async () => {
    const fs = new MemoryFileSystem(undefined, '/home/user', CWD);
    fs.setDirectory(BASE, { uid: OTHER_USER });
    const expected = `${BASE} is owned by another user`;
    const actual = await buildWorkspace(true, CONVERSATION_ID, fs).resolve();
    expect(actual?.reason).toBe(expected);
  });

  it('refuses a base that another user left open to everyone', async () => {
    const fs = new MemoryFileSystem(undefined, '/home/user', CWD);
    fs.setDirectory(BASE, { mode: 0o777 });
    const expected = `${BASE} is reachable by other users`;
    const actual = await buildWorkspace(true, CONVERSATION_ID, fs).resolve();
    expect(actual?.reason).toBe(expected);
  });

  it('tells the operator to remove a directory only when it is theirs to remove', async () => {
    const fs = new MemoryFileSystem(undefined, '/home/user', CWD);
    fs.setDirectory(BASE, { uid: OTHER_USER });
    const actual = await buildWorkspace(true, CONVERSATION_ID, fs).resolve();
    expect(actual?.remedy).not.toContain('Remove');
  });

  // Not tolerated, though tmux tolerates them: on macOS every local account shares the staff group,
  // so group access is public access and the scratchpad approves writes for everything beneath it.
  it('refuses a base its group can reach', async () => {
    const fs = new MemoryFileSystem(undefined, '/home/user', CWD);
    fs.setDirectory(BASE, { mode: 0o770 });
    const expected = `${BASE} is reachable by other users`;
    const actual = await buildWorkspace(true, CONVERSATION_ID, fs).resolve();
    expect(actual?.reason).toBe(expected);
  });

  it('refuses a base readable by anyone outside the owner', async () => {
    const fs = new MemoryFileSystem(undefined, '/home/user', CWD);
    fs.setDirectory(BASE, { mode: 0o704 });
    const expected = `${BASE} is reachable by other users`;
    const actual = await buildWorkspace(true, CONVERSATION_ID, fs).resolve();
    expect(actual?.reason).toBe(expected);
  });

  it('refuses a base that has been replaced by a symlink', async () => {
    const fs = new MemoryFileSystem(undefined, '/home/user', CWD);
    fs.setSymlink(BASE);
    const expected = `${BASE} is not a directory`;
    const actual = await buildWorkspace(true, CONVERSATION_ID, fs).resolve();
    expect(actual?.reason).toBe(expected);
  });
});

// workspace.enabled is the only lever over an approval that bypasses the permission matrix, so it
// has to bite on the next tool call rather than at the next conversation or a restart.
describe('Workspace.enabled, changed mid-conversation', () => {
  it('stops handing out a root as soon as the setting is turned off', async () => {
    const configLoader = loaderFor(true);
    const workspace = buildWorkspaceWith(configLoader);
    await workspace.resolve();
    configLoader.apply({ config: { workspace: { enabled: false } }, sources: [], warnings: [] });
    expect(workspace.root()).toBeNull();
  });

  it('holds nothing inside the scratchpad once the setting is turned off', async () => {
    const configLoader = loaderFor(true);
    const workspace = buildWorkspaceWith(configLoader);
    await workspace.resolve();
    configLoader.apply({ config: { workspace: { enabled: false } }, sources: [], warnings: [] });
    const expected = false;
    const actual = workspace.contains(`${EXPECTED_ROOT}/notes.md`);
    expect(actual).toBe(expected);
  });
});

// A delete acts on the directory entry, not on what a link points at: `rm scratchpad/escape` unlinks
// the link and leaves its target untouched, and DeleteFile does the same. So the entry is judged
// where it was named, while its parent is still resolved in full.
describe('Workspace.containsForDelete', () => {
  const link = (target: string) => {
    const fs = new MemoryFileSystem(undefined, '/home/user', CWD);
    fs.setSymlink(`${EXPECTED_ROOT}/escape`, target);
    return fs;
  };

  it('holds a symlink that lives in the scratchpad, whatever it points at', async () => {
    const workspace = await resolved(true, CONVERSATION_ID, link('/etc/passwd'));
    const expected = true;
    const actual = workspace.containsForDelete(`${EXPECTED_ROOT}/escape`);
    expect(actual).toBe(expected);
  });

  it('does not follow that symlink the way a write does', async () => {
    const workspace = await resolved(true, CONVERSATION_ID, link('/etc/passwd'));
    const expected = false;
    const actual = workspace.contains(`${EXPECTED_ROOT}/escape`);
    expect(actual).toBe(expected);
  });

  it('does not hold the scratchpad directory itself', async () => {
    const expected = false;
    const actual = (await resolved(true)).containsForDelete(EXPECTED_ROOT);
    expect(actual).toBe(expected);
  });

  it('does not hold a path that climbs out of the scratchpad', async () => {
    const expected = false;
    const actual = (await resolved(true)).containsForDelete(`${EXPECTED_ROOT}/../../elsewhere/file.md`);
    expect(actual).toBe(expected);
  });
});

describe('Workspace.contains', () => {
  it('holds a file inside the scratchpad', async () => {
    const expected = true;
    const actual = (await resolved(true)).contains(`${EXPECTED_ROOT}/notes.md`);
    expect(actual).toBe(expected);
  });

  it('does not hold the scratchpad directory itself', async () => {
    const expected = false;
    const actual = (await resolved(true)).contains(EXPECTED_ROOT);
    expect(actual).toBe(expected);
  });

  it('does not hold anything once the scratchpad has been refused', async () => {
    const fs = new MemoryFileSystem(undefined, '/home/user', CWD);
    fs.setDirectory(BASE, { uid: OTHER_USER });
    const workspace = await resolved(true, CONVERSATION_ID, fs);
    const expected = false;
    const actual = workspace.contains(`${EXPECTED_ROOT}/notes.md`);
    expect(actual).toBe(expected);
  });
});
