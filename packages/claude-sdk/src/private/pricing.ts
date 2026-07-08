import type { BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages.js';
import type { CacheTtl } from '../public/enums';

type ModelRates = {
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
};

const M = 1_000_000;

const PRICING: Record<string, ModelRates> = {
  'claude-fable-5': { input: 10 / M, cacheWrite5m: 12.5 / M, cacheWrite1h: 20 / M, cacheRead: 1 / M, output: 50 / M },
  'claude-opus-4-8': { input: 5 / M, cacheWrite5m: 6.25 / M, cacheWrite1h: 10 / M, cacheRead: 0.5 / M, output: 25 / M },
  'claude-opus-4-7': { input: 5 / M, cacheWrite5m: 6.25 / M, cacheWrite1h: 10 / M, cacheRead: 0.5 / M, output: 25 / M },
  'claude-opus-4-6': { input: 5 / M, cacheWrite5m: 6.25 / M, cacheWrite1h: 10 / M, cacheRead: 0.5 / M, output: 25 / M },
  'claude-opus-4-5': { input: 5 / M, cacheWrite5m: 6.25 / M, cacheWrite1h: 10 / M, cacheRead: 0.5 / M, output: 25 / M },
  'claude-opus-4-1': { input: 15 / M, cacheWrite5m: 18.75 / M, cacheWrite1h: 30 / M, cacheRead: 1.5 / M, output: 75 / M },
  'claude-opus-4': { input: 15 / M, cacheWrite5m: 18.75 / M, cacheWrite1h: 30 / M, cacheRead: 1.5 / M, output: 75 / M },
  'claude-sonnet-4-6': { input: 3 / M, cacheWrite5m: 3.75 / M, cacheWrite1h: 6 / M, cacheRead: 0.3 / M, output: 15 / M },
  'claude-sonnet-4-5': { input: 3 / M, cacheWrite5m: 3.75 / M, cacheWrite1h: 6 / M, cacheRead: 0.3 / M, output: 15 / M },
  'claude-sonnet-4': { input: 3 / M, cacheWrite5m: 3.75 / M, cacheWrite1h: 6 / M, cacheRead: 0.3 / M, output: 15 / M },
  'claude-sonnet-3-7': { input: 3 / M, cacheWrite5m: 3.75 / M, cacheWrite1h: 6 / M, cacheRead: 0.3 / M, output: 15 / M },
  'claude-haiku-4-5': { input: 1 / M, cacheWrite5m: 1.25 / M, cacheWrite1h: 2 / M, cacheRead: 0.1 / M, output: 5 / M },
  'claude-haiku-3-5': { input: 0.8 / M, cacheWrite5m: 1 / M, cacheWrite1h: 1.6 / M, cacheRead: 0.08 / M, output: 4 / M },
  'claude-opus-3': { input: 15 / M, cacheWrite5m: 18.75 / M, cacheWrite1h: 30 / M, cacheRead: 1.5 / M, output: 75 / M },
  'claude-haiku-3': { input: 0.25 / M, cacheWrite5m: 0.3 / M, cacheWrite1h: 0.5 / M, cacheRead: 0.03 / M, output: 1.25 / M },
};

const CONTEXT_WINDOW: Record<string, number> = {
  'claude-fable-5': 1_000_000,
  'claude-opus-4-8': 1_000_000,
  'claude-opus-4-7': 1_000_000,
  'claude-opus-4-6': 1_000_000,
  'claude-sonnet-4-6': 1_000_000,
  'claude-opus-4': 200_000,
  'claude-opus-4-5': 200_000,
  'claude-opus-4-1': 200_000,
  'claude-sonnet-4': 1_000_000,
  'claude-haiku-4-5': 200_000,
  'claude-haiku-3-5': 200_000,
  'claude-sonnet-3-7': 200_000,
  'claude-opus-3': 200_000,
  'claude-haiku-3': 200_000,
};

export function getContextWindow(modelId: string): number {
  return CONTEXT_WINDOW[modelId] ?? CONTEXT_WINDOW[stripDateSuffix(modelId)] ?? getFamilyDefault(modelId);
}

function getFamilyDefault(modelId: string): number {
  return /^claude-(opus|sonnet|fable)-/.test(modelId) ? 1_000_000 : 200_000;
}

function stripDateSuffix(modelId: string): string {
  return modelId.replace(/-\d{8}$/, '');
}

export type MessageTokens = {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
};

export function calculateCost(tokens: MessageTokens, modelId: string, cacheTtl: CacheTtl): number {
  const rates = PRICING[modelId] ?? PRICING[stripDateSuffix(modelId)];
  if (!rates) {
    return 0;
  }
  const cacheWriteRate = cacheTtl === '1h' ? rates.cacheWrite1h : rates.cacheWrite5m;
  return tokens.inputTokens * rates.input + tokens.cacheCreationTokens * cacheWriteRate + tokens.cacheReadTokens * rates.cacheRead + tokens.outputTokens * rates.output;
}

export type MessageTokensSplit = {
  inputTokens: number;
  cacheCreation5mTokens: number;
  cacheCreation1hTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
};

/**
 * Price each cache-creation duration at its own rate. This is the correct path
 * whenever a turn's cache-creation is a 5m/1h mix: `calculateCost` prices a
 * single flat total at one assumed TTL, which is wrong for a mixed turn.
 */
export function calculateCostSplit(tokens: MessageTokensSplit, modelId: string): number {
  const rates = PRICING[modelId] ?? PRICING[stripDateSuffix(modelId)];
  if (!rates) {
    return 0;
  }
  return tokens.inputTokens * rates.input + tokens.cacheCreation5mTokens * rates.cacheWrite5m + tokens.cacheCreation1hTokens * rates.cacheWrite1h + tokens.cacheReadTokens * rates.cacheRead + tokens.outputTokens * rates.output;
}

/**
 * Reconstruct the true 5m/1h cache-creation split from an assembled BetaMessage
 * usage. The 1h count survives untouched from the `message_start` split; the 5m
 * count is the remainder of the flat cumulative total, because server-tool 5m
 * cache written during the turn shows only as growth in that flat number. When
 * `cache_creation` is null, the whole flat total is treated as 5m.
 */
export function reconstructCacheSplit(usage: BetaUsage): { fiveMinute: number; oneHour: number } {
  const oneHour = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const flat = usage.cache_creation_input_tokens ?? 0;
  const fiveMinute = Math.max(0, flat - oneHour);
  return { fiveMinute, oneHour };
}
