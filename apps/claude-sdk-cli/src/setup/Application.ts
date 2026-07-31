import { stat } from 'node:fs/promises';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { ICredentialProvider, ILoginFlow, NotAuthenticatedError } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import { ViewHost } from '../app/ViewHost.js';
import { EditorHandler } from '../controller/EditorHandler.js';
import { IWireSayInbox } from '../conv/WireSayInbox.js';
import { logger } from '../logger.js';
import { buildSubmitText } from '../model/buildSubmitText.js';
import { IConversationState } from '../model/ConversationState.js';
import { ReadLine } from '../ReadLine.js';
import type { UserInput } from '../runAgent.js';
import { Flasher } from '../view/Flasher.js';
import { TerminalRenderer } from '../view/TerminalRenderer.js';
import { IAgentBusActivator } from './AgentBusActivator.js';
import { IConfigChangeCoordinator } from './ConfigChangeCoordinator.js';
import { IConsumerMessageRouter } from './ConsumerMessageRouter.js';
import { IConversationBootSequence } from './ConversationBootSequence.js';
import { ISessionActivator } from './SessionActivator.js';
import { IShutdownSequence } from './ShutdownSequence.js';
import { ITurnCoordinator } from './TurnCoordinator.js';
import { IWorkingDirectoryMoveHandler } from './WorkingDirectoryMoveHandler.js';

export type RunAppArgs = {
  initialFilePaths: string[];
  initialPrompt: string | null;
  decodedPrompt: string | null;
  noResume: boolean;
  sessionName: string | null;
  resumeId: string | null;
  identityPath: string | null;
  configOverride: Record<string, unknown> | undefined;
};

/** The application's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IApplication {
  /** Runs the whole interactive session: activation, every startup wire-up, the initial turn (if
   *  any), then the main input loop. Never returns under normal operation — the process exits via
   *  `IShutdownSequence`. Rethrows `IdentityFileNotFoundError`; the caller is the process boundary
   *  (see `SessionActivator`) and owns printing and exiting for that one case. */
  public abstract run(args: RunAppArgs): Promise<void>;
}

async function buildInitialInput(text: string, filePaths: readonly string[]): Promise<UserInput> {
  if (filePaths.length === 0) {
    return { text, images: [] };
  }
  const attachments: { kind: 'file'; path: string; fileType: 'file' | 'dir' | 'missing'; sizeBytes?: number }[] = [];
  for (const filePath of filePaths) {
    let fileType: 'file' | 'dir' | 'missing' = 'missing';
    let sizeBytes: number | undefined;
    try {
      const fileInfo = await stat(filePath);
      if (fileInfo.isDirectory()) {
        fileType = 'dir';
      } else {
        fileType = 'file';
        sizeBytes = fileInfo.size;
      }
    } catch {
      fileType = 'missing';
    }
    attachments.push({ kind: 'file', path: filePath, fileType, sizeBytes });
  }
  return {
    text: buildSubmitText(text, attachments),
    images: [],
  };
}

/**
 * The one composition-root object `main.ts` resolves. Every startup step main.ts used to hand-resolve
 * and sequence itself — config fail-fast, credential activation, session activation, the bus/agent
 * wiring, the config-change and shutdown wiring, the consumer message router, the view, the boot
 * sequence, and the main input loop — is a declared dependency here instead, so
 * `buildContainer(...).validate()` (and `eagerSingletons`) actually sees the whole graph. `main.ts`
 * keeps only process-boundary concerns: argv, `buildProvider`, and the one case
 * (`IdentityFileNotFoundError`) it must print and exit for itself.
 */
export class Application extends IApplication {
  // Fail-fast at construction: resolving Application resolves these, throwing on a broken config
  // or an unreachable Anthropic credential before anything else runs. The config watches are not
  // among them — they are not singleton values (see container.ts), so WorkingDirectoryMoveHandler
  // constructs its own, in wire(), called explicitly below.
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<any>;
  @dependsOn(ICredentialProvider) private readonly credentials!: ICredentialProvider;
  @dependsOn(ILoginFlow) private readonly loginFlow!: ILoginFlow;
  @dependsOn(ISessionActivator) private readonly sessionActivator!: ISessionActivator;
  @dependsOn(IWireSayInbox) private readonly wireSayInbox!: IWireSayInbox;
  @dependsOn(IAgentBusActivator) private readonly agentBusActivator!: IAgentBusActivator;
  @dependsOn(IConversationState) private readonly conversationState!: IConversationState;
  @dependsOn(ITurnCoordinator) private readonly turnCoordinator!: ITurnCoordinator;
  @dependsOn(IConfigChangeCoordinator) private readonly configChangeCoordinator!: IConfigChangeCoordinator;
  @dependsOn(IWorkingDirectoryMoveHandler) private readonly workingDirectoryMoveHandler!: IWorkingDirectoryMoveHandler;
  @dependsOn(IShutdownSequence) private readonly shutdownSequence!: IShutdownSequence;
  @dependsOn(IConsumerMessageRouter) private readonly consumerMessageRouter!: IConsumerMessageRouter;
  @dependsOn(TerminalRenderer) private readonly renderer!: TerminalRenderer;
  @dependsOn(ViewHost) private readonly host!: ViewHost;
  @dependsOn(Flasher) private readonly flasher!: Flasher;
  @dependsOn(ReadLine) private readonly readLine!: ReadLine;
  @dependsOn(IConversationBootSequence) private readonly bootSequence!: IConversationBootSequence;
  @dependsOn(EditorHandler) private readonly editorHandler!: EditorHandler;

  public async run(args: RunAppArgs): Promise<void> {
    const { initialFilePaths, initialPrompt, decodedPrompt, noResume, sessionName, resumeId, identityPath, configOverride } = args;

    // Constructs and starts the config watches (see WorkingDirectoryMoveHandler): credential activation
    // below can block arbitrarily long (an OAuth flow waiting on the browser), and a config edit made
    // during that wait must be watched, not silently missed until the next edit after it.
    this.workingDirectoryMoveHandler.wire();

    // Activation: async startup. The one place a browser login may open.
    try {
      await this.credentials.get();
    } catch (err) {
      if (!(err instanceof NotAuthenticatedError)) {
        throw err;
      }
      await this.loginFlow.run();
    }

    // IdentityFileNotFoundError propagates: the caller is the process boundary and owns printing/exiting for it.
    await this.sessionActivator.activate({ resumeId, initialFilePaths, initialPrompt, noResume, identityPath, sessionName });

    // Wired before the agent surface goes live: agentBusActivator.activate() binds the requests subject
    // (agent-spec) and a drain can arrive the instant it does. ShutdownSequence.wire() subscribes the
    // drain listener; wiring it after activate() would silently drop a drain that lands in that window.
    this.configChangeCoordinator.wire();
    this.shutdownSequence.wire();
    this.consumerMessageRouter.wire();
    this.turnCoordinator.wire();

    await this.agentBusActivator.activate();

    this.renderer.enter();
    this.readLine.enable();
    this.host.renderNow();

    // The terminal is now in the entered (alt-screen/raw) state, so any failure past this point must
    // restore it before propagating — the old `using renderer = ...`/`using _ = ReadLine` gave this for
    // free; a plain field does not, so it's explicit here instead.
    try {
      // Turn-time clock repaint: the active role's total ticks while idle. The terminal already repaints
      // fully on activity; this covers the idle case.
      const clockRepaint = setInterval(() => this.host.scheduleRender(), 1000);
      clockRepaint.unref();

      await this.bootSequence.run(configOverride);

      // --- Main loop ---

      const hasInitialTurn = initialFilePaths.length > 0 || initialPrompt != null;
      if (hasInitialTurn) {
        await this.turnCoordinator.runTurn(await buildInitialInput(decodedPrompt ?? '', initialFilePaths));
      }

      // The loop races the keyboard against the wire: whichever produces input first drives the turn. The
      // premise rule keeps them from colliding into two turns — a say is accepted only while idle (§1.4).
      const nextInput = async (): Promise<UserInput> => {
        const fromKeyboard = this.editorHandler.waitForInput();
        const fromWire = this.wireSayInbox.next().then((s): UserInput => ({ text: s.text, images: [], queryId: s.queryId, from: s.from }));
        return Promise.race([fromKeyboard, fromWire]);
      };

      while (true) {
        this.conversationState.markPromptStart();
        await this.turnCoordinator.runTurn(await nextInput());
      }
    } catch (err) {
      // Each teardown step is independent, the same as `using`'s own multi-resource disposal: one
      // throwing must not stop the other from running, and neither may mask the original failure.
      try {
        this.renderer.exit();
      } catch (disposeErr) {
        logger.error('renderer teardown failed after a startup failure', disposeErr);
      }
      try {
        this.host[Symbol.dispose]();
      } catch (disposeErr) {
        logger.error('host teardown failed after a startup failure', disposeErr);
      }
      try {
        this.flasher[Symbol.dispose]();
      } catch (disposeErr) {
        logger.error('flasher teardown failed after a startup failure', disposeErr);
      }
      try {
        this.readLine[Symbol.dispose]();
      } catch (disposeErr) {
        logger.error('readLine teardown failed after a startup failure', disposeErr);
      }
      throw err;
    }
  }
}
