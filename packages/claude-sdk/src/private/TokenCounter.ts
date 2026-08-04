import versionJson from '@shellicar/build-version/version';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import type { ICredentialProvider } from './Client/Auth/interfaces';
import { customFetch } from './http/customFetch';
import type { RequestParams } from './RequestBuilder';

const COUNT_URL = 'https://api.anthropic.com/v1/messages/count_tokens?beta=true';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * How many input tokens a request would count as, asked of the model that would answer it.
 *
 * A token count is a property of the model, not of the content: the same bytes came back as 12,223
 * tokens on sonnet-4-6 and 15,948 on sonnet-5. So a count taken under one model says nothing about
 * what another would charge for the same prompt, and there is no way to derive it locally. This is
 * the only way to know.
 */
export abstract class ITokenCounter {
  /** The count, or null when the API could not say. Advisory: a caller shows what it already knew
   *  rather than treating the absence as an error. */
  public abstract count(request: RequestParams): Promise<number | null>;
}

/**
 * Counts over the same OAuth-bearer transport the message client uses, sending the request the
 * caller assembled minus the fields that describe a generation rather than a prompt.
 *
 * Advisory like the model catalogue: a failure logs and returns null rather than throwing, because
 * every caller is showing a figure it can fall back on and none of them should fail for want of a
 * better one. Nothing is memoised, since each call is a different prompt.
 */
export class TokenCounter extends ITokenCounter {
  readonly #credentials: ICredentialProvider;
  readonly #logger: ILogger;
  readonly #fetch: typeof fetch;
  readonly #defaultHeaders: Record<string, string> = {
    'user-agent': `@shellicar/claude-sdk/${versionJson.version}`,
  };

  public constructor(credentials: ICredentialProvider, logger: ILogger) {
    super();
    this.#credentials = credentials;
    this.#logger = logger;
    this.#fetch = customFetch(logger) as typeof fetch;
  }

  public async count(request: RequestParams): Promise<number | null> {
    try {
      return await this.#count(request);
    } catch (err) {
      this.#logger.warn('token count failed', err);
      return null;
    }
  }

  async #count(request: RequestParams): Promise<number> {
    const { claudeAiOauth } = await this.#credentials.get();
    // The endpoint takes a prompt, not a generation, so the fields that bound the response go.
    const { max_tokens: _maxTokens, stream: _stream, ...prompt } = request.body as unknown as Record<string, unknown>;
    const response = await this.#fetch(COUNT_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
        authorization: `Bearer ${claudeAiOauth.accessToken}`,
        ...this.#defaultHeaders,
        ...request.headers,
      },
      body: JSON.stringify(prompt),
    });
    if (!response.ok) {
      throw new Error(`token count request failed: ${response.status} ${response.statusText}`);
    }
    const json = (await response.json()) as { input_tokens?: unknown };
    if (typeof json.input_tokens !== 'number') {
      throw new Error('token count response carried no input_tokens');
    }
    return json.input_tokens;
  }
}
