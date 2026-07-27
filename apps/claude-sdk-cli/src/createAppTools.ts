import type { Clock } from '@js-joda/core';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { IHistoryReader } from '@shellicar/claude-core/history/interfaces';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import type { IMemoryStore } from '@shellicar/claude-core/memory/interfaces';
import type { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';
import type { AnyToolDefinition, ToolBlockLifetime } from '@shellicar/claude-sdk';
import { AppendFile } from '@shellicar/claude-sdk-tools/AppendFile';
import { type AzAccountsConfig, type AzDeps, AzSessionCache, azExecutor, createAzTools } from '@shellicar/claude-sdk-tools/Az';
import { createAdoPrTools } from '@shellicar/claude-sdk-tools/AzureDevOps';
import { CreateFile } from '@shellicar/claude-sdk-tools/CreateFile';
import { DeleteDirectory } from '@shellicar/claude-sdk-tools/DeleteDirectory';
import { DeleteFile } from '@shellicar/claude-sdk-tools/DeleteFile';
import { createEditFile } from '@shellicar/claude-sdk-tools/EditFile';
import { Exec } from '@shellicar/claude-sdk-tools/Exec';
import { ExecV2 } from '@shellicar/claude-sdk-tools/ExecV2';
import { configureExecV3, type IEnvProvider, type IRulesConfigProvider } from '@shellicar/claude-sdk-tools/ExecV3';
import { createGhPrTools, ghExecutor } from '@shellicar/claude-sdk-tools/GitHub';
import { createHistoryTools } from '@shellicar/claude-sdk-tools/History';
import { createMemoryTools } from '@shellicar/claude-sdk-tools/Memory';
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
  toolsConfig: { exec: boolean; execV2: boolean; execV3: boolean };
  /** Live source for ExecV3's safety rules/blocklist — injected as an interface, read fresh on
   *  every call, so a config reload takes effect on the next call with no tool rebuild. */
  rulesProvider: IRulesConfigProvider;
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
  /** Live source for the named Azure accounts AzCli/EscalatedAzCli/AzureDevOps.PullRequest.* select
   *  between — read fresh on every call (never captured once), so a config reload that adds,
   *  removes, or reconfigures an account takes effect on the very next call, with no tool rebuild. */
  getAzAccounts: () => AzAccountsConfig;
};

export function createAppTools({ fs, tsServer, toolsConfig, rulesProvider, objects, memory, history, currentSessionId, clock, tsAvailable, logger, skillDirs = [], secrets, envProvider, getAzAccounts }: CreateAppToolsOptions): AppTools {
  const store = new RefStore(objects);
  const EditFile = createEditFile(fs);
  const { tool: Ref, transformToolResult: refTransform } = createRef(store, 50_000);

  // ReadFile (V1) is retired: Orchestrate's Tools V2 Read (text) and ReadBinaryFile (PDF/image,
  // excluded from stages) between them cover everything it did.
  const tools: AnyToolDefinition[] = [EditFile, CreateFile, AppendFile, DeleteFile, DeleteDirectory];
  if (toolsConfig.exec) {
    tools.push(Exec);
  }
  if (toolsConfig.execV2) {
    tools.push(ExecV2);
  }
  if (toolsConfig.execV3) {
    tools.push(configureExecV3(envProvider, rulesProvider));
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
  // certificate, proven to authenticate to Azure DevOps directly, no separate PAT. Always
  // registered: which account (if any) currently has a holder identity configured is live config,
  // resolved fresh per call (see resolveAzAccount) and re-checked by the disabled-tools provider
  // each turn — never decided once here at startup. No org config needed: each call resolves org
  // from its own git remote or the model's explicit input (see AzureDevOps/tools.ts's orgArgs).
  //
  // One AzDeps object and one AzSessionCache, shared verbatim between AzCli/EscalatedAzCli and the
  // AzureDevOps.PullRequest.* tools — they are the same credential mechanism (a holder certificate
  // logged into az), so a PR call against an account whose EscalatedAzCli session is already warm
  // reuses that session instead of paying its own fresh `az login`. adoExecutor and azExecutor are
  // the same process-wide singleton (see exec-shared.ts), so there is nothing to reuse there beyond
  // this one import.
  const azDeps: AzDeps = {
    executor: azExecutor,
    getCert: (account, identity) => secrets.azCert(account, identity),
    getIdentity: (account, identity) => {
      const config = identity === 'reader' ? getAzAccounts()[account]?.reader : getAzAccounts()[account]?.holder;
      if (config == null) {
        throw new Error(`az account '${account}' has no ${identity} identity configured`);
      }
      return config;
    },
    getTenantId: (account) => getAzAccounts()[account].tenantId,
  };
  // A real process-lifetime singleton, not just per-call: createAppTools is only ever invoked once
  // (see AppToolsService's factory registration in container.ts — core-di-lite memoizes by the
  // registration itself), so this is constructed exactly once for the process's lifetime.
  const azSessionCache = new AzSessionCache(clock, logger);

  tools.push(...createAdoPrTools(azDeps, getAzAccounts, azSessionCache));
  tools.push(...createAzTools(azDeps, getAzAccounts, azSessionCache));

  const permissionTools: PermissionTool[] = tools.map((t) => ({ name: t.name, operation: t.operation, input_schema: t.input_schema }));
  return { tools, permissionTools, store, refTransform };
}
