export enum AnthropicBeta {
  /**
   * @see https://platform.claude.com/docs/en/build-with-claude/compaction
  */
  Compact = 'compact-2026-01-12',
  ClaudeCodeAuth = 'oauth-2025-04-20',
  /**
   * @see https://platform.claude.com/docs/en/build-with-claude/extended-thinking#interleaved-thinking
   * @deprecated
   */
  InterleavedThinking = 'interleaved-thinking-2025-05-14',

  /**
   * @see https://platform.claude.com/docs/en/build-with-claude/context-editing#server-side-strategies
   */
  ContextManagement = 'context-management-2025-06-27',

  PromptCachingScope = 'prompt-caching-scope-2026-01-05',
  /**
   * @see https://www.anthropic.com/engineering/advanced-tool-use
   */
  AdvancedToolUse = 'advanced-tool-use-2025-11-20',
}
