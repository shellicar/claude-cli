import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnthropicAuth } from '../src/private/Client/Auth/AnthropicAuth.js';
import { ModelCatalog } from '../src/private/ModelCatalog.js';

const noopLogger: ILogger = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** A fake auth that yields a static bearer token, standing in for the OAuth flow. */
const fakeAuth = { getCredentials: () => Promise.resolve({ claudeAiOauth: { accessToken: 'tok' } }) } as unknown as AnthropicAuth;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubFetch(...responses: Response[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn<typeof fetch>();
  for (const r of responses) {
    fn.mockResolvedValueOnce(r);
  }
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ModelCatalog — list', () => {
  it('maps the endpoint data to id and displayName', async () => {
    stubFetch(jsonResponse({ data: [{ id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' }] }));
    const catalogue = new ModelCatalog(fakeAuth, noopLogger);

    const actual = await catalogue.list();
    const expected = [{ id: 'claude-opus-4-8', displayName: 'Claude Opus 4.8' }];

    expect(actual).toEqual(expected);
  });

  it('falls back to the id when display_name is absent', async () => {
    stubFetch(jsonResponse({ data: [{ id: 'claude-x' }] }));
    const catalogue = new ModelCatalog(fakeAuth, noopLogger);

    const actual = (await catalogue.list())[0]?.displayName;
    const expected = 'claude-x';

    expect(actual).toBe(expected);
  });

  it('skips entries without a string id', async () => {
    stubFetch(jsonResponse({ data: [{ id: 42 }, { id: 'claude-y' }] }));
    const catalogue = new ModelCatalog(fakeAuth, noopLogger);

    const actual = (await catalogue.list()).map((m) => m.id);
    const expected = ['claude-y'];

    expect(actual).toEqual(expected);
  });
});

describe('ModelCatalog — memoisation', () => {
  it('fetches once across repeated calls on success', async () => {
    const fn = stubFetch(jsonResponse({ data: [{ id: 'claude-opus-4-8' }] }));
    const catalogue = new ModelCatalog(fakeAuth, noopLogger);

    await catalogue.list();
    await catalogue.list();
    const expected = 1;
    const actual = fn.mock.calls.length;

    expect(actual).toBe(expected);
  });
});

describe('ModelCatalog — failure', () => {
  it('returns an empty list on a non-ok response', async () => {
    stubFetch(new Response('nope', { status: 500 }));
    const catalogue = new ModelCatalog(fakeAuth, noopLogger);

    const actual = await catalogue.list();
    const expected: unknown[] = [];

    expect(actual).toEqual(expected);
  });

  it('does not cache a failure, so a later call retries and succeeds', async () => {
    stubFetch(new Response('nope', { status: 500 }), jsonResponse({ data: [{ id: 'claude-opus-4-8' }] }));
    const catalogue = new ModelCatalog(fakeAuth, noopLogger);

    await catalogue.list();
    const actual = (await catalogue.list()).map((m) => m.id);
    const expected = ['claude-opus-4-8'];

    expect(actual).toEqual(expected);
  });
});
