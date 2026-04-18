import type { AnyToolDefinition } from '@shellicar/claude-sdk';
import { CreateFile } from '@shellicar/claude-sdk-tools/CreateFile';
import { DeleteDirectory } from '@shellicar/claude-sdk-tools/DeleteDirectory';
import { DeleteFile } from '@shellicar/claude-sdk-tools/DeleteFile';
import { EditFile } from '@shellicar/claude-sdk-tools/EditFile';
import { Exec } from '@shellicar/claude-sdk-tools/Exec';
import { Find } from '@shellicar/claude-sdk-tools/Find';
import { Grep } from '@shellicar/claude-sdk-tools/Grep';
import { Head } from '@shellicar/claude-sdk-tools/Head';
import { createPipe } from '@shellicar/claude-sdk-tools/Pipe';
import { PreviewEdit } from '@shellicar/claude-sdk-tools/PreviewEdit';
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

export function createAppTools(tsServer: ITypeScriptService): AppTools {
  const store = new RefStore();
  const pipeSource = [Find, ReadFile, Grep, Head, Tail, Range, SearchFiles];
  const { tool: Ref, transformToolResult: refTransform } = createRef(store, 20_000);
  const TsDiagnostics = createTsDiagnostics(tsServer);
  const TsHover = createTsHover(tsServer);
  const TsReferences = createTsReferences(tsServer);
  const TsDefinition = createTsDefinition(tsServer);
  const tsTools = [TsDiagnostics, TsHover, TsReferences, TsDefinition];
  const otherTools = [PreviewEdit, EditFile, CreateFile, DeleteFile, DeleteDirectory, Exec, Ref, ...tsTools];
  const pipe = createPipe(pipeSource);
  const tools: AnyToolDefinition[] = [pipe, ...pipeSource, ...otherTools];
  return { tools, store, refTransform };
}
