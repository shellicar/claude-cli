import type { Clock } from '@js-joda/core';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { IHistoryReader } from '@shellicar/claude-core/history/interfaces';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import type { IMemoryStore } from '@shellicar/claude-core/memory/interfaces';
import type { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';
import type { AnyToolDefinition, ToolBlockLifetime } from '@shellicar/claude-sdk';
import { AppendFile } from '@shellicar/claude-sdk-tools/AppendFile';
import { type AzAccountsConfig, azExecutor, createAzTools } from '@shellicar/claude-sdk-tools/Az';
import { adoExecutor, createAdoPrTools } from '@shellicar/claude-sdk-tools/AzureDevOps';
import { CreateFile } from '@shellicar/claude-sdk-tools/CreateFile';
import { toStandalone } from '@shellicar/claude-sdk-tools/composable';
import { DeleteDirectory } from '@shellicar/claude-sdk-tools/DeleteDirectory';
import { DeleteFile } from '@shellicar/claude-sdk-tools/DeleteFile';
import { createEditFile } from '@shellicar/claude-sdk-tools/EditFile';
import { Exec } from '@shellicar/claude-sdk-tools/Exec';
import { ExecV2 } from '@shellicar/claude-sdk-tools/ExecV2';
import { type BlockedCommand, configureExecV3, type IEnvProvider } from '@shellicar/claude-sdk-tools/ExecV3';
import { Find } from '@shellicar/claude-sdk-tools/Find';
import { createGhPrTools, ghExecutor } from '@shellicar/claude-sdk-tools/GitHub';
import { Head } from '@shellicar/claude-sdk-tools/Head';
import { createHistoryTools } from '@shellicar/claude-sdk-tools/History';
import { Match } from '@shellicar/claude-sdk-tools/Match';
import { createMemoryTools } from '@shellicar/claude-sdk-tools/Memory';
import { Paths } from '@shellicar/claude-sdk-tools/Paths';
import { createPipe } from '@shellicar/claude-sdk-tools/Pipe';
import { Range } from '@shellicar/claude-sdk-tools/Range';
import { Read } from '@shellicar/claude-sdk-tools/Read';
import { createReadFileTool } from '@shellicar/claude-sdk-tools/ReadFile';
import { createRef } from '@shellicar/claude-sdk-tools/Ref';
import { RefStore } from '@shellicar/claude-sdk-tools/RefStore';
import { createSkillTool } from '@shellicar/claude-sdk-tools/Skill';
import { Tail } from '@shellicar/claude-sdk-tools/Tail';
import { createTsDefinition } from '@shellicar/claude-sdk-tools/TsDefinition';
import { createTsDiagnostics } from '@shellicar/claude-sdk-tools/TsDiagnostics';
import { createTsHover } from '@shellicar/claude-sdk-tools/TsHover';
import { createTsReferences } from '@shellicar/claude-sdk-tools/TsReferences';
import type { ITypeScriptService } from '@shellicar/claude-sdk-tools/TsService';
import type { PermissionTool } from './permissions.js';
import type { ISecrets } from './secrets/Secrets.js';

export type AppTools = {
  tools: AnyToolDefinition[];
  /** The registered tools plus the pipe-only stages, for permission resolution only. The permission
   *  system walks each pipe step by name; the stages are not registered standalone, so they are
   *  surfaced here (never sent to the wire/registry) so a pipe's stage steps resolve. */
  permissionTools: PermissionTool[];
  store: RefStore;
  refTransform: (toolName: string, output: unknown) => unknown;
};

export type CreateAppToolsOptions = {
  fs: IFileSystem;
  tsServer: ITypeScriptService & ToolBlockLifetime;
  toolsConfig: { exec: boolean; execV2: boolean; execV3: boolean; blockedCommands?: BlockedCommand[] };
  objects: IObjectStore;
  memory: IMemoryStore;
  history: IHistoryReader;
  /** The live session id, read afresh per call — SearchHistory holds it out of results unless asked to include it. */
  currentSessionId: () => string;
  /** The clock the history tools resolve `since`/`until` bounds against — carries now and the user's timezone. */
  clock: Clock;
  tsAvailable: boolean;
  logger: ILogger;
  /** Skill roots the Skill tool resolves across, already expanded to absolute paths. Absent or empty resolves nothing. */
  skillDirs?: string[];
  /** The holder's gh token and az certificates, read lazily on first escalated call — never eagerly. */
  secrets: ISecrets;
  /** Strips any ambient gh credential and injects the read-only reader token for every ExecV3 call. */
  envProvider: IEnvProvider;
  /** Named Azure accounts AzCli/EscalatedAzCli can select between — the closed enum each tool's
   *  `account` field is built from. Empty registers neither tool. */
  azAccounts: AzAccountsConfig;
};

export function createAppTools({ fs, tsServer, toolsConfig, objects, memory, history, currentSessionId, clock, tsAvailable, logger, skillDirs = [], secrets, envProvider, azAccounts }: CreateAppToolsOptions): AppTools {
  const store = new RefStore(objects);
  const ReadFile = createReadFileTool(logger);
  const EditFile = createEditFile(fs);
  const { tool: Ref, transformToolResult: refTransform } = createRef(store, 50_000);
  // Composable sources start a pipe and are also useful standalone; stages run only inside a pipe.
  const sources = [Find, Paths];
  const stages = [Read, Match, Head, Tail, Range];
  const pipe = createPipe([...sources, ...stages]);

  // ReadFile is the non-pipe single-file read (text + binary), never a pipe step.
  const tools: AnyToolDefinition[] = [pipe, ...sources.map(toStandalone)];
  tools.push(EditFile, CreateFile, AppendFile, ReadFile, DeleteFile, DeleteDirectory);
  if (toolsConfig.exec) {
    tools.push(Exec);
  }
  if (toolsConfig.execV2) {
    tools.push(ExecV2);
  }
  if (toolsConfig.execV3) {
    tools.push(configureExecV3(envProvider, toolsConfig.blockedCommands ?? []));
  }
  tools.push(Ref);
  // The TS tools depend on tsserver, which needs typescript on disk. When that
  // can't be resolved (e.g. the SEA without the launcher-provided path), the
  // tools are left out entirely rather than registered and failing on first use.
  if (tsAvailable) {
    // Each TS tool declares the shared bridge as its block lifetime; the
    // build-tools step (container) collects it, deduped, and disposes it per block.
    tools.push({ ...createTsDiagnostics(tsServer), blockLifetime: tsServer }, { ...createTsHover(tsServer), blockLifetime: tsServer }, { ...createTsReferences(tsServer), blockLifetime: tsServer }, { ...createTsDefinition(tsServer), blockLifetime: tsServer });
  }
  tools.push(...createMemoryTools(memory));
  tools.push(createSkillTool(fs, skillDirs, logger));
  tools.push(...createHistoryTools(history, currentSessionId, clock));
  tools.push(...createGhPrTools({ executor: ghExecutor, getHolderToken: () => secrets.ghHolderToken() }));

  // The AzureDevOps.PullRequest.* tools run as the same holder identity EscalatedAzCli uses — one
  // certificate, proven to authenticate to Azure DevOps directly (see AzCli's runAz), no separate
  // PAT. Only registered when exactly one account has a holder identity configured; with none or
  // more than one, there is no unambiguous holder to run as, so the tools are left unregistered
  // rather than guessing. No org config needed: each call resolves org from its own git remote or
  // the model's explicit input (see AzureDevOps/tools.ts's orgArgs).
  const adoAccounts = Object.entries(azAccounts).filter(([, a]) => a.holderClientId != null);
  if (adoAccounts.length === 1) {
    const [accountName, account] = adoAccounts[0];
    tools.push(
      ...createAdoPrTools({
        executor: adoExecutor,
        getCert: () => secrets.azCert(accountName, 'holder'),
        getClientId: () => account.holderClientId as string,
        getTenantId: () => account.tenantId,
      }),
    );
  }

  tools.push(
    ...createAzTools(
      {
        executor: azExecutor,
        getCert: (account, identity) => secrets.azCert(account, identity),
        getClientId: (account, identity) => {
          const clientId = identity === 'reader' ? azAccounts[account]?.readerClientId : azAccounts[account]?.holderClientId;
          if (clientId == null) {
            throw new Error(`az account '${account}' has no ${identity} clientId configured`);
          }
          return clientId;
        },
        getTenantId: (account) => azAccounts[account].tenantId,
      },
      azAccounts,
      clock,
      logger,
    ),
  );

  // Stages run only inside a pipe, so they are not in `tools`. The permission resolver looks every pipe
  // step up by name and reads its operation and input_schema (to locate marked paths), so it needs them
  // too — projected rather than carried whole, so no runnable (and, uninvoked, crash-prone) stage
  // handler comes along. A composable stage's path-schema is its `model` (its standalone input face).
  const permissionTools: PermissionTool[] = [...tools.map((t) => ({ name: t.name, operation: t.operation, input_schema: t.input_schema })), ...stages.map((t) => ({ name: t.name, operation: t.operation, input_schema: t.model }))];
  return { tools, permissionTools, store, refTransform };
}
