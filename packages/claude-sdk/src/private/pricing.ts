import type { BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages.js';
import type { CacheTtl } from '../public/enums';

const M = 1_000_000;

type ModelConfig = {
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
  contextWindow: number;
};

type ModelEntry = { readonly id: string; readonly config: ModelConfig };

// Each family in release order, newest at the tail. Position encodes recency —
// ordered, not sorted. An unknown model in a known family resolves to the tail.
const FAMILIES = {
  fable: [{ id: 'claude-fable-5', config: { input: 10 / M, cacheWrite5m: 12.5 / M, cacheWrite1h: 20 / M, cacheRead: 1 / M, output: 50 / M, contextWindow: 1_000_000 } }],
  opus: [
    { id: 'claude-opus-3', config: { input: 15 / M, cacheWrite5m: 18.75 / M, cacheWrite1h: 30 / M, cacheRead: 1.5 / M, output: 75 / M, contextWindow: 200_000 } },
    { id: 'claude-opus-4', config: { input: 15 / M, cacheWrite5m: 18.75 / M, cacheWrite1h: 30 / M, cacheRead: 1.5 / M, output: 75 / M, contextWindow: 200_000 } },
    { id: 'claude-opus-4-1', config: { input: 15 / M, cacheWrite5m: 18.75 / M, cacheWrite1h: 30 / M, cacheRead: 1.5 / M, output: 75 / M, contextWindow: 200_000 } },
    { id: 'claude-opus-4-5', config: { input: 5 / M, cacheWrite5m: 6.25 / M, cacheWrite1h: 10 / M, cacheRead: 0.5 / M, output: 25 / M, contextWindow: 200_000 } },
    { id: 'claude-opus-4-6', config: { input: 5 / M, cacheWrite5m: 6.25 / M, cacheWrite1h: 10 / M, cacheRead: 0.5 / M, output: 25 / M, contextWindow: 1_000_000 } },
    { id: 'claude-opus-4-7', config: { input: 5 / M, cacheWrite5m: 6.25 / M, cacheWrite1h: 10 / M, cacheRead: 0.5 / M, output: 25 / M, contextWindow: 1_000_000 } },
    { id: 'claude-opus-4-8', config: { input: 5 / M, cacheWrite5m: 6.25 / M, cacheWrite1h: 10 / M, cacheRead: 0.5 / M, output: 25 / M, contextWindow: 1_000_000 } },
  ],
  sonnet: [
    { id: 'claude-sonnet-3-7', config: { input: 3 / M, cacheWrite5m: 3.75 / M, cacheWrite1h: 6 / M, cacheRead: 0.3 / M, output: 15 / M, contextWindow: 200_000 } },
    { id: 'claude-sonnet-4', config: { input: 3 / M, cacheWrite5m: 3.75 / M, cacheWrite1h: 6 / M, cacheRead: 0.3 / M, output: 15 / M, contextWindow: 1_000_000 } },
    { id: 'claude-sonnet-4-5', config: { input: 3 / M, cacheWrite5m: 3.75 / M, cacheWrite1h: 6 / M, cacheRead: 0.3 / M, output: 15 / M, contextWindow: 1_000_000 } },
    { id: 'claude-sonnet-4-6', config: { input: 3 / M, cacheWrite5m: 3.75 / M, cacheWrite1h: 6 / M, cacheRead: 0.3 / M, output: 15 / M, contextWindow: 1_000_000 } },
    { id: 'claude-sonnet-5', config: { input: 2 / M, cacheWrite5m: 2.5 / M, cacheWrite1h: 4 / M, cacheRead: 0.2 / M, output: 10 / M, contextWindow: 1_000_000 } },
  ],
  haiku: [
    { id: 'claude-haiku-3', config: { input: 0.25 / M, cacheWrite5m: 0.3 / M, cacheWrite1h: 0.5 / M, cacheRead: 0.03 / M, output: 1.25 / M, contextWindow: 200_000 } },
    { id: 'claude-haiku-3-5', config: { input: 0.8 / M, cacheWrite5m: 1 / M, cacheWrite1h: 1.6 / M, cacheRead: 0.08 / M, output: 4 / M, contextWindow: 200_000 } },
    { id: 'claude-haiku-4-5', config: { input: 1 / M, cacheWrite5m: 1.25 / M, cacheWrite1h: 2 / M, cacheRead: 0.1 / M, output: 5 / M, contextWindow: 200_000 } },
  ],
} satisfies Record<string, readonly ModelEntry[]>;

type FamilyName = keyof typeof FAMILIES;

// Exact-id lookup, derived from the family lists so there is one source of truth.
const BY_ID: Record<string, ModelConfig> = Object.fromEntries(Object.values(FAMILIES).flatMap((entries) => entries.map((entry) => [entry.id, entry.config] as const)));

function getFamily(modelId: string): FamilyName | undefined {
  const token = /^claude-(fable|opus|sonnet|haiku)-/.exec(modelId)?.[1];
  // `token in FAMILIES` narrows FAMILIES, not `token`, so the assertion is
  // required — the tsup DTS build rejects the un-asserted form.
  return token !== undefined && token in FAMILIES ? (token as FamilyName) : undefined;
}

function resolveConfig(modelId: string): ModelConfig | undefined {
  const exact = BY_ID[modelId] ?? BY_ID[stripDateSuffix(modelId)];
  if (exact !== undefined) {
    return exact;
  }
  const family = getFamily(modelId);
  if (family === undefined) {
    return undefined;
  }
  const entries = FAMILIES[family];
  return entries[entries.length - 1].config;
}

export function getContextWindow(modelId: string): number {
  return resolveConfig(modelId)?.contextWindow ?? 200_000;
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
  const config = resolveConfig(modelId);
  if (!config) {
    return 0;
  }
  const cacheWriteRate = cacheTtl === '1h' ? config.cacheWrite1h : config.cacheWrite5m;
  return tokens.inputTokens * config.input + tokens.cacheCreationTokens * cacheWriteRate + tokens.cacheReadTokens * config.cacheRead + tokens.outputTokens * config.output;
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
  const config = resolveConfig(modelId);
  if (!config) {
    return 0;
  }
  return tokens.inputTokens * config.input + tokens.cacheCreation5mTokens * config.cacheWrite5m + tokens.cacheCreation1hTokens * config.cacheWrite1h + tokens.cacheReadTokens * config.cacheRead + tokens.outputTokens * config.output;
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
