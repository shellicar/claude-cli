import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { IConfigOptions } from '@shellicar/claude-core/Config/IConfigOptions';
import { DEFAULT_TSSERVER_TIMEOUT_MS, type ITsServerOptions, resolveTsServerPath } from '@shellicar/claude-sdk-tools/TsService';
import { z } from 'zod';
import { CONFIG_PATH, localConfigPath } from './cli-config/consts.js';
import { initConfig } from './cli-config/initConfig.js';
import { parseConfigOverride } from './cli-config/parseConfigOverride.js';
import { sdkConfigSchema } from './cli-config/schema.js';
import { decodePromptEscapes } from './decodePromptEscapes.js';
import { runVerify } from './entry/verify.js';
import { printUsage, printVersion, printVersionInfo } from './help.js';
import { IApplication, type RunAppArgs } from './setup/Application.js';
import { buildContainer, type ContainerOptions } from './setup/container.js';
import type { IRuntimeOptions } from './setup/IRuntimeOptions.js';
import { IdentityFileNotFoundError } from './setup/SessionActivator.js';

type RunAppInput = ContainerOptions & { args: RunAppArgs };

/**
 * The procedural startup. Holds everything that used to run at module scope:
 * argv parsing, the early-exit branches, and the parameter extraction. Builds
 * the registered options objects (decision 8) from argv and passes them into
 * the container via `runApp` / `runVerify`; nothing is `new`'d here (decision 9).
 * The only import-time effect of `entry/main.ts` is calling this (decision 13).
 */
export const main = async (): Promise<void> => {
  process.title = 'claude-sdk-cli';

  if (process.argv.includes('-?')) {
    // biome-ignore lint/suspicious/noConsole: CLI --help output before app starts
    printUsage(console.log);
    process.exit(0);
  }

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      options: {
        version: { type: 'boolean', short: 'v', default: false },
        'version-info': { type: 'boolean', default: false },
        verify: { type: 'boolean', default: false },
        'init-config': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        file: { type: 'string', multiple: true },
        name: { type: 'string' },
        model: { type: 'string' },
        prompt: { type: 'string' },
        system: { type: 'string' },
        claudeMd: { type: 'string' },
        'system-identity': { type: 'string' },
        resume: { type: 'string' },
        config: { type: 'string' },
        'no-resume': { type: 'boolean', default: false },
      },
      strict: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n\n`);
    printUsage((line) => process.stderr.write(`${line}\n`));
    process.exit(1);
  }
  const { values } = parsed;

  if (values.version) {
    // biome-ignore lint/suspicious/noConsole: CLI --version output before app starts
    printVersion(console.log);
    process.exit(0);
  }
  if (values['version-info']) {
    // biome-ignore lint/suspicious/noConsole: CLI --version-info output before app starts
    printVersionInfo(console.log);
    process.exit(0);
  }
  if (values['init-config']) {
    // biome-ignore lint/suspicious/noConsole: CLI --init-config output before app starts
    initConfig(console.log);
    process.exit(0);
  }
  if (values.help) {
    // biome-ignore lint/suspicious/noConsole: CLI --help output before app starts
    printUsage(console.log);
    process.exit(0);
  }
  // --verify is non-interactive (it runs in CI and under Claude), so it must
  // not be gated on a TTY; it is handled below once the options objects exist.
  if (!values.verify && !process.stdin.isTTY) {
    process.stderr.write('stdin is not a terminal. Run interactively.\n');
    process.exit(1);
  }

  const initialFilePaths = Array.isArray(values.file) ? (values.file as string[]).map((p) => resolve(p.replace(/^~(?=\/|$)/, process.env.HOME ?? ''))) : [];
  const initialPrompt = typeof values.prompt === 'string' ? values.prompt : null;
  const decodedPrompt = initialPrompt != null ? decodePromptEscapes(initialPrompt) : null;
  const systemFlag = typeof values.system === 'string' ? values.system : null;
  const decodedSystem = systemFlag != null ? decodePromptEscapes(systemFlag) : null;
  const claudeMdFlag = typeof values.claudeMd === 'string' ? values.claudeMd : null;
  const decodedClaudeMd = claudeMdFlag != null ? decodePromptEscapes(claudeMdFlag) : null;
  const identityFlag = typeof values['system-identity'] === 'string' ? values['system-identity'] : null;
  const identityPath = identityFlag != null ? resolve(identityFlag.replace(/^~(?=\/|$)/, process.env.HOME ?? '')) : null;
  const noResume = values['no-resume'] === true;
  const sessionName = typeof values.name === 'string' ? values.name : null;
  const modelOverride = typeof values.model === 'string' ? values.model : null;
  const resumeId = typeof values.resume === 'string' ? values.resume : null;
  if (resumeId != null) {
    const result = z.string().uuid().safeParse(resumeId);
    if (!result.success) {
      process.stderr.write(`Invalid --resume value: expected a UUID, got "${resumeId}"\n`);
      process.exit(1);
    }
  }

  let configOverride: Record<string, unknown> | undefined;
  const configArg = typeof values.config === 'string' ? values.config : null;
  if (configArg != null) {
    try {
      configOverride = parseConfigOverride(configArg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`${message}\n`);
      process.exit(1);
    }
  }

  // Runtime values from argv ride on registered options objects (decision 8).
  const tsserverPath = resolveTsServerPath();
  const configOptions = {
    schema: sdkConfigSchema,
    // Read live so a mid-session move re-points the local override at the new
    // directory's .claude/sdk-config.json — nothing is captured at startup.
    get paths() {
      return [CONFIG_PATH, localConfigPath()];
    },
    // Hook commands may be written as `~`, `$HOME`, or config-relative paths;
    // the loader resolves them per-source so a relative path always refers to
    // the directory of the file it was authored in.
    pathFields: [['hooks', 'approvalNotify', 'command']],
    overrides: configOverride === undefined ? undefined : { origin: ':parameters:', raw: configOverride },
  } satisfies IConfigOptions;
  const runtimeOptions = { modelOverride, systemFlagText: decodedSystem, claudeMdFlagText: decodedClaudeMd, tsAvailable: tsserverPath != null } satisfies IRuntimeOptions;
  const tsServerOptions = { tsserverPath, timeoutMs: DEFAULT_TSSERVER_TIMEOUT_MS } satisfies ITsServerOptions;
  const base = { configOptions, runtimeOptions, tsServerOptions };

  if (values.verify) {
    process.exit(await runVerify({ ...base, databaseOptions: { inMemory: true } }, (line) => process.stdout.write(`${line}\n`)));
  }

  await runApp({
    ...base,
    databaseOptions: { inMemory: false },
    args: { initialFilePaths, initialPrompt, decodedPrompt, noResume, sessionName, resumeId, identityPath, configOverride },
  });
};

const runApp = async ({ configOptions, runtimeOptions, tsServerOptions, databaseOptions, args }: RunAppInput): Promise<void> => {
  const provider = buildContainer({ configOptions, runtimeOptions, tsServerOptions, databaseOptions }).buildProvider();
  try {
    await provider.resolve(IApplication).run(args);
  } catch (err) {
    // IdentityFileNotFoundError is the one case Application rethrows for main.ts, the process
    // boundary, to print and exit for itself (see SessionActivator).
    if (err instanceof IdentityFileNotFoundError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
};
