import { describe, expect, it } from 'vitest';
import { resolveAzAccount } from '../../src/Az/createAzTool';
import type { AzAccountsConfig } from '../../src/Az/tools';

const single: AzAccountsConfig = { shellicar: { tenantId: 't', reader: { mechanism: 'cert', clientId: 'r', subscriptionIds: [] }, holder: null } };
const multiple: AzAccountsConfig = {
  shellicar: { tenantId: 't1', reader: { mechanism: 'cert', clientId: 'r1', subscriptionIds: [] }, holder: { mechanism: 'cert', clientId: 'h1', subscriptionIds: [] } },
  hopeventures: { tenantId: 't2', reader: { mechanism: 'cert', clientId: 'r2', subscriptionIds: [] }, holder: { mechanism: 'cert', clientId: 'h2', subscriptionIds: [] } },
};

describe('resolveAzAccount', () => {
  describe('with exactly one account configured for the identity', () => {
    it('resolves to that account when none is requested', () => {
      const expected = 'shellicar';
      const actual = resolveAzAccount(() => single, 'reader', undefined);
      expect(actual).toBe(expected);
    });

    it('resolves to the requested account when it matches', () => {
      const expected = 'shellicar';
      const actual = resolveAzAccount(() => single, 'reader', 'shellicar');
      expect(actual).toBe(expected);
    });
  });

  describe('with more than one account configured for the identity', () => {
    it('throws when no account is requested', () => {
      const expected = 'account is required when more than one Azure account is configured';
      expect(() => resolveAzAccount(() => multiple, 'reader', undefined)).toThrow(expected);
    });

    it('resolves to the requested account when it matches', () => {
      const expected = 'hopeventures';
      const actual = resolveAzAccount(() => multiple, 'holder', 'hopeventures');
      expect(actual).toBe(expected);
    });
  });

  it('throws when the requested account has no identity of that kind configured', () => {
    const expected = "account 'other' has no holder identity configured";
    expect(() => resolveAzAccount(() => multiple, 'holder', 'other')).toThrow(expected);
  });

  it('throws when no account has the identity configured at all', () => {
    const expected = 'no account has a holder identity configured';
    expect(() => resolveAzAccount(() => single, 'holder', undefined)).toThrow(expected);
  });

  describe('with a fallback', () => {
    it('uses the fallback when no account is requested and it matches a configured account', () => {
      const expected = 'hopeventures';
      const actual = resolveAzAccount(() => multiple, 'holder', undefined, 'hopeventures');
      expect(actual).toBe(expected);
    });

    it('prefers the explicit request over the fallback', () => {
      const expected = 'shellicar';
      const actual = resolveAzAccount(() => multiple, 'holder', 'shellicar', 'hopeventures');
      expect(actual).toBe(expected);
    });

    it('throws when the fallback does not match any configured account and more than one is configured', () => {
      const expected = 'account is required when more than one Azure account is configured';
      expect(() => resolveAzAccount(() => multiple, 'holder', undefined, 'unrelated-org')).toThrow(expected);
    });
  });
});
