export abstract class ILogger {
  public abstract trace(message: string, ...meta: unknown[]): void;
  public abstract debug(message: string, ...meta: unknown[]): void;
  public abstract info(message: string, ...meta: unknown[]): void;
  public abstract warn(message: string, ...meta: unknown[]): void;
  public abstract error(message: string, ...meta: unknown[]): void;
}
