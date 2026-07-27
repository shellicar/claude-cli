import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IDisabledToolsProvider } from '@shellicar/claude-sdk';
import { AZ_CLI_TOOL_NAME, ESCALATED_AZ_CLI_TOOL_NAME } from '@shellicar/claude-sdk-tools/Az';
import { ADO_PR_TOOL_NAMES } from '@shellicar/claude-sdk-tools/AzureDevOps';
import { dependsOn } from '@shellicar/core-di';

export class ConfigDisabledToolsProvider extends IDisabledToolsProvider {
  @dependsOn(ConfigLoader)
  public configLoader!: ConfigLoader<any>;

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
    return disabled;
  }
}
