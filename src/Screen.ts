export interface Screen {
  readonly rows: number;
  readonly columns: number;
  write(data: string): void;
  onResize(cb: (columns: number, rows: number) => void): () => void;
}

export class StdoutScreen implements Screen {
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
    const handler = () => cb(process.stdout.columns ?? 80, process.stdout.rows ?? 24);
    process.stdout.on('resize', handler);
    return () => process.stdout.off('resize', handler);
  }
}
