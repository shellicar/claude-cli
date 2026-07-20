import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IDisabledToolsProvider } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di-lite';

export class ConfigDisabledToolsProvider extends IDisabledToolsProvider {
  @dependsOn(ConfigLoader)
  public configLoader!: ConfigLoader<any>;

  public get disabledTools(): ReadonlySet<string> {
    return new Set(this.configLoader.config.disabledTools);
  }
}
