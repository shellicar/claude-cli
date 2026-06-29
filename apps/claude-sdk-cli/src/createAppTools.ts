import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { IMemoryStore } from '@shellicar/claude-core/memory/interfaces';
import type { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';
import type { AnyToolDefinition } from '@shellicar/claude-sdk';
import { AppendFile } from '@shellicar/claude-sdk-tools/AppendFile';
import { CreateFile } from '@shellicar/claude-sdk-tools/CreateFile';
import { DeleteDirectory } from '@shellicar/claude-sdk-tools/DeleteDirectory';
import { DeleteFile } from '@shellicar/claude-sdk-tools/DeleteFile';
import { createEditFilePair } from '@shellicar/claude-sdk-tools/EditFilePair';
import { Exec } from '@shellicar/claude-sdk-tools/Exec';
import { ExecV2 } from '@shellicar/claude-sdk-tools/ExecV2';
import { Find } from '@shellicar/claude-sdk-tools/Find';
import { Grep } from '@shellicar/claude-sdk-tools/Grep';
import { Head } from '@shellicar/claude-sdk-tools/Head';
import { createMemoryTools } from '@shellicar/claude-sdk-tools/Memory';
import { createPipe } from '@shellicar/claude-sdk-tools/Pipe';
import { Range } from '@shellicar/claude-sdk-tools/Range';
import { ReadFile } from '@shellicar/claude-sdk-tools/ReadFile';
import { createRef } from '@shellicar/claude-sdk-tools/Ref';
import { RefStore } from '@shellicar/claude-sdk-tools/RefStore';
import { SearchFiles } from '@shellicar/claude-sdk-tools/SearchFiles';
import { Tail } from '@shellicar/claude-sdk-tools/Tail';
import { createTsDefinition } from '@shellicar/claude-sdk-tools/TsDefinition';
import { createTsDiagnostics } from '@shellicar/claude-sdk-tools/TsDiagnostics';
import { createTsHover } from '@shellicar/claude-sdk-tools/TsHover';
import { createTsReferences } from '@shellicar/claude-sdk-tools/TsReferences';
import type { ITypeScriptService } from '@shellicar/claude-sdk-tools/TsService';

export type AppTools = {
  tools: AnyToolDefinition[];
  store: RefStore;
  refTransform: (toolName: string, output: unknown) => unknown;
};

export function createAppTools(fs: IFileSystem, tsServer: ITypeScriptService, toolsConfig: { exec: boolean; execV2: boolean }, objects: IObjectStore, memory: IMemoryStore, tsAvailable: boolean): AppTools {
  const store = new RefStore(objects);
  const { previewEdit: PreviewEdit, editFile: EditFile } = createEditFilePair(fs, objects);
  const pipeSource = [Find, ReadFile, Grep, Head, Tail, Range, SearchFiles];
  const { tool: Ref, transformToolResult: refTransform } = createRef(store, 50_000);
  // The TS tools depend on tsserver, which needs typescript on disk. When that
  // can't be resolved (e.g. the SEA without the launcher-provided path), the
  // tools are left out entirely rather than registered and failing on first use.
  const tsTools = tsAvailable ? [createTsDiagnostics(tsServer), createTsHover(tsServer), createTsReferences(tsServer), createTsDefinition(tsServer)] : [];
  const execTools = [...(toolsConfig.exec ? [Exec] : []), ...(toolsConfig.execV2 ? [ExecV2] : [])];
  const memoryTools = createMemoryTools(memory);
  const otherTools = [PreviewEdit, EditFile, CreateFile, AppendFile, DeleteFile, DeleteDirectory, ...execTools, Ref, ...tsTools, ...memoryTools];
  const pipe = createPipe(pipeSource);
  const tools: AnyToolDefinition[] = [pipe, ...pipeSource, ...otherTools];
  return { tools, store, refTransform };
}
