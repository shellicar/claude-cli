import { describe, expect, it } from 'vitest';
import { diffConfig } from '../src/cli-config/diffConfig.js';
import { parseCliConfig } from '../src/cli-config/parseCliConfig.js';
import { validateRawConfig } from '../src/cli-config/validateRawConfig.js';

describe('parseCliConfig', () => {
  describe('defaults', () => {
    it('returns defaults for empty object', () => {
      const config = parseCliConfig({});
      expect(config).toEqual({
        model: 'claude-opus-4-6',
        maxTurns: 100,
        permissionTimeoutMs: 30_000,
        extendedPermissionTimeoutMs: 120_000,
        questionTimeoutMs: 60_000,
        drowningThreshold: 15,
        autoApproveEdits: true,
        autoApproveReads: true,
        expandTilde: true,
        providers: {
          git: { enabled: true, branch: true, status: true, sha: true },
          usage: { enabled: true, time: true, context: true, cost: true },
        },
      });
    });

    it('throws for undefined input', () => {
      expect(() => parseCliConfig(undefined)).toThrow();
    });
  });

  describe('overrides', () => {
    it('overrides model', () => {
      const config = parseCliConfig({ model: 'claude-sonnet-4-6' });
      expect(config.model).toBe('claude-sonnet-4-6');
    });

    it('overrides maxTurns', () => {
      const config = parseCliConfig({ maxTurns: 50 });
      expect(config.maxTurns).toBe(50);
    });

    it('overrides permissionTimeoutMs', () => {
      const config = parseCliConfig({ permissionTimeoutMs: 60_000 });
      expect(config.permissionTimeoutMs).toBe(60_000);
    });

    it('overrides extendedPermissionTimeoutMs', () => {
      const config = parseCliConfig({ extendedPermissionTimeoutMs: 300_000 });
      expect(config.extendedPermissionTimeoutMs).toBe(300_000);
    });

    it('overrides questionTimeoutMs', () => {
      const config = parseCliConfig({ questionTimeoutMs: 120_000 });
      expect(config.questionTimeoutMs).toBe(120_000);
    });

    it('overrides drowningThreshold', () => {
      const config = parseCliConfig({ drowningThreshold: 20 });
      expect(config.drowningThreshold).toBe(20);
    });

    it('overrides autoApproveEdits', () => {
      const config = parseCliConfig({ autoApproveEdits: false });
      expect(config.autoApproveEdits).toBe(false);
    });

    it('overrides autoApproveReads', () => {
      const config = parseCliConfig({ autoApproveReads: false });
      expect(config.autoApproveReads).toBe(false);
    });

    it('overrides expandTilde', () => {
      const config = parseCliConfig({ expandTilde: false });
      expect(config.expandTilde).toBe(false);
    });
  });

  describe('nullable drowningThreshold', () => {
    it('accepts null to disable', () => {
      const config = parseCliConfig({ drowningThreshold: null });
      expect(config.drowningThreshold).toBeNull();
    });

    it('accepts zero', () => {
      const config = parseCliConfig({ drowningThreshold: 0 });
      expect(config.drowningThreshold).toBe(0);
    });
  });

  describe('nullable extendedPermissionTimeoutMs', () => {
    it('accepts null to disable', () => {
      const config = parseCliConfig({ extendedPermissionTimeoutMs: null });
      expect(config.extendedPermissionTimeoutMs).toBeNull();
    });

    it('accepts valid value', () => {
      const config = parseCliConfig({ extendedPermissionTimeoutMs: 300_000 });
      expect(config.extendedPermissionTimeoutMs).toBe(300_000);
    });

    it('falls back below minimum', () => {
      const config = parseCliConfig({ extendedPermissionTimeoutMs: 500 });
      expect(config.extendedPermissionTimeoutMs).toBe(120_000);
    });

    it('falls back on string', () => {
      const config = parseCliConfig({ extendedPermissionTimeoutMs: 'slow' });
      expect(config.extendedPermissionTimeoutMs).toBe(120_000);
    });

    it('returns default when missing', () => {
      const config = parseCliConfig({});
      expect(config.extendedPermissionTimeoutMs).toBe(120_000);
    });
  });

  describe('nullable questionTimeoutMs', () => {
    it('accepts null to disable', () => {
      const config = parseCliConfig({ questionTimeoutMs: null });
      expect(config.questionTimeoutMs).toBeNull();
    });

    it('accepts valid value', () => {
      const config = parseCliConfig({ questionTimeoutMs: 120_000 });
      expect(config.questionTimeoutMs).toBe(120_000);
    });

    it('falls back below minimum', () => {
      const config = parseCliConfig({ questionTimeoutMs: 500 });
      expect(config.questionTimeoutMs).toBe(60_000);
    });

    it('falls back on string', () => {
      const config = parseCliConfig({ questionTimeoutMs: 'hello' });
      expect(config.questionTimeoutMs).toBe(60_000);
    });

    it('returns default when missing', () => {
      const config = parseCliConfig({});
      expect(config.questionTimeoutMs).toBe(60_000);
    });
  });

  describe('catch fallback on invalid values', () => {
    it('falls back model on wrong type', () => {
      const config = parseCliConfig({ model: 123 });
      expect(config.model).toBe('claude-opus-4-6');
    });

    it('falls back maxTurns on zero', () => {
      const config = parseCliConfig({ maxTurns: 0 });
      expect(config.maxTurns).toBe(100);
    });

    it('falls back maxTurns on negative', () => {
      const config = parseCliConfig({ maxTurns: -5 });
      expect(config.maxTurns).toBe(100);
    });

    it('falls back maxTurns on non-integer', () => {
      const config = parseCliConfig({ maxTurns: 1.5 });
      expect(config.maxTurns).toBe(100);
    });

    it('falls back permissionTimeoutMs below minimum', () => {
      const config = parseCliConfig({ permissionTimeoutMs: 500 });
      expect(config.permissionTimeoutMs).toBe(30_000);
    });

    it('falls back extendedPermissionTimeoutMs on string', () => {
      const config = parseCliConfig({ extendedPermissionTimeoutMs: 'fast' });
      expect(config.extendedPermissionTimeoutMs).toBe(120_000);
    });

    it('falls back drowningThreshold on negative', () => {
      const config = parseCliConfig({ drowningThreshold: -1 });
      expect(config.drowningThreshold).toBe(15);
    });

    it('falls back autoApproveEdits on string', () => {
      const config = parseCliConfig({ autoApproveEdits: 'yes' });
      expect(config.autoApproveEdits).toBe(true);
    });

    it('falls back autoApproveReads on number', () => {
      const config = parseCliConfig({ autoApproveReads: 1 });
      expect(config.autoApproveReads).toBe(true);
    });

    it('falls back expandTilde on string', () => {
      const config = parseCliConfig({ expandTilde: 'yes' });
      expect(config.expandTilde).toBe(true);
    });
  });

  describe('$schema passthrough', () => {
    it('ignores $schema field', () => {
      const config = parseCliConfig({ $schema: 'https://example.com/schema.json' });
      expect(config.model).toBe('claude-opus-4-6');
    });
  });

  describe('unknown fields', () => {
    it('ignores unknown fields', () => {
      const config = parseCliConfig({ unknownField: 'value', model: 'claude-haiku-4-5' });
      expect(config.model).toBe('claude-haiku-4-5');
    });
  });
});

describe('validateRawConfig', () => {
  it('returns no warnings for valid config', () => {
    const warnings = validateRawConfig({ model: 'claude-opus-4-6', maxTurns: 100, autoApproveEdits: true });
    expect(warnings).toEqual([]);
  });

  it('warns on non-integer maxTurns', () => {
    const warnings = validateRawConfig({ maxTurns: 1.5 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('maxTurns');
  });

  it('warns on maxTurns below minimum', () => {
    const warnings = validateRawConfig({ maxTurns: 0 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('maxTurns');
  });

  it('warns on string maxTurns', () => {
    const warnings = validateRawConfig({ maxTurns: 'banana' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('maxTurns');
  });

  it('warns on permissionTimeoutMs below minimum', () => {
    const warnings = validateRawConfig({ permissionTimeoutMs: 500 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('permissionTimeoutMs');
  });

  it('warns on non-boolean autoApproveEdits', () => {
    const warnings = validateRawConfig({ autoApproveEdits: 'yes' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('autoApproveEdits');
  });

  it('warns on non-string model', () => {
    const warnings = validateRawConfig({ model: 123 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('model');
  });

  it('accepts null for nullable fields', () => {
    const warnings = validateRawConfig({ extendedPermissionTimeoutMs: null, questionTimeoutMs: null, drowningThreshold: null });
    expect(warnings).toEqual([]);
  });

  it('warns on invalid nested provider field', () => {
    const warnings = validateRawConfig({ providers: { git: { enabled: 'yes' } } });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('providers.git.enabled');
  });

  it('warns on non-object providers', () => {
    const warnings = validateRawConfig({ providers: 'bad' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('providers');
  });

  it('returns no warnings for missing fields', () => {
    const warnings = validateRawConfig({});
    expect(warnings).toEqual([]);
  });
});

describe('diffConfig', () => {
  const defaults = parseCliConfig({});

  it('returns empty for identical configs', () => {
    const changes = diffConfig(defaults, defaults);
    expect(changes).toEqual([]);
  });

  it('detects model change', () => {
    const next = { ...defaults, model: 'claude-sonnet-4-6' };
    const changes = diffConfig(defaults, next);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toContain('model');
    expect(changes[0]).toContain('claude-sonnet-4-6');
  });

  it('detects nested provider change', () => {
    const next = { ...defaults, providers: { ...defaults.providers, git: { ...defaults.providers.git, enabled: false } } };
    const changes = diffConfig(defaults, next);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toContain('providers.git.enabled');
  });

  it('detects multiple changes', () => {
    const next = { ...defaults, model: 'claude-haiku-4-5', maxTurns: 50 };
    const changes = diffConfig(defaults, next);
    expect(changes).toHaveLength(2);
  });

  it('detects nullable field change to null', () => {
    const next = { ...defaults, drowningThreshold: null };
    const changes = diffConfig(defaults, next);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toContain('drowningThreshold');
  });
});
