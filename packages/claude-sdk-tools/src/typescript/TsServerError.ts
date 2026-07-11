/**
 * A server-side failure of the TypeScript server: the backing tsserver process
 * broke, timed out, or answered a request with `success: false`. This is the
 * 5xx equivalent (the service could not answer), distinct from a normal
 * tool/usage error like a bad file path (the 4xx equivalent). Surfacing it as
 * its own error means a failed request never reads as a clean file — the bug
 * that started this mission.
 */
export class TsServerError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'TsServerError';
  }
}
