import { buildEnvFrom, IEnvProvider } from '@shellicar/claude-sdk-tools/ExecV3';
import { dependsOn } from '@shellicar/core-di-lite';
import { ISecrets } from './Secrets.js';

/** The concrete IEnvProvider every ordinary exec call runs under. Strips any ambient gh
 *  credential and injects the reader token, fresh on every call: same reasoning as ISecrets
 *  itself, no caching, so a rotated credential takes effect on the very next call. The reader
 *  token is not "read-only": it holds Contents: read-write, so it can push branches. What makes
 *  it unprivileged is that it has no Pull requests permission, so GitHub itself refuses any PR
 *  operation on it, regardless of what command runs. The holder token never appears here; it
 *  only ever exists inside the GitHub escalated tools' own env construction (runGhEscalated).
 *
 *  SSH_AUTH_SOCK is stripped too, not just the gh token vars: an ssh-remote git push/clone
 *  authenticates against the ssh-agent socket, not GH_TOKEN, so leaving it present would let
 *  exec authenticate as the real ssh identity and bypass the gh token scoping entirely. */
export class EnvProvider extends IEnvProvider {
  @dependsOn(ISecrets) private readonly secrets!: ISecrets;

  public buildEnv(cmdEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return buildEnvFrom({ strip: ['GH_TOKEN', 'GITHUB_TOKEN', 'SSH_AUTH_SOCK'], provide: { GH_TOKEN: () => this.secrets.ghReaderToken() } }, cmdEnv);
  }
}
