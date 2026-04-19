export abstract class IProcessLauncher {
  public abstract launch(command: string, args: string[]): void;
}
