import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { createEditFile } from './ConfirmEditFile';
import { createPreviewEdit } from './EditFile';
import type { PreviewEditOutputType } from './types';

export function createEditFilePair(fs: IFileSystem) {
  const store = new Map<string, PreviewEditOutputType>();
  return {
    previewEdit: createPreviewEdit(fs, store),
    editFile: createEditFile(fs, store),
  };
}
