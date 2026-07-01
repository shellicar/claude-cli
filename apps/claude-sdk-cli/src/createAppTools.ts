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
import { ExecV3 } from '@shellicar/claude-sdk-tools/ExecV3';
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

export type CreateAppToolsOptions = {
  fs: IFileSystem;
  tsServer: ITypeScriptService;
  toolsConfig: { exec: boolean; execV2: boolean; execV3: boolean };
  objects: IObjectStore;
  memory: IMemoryStore;
  tsAvailable: boolean;
};

export function createAppTools({ fs, tsServer, toolsConfig, objects, memory, tsAvailable }: CreateAppToolsOptions): AppTools {
  const store = new RefStore(objects);
  const { previewEdit: PreviewEdit, editFile: EditFile } = createEditFilePair(fs, objects);
  const pipeSource = [Find, ReadFile, Grep, Head, Tail, Range, SearchFiles];
  const { tool: Ref, transformToolResult: refTransform } = createRef(store, 50_000);
  const pipe = createPipe(pipeSource);

  const tools: AnyToolDefinition[] = [pipe, ...pipeSource];
  tools.push(PreviewEdit, EditFile, CreateFile, AppendFile, DeleteFile, DeleteDirectory);
  if (toolsConfig.exec) {
    tools.push(Exec);
  }
  if (toolsConfig.execV2) {
    tools.push(ExecV2);
  }
  if (toolsConfig.execV3) {
    tools.push(ExecV3);
  }
  tools.push(Ref);
  // The TS tools depend on tsserver, which needs typescript on disk. When that
  // can't be resolved (e.g. the SEA without the launcher-provided path), the
  // tools are left out entirely rather than registered and failing on first use.
  if (tsAvailable) {
    tools.push(createTsDiagnostics(tsServer), createTsHover(tsServer), createTsReferences(tsServer), createTsDefinition(tsServer));
  }
  tools.push(...createMemoryTools(memory));

  return { tools, store, refTransform };
}
