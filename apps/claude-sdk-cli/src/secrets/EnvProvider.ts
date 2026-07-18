import { buildEnvFrom, IEnvProvider } from '@shellicar/claude-sdk-tools/ExecV3';
import { dependsOn } from '@shellicar/core-di-lite';
import { ISecrets } from './Secrets.js';

/** The concrete IEnvProvider every ordinary exec call runs under. Strips any ambient gh
 *  credential and injects the read-only reader token, fresh on every call: same reasoning as
 *  ISecrets itself, no caching, so a rotated credential takes effect on the very next call.
 *  The holder token never appears here; it only ever exists inside the GitHub escalated tools'
 *  own env construction (runGhEscalated). */
export class EnvProvider extends IEnvProvider {
  @dependsOn(ISecrets) private readonly secrets!: ISecrets;

  public buildEnv(cmdEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return buildEnvFrom({ strip: ['GH_TOKEN', 'GITHUB_TOKEN'], provide: { GH_TOKEN: () => this.secrets.ghReaderToken() } }, cmdEnv);
  }
}
