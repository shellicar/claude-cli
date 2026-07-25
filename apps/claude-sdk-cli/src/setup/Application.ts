import { stat } from 'node:fs/promises';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { ConfigWatchHandle } from '@shellicar/claude-core/Config/types';
import { AnthropicAuth } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import { ViewHost } from '../app/ViewHost.js';
import { EditorHandler } from '../controller/EditorHandler.js';
import { IWireSayInbox } from '../conv/WireSayInbox.js';
import { buildSubmitText } from '../model/buildSubmitText.js';
import { IConversationState } from '../model/ConversationState.js';
import { ReadLine } from '../ReadLine.js';
import type { UserInput } from '../runAgent.js';
import { Flasher } from '../view/Flasher.js';
import { TerminalRenderer } from '../view/TerminalRenderer.js';
import { IAgentBusActivator } from './AgentBusActivator.js';
import { IConfigChangeCoordinator } from './ConfigChangeCoordinator.js';
import { RulesConfigWatchHandle } from './ConfigRulesConfigProvider.js';
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
  // or an unreachable Anthropic credential before anything else runs.
  @dependsOn(ConfigWatchHandle) private readonly configWatch!: ConfigWatchHandle;
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<any>;
  @dependsOn(RulesConfigWatchHandle) private readonly rulesConfigWatch!: ConfigWatchHandle;
  @dependsOn(AnthropicAuth) private readonly anthropicAuth!: AnthropicAuth;
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

    // Activation: async startup
    await this.anthropicAuth.getCredentials();

    // IdentityFileNotFoundError propagates: the caller is the process boundary and owns printing/exiting for it.
    await this.sessionActivator.activate({ resumeId, initialFilePaths, initialPrompt, noResume, identityPath, sessionName });

    await this.agentBusActivator.activate();

    this.configChangeCoordinator.wire();
    this.workingDirectoryMoveHandler.wire();
    this.shutdownSequence.wire();
    this.consumerMessageRouter.wire();

    this.renderer.enter();
    this.host.renderNow();

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
  }
}
