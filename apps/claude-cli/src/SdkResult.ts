import type { SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk';

const API_ERROR_REGEX = /API Error: (\d+) (\{.+\})$/s;

export interface ApiErrorInfo {
  readonly statusCode: number;
  readonly errorType: string | null;
  readonly errorMessage: string | null;
}

function parseApiError(result: string): ApiErrorInfo | null {
  const match = API_ERROR_REGEX.exec(result);
  if (!match) {
    return null;
  }

  const statusCode = Number(match[1]);
  const jsonBody = match[2];

  try {
    const parsed = JSON.parse(jsonBody) as { error?: { type?: string; message?: string } };
    return {
      statusCode,
      errorType: parsed.error?.type ?? null,
      errorMessage: parsed.error?.message ?? null,
    };
  } catch {
    return {
      statusCode,
      errorType: null,
      errorMessage: null,
    };
  }
}

export class SdkResult {
  public readonly result: string;
  public readonly isError: boolean;
  public readonly stopReason: string | null;
  public readonly apiError: ApiErrorInfo | null;
  public readonly isApiError: boolean;
  public readonly isRateLimited: boolean;
  public readonly noTokens: boolean;

  public constructor(msg: SDKResultSuccess) {
    this.result = msg.result;
    this.isError = msg.is_error;
    this.stopReason = msg.stop_reason;

    this.apiError = parseApiError(msg.result);
    this.isApiError = this.apiError !== null;

    const totalOutput = Object.values(msg.modelUsage).reduce((sum, mu) => sum + (mu.outputTokens ?? 0), 0);
    this.noTokens = totalOutput === 0;
    this.isRateLimited = this.noTokens && msg.result.includes('429') && msg.result.includes('rate_limit_error');
  }
}
