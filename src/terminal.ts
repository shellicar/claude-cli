import { inspect } from 'node:util';
import { DateTimeFormatter, LocalTime } from '@js-joda/core';

const TIME_FORMAT = DateTimeFormatter.ofPattern('HH:mm:ss.SSS');
const CLEAR_LINE = '\r\x1B[2K';

export class Terminal {
  private timestamp(): string {
    return LocalTime.now().format(TIME_FORMAT);
  }

  public logLine(message: string, ...args: any[]): void {
    process.stdout.write('[');
    process.stdout.write(this.timestamp());
    process.stdout.write('] ');
    process.stdout.write(message);
    if (args.length > 0) {
      for (const a of args) {
        process.stdout.write(' ');
        process.stdout.write(typeof a === 'string' ? a : inspect(a, { depth: null, colors: true, breakLength: Infinity, compact: true }));
      }
    }
  }

  public log(message: string, ...args: any[]): void {
    this.logLine(message, ...args);
    process.stdout.write('\n');
  }

  public clearLine(): void {
    process.stdout.write(CLEAR_LINE);
  }

  public status(message: string): void {
    this.clearLine();
    this.logLine(message);
  }

  public write(data: string): void {
    process.stdout.write(data);
  }

  public error(message: string): void {
    process.stderr.write(`Error: ${message}\n`);
  }

  public info(message: string): void {
    process.stdout.write(message);
    process.stdout.write('\n');
  }
}
