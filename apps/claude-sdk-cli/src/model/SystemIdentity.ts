import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';
import { dependsOn } from '@shellicar/core-di-lite';
import { parseSystemIdentity } from '../parseSystemIdentity.js';
import { type IdentityRead, ISystemIdentity } from './ISystemIdentity.js';

/** The `objects` collection under which each conversation's identity file path is stored, keyed by conversation id. */
export const IDENTITY_COLLECTION = 'identity';

/**
 * Owns the conversation's system identity: the file PATH (persisted in the
 * objects store, keyed by conversation id) and the live read of the file's
 * contents. Only the path is durable; body and name are always read fresh from
 * disk so the identity is a live mirror — deleted means absent, restored means
 * present. The strict-existence gate at assertion is the caller's (main.ts).
 */
export class SystemIdentity extends ISystemIdentity {
  @dependsOn(IObjectStore) private readonly objects!: IObjectStore;
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;
  #path: string | null = null;

  public get path(): string | null {
    return this.#path;
  }

  public assert(conversationId: string, path: string): void {
    this.#path = path;
    this.objects.set(IDENTITY_COLLECTION, conversationId, path);
  }

  public load(conversationId: string): void {
    this.#path = this.objects.get(IDENTITY_COLLECTION, conversationId) ?? null;
  }

  public inherit(newConversationId: string): void {
    if (this.#path != null) {
      this.objects.set(IDENTITY_COLLECTION, newConversationId, this.#path);
    }
  }

  public async read(): Promise<IdentityRead> {
    if (this.#path === null) {
      return { state: 'none' };
    }
    try {
      const raw = await this.fs.readFile(this.#path);
      const { name, body } = parseSystemIdentity(raw);
      return { state: 'present', path: this.#path, body, name };
    } catch {
      return { state: 'missing', path: this.#path };
    }
  }
}
