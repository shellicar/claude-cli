import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { buildEnvFrom, IEnvProvider } from '@shellicar/claude-sdk-tools/ExecV3';
import { dependsOn } from '@shellicar/core-di-lite';
import { ISecrets } from './Secrets.js';

/** Extracted as a pure function so the boundary (darwin + arm64, nothing else) is unit-testable
 *  directly, without mocking process.platform/process.arch. */
export function isKeychainPlatformSupported(platform: NodeJS.Platform, arch: NodeJS.Architecture): boolean {
  return platform === 'darwin' && arch === 'arm64';
}

/** Static for the process's lifetime — the running binary's platform cannot change mid-session,
 *  so this is computed once rather than re-checked (or probed via module resolution) per call. */
const KEYCHAIN_PLATFORM_SUPPORTED = isKeychainPlatformSupported(process.platform, process.arch);

const GH_ENV_KEYS = ['GH_TOKEN', 'GITHUB_TOKEN', 'SSH_AUTH_SOCK'];

/** The concrete IEnvProvider every ordinary exec call runs under. Two independently configured
 *  behaviours, not one:
 *
 *  - stripGhCredentials (opt-out, default on): delete GH_TOKEN, GITHUB_TOKEN, and SSH_AUTH_SOCK
 *    from the environment before every exec call, so a model-driven command can never inherit
 *    your ambient gh/ssh credentials. This existed before ghScoping and must keep working exactly
 *    as before regardless of it — someone relying on their own ambient GH_TOKEN reaching exec
 *    needs a way to turn stripping off on its own, not as a side effect of ghScoping being unset.
 *  - ghScoping (opt-in, default off): after stripping, inject a specific unprivileged reader
 *    token read fresh from Keychain on every call (no caching, so a rotated credential takes
 *    effect on the very next call). The reader token is not "read-only": it holds Contents:
 *    read-write, so it can push branches. What makes it unprivileged is that it has no Pull
 *    requests permission, so GitHub itself refuses any PR operation on it, regardless of what
 *    command runs. The holder token never appears here; it only ever exists inside the GitHub
 *    escalated tools' own env construction (runGhEscalated).
 *
 *  ghScoping requires keychain-native, which only ever installs on macOS arm64 (its
 *  optionalDependency os/cpu fields), AND a Keychain reader item created out of band by the
 *  operator — so it only ever does something on a deliberately set-up machine, never out of the
 *  box. Off (by default, or when unsupported), buildEnv simply never injects a replacement; it
 *  does not fall back to throwing, and it does not on its own decide whether stripping happens.
 *
 *  Both config values are read live on every call (not cached at construction), so toggling
 *  either one takes effect on the very next exec call once the config file's watcher picks up
 *  the change — no restart needed. */
export class EnvProvider extends IEnvProvider {
  @dependsOn(ISecrets) private readonly secrets!: ISecrets;
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<any>;

  public buildEnv(cmdEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const { stripGhCredentials, ghScoping } = this.configLoader.config.secrets;
    const scopingEnabled = KEYCHAIN_PLATFORM_SUPPORTED && ghScoping;
    return buildEnvFrom(
      {
        strip: stripGhCredentials ? GH_ENV_KEYS : [],
        provide: scopingEnabled ? { GH_TOKEN: () => this.secrets.ghReaderToken() } : {},
      },
      cmdEnv,
    );
  }
}
