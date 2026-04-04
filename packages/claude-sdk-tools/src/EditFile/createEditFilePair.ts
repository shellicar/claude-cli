import type { IFileSystem } from '../fs/IFileSystem';
import { createEditFile } from './ConfirmEditFile';
import { createPreviewEdit } from './EditFile';

export function createEditFilePair(fs: IFileSystem) {
  const store = new Map<string, unknown>();
  return {
    previewEdit: createPreviewEdit(fs, store),
    editFile: createEditFile(fs, store),
  };
}
