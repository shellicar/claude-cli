import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { dependsOn } from '@shellicar/core-di';
import { auditPathFor } from './auditPath.js';

/** The tip as the durable record holds it: the id of the last message in the conversation's audit
 *  file. Read when a conversation is loaded or switched to, because the conversation file carries
 *  messages only and a resumed conversation still has to judge a `say` premise. */
export abstract class IAuditTip {
  public abstract read(conversationId: string): Promise<string | null>;
}

export class AuditTip extends IAuditTip {
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;

  public async read(conversationId: string): Promise<string | null> {
    const path = auditPathFor(this.fs, conversationId);
    if (!(await this.fs.exists(path))) {
      return null;
    }
    const raw = await this.fs.readFile(path);
    const lines = raw.split('\n').filter((line) => line.length > 0);
    // Backwards, because a pre-v2 tail line carries no id and is not the tip of anything the wire saw.
    for (let i = lines.length - 1; i >= 0; i--) {
      const id = (JSON.parse(lines[i] as string) as { id?: unknown }).id;
      if (typeof id === 'string') {
        return id;
      }
    }
    return null;
  }
}
