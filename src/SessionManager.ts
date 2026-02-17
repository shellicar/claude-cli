import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export class SessionManager {
  public constructor(private readonly filePath: string) {}

  public load(log: (msg: string) => void): string | undefined {
    if (!existsSync(this.filePath)) {
      log(`No session file found at ${this.filePath}`);
      return undefined;
    }
    try {
      const content = readFileSync(this.filePath, 'utf8').trim();
      if (!content) {
        log('Session file exists but is empty');
        return undefined;
      }
      log(`Found saved session: ${content}`);
      return content;
    } catch (err) {
      log(`Failed to read session file: ${err}`);
      return undefined;
    }
  }

  public save(id: string): void {
    writeFileSync(this.filePath, id);
  }
}
