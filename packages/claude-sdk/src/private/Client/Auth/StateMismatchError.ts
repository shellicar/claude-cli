/** The callback carried a `state` other than the one the authorisation request was built with, so
 * it did not come from the login this process started. */
export class StateMismatchError extends Error {
  public constructor() {
    super('OAuth callback state did not match the authorisation request');
  }
}
