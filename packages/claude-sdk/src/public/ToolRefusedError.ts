/**
 * Thrown by a tool handler to refuse a well-formed but disallowed request, such as a
 * blocked program. Surfaces as a `refused` outcome: non-retryable, escalate to the user.
 * The message becomes the refusal reason.
 */
export class ToolRefusedError extends Error {}
