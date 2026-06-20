import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';
import { createEditFile } from './ConfirmEditFile';
import { createPreviewEdit } from './EditFile';
import { PreviewEditOutputSchema } from './schema';
import type { PatchStore } from './types';

const COLLECTION = 'previewEdit';

export function createEditFilePair(fs: IFileSystem, objects: IObjectStore) {
  const store: PatchStore = {
    get: (id) => {
      const raw = objects.get(COLLECTION, id);
      return raw === undefined ? undefined : PreviewEditOutputSchema.parse(JSON.parse(raw));
    },
    set: (id, value) => {
      objects.set(COLLECTION, id, JSON.stringify(value));
    },
  };
  return {
    previewEdit: createPreviewEdit(fs, store),
    editFile: createEditFile(fs, store),
  };
}
