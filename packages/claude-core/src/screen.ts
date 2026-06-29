export abstract class Screen {
  public abstract get rows(): number;
  public abstract get columns(): number;
  public abstract write(data: string): void;
  public abstract onResize(cb: (columns: number, rows: number) => void): () => void;
  public abstract enterAltBuffer(): void;
  public abstract exitAltBuffer(): void;
}

export class StdoutScreen extends Screen {
  public get rows(): number {
    return process.stdout.rows ?? 24;
  }

  public get columns(): number {
    return process.stdout.columns ?? 80;
  }

  public write(data: string): void {
    process.stdout.write(data);
  }

  public onResize(cb: (columns: number, rows: number) => void): () => void {
    const handler = () => cb(process.stdout.columns, process.stdout.rows);
    process.stdout.on('resize', handler);
    return () => process.stdout.off('resize', handler);
  }

  public enterAltBuffer(): void {
    process.stdout.write('\x1b[?1049h');
  }

  public exitAltBuffer(): void {
    process.stdout.write('\x1b[?1049l');
  }
}
