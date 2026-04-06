import { Anthropic, type ClientOptions } from '@anthropic-ai/sdk';

/**
 * Subclass of Anthropic that overrides bearerAuth to support async token refresh.
 *
 * The SDK types include ApiKeySetter = () => Promise<string> but the runtime
 * discards non-string values in the constructor:
 *   this.apiKey = typeof apiKey === 'string' ? apiKey : null;
 * So ApiKeySetter is a type lie in 0.82.0 — the function is never called.
 *
 * bearerAuth is protected and is called per-request, before validateHeaders,
 * so overriding it is the cleanest way to inject a refreshed token each call.
 * We return a plain Record<string, string> which buildHeaders accepts via
 * Object.entries — no need to import from @anthropic-ai/sdk/internal/*.
 */
export class TokenRefreshingAnthropic extends Anthropic {
  readonly #getToken: () => Promise<string>;

  public constructor(getToken: () => Promise<string>, opts?: Omit<ClientOptions, 'apiKey' | 'authToken'>) {
    // Explicitly null both auth fields so the SDK doesn't read from env vars.
    // validateHeaders will see the Authorization header we inject in bearerAuth
    // (authHeaders runs before validateHeaders in the request pipeline).
    super({ ...opts, apiKey: null, authToken: null });
    this.#getToken = getToken;
  }

  // biome-ignore lint/suspicious/noExplicitAny: overriding SDK internal method; types not exported
  protected override async bearerAuth(_opts: any): Promise<any> {
    const token = await this.#getToken();
    return { Authorization: `Bearer ${token}` };
  }
}
