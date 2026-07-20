import { describe, expect, it } from 'vitest';
import { sdkConfigSchema } from '../src/cli-config/schema.js';

function parse(raw: unknown) {
  return sdkConfigSchema.parse(raw);
}

const defaultModel = 'claude-opus-4-8';

describe('sdkConfigSchema', () => {
  describe('defaults', () => {
    it('returns defaults for empty object', () => {
      const config = parse({});
      expect(config).toEqual({
        model: defaultModel,
        maxTokens: 32_000,
        thinking: { enabled: true, effort: 'high' },
        historyReplay: { enabled: true, showThinking: false },
        claudeMd: { enabled: true, sources: { user: false, project: true, projectClaude: true, local: true } },
        systemPrompt: { enabled: true, sources: { user: false, project: true, projectClaude: true, local: true }, text: null },
        skillDirs: [],
        compact: { enabled: false, inputTokens: 160_000, pauseAfterCompaction: true, customInstructions: null },
        advancedTools: { enabled: true, searchTool: null, allowProgrammaticExecution: [], codeExecutionTool: 'code_execution_20260120' },
        serverTools: {
          webSearch: { enabled: true, version: 'web_search_20260209', allowedCallers: ['direct'] },
          webFetch: { enabled: true, version: 'web_fetch_20260209', allowedCallers: ['direct'] },
        },
        hooks: { approvalNotify: null },
        tools: { exec: false, execV2: false, execV3: true, blockedCommands: [], rules: [] },
        input: { escFastPath: true },
        disabledTools: [],
        statusBar: { showConversationId: true },
        permissions: {
          default: { read: 'approve', write: 'approve', delete: 'ask' },
          outside: { read: 'approve', write: 'ask', delete: 'deny' },
        },
        preventSleep: { enabled: true, platforms: { macos: 'caffeinate', windows: null, linux: null } },
        persistence: { database: 'persistence.db' },
        markdown: { enabled: true, streaming: true },
        memory: { tenantId: null, environment: {}, git: { enabled: true } },
        secrets: { stripGhCredentials: true, ghScoping: false },
        az: { accounts: {} },
        nats: { enabled: false, url: 'nats://localhost:4222', world: 'default', pulseIntervalS: 30 },
      });
    });

    it('ignores $schema field', () => {
      const config = parse({ $schema: 'https://example.com/schema.json' });
      expect(config.model).toBe(defaultModel);
    });

    it('ignores unknown fields', () => {
      const config = parse({ unknownField: 'value' });
      expect(config.model).toBe(defaultModel);
    });
  });

  describe('model', () => {
    it('overrides model', () => {
      const config = parse({ model: 'claude-opus-4-6' });
      expect(config.model).toBe('claude-opus-4-6');
    });

    it('falls back to default on wrong type', () => {
      const config = parse({ model: 123 });
      expect(config.model).toBe(defaultModel);
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
      expect(config.claudeMd).toEqual({ enabled: true, sources: { user: false, project: true, projectClaude: true, local: true } });
    });

    it('falls back field to default on wrong type', () => {
      const config = parse({ claudeMd: { enabled: 'yes' } });
      expect(config.claudeMd.enabled).toBe(true);
    });

    it('defaults the user source to false and the rest to true', () => {
      const config = parse({});
      expect(config.claudeMd.sources).toEqual({ user: false, project: true, projectClaude: true, local: true });
    });

    it('overrides individual source', () => {
      const config = parse({ claudeMd: { sources: { user: false } } });
      expect(config.claudeMd.sources.user).toBe(false);
    });

    it('falls back sources field to default on wrong type', () => {
      const config = parse({ claudeMd: { sources: { user: 'no' } } });
      expect(config.claudeMd.sources.user).toBe(false);
    });
  });

  describe('systemPrompt', () => {
    it('defaults enabled to true', () => {
      const config = parse({});
      expect(config.systemPrompt.enabled).toBe(true);
    });

    it('defaults the user source to false and the rest to true', () => {
      const config = parse({});
      expect(config.systemPrompt.sources).toEqual({ user: false, project: true, projectClaude: true, local: true });
    });

    it('defaults text to null', () => {
      const config = parse({});
      expect(config.systemPrompt.text).toBeNull();
    });

    it('overrides enabled', () => {
      const config = parse({ systemPrompt: { enabled: false } });
      expect(config.systemPrompt.enabled).toBe(false);
    });

    it('overrides an individual source', () => {
      const config = parse({ systemPrompt: { sources: { user: false } } });
      expect(config.systemPrompt.sources.user).toBe(false);
    });

    it('overrides text', () => {
      const config = parse({ systemPrompt: { text: 'Be concise.' } });
      expect(config.systemPrompt.text).toBe('Be concise.');
    });

    it('falls back to defaults on an invalid section value', () => {
      const config = parse({ systemPrompt: 'bad' });
      expect(config.systemPrompt).toEqual({ enabled: true, sources: { user: false, project: true, projectClaude: true, local: true }, text: null });
    });

    it('falls back enabled to default on wrong type', () => {
      const config = parse({ systemPrompt: { enabled: 'yes' } });
      expect(config.systemPrompt.enabled).toBe(true);
    });

    it('falls back a source field to default on wrong type', () => {
      const config = parse({ systemPrompt: { sources: { user: 'no' } } });
      expect(config.systemPrompt.sources.user).toBe(false);
    });

    it('falls back text to default on wrong type', () => {
      const config = parse({ systemPrompt: { text: 123 } });
      expect(config.systemPrompt.text).toBeNull();
    });
  });

  describe('maxTokens', () => {
    it('defaults to 32000', () => {
      const config = parse({});
      expect(config.maxTokens).toBe(32_000);
    });

    it('overrides maxTokens', () => {
      const config = parse({ maxTokens: 8_000 });
      expect(config.maxTokens).toBe(8_000);
    });

    it('falls back to default on wrong type', () => {
      const config = parse({ maxTokens: 'big' });
      expect(config.maxTokens).toBe(32_000);
    });
  });

  describe('thinking', () => {
    it('defaults thinking.enabled to true', () => {
      const config = parse({});
      const actual = config.thinking.enabled;
      const expected = true;
      expect(actual).toBe(expected);
    });

    it('defaults thinking.effort to high', () => {
      const config = parse({});
      const actual = config.thinking.effort;
      const expected = 'high';
      expect(actual).toBe(expected);
    });

    it('overrides thinking.enabled', () => {
      const config = parse({ thinking: { enabled: false } });
      const actual = config.thinking.enabled;
      const expected = false;
      expect(actual).toBe(expected);
    });

    it('overrides thinking.effort', () => {
      const config = parse({ thinking: { effort: 'low' } });
      const actual = config.thinking.effort;
      const expected = 'low';
      expect(actual).toBe(expected);
    });

    it('falls back to defaults on invalid thinking object', () => {
      const config = parse({ thinking: 'bad' });
      const actual = config.thinking;
      const expected = { enabled: true, effort: 'high' };
      expect(actual).toEqual(expected);
    });

    it('falls back effort to default on invalid value', () => {
      const config = parse({ thinking: { effort: 'invalid' } });
      const actual = config.thinking.effort;
      const expected = 'high';
      expect(actual).toBe(expected);
    });
  });

  describe('disabledTools', () => {
    it('defaults to an empty array', () => {
      const config = parse({});
      const actual = config.disabledTools;
      const expected: string[] = [];
      expect(actual).toEqual(expected);
    });

    it('overrides disabledTools', () => {
      const config = parse({ disabledTools: ['ExecV3', 'DeleteFile'] });
      const actual = config.disabledTools;
      const expected = ['ExecV3', 'DeleteFile'];
      expect(actual).toEqual(expected);
    });

    it('falls back to an empty array on wrong type', () => {
      const config = parse({ disabledTools: 'ExecV3' });
      const actual = config.disabledTools;
      const expected: string[] = [];
      expect(actual).toEqual(expected);
    });
  });

  describe('input.escFastPath', () => {
    it('defaults to true', () => {
      const config = parse({});
      const actual = config.input.escFastPath;
      const expected = true;
      expect(actual).toBe(expected);
    });

    it('overrides escFastPath', () => {
      const config = parse({ input: { escFastPath: false } });
      const actual = config.input.escFastPath;
      const expected = false;
      expect(actual).toBe(expected);
    });

    it('falls back to true on wrong type', () => {
      const config = parse({ input: { escFastPath: 'yes' } });
      const actual = config.input.escFastPath;
      const expected = true;
      expect(actual).toBe(expected);
    });
  });

  describe('permissions', () => {
    it('defaults to the current permission matrix', () => {
      const config = parse({});
      const expected = {
        default: { read: 'approve', write: 'approve', delete: 'ask' },
        outside: { read: 'approve', write: 'ask', delete: 'deny' },
      };
      const actual = config.permissions;
      expect(actual).toEqual(expected);
    });

    it('falls back to defaults on invalid value', () => {
      const config = parse({ permissions: 'bad' });
      const expected = {
        default: { read: 'approve', write: 'approve', delete: 'ask' },
        outside: { read: 'approve', write: 'ask', delete: 'deny' },
      };
      const actual = config.permissions;
      expect(actual).toEqual(expected);
    });

    it('partial default zone — omitted write defaults to real value (approve)', () => {
      const config = parse({ permissions: { default: { read: 'ask' } } });
      const expected = 'approve';
      const actual = config.permissions.default.write;
      expect(actual).toBe(expected);
    });

    it('partial default zone — omitted delete defaults to real value (ask)', () => {
      const config = parse({ permissions: { default: { read: 'ask' } } });
      const expected = 'ask';
      const actual = config.permissions.default.delete;
      expect(actual).toBe(expected);
    });

    it('invalid field action falls back to real value (approve), not deny', () => {
      const config = parse({ permissions: { default: { read: 'allow' } } });
      const expected = 'approve';
      const actual = config.permissions.default.read;
      expect(actual).toBe(expected);
    });
  });
});
