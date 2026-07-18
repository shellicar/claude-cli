import { buildEnvFrom, IEnvProvider } from '@shellicar/claude-sdk-tools/ExecV3';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { dependsOn } from '@shellicar/core-di-lite';
import { ISecrets } from './Secrets.js';

/** Static for the process's lifetime — the running binary's platform cannot change mid-session,
 *  so this is computed once rather than re-checked (or probed via module resolution) per call. */
const KEYCHAIN_PLATFORM_SUPPORTED = process.platform === 'darwin' && process.arch === 'arm64';

/** The concrete IEnvProvider every ordinary exec call runs under. Strips any ambient gh
 *  credential and, when scoping is available and enabled, injects the reader token fresh on
 *  every call: same reasoning as ISecrets itself, no caching, so a rotated credential takes
 *  effect on the very next call. The reader token is not "read-only": it holds Contents:
 *  read-write, so it can push branches. What makes it unprivileged is that it has no Pull
 *  requests permission, so GitHub itself refuses any PR operation on it, regardless of what
 *  command runs. The holder token never appears here; it only ever exists inside the GitHub
 *  escalated tools' own env construction (runGhEscalated).
 *
 *  SSH_AUTH_SOCK is stripped too, not just the gh token vars: an ssh-remote git push/clone
 *  authenticates against the ssh-agent socket, not GH_TOKEN, so leaving it present would let
 *  exec authenticate as the real ssh identity and bypass the gh token scoping entirely.
 *
 *  Scoping requires keychain-native, which only ever installs on macOS arm64 (its optionalDependency
 *  os/cpu fields). On any other platform, or when config.secrets.ghScoping is off, buildEnv still
 *  strips ambient credentials — it just never injects a replacement, so a gh command fails on
 *  missing auth instead of either crashing exec (the pre-fix behaviour) or running unscoped. The
 *  config value is read live on every call (not cached at construction), so toggling it takes
 *  effect on the very next exec call once the config file's watcher picks up the change — no
 *  restart needed. */
export class EnvProvider extends IEnvProvider {
  @dependsOn(ISecrets) private readonly secrets!: ISecrets;
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<any>;

  public buildEnv(cmdEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const scopingEnabled = KEYCHAIN_PLATFORM_SUPPORTED && this.configLoader.config.secrets.ghScoping;
    return buildEnvFrom(
      {
        strip: ['GH_TOKEN', 'GITHUB_TOKEN', 'SSH_AUTH_SOCK'],
        provide: scopingEnabled ? { GH_TOKEN: () => this.secrets.ghReaderToken() } : {},
      },
      cmdEnv,
    );
  }
}
