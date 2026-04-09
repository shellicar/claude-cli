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

export const sdkConfigSchema = z
  .object({
    $schema: z.string().optional().describe('JSON Schema reference for editor autocomplete'),
    model: z.string().optional().default(DEFAULT_MODEL).catch(DEFAULT_MODEL).describe('Claude model to use'),
    historyReplay: historyReplaySchema.describe('History replay configuration'),
    claudeMd: claudeMdSchema.describe('CLAUDE.md loading configuration'),
  })
  .meta({ title: 'Claude SDK CLI Configuration', description: 'Configuration for @shellicar/claude-sdk-cli' });
