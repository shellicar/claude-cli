import { z } from 'zod';
import { GIT_PROVIDER_DEFAULTS, PROVIDERS_DEFAULTS, USAGE_PROVIDER_DEFAULTS } from './consts';

export const thinkingEffortSchema = z.enum(['max', 'high', 'medium', 'low']);

const BASE_MODELS = [
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-opus-4-5-20251101',
  'claude-opus-4-5',
  'claude-3-7-sonnet-latest',
  'claude-3-7-sonnet-20250219',
  'claude-3-5-haiku-latest',
  'claude-3-5-haiku-20241022',
  'claude-haiku-4-5',
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-20250514',
  'claude-sonnet-4-0',
  'claude-4-sonnet-20250514',
  'claude-sonnet-4-5',
  'claude-sonnet-4-5-20250929',
  'claude-opus-4-0',
  'claude-opus-4-20250514',
  'claude-4-opus-20250514',
  'claude-opus-4-1-20250805',
  'claude-3-opus-latest',
  'claude-3-opus-20240229',
  'claude-3-haiku-20240307',
] as const satisfies readonly string[];

export type BaseModel = (typeof BASE_MODELS)[number];
export type ExtendedModel = `${BaseModel}[1m]`;
export type ClaudeModel = BaseModel | ExtendedModel;

const claudeModelSchema = z.enum([...BASE_MODELS, ...BASE_MODELS.map((m) => `${m}[1m]` as ExtendedModel)] as [BaseModel | ExtendedModel, ...(BaseModel | ExtendedModel)[]]);

const gitProviderSchema = z
  .object({
    enabled: z.boolean().optional().default(true).catch(true).describe('Enable the git provider'),
    branch: z.boolean().optional().default(true).catch(true).describe('Show current branch name'),
    status: z.boolean().optional().default(true).catch(true).describe('Show working tree status (dirty/clean)'),
    sha: z.boolean().optional().default(true).catch(true).describe('Show short commit SHA with -dirty suffix'),
  })
  .optional()
  .default(GIT_PROVIDER_DEFAULTS)
  .catch(GIT_PROVIDER_DEFAULTS);
const usageProviderSchema = z
  .object({
    enabled: z.boolean().optional().default(true).catch(true).describe('Enable the usage provider'),
    time: z.boolean().optional().default(true).catch(true).describe('Show current time and seconds since last response'),
    context: z.boolean().optional().default(true).catch(true).describe('Show context usage percentage'),
    cost: z.boolean().optional().default(true).catch(true).describe('Show session cost'),
  })
  .optional()
  .default(USAGE_PROVIDER_DEFAULTS)
  .catch(USAGE_PROVIDER_DEFAULTS);
const providersSchema = z
  .object({
    git: gitProviderSchema.describe('Git provider configuration'),
    usage: usageProviderSchema.describe('Usage provider configuration'),
  })
  .optional()
  .default(PROVIDERS_DEFAULTS)
  .catch(PROVIDERS_DEFAULTS);

const approveRuleSchema = z.object({
  program: z.string().min(1).describe('Program name to match by basename (e.g. "git").'),
  args: z.array(z.string().min(1)).min(1).optional().describe('Arguments that must ALL be present in the command (AND logic). Each entry is checked individually.'),
});

const presetsSchema = z.enum(['defaults']);

const execPermissionsSchema = z
  .object({
    presets: z.array(presetsSchema).optional().default(['defaults']).catch(['defaults']).describe('Named permission sets. "defaults" includes built-in patterns for skill scripts.'),
    approve: z.array(approveRuleSchema).optional().default([]).catch([]).describe('Commands to auto-approve. Each rule specifies a program and args to match.'),
  })
  .optional()
  .describe('Structured exec permission config. Takes precedence over execAutoApprove when present.');

export const cliConfigSchema = z
  .object({
    $schema: z.string().optional().describe('JSON Schema reference for editor autocomplete'),
    model: claudeModelSchema.optional().default('claude-opus-4-6').catch('claude-opus-4-6').describe('Claude model to use for queries'),
    compactModel: claudeModelSchema.optional().default('claude-haiku-4-5-20251001').catch('claude-haiku-4-5-20251001').describe('Claude model to use for conversation compaction'),
    maxTurns: z.int().min(1).optional().default(100).catch(100).describe('Maximum number of agentic turns per query'),
    permissionTimeoutMs: z.int().min(1000).optional().default(30000).catch(30000).describe('Timeout in milliseconds for standard tool permission prompts'),
    extendedPermissionTimeoutMs: z.int().min(1000).nullable().optional().default(120000).catch(120000).describe('Timeout in milliseconds for extended permission prompts (e.g. EnterPlanMode, ExitPlanMode). Set to null to disable timeout.'),
    questionTimeoutMs: z.int().min(1000).nullable().optional().default(60000).catch(60000).describe('Timeout in milliseconds for user question prompts. Set to null to disable timeout.'),
    drowningThreshold: z.int().min(0).nullable().optional().default(15).catch(15).describe('Seconds remaining on permission timer before the drowning alert (flashing + beep). Set to null to disable.'),
    autoApproveEdits: z.boolean().optional().default(true).catch(true).describe('Auto-approve Edit and Write tools for files inside the working directory'),
    autoApproveReads: z.boolean().optional().default(true).catch(true).describe('Auto-approve read-only tools (Read, Glob, Grep, LS, Skill) without prompting'),
    expandTilde: z.boolean().optional().default(true).catch(true).describe('Expand ~ to home directory in /add-dir paths'),
    thinking: z.boolean().optional().default(true).catch(true).describe('Enable adaptive thinking (Claude determines when and how much to think based on query complexity)'),
    thinkingEffort: thinkingEffortSchema.optional().default('high').catch('high').describe('Effort level for adaptive thinking. max=always thinks deeply (Opus 4.6 only), high=always thinks, medium=moderate thinking, low=minimise thinking'),
    shellicarMcp: z.boolean().optional().default(true).catch(true).describe('Replace the Bash tool with Exec (structured command execution via MCP). Commands are decomposed into program + args arrays instead of freeform shell strings.'),
    execAutoApprove: z.array(z.string()).optional().default([]).catch([]).describe('@deprecated Use execPermissions instead. Glob patterns for auto-approving Exec commands. Programs are resolved to absolute paths before matching. Supports $HOME expansion.'),
    execPermissions: execPermissionsSchema,
    providers: providersSchema.describe('System prompt provider configuration'),
  })
  .meta({ title: 'Claude CLI Configuration', description: 'Configuration for @shellicar/claude-cli' });
