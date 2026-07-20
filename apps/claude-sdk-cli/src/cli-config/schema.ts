import { z } from 'zod';

const defaults = {
  model: 'claude-opus-4-8',
  advancedTools: {
    enabled: true,
  },
};

const historyReplaySchema = z
  .object({
    enabled: z.boolean().optional().default(true).catch(true).describe('Replay history messages into the display on startup'),
    showThinking: z.boolean().optional().default(false).catch(false).describe('Show thinking blocks when replaying history'),
  })
  .optional()
  .default({ enabled: true, showThinking: false })
  .catch({ enabled: true, showThinking: false });

const claudeMdSourcesSchema = z
  .object({
    user: z.boolean().optional().default(false).catch(false).describe('Load ~/.claude/CLAUDE.md'),
    project: z.boolean().optional().default(true).catch(true).describe('Load ./CLAUDE.md'),
    projectClaude: z.boolean().optional().default(true).catch(true).describe('Load ./.claude/CLAUDE.md'),
    local: z.boolean().optional().default(true).catch(true).describe('Load ./CLAUDE.local.md'),
  })
  .optional()
  .default({ user: false, project: true, projectClaude: true, local: true })
  .catch({ user: false, project: true, projectClaude: true, local: true });

const claudeMdSchema = z
  .object({
    enabled: z.boolean().optional().default(true).catch(true).describe('Load CLAUDE.md files as system prompts'),
    sources: claudeMdSourcesSchema.describe('Per-source CLAUDE.md loading control'),
  })
  .optional()
  .default({ enabled: true, sources: { user: false, project: true, projectClaude: true, local: true } })
  .catch({ enabled: true, sources: { user: false, project: true, projectClaude: true, local: true } });

const systemPromptSourcesSchema = z
  .object({
    user: z.boolean().optional().default(false).catch(false).describe('Load ~/.claude/SYSTEM.md'),
    project: z.boolean().optional().default(true).catch(true).describe('Load ./SYSTEM.md'),
    projectClaude: z.boolean().optional().default(true).catch(true).describe('Load ./.claude/SYSTEM.md'),
    local: z.boolean().optional().default(true).catch(true).describe('Load ./SYSTEM.local.md'),
  })
  .optional()
  .default({ user: false, project: true, projectClaude: true, local: true })
  .catch({ user: false, project: true, projectClaude: true, local: true });

const systemPromptSchema = z
  .object({
    enabled: z.boolean().optional().default(true).catch(true).describe('Load SYSTEM.md files as the system prompt'),
    sources: systemPromptSourcesSchema.describe('Per-source SYSTEM.md loading control'),
    text: z.string().nullable().optional().default(null).catch(null).describe('Inline system prompt contributed by config, appended after SYSTEM.md files'),
  })
  .optional()
  .default({ enabled: true, sources: { user: false, project: true, projectClaude: true, local: true }, text: null })
  .catch({ enabled: true, sources: { user: false, project: true, projectClaude: true, local: true }, text: null });

const compactSchema = z
  .object({
    enabled: z.boolean().optional().default(false).catch(false).describe('Enable conversation compaction'),
    inputTokens: z.number().int().positive().optional().default(160_000).catch(160_000).describe('Token threshold at which compaction triggers'),
    pauseAfterCompaction: z.boolean().optional().default(true).catch(true).describe('Whether to pause after a compaction occurs'),
    customInstructions: z.string().nullable().default(null).catch(null).describe('Custom instructions to guide the compaction summary'),
  })
  .optional()
  .default({ enabled: false, inputTokens: 160_000, pauseAfterCompaction: true, customInstructions: null })
  .catch({ enabled: false, inputTokens: 160_000, pauseAfterCompaction: true, customInstructions: null });

const advancedToolsSchema = z
  .object({
    enabled: z.boolean().optional().default(defaults.advancedTools.enabled).catch(defaults.advancedTools.enabled).describe('Enable advanced tool use'),
    searchTool: z.enum(['regex', 'bm25']).nullable().optional().default(null).catch(null).describe('Search tool to prepend for deferred tool loading; omit when only using allowProgrammaticExecution or input_examples'),
    allowProgrammaticExecution: z.array(z.string()).optional().default([]).catch([]).describe('Tool names that can be called programmatically by code execution tools'),
    codeExecutionTool: z.enum(['code_execution_20250825', 'code_execution_20260120']).optional().default('code_execution_20260120').catch('code_execution_20260120').describe('Code execution tool version allowed to call tools in allowProgrammaticExecution'),
  })
  .optional()
  .default({ enabled: defaults.advancedTools.enabled, searchTool: null, allowProgrammaticExecution: [], codeExecutionTool: 'code_execution_20260120' })
  .catch({ enabled: defaults.advancedTools.enabled, searchTool: null, allowProgrammaticExecution: [], codeExecutionTool: 'code_execution_20260120' });

const allowedCallersSchema = z
  .array(z.enum(['direct', 'code_execution']))
  .optional()
  .default(['direct'])
  .catch(['direct'])
  .describe('Who can invoke this tool. Set to ["direct"] for ZDR eligibility');

const webSearchSchema = z
  .object({
    enabled: z.boolean().optional().default(true).catch(true).describe('Enable web search'),
    version: z.enum(['web_search_20250305', 'web_search_20260209']).optional().default('web_search_20260209').catch('web_search_20260209').describe('API version. 20260209 adds dynamic filtering (not ZDR without allowedCallers: ["direct"])'),
    allowedCallers: allowedCallersSchema,
  })
  .optional()
  .default({ enabled: true, version: 'web_search_20260209', allowedCallers: ['direct'] })
  .catch({ enabled: true, version: 'web_search_20260209', allowedCallers: ['direct'] });

const webFetchSchema = z
  .object({
    enabled: z.boolean().optional().default(true).catch(true).describe('Enable web fetch'),
    version: z.enum(['web_fetch_20250910', 'web_fetch_20260209']).optional().default('web_fetch_20260209').catch('web_fetch_20260209').describe('API version. 20260209 adds dynamic filtering (not ZDR without allowedCallers: ["direct"])'),
    allowedCallers: allowedCallersSchema,
  })
  .optional()
  .default({ enabled: true, version: 'web_fetch_20260209', allowedCallers: ['direct'] })
  .catch({ enabled: true, version: 'web_fetch_20260209', allowedCallers: ['direct'] });

const serverToolsSchema = z
  .object({
    webSearch: webSearchSchema.describe('Web search configuration'),
    webFetch: webFetchSchema.describe('Web fetch configuration'),
  })
  .optional()
  .default({
    webSearch: { enabled: true, version: 'web_search_20260209', allowedCallers: ['direct'] },
    webFetch: { enabled: true, version: 'web_fetch_20260209', allowedCallers: ['direct'] },
  })
  .catch({
    webSearch: { enabled: true, version: 'web_search_20260209', allowedCallers: ['direct'] },
    webFetch: { enabled: true, version: 'web_fetch_20260209', allowedCallers: ['direct'] },
  })
  .describe('Server-side tool configuration');

const statusBarSchema = z
  .object({
    showConversationId: z.boolean().optional().default(true).catch(true).describe('Show the conversation id on the status bar (top line)'),
  })
  .optional()
  .default({ showConversationId: true })
  .catch({ showConversationId: true });

const hooksSchema = z
  .object({
    approvalNotify: z
      .object({
        command: z.string().describe('Command to run when approval is pending'),
        delayMs: z.number().int().nonnegative().optional().default(0).catch(0).describe('Milliseconds to wait before running the command. 0 means immediate'),
      })
      .nullable()
      .optional()
      .default(null)
      .catch(null),
  })
  .optional()
  .default({ approvalNotify: null })
  .catch({ approvalNotify: null });

const blockedCommandSchema = z.object({
  program: z.string().describe('Program name to match exactly'),
  args: z.array(z.string()).optional().default([]).catch([]).describe('Args that must all appear, in order (an ordered subsequence), for the block to apply. Empty matches on program alone.'),
});

const toolsSchema = z
  .object({
    exec: z.boolean().optional().default(false).catch(false).describe('Enable the original Exec tool (steps + chaining schema)'),
    execV2: z.boolean().optional().default(false).catch(false).describe('Enable the ExecV2 tool (recursive AST schema)'),
    execV3: z.boolean().optional().default(true).catch(true).describe('Enable the ExecV3 tool (flat commands + forward op)'),
    blockedCommands: z.array(blockedCommandSchema).optional().default([]).catch([]).describe('Extra command patterns ExecV3 refuses to start. Program must match and every arg must appear in order.'),
  })
  .optional()
  .default({ exec: false, execV2: false, execV3: true, blockedCommands: [] })
  .catch({ exec: false, execV2: false, execV3: true, blockedCommands: [] })
  .describe('Which execution tools to register. Both can be on for comparison; normally one. Takes effect at startup — switching requires a restart.');

const thinkingSchema = z
  .object({
    enabled: z.boolean().optional().default(true).catch(true).describe('Enable extended thinking'),
    effort: z.enum(['max', 'xhigh', 'high', 'medium', 'low']).optional().default('high').catch('high').describe('Token effort level applied to all spending (thinking, text, tool calls)'),
  })
  .optional()
  .default({ enabled: true, effort: 'high' })
  .catch({ enabled: true, effort: 'high' });

const markdownSchema = z
  .object({
    enabled: z.boolean().optional().default(true).catch(true).describe('Render assistant responses as styled markdown'),
    streaming: z.boolean().optional().default(true).catch(true).describe('Render markdown live while the response streams (ignored when enabled is off)'),
  })
  .optional()
  .default({ enabled: true, streaming: true })
  .catch({ enabled: true, streaming: true });

export const permissionActionSchema = z.enum(['approve', 'ask', 'deny']);

const defaultZonePermissionsSchema = z
  .object({
    read: permissionActionSchema.optional().default('approve').catch('approve').describe('Action for read operations'),
    write: permissionActionSchema.optional().default('approve').catch('approve').describe('Action for write operations'),
    delete: permissionActionSchema.optional().default('ask').catch('ask').describe('Action for delete operations'),
  })
  .optional()
  .default({ read: 'approve', write: 'approve', delete: 'ask' })
  .catch({ read: 'approve', write: 'approve', delete: 'ask' });

const outsideZonePermissionsSchema = z
  .object({
    read: permissionActionSchema.optional().default('approve').catch('approve').describe('Action for read operations'),
    write: permissionActionSchema.optional().default('ask').catch('ask').describe('Action for write operations'),
    delete: permissionActionSchema.optional().default('deny').catch('deny').describe('Action for delete operations'),
  })
  .optional()
  .default({ read: 'approve', write: 'ask', delete: 'deny' })
  .catch({ read: 'approve', write: 'ask', delete: 'deny' });

const permissionsSchema = z
  .object({
    default: defaultZonePermissionsSchema.describe('Permissions for paths inside the working directory'),
    outside: outsideZonePermissionsSchema.describe('Permissions for paths outside the working directory'),
  })
  .optional()
  .default({
    default: { read: 'approve', write: 'approve', delete: 'ask' },
    outside: { read: 'approve', write: 'ask', delete: 'deny' },
  })
  .catch({
    default: { read: 'approve', write: 'approve', delete: 'ask' },
    outside: { read: 'approve', write: 'ask', delete: 'deny' },
  });

const persistenceSchema = z
  .object({
    database: z.string().optional().default('persistence.db').catch('persistence.db').describe('SQLite database filename, stored under ~/.claude, for Ref persistence across restarts'),
  })
  .optional()
  .default({ database: 'persistence.db' })
  .catch({ database: 'persistence.db' });

const memorySchema = z
  .object({
    tenantId: z.string().nullable().optional().default(null).catch(null).describe('Optional separation lever: selects a distinct memory.<tenantId>.db file for physical isolation. Not a search filter.'),
    environment: z.record(z.string(), z.string()).optional().default({}).catch({}).describe('Static key:value pairs stamped onto every memory written from this machine.'),
    git: z
      .object({ enabled: z.boolean().optional().default(true).catch(true).describe('Derive org/repo/project keys from the git remote.') })
      .optional()
      .default({ enabled: true })
      .catch({ enabled: true }),
  })
  .optional()
  .default({ tenantId: null, environment: {}, git: { enabled: true } })
  .catch({ tenantId: null, environment: {}, git: { enabled: true } });

const preventSleepPlatformsSchema = z
  .object({
    macos: z.string().nullable().optional().default('caffeinate').catch('caffeinate').describe('macOS wake-lock command, spawned with -i to inhibit idle sleep. null disables on macOS'),
    windows: z.string().nullable().optional().default(null).catch(null).describe('Windows wake-lock command. Not yet wired; null disables'),
    linux: z.string().nullable().optional().default(null).catch(null).describe('Linux wake-lock command. Not yet wired; null disables'),
  })
  .optional()
  .default({ macos: 'caffeinate', windows: null, linux: null })
  .catch({ macos: 'caffeinate', windows: null, linux: null });

const preventSleepSchema = z
  .object({
    enabled: z.boolean().optional().default(true).catch(true).describe('Hold the machine awake during in-flight network requests (opt-out)'),
    platforms: preventSleepPlatformsSchema.describe('Per-platform wake-lock command. Only macOS is wired; windows/linux are null placeholders'),
  })
  .optional()
  .default({ enabled: true, platforms: { macos: 'caffeinate', windows: null, linux: null } })
  .catch({ enabled: true, platforms: { macos: 'caffeinate', windows: null, linux: null } });

const secretsSchema = z
  .object({
    stripGhCredentials: z
      .boolean()
      .optional()
      .default(true)
      .catch(true)
      .describe(
        "Strip GH_TOKEN, GITHUB_TOKEN, and SSH_AUTH_SOCK from every exec call's environment before it runs, so a model-driven command can never inherit your ambient gh/ssh credentials. Opt-out: disable if you rely on your own GH_TOKEN reaching exec commands unmodified. Independent of ghScoping — turning ghScoping off does not restore ambient credentials on its own.",
      ),
    ghScoping: z
      .boolean()
      .optional()
      .default(false)
      .catch(false)
      .describe(
        'Scope every exec call with an unprivileged gh reader token from Keychain, replacing whatever stripGhCredentials removed. Opt-in: requires macOS arm64 (keychain-native) AND a Keychain reader item created out of band by the operator, so it only works after deliberate setup, not out of the box. When disabled, unsupported on this platform, or not yet set up, no replacement token is injected — a gh command then fails on missing auth (if stripGhCredentials is on) or runs with whatever ambient credential is present (if it is off).',
      ),
  })
  .optional()
  .default({ stripGhCredentials: true, ghScoping: false })
  .catch({ stripGhCredentials: true, ghScoping: false });

const azAccountSchema = z.object({
  tenantId: z.string().describe("Entra tenant ID this account's service principals belong to"),
  readerClientId: z.string().nullable().optional().default(null).catch(null).describe('Application (client) ID of the unprivileged reader service principal for this account. null omits this account from AzCli entirely.'),
  holderClientId: z.string().nullable().optional().default(null).catch(null).describe('Application (client) ID of the privileged holder service principal for this account. null omits this account from EscalatedAzCli entirely.'),
});

const azSchema = z
  .object({
    accounts: z
      .record(z.string(), azAccountSchema)
      .optional()
      .default({})
      .catch({})
      .describe(
        'Named Azure accounts AzCli/EscalatedAzCli can select between via their `account` field, which the tools expose as a closed enum built from these keys — the model can only ever request an account configured here. Certificates are read fresh from Keychain per call as az-<name>-reader-cert / az-<name>-holder-cert (see .claude/scripts/az-sp-create.sh). Empty (the default) registers neither tool.',
      ),
  })
  .optional()
  .default({ accounts: {} })
  .catch({ accounts: {} });

const natsSchema = z
  .object({
    enabled: z.boolean().optional().default(false).catch(false).describe('Participate on NATS: serve say/cancel, raise/answer approvals, and speak the agent concern (ready/pulse/attached/service/drain/chdir). Disabled (default) has zero effect'),
    url: z.string().optional().default('nats://localhost:4222').catch('nats://localhost:4222').describe('NATS broker URL'),
    world: z.string().optional().default('default').catch('default').describe('The agent concern world id — a deployer-chosen, durable name for the place this CLI serves conversations from (a machine, a container). Not centrally registered'),
    pulseIntervalS: z.number().int().positive().optional().default(30).catch(30).describe('Seconds between agent liveness pulses — the promise carried on each pulse'),
  })
  .optional()
  .default({ enabled: false, url: 'nats://localhost:4222', world: 'default', pulseIntervalS: 30 })
  .catch({ enabled: false, url: 'nats://localhost:4222', world: 'default', pulseIntervalS: 30 });

export const sdkConfigSchema = z
  .object({
    $schema: z.string().optional().describe('JSON Schema reference for editor autocomplete'),
    model: z.string().optional().default(defaults.model).catch(defaults.model).describe('Claude model to use'),
    maxTokens: z.number().int().positive().optional().default(32_000).catch(32_000).describe('Maximum tokens per response'),
    thinking: thinkingSchema.describe('Extended thinking configuration'),
    historyReplay: historyReplaySchema.describe('History replay configuration'),
    claudeMd: claudeMdSchema.describe('CLAUDE.md loading configuration'),
    systemPrompt: systemPromptSchema.describe('System prompt (SYSTEM.md + inline) configuration'),
    skillDirs: z
      .array(z.string())
      .optional()
      .default([])
      .catch([])
      .describe('Ordered skill root directories the Skill tool resolves across. Replacement-only: this array is the whole set for a session, never merged with a built-in default. Later directories override earlier ones on a name collision. Empty (the default) resolves nothing.'),
    compact: compactSchema.describe('Compaction configuration'),
    advancedTools: advancedToolsSchema.describe('Advanced tool use configuration'),
    serverTools: serverToolsSchema,
    hooks: hooksSchema.describe('Hook configuration'),
    tools: toolsSchema.describe('Execution tool selection'),
    disabledTools: z.array(z.string()).optional().default([]).catch([]).describe('Names of loaded tools to hide from the model and refuse as unavailable. Read live: takes effect on the next turn without a restart.'),
    statusBar: statusBarSchema.describe('Status bar configuration'),
    permissions: permissionsSchema.describe('Tool approval permission matrix'),
    preventSleep: preventSleepSchema.describe('Sleep prevention during in-flight network requests'),
    persistence: persistenceSchema.describe('Persistence (SQLite) configuration'),
    markdown: markdownSchema.describe('Markdown rendering configuration'),
    memory: memorySchema.describe('Persistent memory configuration'),
    nats: natsSchema.describe('NATS conversation + approval participant configuration'),
    secrets: secretsSchema.describe('Credential-scoping configuration'),
    az: azSchema.describe('Named Azure accounts for AzCli/EscalatedAzCli'),
  })
  .meta({ title: 'Claude SDK CLI Configuration', description: 'Configuration for @shellicar/claude-sdk-cli' });
