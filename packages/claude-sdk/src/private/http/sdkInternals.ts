/**
 * Re-implementations of @anthropic-ai/sdk/internal/* types and utilities.
 *
 * Those paths are not included in the package exports map and cannot be
 * imported directly. We mirror them structurally so our subclass overrides
 * satisfy the same contract as the SDK's own protected methods.
 *
 * Linting is disabled on this file (see biome.json overrides) — it is
 * intentionally written to match the SDK source, not our own conventions.
 */

import type { Stream } from '@anthropic-ai/sdk/core/streaming';

// ---------------------------------------------------------------------------
// NullableHeaders (mirrors @anthropic-ai/sdk/internal/headers)
// ---------------------------------------------------------------------------

export const brand_privateNullableHeaders = Symbol.for('brand.privateNullableHeaders') as symbol & {
  description: 'brand.privateNullableHeaders';
};

export type NullableHeaders = {
  [_: typeof brand_privateNullableHeaders]: true;
  values: Headers;
  nulls: Set<string>;
};

type HeaderValue = string | undefined | null;

export type HeadersLike =
  | Headers
  | readonly HeaderValue[][]
  | Record<string, HeaderValue | readonly HeaderValue[]>
  | undefined
  | null
  | NullableHeaders;

// ---------------------------------------------------------------------------
// MergedRequestInit (mirrors @anthropic-ai/sdk/internal/types)
// The SDK definition is a union of platform-specific RequestInit variants.
// The meaningful constraint is that body/headers/method/signal are excluded.
// ---------------------------------------------------------------------------

export type MergedRequestInit = Omit<RequestInit, 'body' | 'headers' | 'method' | 'signal'>;

// ---------------------------------------------------------------------------
// RequestOptions / FinalRequestOptions (mirrors @anthropic-ai/sdk/internal/request-options)
// ---------------------------------------------------------------------------

export type HTTPMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type RequestOptions = {
  method?: HTTPMethod;
  path?: string;
  query?: object | undefined | null;
  body?: unknown;
  headers?: HeadersLike;
  maxRetries?: number;
  stream?: boolean | undefined;
  timeout?: number;
  fetchOptions?: MergedRequestInit;
  signal?: AbortSignal | undefined | null;
  idempotencyKey?: string;
  defaultBaseURL?: string | undefined;
  __binaryResponse?: boolean | undefined;
  __streamClass?: typeof Stream;
};

export type FinalRequestOptions = RequestOptions & { method: HTTPMethod; path: string };

// ---------------------------------------------------------------------------
// buildHeaders (mirrors @anthropic-ai/sdk/internal/headers)
// ---------------------------------------------------------------------------

const isReadonlyArray = Array.isArray as (val: unknown) => val is readonly unknown[];

function* iterateHeaders(headers: HeadersLike): IterableIterator<readonly [string, string | null]> {
  if (!headers) return;

  if (brand_privateNullableHeaders in headers) {
    const { values, nulls } = headers as NullableHeaders;
    yield* values.entries();
    for (const name of nulls) yield [name, null];
    return;
  }

  let shouldClear = false;
  let iter: Iterable<readonly (HeaderValue | readonly HeaderValue[])[]>;
  if (headers instanceof Headers) {
    iter = headers.entries();
  } else if (isReadonlyArray(headers)) {
    iter = headers;
  } else {
    shouldClear = true;
    iter = Object.entries(headers ?? {});
  }

  for (const row of iter) {
    const name = row[0];
    if (typeof name !== 'string') throw new TypeError('expected header name to be a string');
    const values = isReadonlyArray(row[1]) ? row[1] : [row[1]];
    let didClear = false;
    for (const value of values) {
      if (value === undefined) continue;
      if (shouldClear && !didClear) {
        didClear = true;
        yield [name, null];
      }
      yield [name, value];
    }
  }
}

export const buildHeaders = (newHeaders: HeadersLike[]): NullableHeaders => {
  const targetHeaders = new Headers();
  const nullHeaders = new Set<string>();
  for (const headers of newHeaders) {
    const seenHeaders = new Set<string>();
    for (const [name, value] of iterateHeaders(headers)) {
      const lowerName = name.toLowerCase();
      if (!seenHeaders.has(lowerName)) {
        targetHeaders.delete(name);
        seenHeaders.add(lowerName);
      }
      if (value === null) {
        targetHeaders.delete(name);
        nullHeaders.add(lowerName);
      } else {
        targetHeaders.append(name, value);
        nullHeaders.delete(lowerName);
      }
    }
  }
  return { [brand_privateNullableHeaders]: true, values: targetHeaders, nulls: nullHeaders };
};
