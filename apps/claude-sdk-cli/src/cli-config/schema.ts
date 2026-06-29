import { z } from 'zod';

const DEFAULT_MODEL = 'claude-opus-4-8';

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
    user: z.boolean().optional().default(true).catch(true).describe('Load ~/.claude/CLAUDE.md'),
    project: z.boolean().optional().default(true).catch(true).describe('Load ./CLAUDE.md'),
    projectClaude: z.boolean().optional().default(true).catch(true).describe('Load ./.claude/CLAUDE.md'),
    local: z.boolean().optional().default(true).catch(true).describe('Load ./CLAUDE.local.md'),
  })
  .optional()
  .default({ user: true, project: true, projectClaude: true, local: true })
  .catch({ user: true, project: true, projectClaude: true, local: true });

const claudeMdSchema = z
  .object({
    enabled: z.boolean().optional().default(true).catch(true).describe('Load CLAUDE.md files as system prompts'),
    sources: claudeMdSourcesSchema.describe('Per-source CLAUDE.md loading control'),
  })
  .optional()
  .default({ enabled: true, sources: { user: true, project: true, projectClaude: true, local: true } })
  .catch({ enabled: true, sources: { user: true, project: true, projectClaude: true, local: true } });

const systemPromptSourcesSchema = z
  .object({
    user: z.boolean().optional().default(true).catch(true).describe('Load ~/.claude/SYSTEM.md'),
    project: z.boolean().optional().default(true).catch(true).describe('Load ./SYSTEM.md'),
    projectClaude: z.boolean().optional().default(true).catch(true).describe('Load ./.claude/SYSTEM.md'),
    local: z.boolean().optional().default(true).catch(true).describe('Load ./SYSTEM.local.md'),
  })
  .optional()
  .default({ user: true, project: true, projectClaude: true, local: true })
  .catch({ user: true, project: true, projectClaude: true, local: true });

const systemPromptSchema = z
  .object({
    enabled: z.boolean().optional().default(true).catch(true).describe('Load SYSTEM.md files as the system prompt'),
    sources: systemPromptSourcesSchema.describe('Per-source SYSTEM.md loading control'),
    text: z.string().nullable().optional().default(null).catch(null).describe('Inline system prompt contributed by config, appended after SYSTEM.md files'),
  })
  .optional()
  .default({ enabled: true, sources: { user: true, project: true, projectClaude: true, local: true }, text: null })
  .catch({ enabled: true, sources: { user: true, project: true, projectClaude: true, local: true }, text: null });

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
    enabled: z.boolean().optional().default(false).catch(false).describe('Enable advanced tool use'),
    searchTool: z.enum(['regex', 'bm25']).nullable().optional().default(null).catch(null).describe('Search tool to prepend for deferred tool loading; omit when only using allowProgrammaticExecution or input_examples'),
    allowProgrammaticExecution: z.array(z.string()).optional().default([]).catch([]).describe('Tool names that can be called programmatically by code execution tools'),
    codeExecutionTool: z.enum(['code_execution_20250825', 'code_execution_20260120']).optional().default('code_execution_20260120').catch('code_execution_20260120').describe('Code execution tool version allowed to call tools in allowProgrammaticExecution'),
  })
  .optional()
  .default({ enabled: false, searchTool: null, allowProgrammaticExecution: [], codeExecutionTool: 'code_execution_20260120' })
  .catch({ enabled: false, searchTool: null, allowProgrammaticExecution: [], codeExecutionTool: 'code_execution_20260120' });

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

const toolsSchema = z
  .object({
    exec: z.boolean().optional().default(false).catch(false).describe('Enable the original Exec tool (steps + chaining schema)'),
    execV2: z.boolean().optional().default(true).catch(true).describe('Enable the ExecV2 tool (recursive AST schema)'),
  })
  .optional()
  .default({ exec: false, execV2: true })
  .catch({ exec: false, execV2: true })
  .describe('Which execution tools to register. Both can be on for comparison; normally one. Takes effect at startup — switching requires a restart.');

const thinkingSchema = z
  .object({
    enabled: z.boolean().optional().default(true).catch(true).describe('Enable extended thinking'),
    effort: z.enum(['max', 'xhigh', 'high', 'medium', 'low']).optional().default('high').catch('high').describe('Token effort level applied to all spending (thinking, text, tool calls)'),
  })
  .optional()
  .default({ enabled: true, effort: 'high' })
  .catch({ enabled: true, effort: 'high' });

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
    database: z.string().optional().default('persistence.db').catch('persistence.db').describe('SQLite database filename, stored under ~/.claude, for Ref/PreviewEdit persistence across restarts'),
  })
  .optional()
  .default({ database: 'persistence.db' })
  .catch({ database: 'persistence.db' });

export const sdkConfigSchema = z
  .object({
    $schema: z.string().optional().describe('JSON Schema reference for editor autocomplete'),
    model: z.string().optional().default(DEFAULT_MODEL).catch(DEFAULT_MODEL).describe('Claude model to use'),
    maxTokens: z.number().int().positive().optional().default(32_000).catch(32_000).describe('Maximum tokens per response'),
    thinking: thinkingSchema.describe('Extended thinking configuration'),
    historyReplay: historyReplaySchema.describe('History replay configuration'),
    claudeMd: claudeMdSchema.describe('CLAUDE.md loading configuration'),
    systemPrompt: systemPromptSchema.describe('System prompt (SYSTEM.md + inline) configuration'),
    compact: compactSchema.describe('Compaction configuration'),
    advancedTools: advancedToolsSchema.describe('Advanced tool use configuration'),
    serverTools: serverToolsSchema,
    hooks: hooksSchema.describe('Hook configuration'),
    tools: toolsSchema.describe('Execution tool selection'),
    statusBar: statusBarSchema.describe('Status bar configuration'),
    permissions: permissionsSchema.describe('Tool approval permission matrix'),
    persistence: persistenceSchema.describe('Persistence (SQLite) configuration'),
  })
  .meta({ title: 'Claude SDK CLI Configuration', description: 'Configuration for @shellicar/claude-sdk-cli' });
