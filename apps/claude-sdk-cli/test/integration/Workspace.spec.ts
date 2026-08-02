import { mkdtempSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { NodeFileSystem } from '@shellicar/claude-sdk-tools/fs';
import { createServiceCollection, Lifetime } from '@shellicar/core-di';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { logger } from '../../src/logger.js';
import { IConversationSession } from '../../src/model/ConversationSession.js';
import { IWorkspace, Workspace } from '../../src/workspace/Workspace.js';

// The fakes prove the decisions; this proves the real filesystem behaves the way they assume, on a
// real temp directory with a real symlink. It is the only place NodeFileSystem's mode, ownership and
// symlink resolution are exercised together with the class that depends on them.

const CONVERSATION_ID = 'integration-conversation';

class FixedSession extends IConversationSession {
  public get id(): string {
    return CONVERSATION_ID;
  }
  public get turnCount(): number {
    throw new Error('FixedSession: turnCount not supported');
  }
  public conversationTip(): undefined {
    throw new Error('FixedSession: conversationTip not supported');
  }
  public startFresh(): Promise<void> {
    throw new Error('FixedSession: startFresh not supported');
  }
  public resume(): Promise<void> {
    throw new Error('FixedSession: resume not supported');
  }
  public load(): Promise<void> {
    throw new Error('FixedSession: load not supported');
  }
  public saveSession(): Promise<void> {
    throw new Error('FixedSession: saveSession not supported');
  }
  public saveConversation(): Promise<void> {
    throw new Error('FixedSession: saveConversation not supported');
  }
  public createNew(): Promise<void> {
    throw new Error('FixedSession: createNew not supported');
  }
}

/** A NodeFileSystem whose temp directory is the test's own, so nothing touches the real one. */
class ScopedFileSystem extends NodeFileSystem {
  readonly #tmp: string;

  public constructor(tmp: string) {
    super();
    this.#tmp = tmp;
  }

  public override tmpdir(): string {
    return this.#tmp;
  }
}

let scratch: string;
let fs: ScopedFileSystem;

function buildWorkspace(): IWorkspace {
  const services = createServiceCollection({ defaultLifetime: Lifetime.Singleton });
  services
    .register(ScopedFileSystem)
    .using(() => fs)
    .as(IFileSystem);
  services
    .register(ConfigLoader)
    .using(() => new ConfigLoader({ config: { workspace: { enabled: true } }, sources: [], warnings: [] }))
    .asSelf();
  services
    .register(FixedSession)
    .using(() => new FixedSession())
    .as(IConversationSession);
  services
    .register(ILogger)
    .using(() => logger)
    .asSelf();
  services.register(Workspace).as(IWorkspace);
  return services.buildProvider().resolve(IWorkspace);
}

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'workspace-integration-'));
  fs = new ScopedFileSystem(scratch);
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('Workspace against a real filesystem', () => {
  it('creates the shared base owner-only', async () => {
    const workspace = buildWorkspace();
    await workspace.resolve();
    const expected = 0o700;
    const actual = statSync(path.join(scratch, `claude-${process.getuid?.()}`)).mode & 0o777;
    expect(actual).toBe(expected);
  });

  it('produces a scratchpad that exists on disk', async () => {
    const workspace = buildWorkspace();
    await workspace.resolve();
    const root = workspace.root();
    const expected = true;
    const actual = root != null && statSync(root).isDirectory();
    expect(actual).toBe(expected);
  });

  it('does not hold a symlink inside the scratchpad that points outside it', async () => {
    const workspace = buildWorkspace();
    await workspace.resolve();
    const root = workspace.root();
    if (root == null) {
      throw new Error('expected a scratchpad');
    }
    const planted = path.join(root, 'escape');
    symlinkSync(path.join(scratch, 'elsewhere'), planted);
    const expected = false;
    const actual = workspace.contains(planted);
    expect(actual).toBe(expected);
  });

  it('holds an ordinary file inside the scratchpad', async () => {
    const workspace = buildWorkspace();
    await workspace.resolve();
    const root = workspace.root();
    if (root == null) {
      throw new Error('expected a scratchpad');
    }
    const expected = true;
    const actual = workspace.contains(path.join(root, 'notes.md'));
    expect(actual).toBe(expected);
  });
});
