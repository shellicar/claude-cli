/** No stored credentials, and the caller asked for no interactive login. Deliberately not
 * retryable: `isRetryable` returns false for it, so a request that hits it ends the query
 * immediately instead of retrying into a browser-login loop. */
export class NotAuthenticatedError extends Error {
  public constructor() {
    super('Not authenticated: no stored credentials. Restart the CLI to log in.');
  }
}
