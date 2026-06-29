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
import { toStandalone } from '@shellicar/claude-sdk-tools/composable';
import { Find } from '@shellicar/claude-sdk-tools/Find';
import { Head } from '@shellicar/claude-sdk-tools/Head';
import { Match } from '@shellicar/claude-sdk-tools/Match';
import { createMemoryTools } from '@shellicar/claude-sdk-tools/Memory';
import { Paths } from '@shellicar/claude-sdk-tools/Paths';
import { createPipe } from '@shellicar/claude-sdk-tools/Pipe';
import { Range } from '@shellicar/claude-sdk-tools/Range';
import { Read } from '@shellicar/claude-sdk-tools/Read';
import { ReadFile } from '@shellicar/claude-sdk-tools/ReadFile';
import { createRef } from '@shellicar/claude-sdk-tools/Ref';
import { RefStore } from '@shellicar/claude-sdk-tools/RefStore';
import { Slice } from '@shellicar/claude-sdk-tools/Slice';
import { Tail } from '@shellicar/claude-sdk-tools/Tail';
import { createTsDefinition } from '@shellicar/claude-sdk-tools/TsDefinition';
import { createTsDiagnostics } from '@shellicar/claude-sdk-tools/TsDiagnostics';
import { createTsHover } from '@shellicar/claude-sdk-tools/TsHover';
import { createTsReferences } from '@shellicar/claude-sdk-tools/TsReferences';
import type { ITypeScriptService } from '@shellicar/claude-sdk-tools/TsService';

export type AppTools = {
  tools: AnyToolDefinition[];
  /** The registered tools plus the pipe-only stages, for permission resolution only. The permission
   *  system walks each pipe step by name; the stages are not registered standalone, so they are
   *  surfaced here (never sent to the wire/registry) so a pipe's stage steps resolve. */
  permissionTools: AnyToolDefinition[];
  store: RefStore;
  refTransform: (toolName: string, output: unknown) => unknown;
};

export function createAppTools(fs: IFileSystem, tsServer: ITypeScriptService, toolsConfig: { exec: boolean; execV2: boolean }, objects: IObjectStore, memory: IMemoryStore, tsAvailable: boolean): AppTools {
  const store = new RefStore(objects);
  const { previewEdit: PreviewEdit, editFile: EditFile } = createEditFilePair(fs, objects);
  // Composable sources start a pipe and are also useful standalone; stages run only inside a pipe.
  const sources = [Find, Paths];
  const stages = [Read, Match, Head, Tail, Range, Slice];
  const { tool: Ref, transformToolResult: refTransform } = createRef(store, 50_000);
  // The TS tools depend on tsserver, which needs typescript on disk. When that
  // can't be resolved (e.g. the SEA without the launcher-provided path), the
  // tools are left out entirely rather than registered and failing on first use.
  const tsTools = tsAvailable ? [createTsDiagnostics(tsServer), createTsHover(tsServer), createTsReferences(tsServer), createTsDefinition(tsServer)] : [];
  const execTools = [...(toolsConfig.exec ? [Exec] : []), ...(toolsConfig.execV2 ? [ExecV2] : [])];
  const memoryTools = createMemoryTools(memory);
  // ReadFile is the non-pipe single-file read (text + binary), never a pipe step.
  const otherTools = [PreviewEdit, EditFile, CreateFile, AppendFile, ReadFile, DeleteFile, DeleteDirectory, ...execTools, Ref, ...tsTools, ...memoryTools];
  const pipe = createPipe([...sources, ...stages]);
  const tools: AnyToolDefinition[] = [pipe, ...sources.map(toStandalone), ...otherTools];
  // Stages run only inside a pipe, so they are not in `tools`. The permission resolver looks every
  // pipe step up by name, so it needs them too — adapted to definitions for the name/operation lookup.
  const permissionTools: AnyToolDefinition[] = [...tools, ...stages.map(toStandalone)];
  return { tools, permissionTools, store, refTransform };
}
