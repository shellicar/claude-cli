export type WakeLockProcess = {
  kill(): void;
};

export abstract class IWakeLockSpawner {
  public abstract spawn(command: string, args: readonly string[]): WakeLockProcess;
}
