import { describe, expect, it } from 'vitest';
import { parseCliConfig } from '../src/cli-config.js';

describe('parseCliConfig', () => {
  describe('defaults', () => {
    it('returns defaults for empty object', () => {
      const config = parseCliConfig({});
      expect(config).toEqual({
        model: 'claude-opus-4-6',
        maxTurns: 100,
        permissionTimeoutMs: 30_000,
        extendedPermissionTimeoutMs: 120_000,
        drowningThreshold: 15,
        autoApproveEdits: true,
        autoApproveReads: true,
        expandTilde: true,
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
