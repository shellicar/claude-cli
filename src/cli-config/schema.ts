import { z } from 'zod';
import { GIT_PROVIDER_DEFAULTS, PROVIDERS_DEFAULTS, USAGE_PROVIDER_DEFAULTS } from './consts';

const claudeModelSchema = z.enum([
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
]);

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
    providers: providersSchema.describe('System prompt provider configuration'),
  })
  .meta({ title: 'Claude CLI Configuration', description: 'Configuration for @shellicar/claude-cli' });
