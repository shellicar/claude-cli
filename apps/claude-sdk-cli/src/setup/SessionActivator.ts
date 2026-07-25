import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { dependsOn } from '@shellicar/core-di';
import { IConversationSession } from '../model/ConversationSession.js';
import { ISystemIdentity } from '../model/ISystemIdentity.js';
import { StatusState } from '../model/StatusState.js';

export type SessionActivationArgs = {
  resumeId: string | null;
  initialFilePaths: readonly string[];
  initialPrompt: string | null;
  noResume: boolean;
  identityPath: string | null;
  sessionName: string | null;
};

/** Thrown when `--system-identity` names a file that does not exist — the one moment a missing
 *  identity file is fatal (everywhere else a missing/absent identity degrades to a warn). The
 *  activator throws rather than printing and exiting itself, so it stays a plain injectable class;
 *  `main.ts` is the process boundary, so it owns the actual exit. */
export class IdentityFileNotFoundError extends Error {
  public constructor(public readonly path: string) {
    super(`identity file not found: ${path}`);
  }
}

/** The activator's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class ISessionActivator {
  public abstract activate(args: SessionActivationArgs): Promise<void>;
}

/**
 * Brings up the session for this process: resume/startFresh/load per argv, then the system-identity
 * assert/load (`--system-identity` ASSERTS unconditionally; its absence DEFERS to whatever the
 * conversation already owns), then the optional `--name` override.
 *
 * Was inline in `main.ts`'s `runApp` — main resolved every dependency here itself and sequenced it by
 * hand. Extracted so the sequence's dependencies are declared, not hand-resolved, and so
 * `buildContainer(...).validate()` actually sees this wiring.
 */
export class SessionActivator extends ISessionActivator {
  @dependsOn(IConversationSession) private readonly session!: IConversationSession;
  @dependsOn(ISystemIdentity) private readonly systemIdentity!: ISystemIdentity;
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;
  @dependsOn(StatusState) private readonly statusState!: StatusState;

  public async activate(args: SessionActivationArgs): Promise<void> {
    const { resumeId, initialFilePaths, initialPrompt, noResume, identityPath, sessionName } = args;

    if (resumeId != null) {
      await this.session.resume(resumeId);
    } else if (initialFilePaths.length > 0 || initialPrompt != null || noResume) {
      await this.session.startFresh();
    } else {
      await this.session.load();
    }

    if (identityPath != null) {
      const exists = await this.fs.exists(identityPath);
      if (!exists) {
        throw new IdentityFileNotFoundError(identityPath);
      }
      this.systemIdentity.assert(this.session.id, identityPath);
    } else {
      this.systemIdentity.load(this.session.id);
    }

    if (sessionName != null) {
      this.statusState.setSessionName(sessionName);
    }
  }
}
