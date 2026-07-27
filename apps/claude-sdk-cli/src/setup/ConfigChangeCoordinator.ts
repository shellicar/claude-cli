import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IDisabledToolsProvider, IDurableConfigProvider } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import { logger } from '../logger.js';
import { IConversationState } from '../model/ConversationState.js';
import { DisabledToolsNoticeGate } from '../model/DisabledToolsNoticeGate.js';
import { PermissionsNoticeGate } from '../model/PermissionsNoticeGate.js';
import { StatusState } from '../model/StatusState.js';
import { IRulesConfigNotifier } from './ConfigRulesConfigProvider.js';
import { ModelOverrides } from './ModelOverrides.js';
import { ITurnCoordinator } from './TurnCoordinator.js';

/** The coordinator's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IConfigChangeCoordinator {
  public abstract wire(): void;
}

/**
 * Splices a conversation notice on two independent config-change paths, and keeps the status bar's
 * model/id display current on a whole-document reload:
 *
 * - `IRulesConfigNotifier`: tools.rules/tools.blockedCommands validate and watch independently of
 *   the whole-document reload, so it never fires through `configLoader.onChange` and needs its own
 *   splice point.
 * - `configLoader.onChange`: the whole-document reload. Defers the live status update until the
 *   turn between requests (`turnCoordinator.inProgress`) so a reload mid-turn doesn't flash stale
 *   figures.
 *
 * Was inline in `main.ts`'s `runApp`. Extracted so its dependencies are declared, not hand-resolved,
 * and so `buildContainer(...).validate()` sees this wiring.
 */
export class ConfigChangeCoordinator extends IConfigChangeCoordinator {
  @dependsOn(IRulesConfigNotifier) private readonly rulesConfigNotifier!: IRulesConfigNotifier;
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<any>;
  @dependsOn(PermissionsNoticeGate) private readonly permissionsNoticeGate!: PermissionsNoticeGate;
  @dependsOn(IConversationState) private readonly conversationState!: IConversationState;
  @dependsOn(ITurnCoordinator) private readonly turnCoordinator!: ITurnCoordinator;
  @dependsOn(StatusState) private readonly statusState!: StatusState;
  @dependsOn(IDurableConfigProvider) private readonly configFactory!: IDurableConfigProvider;
  @dependsOn(ModelOverrides) private readonly overrides!: ModelOverrides;
  @dependsOn(IDisabledToolsProvider) private readonly disabledToolsProvider!: IDisabledToolsProvider;
  @dependsOn(DisabledToolsNoticeGate) private readonly disabledToolsNoticeGate!: DisabledToolsNoticeGate;

  public wire(): void {
    this.rulesConfigNotifier.onNotice((notice) => {
      if (notice.kind === 'invalid') {
        this.conversationState.spliceNotice(`\u26a0\ufe0f tools.rules/tools.blockedCommands is invalid \u2014 keeping the previous rules (${notice.error})`);
      } else if (notice.kind === 'recovered') {
        this.conversationState.spliceNotice('\u2705 tools.rules/tools.blockedCommands valid again');
      } else {
        this.conversationState.spliceNotice('\ud83d\udee1\ufe0f tools.rules/tools.blockedCommands updated');
      }
    });

    this.configLoader.onChange((config) => {
      logger.info('config reloaded', { model: config.model });
      const permissionsNotice = this.permissionsNoticeGate.update(config.permissions);
      if (permissionsNotice != null) {
        this.conversationState.spliceNotice(permissionsNotice);
      }
      if (!this.turnCoordinator.inProgress) {
        this.statusState.setModel(this.configFactory.getEffectiveModel(), this.overrides.model != null);
        this.statusState.setShowConversationId(config.statusBar.showConversationId);
      }
      const disabledToolsNotice = this.disabledToolsNoticeGate.update(this.disabledToolsProvider.disabledTools);
      if (disabledToolsNotice != null) {
        this.conversationState.spliceNotice(disabledToolsNotice);
      }
    });
  }
}
