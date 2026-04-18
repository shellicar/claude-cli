import { z } from 'zod';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

const historyReplaySchema = z
  .object({
    enabled: z.boolean().optional().default(true).catch(true).describe('Replay history messages into the display on startup'),
    showThinking: z.boolean().optional().default(false).catch(false).describe('Show thinking blocks when replaying history'),
  })
  .optional()
  .default({ enabled: true, showThinking: false })
  .catch({ enabled: true, showThinking: false });

const claudeMdSchema = z
  .object({
    enabled: z.boolean().optional().default(true).catch(true).describe('Load CLAUDE.md files as system prompts'),
  })
  .optional()
  .default({ enabled: true })
  .catch({ enabled: true });

const compactSchema = z
  .object({
    enabled: z.boolean().optional().default(true).catch(true).describe('Enable conversation compaction'),
    inputTokens: z.number().int().positive().optional().default(160_000).catch(160_000).describe('Token threshold at which compaction triggers'),
    pauseAfterCompaction: z.boolean().optional().default(true).catch(true).describe('Whether to pause after a compaction occurs'),
    customInstructions: z.string().nullable().default(null).catch(null).describe('Custom instructions to guide the compaction summary'),
  })
  .optional()
  .default({ enabled: true, inputTokens: 160_000, pauseAfterCompaction: true, customInstructions: null })
  .catch({ enabled: true, inputTokens: 160_000, pauseAfterCompaction: true, customInstructions: null });

const advancedToolsSchema = z
  .object({
    enabled: z.boolean().optional().default(false).catch(false).describe('Enable advanced tool use'),
    searchTool: z.enum(['regex', 'bm25']).nullable().optional().default(null).catch(null).describe('Search tool to prepend for deferred tool loading; omit when only using allowProgramaticExecution or input_examples'),
    allowProgramaticExecution: z.array(z.string()).optional().default([]).catch([]).describe('Tool names that can be called programmatically by code execution tools'),
    codeExecutionTool: z.enum(['code_execution_20250825', 'code_execution_20260120']).optional().default('code_execution_20260120').catch('code_execution_20260120').describe('Code execution tool version allowed to call tools in allowProgramaticExecution'),
  })
  .optional()
  .default({ enabled: false, searchTool: null, allowProgramaticExecution: [], codeExecutionTool: 'code_execution_20260120' })
  .catch({ enabled: false, searchTool: null, allowProgramaticExecution: [], codeExecutionTool: 'code_execution_20260120' });

export const sdkConfigSchema = z
  .object({
    $schema: z.string().optional().describe('JSON Schema reference for editor autocomplete'),
    model: z.string().optional().default(DEFAULT_MODEL).catch(DEFAULT_MODEL).describe('Claude model to use'),
    historyReplay: historyReplaySchema.describe('History replay configuration'),
    claudeMd: claudeMdSchema.describe('CLAUDE.md loading configuration'),
    compact: compactSchema.describe('Compaction configuration'),
    advancedTools: advancedToolsSchema.describe('Advanced tool use configuration'),
  })
  .meta({ title: 'Claude SDK CLI Configuration', description: 'Configuration for @shellicar/claude-sdk-cli' });
