import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IDisabledToolsProvider, isReadOperation } from '@shellicar/claude-sdk';
import { AZ_CLI_TOOL_NAME, ESCALATED_AZ_CLI_TOOL_NAME } from '@shellicar/claude-sdk-tools/Az';
import { ADO_PR_TOOL_NAMES } from '@shellicar/claude-sdk-tools/AzureDevOps';
import { dependsOn } from '@shellicar/core-di';
import { ToolModeState } from '../model/ToolModeState.js';
import { AppToolsService } from './AppToolsService.js';

export class ConfigDisabledToolsProvider extends IDisabledToolsProvider {
  @dependsOn(ConfigLoader)
  public configLoader!: ConfigLoader<any>;
  @dependsOn(ToolModeState)
  public toolModeState!: ToolModeState;
  @dependsOn(AppToolsService)
  public appTools!: AppToolsService;

  /** Read fresh on every access (see `IDisabledToolsProvider`): whether any account currently has a
   *  reader/holder identity configured is live config, so `AzCli`/`EscalatedAzCli`/the
   *  AzureDevOps.PullRequest.* tools are added to the disabled set — and so left off that turn's
   *  wire tool list — the moment the last matching account is removed, and drop back out the moment
   *  one is (re)configured. This is what keeps `Az/tools.ts`/`AzureDevOps/tools.ts` free to always
   *  register these tools unconditionally: registration is static, offering them to the model is not. */
  public get disabledTools(): ReadonlySet<string> {
    const disabled = new Set<string>(this.configLoader.config.disabledTools);
    const accounts = Object.values(this.configLoader.config.az.accounts) as { reader: unknown; holder: unknown }[];
    const hasReader = accounts.some((a) => a.reader != null);
    const hasHolder = accounts.some((a) => a.holder != null);
    if (!hasReader) {
      disabled.add(AZ_CLI_TOOL_NAME);
    }
    if (!hasHolder) {
      disabled.add(ESCALATED_AZ_CLI_TOOL_NAME);
      for (const name of ADO_PR_TOOL_NAMES) {
        disabled.add(name);
      }
    }

    // The tool-availability mode (see ToolModeState) narrows the wire list further, on top of
    // whatever config/az-account state already disabled above — never in place of it. 'readOnly'
    // keeps only read/ephemeral.read tools; 'noTools' keeps none.
    const mode = this.toolModeState.mode;
    if (mode === 'noTools') {
      for (const tool of this.appTools.tools) {
        disabled.add(tool.name);
      }
    } else if (mode === 'readOnly') {
      for (const tool of this.appTools.tools) {
        if (!isReadOperation(tool.operation)) {
          disabled.add(tool.name);
        }
      }
    }
    return disabled;
  }
}
