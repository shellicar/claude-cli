/**
 * Per-session model-tuning capability the command mode drives. The model
 * sub-mode recognises the t/e keys as intents; executing them — advancing the
 * thinking and effort overrides and landing the result in StatusState — is the
 * implementation's job. The implementation owns the cycle order; the executor
 * only asks for the next step.
 */
export abstract class ModelSettings {
  public abstract cycleThinking(): void;
  public abstract cycleEffort(): void;
  /** Set or clear the per-session model override. `null` clears it, falling back
   * to the config model. Shares one slot with the `--model` startup flag. */
  public abstract setModel(id: string | null): void;
}
