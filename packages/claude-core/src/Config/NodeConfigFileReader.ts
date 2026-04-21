import { existsSync, readFileSync } from 'node:fs';
import { IConfigFileReader } from './interfaces';

/**
 * `IConfigFileReader` backed by `node:fs` sync APIs. The production
 * implementation for the CLI.
 */
export class NodeConfigFileReader extends IConfigFileReader {
  public exists(path: string): boolean {
    return existsSync(path);
  }

  public read(path: string): string {
    return readFileSync(path, 'utf8');
  }
}
