/**
 * Module augmentation for missing SDK type exports.
 * SDKRateLimitEvent and SDKPromptSuggestionMessage are referenced in the
 * SDKMessage union but not declared. This unblocks compilation.
 * Remove when the SDK exports these types properly.
 * @see https://github.com/anthropics/claude-agent-sdk-typescript/issues/181
 * @see https://github.com/anthropics/claude-agent-sdk-typescript/issues/184
 */
export {};

declare module '@anthropic-ai/claude-agent-sdk' {
  export type SDKRateLimitEvent = { type: 'rate_limit' };
  export type SDKPromptSuggestionMessage = Record<string, never>;
}
