import { Anthropic, type ClientOptions } from '@anthropic-ai/sdk';
import { buildHeaders, type FinalRequestOptions, type NullableHeaders } from './sdkInternals';

/**
 * Extended ClientOptions that allows apiKey and authToken to be async getter
 * functions in addition to static strings.
 *
 * - apiKey getter    → called in apiKeyAuth(), sets X-Api-Key per request
 * - authToken getter → called in bearerAuth(), sets Authorization: Bearer per request
 *
 * ClientOptions.apiKey already declares ApiKeySetter = () => Promise<string> in
 * its type, but the SDK constructor discards non-string values at runtime:
 *   this.apiKey = typeof apiKey === 'string' ? apiKey : null
 * We capture the getter before super() silently drops it.
 *
 * ClientOptions.authToken is string-only; we extend it here to also accept a getter.
 */
export type TokenRefreshingClientOptions = Omit<ClientOptions, 'authToken'> & {
  authToken?: string | (() => Promise<string>) | null;
};

/**
 * Subclass of Anthropic that properly implements ApiKeySetter and adds getter
 * support for authToken. Both auth methods are called per-request so tokens
 * are always fresh.
 */
export class TokenRefreshingAnthropic extends Anthropic {
  readonly #apiKeyGetter: (() => Promise<string>) | undefined;
  readonly #authTokenGetter: (() => Promise<string>) | undefined;

  public constructor(opts: TokenRefreshingClientOptions) {
    const { apiKey, authToken, ...rest } = opts;
    // Pass static strings through to super as-is; pass null for functions so
    // the SDK doesn't read env vars and doesn't try to use the discarded value.
    super({
      ...rest,
      apiKey: typeof apiKey === 'string' ? apiKey : null,
      authToken: typeof authToken === 'string' ? authToken : null,
    });
    this.#apiKeyGetter = typeof apiKey === 'function' ? apiKey : undefined;
    this.#authTokenGetter = typeof authToken === 'function' ? authToken : undefined;
  }

  protected override async apiKeyAuth(_opts: FinalRequestOptions): Promise<NullableHeaders | undefined> {
    if (this.#apiKeyGetter != null) {
      const token = await this.#apiKeyGetter();
      return buildHeaders([{ 'X-Api-Key': token }]);
    }
    return super.apiKeyAuth(_opts);
  }

  protected override async bearerAuth(_opts: FinalRequestOptions): Promise<NullableHeaders | undefined> {
    if (this.#authTokenGetter != null) {
      const token = await this.#authTokenGetter();
      return buildHeaders([{ Authorization: `Bearer ${token}` }]);
    }
    return super.bearerAuth(_opts);
  }
}
