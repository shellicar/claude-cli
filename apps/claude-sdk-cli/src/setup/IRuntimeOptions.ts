/**
 * Runtime values that arrive from `main` at startup (argv/argc), carried on one
 * registered object (decision 8) rather than threaded as raw strings:
 * `modelOverride` (the `--model` flag), `systemFlagText` (the decoded `--system`
 * flag), `claudeMdFlagText` (the decoded `--claudeMd` flag), and `tsAvailable`
 * (`resolveTsServerPath() != null`). Downstream classes
 * inject this object and read the values off it.
 */
export abstract class IRuntimeOptions {
  public abstract readonly modelOverride: string | null;
  public abstract readonly systemFlagText: string | null;
  public abstract readonly claudeMdFlagText: string | null;
  public abstract readonly tsAvailable: boolean;
}
