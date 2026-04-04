import type { IFileSystem } from '../fs/IFileSystem';
import { createConfirmEditFile } from './ConfirmEditFile';
import { createEditFile } from './EditFile';

export function createEditFilePair(fs: IFileSystem) {
  const store = new Map<string, unknown>();
  return {
    editFile: createEditFile(fs, store),
    confirmEditFile: createConfirmEditFile(fs, store),
  };
}
