import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import type { IMemoryStore } from '@shellicar/claude-core/memory/interfaces';
import type { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';
import type { AnyToolDefinition } from '@shellicar/claude-sdk';
import { AppendFile } from '@shellicar/claude-sdk-tools/AppendFile';
import { CreateFile } from '@shellicar/claude-sdk-tools/CreateFile';
import { toStandalone } from '@shellicar/claude-sdk-tools/composable';
import { DeleteDirectory } from '@shellicar/claude-sdk-tools/DeleteDirectory';
import { DeleteFile } from '@shellicar/claude-sdk-tools/DeleteFile';
import { createEditFilePair } from '@shellicar/claude-sdk-tools/EditFilePair';
import { Exec } from '@shellicar/claude-sdk-tools/Exec';
import { ExecV2 } from '@shellicar/claude-sdk-tools/ExecV2';
import { ExecV3 } from '@shellicar/claude-sdk-tools/ExecV3';
import { Find } from '@shellicar/claude-sdk-tools/Find';
import { Head } from '@shellicar/claude-sdk-tools/Head';
import { Match } from '@shellicar/claude-sdk-tools/Match';
import { createMemoryTools } from '@shellicar/claude-sdk-tools/Memory';
import { Paths } from '@shellicar/claude-sdk-tools/Paths';
import { createPipe } from '@shellicar/claude-sdk-tools/Pipe';
import { Range } from '@shellicar/claude-sdk-tools/Range';
import { Read } from '@shellicar/claude-sdk-tools/Read';
import { createReadFileTool } from '@shellicar/claude-sdk-tools/ReadFile';
import { createRef } from '@shellicar/claude-sdk-tools/Ref';
import { RefStore } from '@shellicar/claude-sdk-tools/RefStore';
import { Tail } from '@shellicar/claude-sdk-tools/Tail';
import { createTsDefinition } from '@shellicar/claude-sdk-tools/TsDefinition';
import { createTsDiagnostics } from '@shellicar/claude-sdk-tools/TsDiagnostics';
import { createTsHover } from '@shellicar/claude-sdk-tools/TsHover';
import { createTsReferences } from '@shellicar/claude-sdk-tools/TsReferences';
import type { ITypeScriptService } from '@shellicar/claude-sdk-tools/TsService';
import type { PermissionTool } from './permissions.js';

export type AppTools = {
  tools: AnyToolDefinition[];
  /** The registered tools plus the pipe-only stages, for permission resolution only. The permission
   *  system walks each pipe step by name; the stages are not registered standalone, so they are
   *  surfaced here (never sent to the wire/registry) so a pipe's stage steps resolve. */
  permissionTools: PermissionTool[];
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
  logger: ILogger;
};

export function createAppTools({ fs, tsServer, toolsConfig, objects, memory, tsAvailable, logger }: CreateAppToolsOptions): AppTools {
  const store = new RefStore(objects);
  const ReadFile = createReadFileTool(logger);
  const { previewEdit: PreviewEdit, editFile: EditFile } = createEditFilePair(fs, objects);
  const { tool: Ref, transformToolResult: refTransform } = createRef(store, 50_000);
  // Composable sources start a pipe and are also useful standalone; stages run only inside a pipe.
  const sources = [Find, Paths];
  const stages = [Read, Match, Head, Tail, Range];
  const pipe = createPipe([...sources, ...stages]);

  // ReadFile is the non-pipe single-file read (text + binary), never a pipe step.
  const tools: AnyToolDefinition[] = [pipe, ...sources.map(toStandalone)];
  tools.push(PreviewEdit, EditFile, CreateFile, AppendFile, ReadFile, DeleteFile, DeleteDirectory);
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

  // Stages run only inside a pipe, so they are not in `tools`. The permission resolver looks every pipe
  // step up by name and reads its operation, so it needs them too — projected to { name, operation }
  // rather than full tools, so no runnable (and, uninvoked, crash-prone) stage handler is carried here.
  const permissionTools: PermissionTool[] = [...tools, ...stages].map((t) => ({ name: t.name, operation: t.operation }));
  return { tools, permissionTools, store, refTransform };
}
