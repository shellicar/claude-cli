export interface LaunchOptions {
  readonly args?: readonly string[];
  readonly stdin?: string;
}

export abstract class IProcessLauncher {
  public abstract launch(command: string, options: LaunchOptions): void;
}
