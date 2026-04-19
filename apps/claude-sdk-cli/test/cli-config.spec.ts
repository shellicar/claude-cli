import { describe, expect, it } from 'vitest';
import { sdkConfigSchema } from '../src/cli-config/schema.js';

function parse(raw: unknown) {
  return sdkConfigSchema.parse(raw);
}

describe('sdkConfigSchema', () => {
  describe('defaults', () => {
    it('returns defaults for empty object', () => {
      const config = parse({});
      expect(config).toEqual({
        model: 'claude-sonnet-4-6',
        historyReplay: { enabled: true, showThinking: false },
        claudeMd: { enabled: true },
        compact: { enabled: false, inputTokens: 160_000, pauseAfterCompaction: true, customInstructions: null },
        advancedTools: { enabled: false, searchTool: null, allowProgrammaticExecution: [], codeExecutionTool: 'code_execution_20260120' },
        serverTools: {
          webSearch: { enabled: true, version: 'web_search_20260209', allowedCallers: ['direct'] },
          webFetch: { enabled: true, version: 'web_fetch_20260209', allowedCallers: ['direct'] },
        },
        hooks: { approvalNotify: null },
      });
    });

    it('ignores $schema field', () => {
      const config = parse({ $schema: 'https://example.com/schema.json' });
      expect(config.model).toBe('claude-sonnet-4-6');
    });

    it('ignores unknown fields', () => {
      const config = parse({ unknownField: 'value' });
      expect(config.model).toBe('claude-sonnet-4-6');
    });
  });

  describe('model', () => {
    it('overrides model', () => {
      const config = parse({ model: 'claude-opus-4-6' });
      expect(config.model).toBe('claude-opus-4-6');
    });

    it('falls back to default on wrong type', () => {
      const config = parse({ model: 123 });
      expect(config.model).toBe('claude-sonnet-4-6');
    });
  });

  describe('historyReplay', () => {
    it('overrides enabled', () => {
      const config = parse({ historyReplay: { enabled: false } });
      expect(config.historyReplay.enabled).toBe(false);
    });

    it('overrides showThinking', () => {
      const config = parse({ historyReplay: { showThinking: true } });
      expect(config.historyReplay.showThinking).toBe(true);
    });

    it('falls back to defaults on invalid value', () => {
      const config = parse({ historyReplay: 'bad' });
      expect(config.historyReplay).toEqual({ enabled: true, showThinking: false });
    });

    it('falls back field to default on wrong type', () => {
      const config = parse({ historyReplay: { enabled: 'yes' } });
      expect(config.historyReplay.enabled).toBe(true);
    });
  });

  describe('claudeMd', () => {
    it('defaults enabled to true', () => {
      const config = parse({});
      expect(config.claudeMd.enabled).toBe(true);
    });

    it('overrides enabled', () => {
      const config = parse({ claudeMd: { enabled: false } });
      expect(config.claudeMd.enabled).toBe(false);
    });

    it('falls back to defaults on invalid value', () => {
      const config = parse({ claudeMd: 'bad' });
      expect(config.claudeMd).toEqual({ enabled: true });
    });

    it('falls back field to default on wrong type', () => {
      const config = parse({ claudeMd: { enabled: 'yes' } });
      expect(config.claudeMd.enabled).toBe(true);
    });
  });
});
