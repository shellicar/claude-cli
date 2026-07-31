/** No credentials are stored. Deliberately not retryable: `isRetryable` returns false for it, so a
 * request that hits it ends the query immediately instead of retrying an unauthenticated machine. */
export class NotAuthenticatedError extends Error {
  public constructor() {
    super('Not authenticated: no stored credentials.');
  }
}
