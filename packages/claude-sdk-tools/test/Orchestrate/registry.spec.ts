import { Clock } from '@js-joda/core';
import { describe, expect, it } from 'vitest';
import { createToolsV2Registry, toolsV2WireTools } from '../../src/Orchestrate/registry.js';
import { RefStore } from '../../src/RefStore/RefStore.js';
import { FakeExecutor } from '../FakeExecutor.js';
import { fakeEscalatedRegistryDeps } from '../fakeEscalatedRegistryDeps.js';
import { noopLogger, passthroughSips } from '../helpers.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';
import { MemoryObjectStore } from '../MemoryObjectStore.js';
import { RecordingHistoryReader } from '../RecordingHistoryReader.js';
import { RecordingMemoryStore } from '../RecordingMemoryStore.js';

function makeRegistry() {
  return createToolsV2Registry({
    fs: new MemoryFileSystem(),
    executor: new FakeExecutor(() => ({ exitCode: 0 })),
    refStore: new RefStore(new MemoryObjectStore()),
    sips: passthroughSips,
    logger: noopLogger,
    memoryStore: new RecordingMemoryStore(),
    historyReader: new RecordingHistoryReader(),
    currentSessionId: () => 'session',
    clock: Clock.systemUTC(),
    skillDirs: [],
    ...fakeEscalatedRegistryDeps(),
  });
}

describe('createToolsV2Registry', () => {
  it('gives every registered tool its own wire entry', () => {
    const registry = makeRegistry();

    const expected = [
      'Find',
      'Paths',
      'Match',
      'Head',
      'Tail',
      'Range',
      'Read',
      'ReadBinaryFile',
      'Program',
      'Delete',
      'Ref',
      'CreateFile',
      'AppendFile',
      'EditFile',
      'WriteMemory',
      'ReadMemory',
      'SearchMemory',
      'DeleteMemory',
      'MemoryTypes',
      'SearchHistory',
      'ReadHistory',
      'Skill',
      'TsDiagnostics',
      'TsHover',
      'TsReferences',
      'TsDefinition',
      'GitHub_PullRequest_Create',
      'GitHub_PullRequest_Ready',
      'GitHub_PullRequest_Edit',
      'GitHub_PullRequest_Comment',
      'GitHub_PullRequest_AutoMerge',
      'GitHub_PullRequest_Review',
      'AzureDevOps_PullRequest_Create',
      'AzureDevOps_PullRequest_Ready',
      'AzureDevOps_PullRequest_Edit',
      'AzureDevOps_PullRequest_AutoMerge',
      'AzureDevOps_PullRequest_ReviewerAdd',
      'AzureDevOps_PullRequest_ReviewerRemove',
      'AzureDevOps_PullRequest_Vote',
      'AzCli',
      'EscalatedAzCli',
    ].sort();
    const actual = registry.wireTools.map((t) => t.name).sort();
    expect(actual).toEqual(expected);
  });

  it('looks a registered tool up by name', () => {
    const registry = makeRegistry();

    const expected = 'Find';
    const actual = registry.get('Find')?.name;
    expect(actual).toBe(expected);
  });
});

describe('toolsV2WireTools', () => {
  it('includes Orchestrate alongside every individually registered tool', () => {
    const registry = makeRegistry();

    const expected = [
      'Find',
      'Paths',
      'Match',
      'Head',
      'Tail',
      'Range',
      'Read',
      'ReadBinaryFile',
      'Program',
      'Delete',
      'Ref',
      'CreateFile',
      'AppendFile',
      'EditFile',
      'WriteMemory',
      'ReadMemory',
      'SearchMemory',
      'DeleteMemory',
      'MemoryTypes',
      'SearchHistory',
      'ReadHistory',
      'Skill',
      'TsDiagnostics',
      'TsHover',
      'TsReferences',
      'TsDefinition',
      'GitHub_PullRequest_Create',
      'GitHub_PullRequest_Ready',
      'GitHub_PullRequest_Edit',
      'GitHub_PullRequest_Comment',
      'GitHub_PullRequest_AutoMerge',
      'GitHub_PullRequest_Review',
      'AzureDevOps_PullRequest_Create',
      'AzureDevOps_PullRequest_Ready',
      'AzureDevOps_PullRequest_Edit',
      'AzureDevOps_PullRequest_AutoMerge',
      'AzureDevOps_PullRequest_ReviewerAdd',
      'AzureDevOps_PullRequest_ReviewerRemove',
      'AzureDevOps_PullRequest_Vote',
      'AzCli',
      'EscalatedAzCli',
      'Orchestrate',
    ].sort();
    const actual = toolsV2WireTools(registry)
      .map((t) => t.name)
      .sort();
    expect(actual).toEqual(expected);
  });
});

describe('ToolsV2Registry.stageSchema', () => {
  it('accepts a Find piped into Head, validated against each tool own model', () => {
    const registry = makeRegistry();
    const input = {
      stages: [
        { tool: 'Find', input: { path: '/root' }, op: '|' },
        { tool: 'Head', input: { count: 1 } },
      ],
    };

    const expected = true;
    const actual = registry.stageSchema.safeParse(input).success;
    expect(actual).toBe(expected);
  });

  it('accepts showStderr on any stage, not just Program — it is per-stage, not per-tool', () => {
    const registry = makeRegistry();
    const input = { stages: [{ tool: 'Find', input: { path: '/root' }, showStderr: true }] };

    const expected = true;
    const actual = registry.stageSchema.safeParse(input).success;
    expect(actual).toBe(expected);
  });

  it('accepts an Xargs stage bridging into the next stage', () => {
    const registry = makeRegistry();
    const input = { stages: [{ tool: 'Find', input: { path: '/root' }, op: '|' }, { xargs: 'files' }, { tool: 'Program', input: { program: 'rm', cwd: '/root' } }] };

    const expected = true;
    const actual = registry.stageSchema.safeParse(input).success;
    expect(actual).toBe(expected);
  });

  it('rejects a tool name outside the registry', () => {
    const registry = makeRegistry();
    const input = { stages: [{ tool: 'DeleteFile', input: {} }] };

    const expected = false;
    const actual = registry.stageSchema.safeParse(input).success;
    expect(actual).toBe(expected);
  });

  it('rejects a Range stage whose start is after its end, via Range own model', () => {
    const registry = makeRegistry();
    const input = { stages: [{ tool: 'Range', input: { start: 10, end: 1 } }] };

    const expected = false;
    const actual = registry.stageSchema.safeParse(input).success;
    expect(actual).toBe(expected);
  });

  it('rejects a tool marked excludeFromStages — it stays individually callable but cannot be dropped into a pipe', () => {
    const registry = makeRegistry();
    const input = { stages: [{ tool: 'ReadBinaryFile', input: { path: '/doc.pdf' } }] };

    const expected = false;
    const actual = registry.stageSchema.safeParse(input).success;
    expect(actual).toBe(expected);
  });

  it('still gives a tool marked excludeFromStages its own wire entry', () => {
    const registry = makeRegistry();

    const expected = true;
    const actual = registry.wireTools.some((t) => t.name === 'ReadBinaryFile');
    expect(actual).toBe(expected);
  });

  it('rejects a dangling op on the last stage — there is nothing after it to join to', () => {
    const registry = makeRegistry();
    const input = { stages: [{ tool: 'Head', input: { count: 1 }, op: '|' }] };

    const expected = false;
    const actual = registry.stageSchema.safeParse(input).success;
    expect(actual).toBe(expected);
  });

  it('accepts an op on an earlier stage as long as the last stage has none', () => {
    const registry = makeRegistry();
    const input = {
      stages: [
        { tool: 'Find', input: { path: '/root' }, op: '|' },
        { tool: 'Head', input: { count: 1 } },
      ],
    };

    const expected = true;
    const actual = registry.stageSchema.safeParse(input).success;
    expect(actual).toBe(expected);
  });
});

describe('ToolsV2Registry.toStage', () => {
  it('resolves a tool-shaped wire stage into a real orchestrate-core Stage', () => {
    const registry = makeRegistry();

    const stage = registry.toStage({ tool: 'Head', input: { count: 5 } });

    const expected = 'tool';
    const actual = stage.kind;
    expect(actual).toBe(expected);
  });

  it('carries showStderr from the wire stage onto the resolved Stage, not onto the tool', () => {
    const registry = makeRegistry();

    const stage = registry.toStage({ tool: 'Head', input: { count: 5 }, showStderr: true });

    const expected = true;
    const actual = stage.kind === 'tool' ? stage.showStderr : undefined;
    expect(actual).toBe(expected);
  });

  it('resolves an Xargs wire stage without consulting the tool registry', () => {
    const registry = makeRegistry();

    const stage = registry.toStage({ xargs: 'files' });

    const expected = 'xargs';
    const actual = stage.kind;
    expect(actual).toBe(expected);
  });

  it("resolves a tool's own isPath field via the injected expand before running it, leaving the Stage's own input untouched", async () => {
    const executor = new FakeExecutor(() => ({ exitCode: 0 }));
    const registry = createToolsV2Registry({
      fs: new MemoryFileSystem(),
      executor,
      refStore: new RefStore(new MemoryObjectStore()),
      sips: passthroughSips,
      logger: noopLogger,
      memoryStore: new RecordingMemoryStore(),
      historyReader: new RecordingHistoryReader(),
      currentSessionId: () => 'session',
      clock: Clock.systemUTC(),
      skillDirs: [],
      expand: (p) => (p === '~/project' ? '/resolved/project' : p),
      ...fakeEscalatedRegistryDeps(),
    });

    const stage = registry.toStage({ tool: 'Program', input: { program: 'ls', cwd: '~/project' } });
    if (stage.kind !== 'tool') {
      throw new Error('unreachable');
    }
    const result = stage.tool.run(stage.input, undefined, []);
    for await (const _ of result.stdout) {
      // drain
    }

    const expectedCwd = '/resolved/project';
    const actualCwd = executor.calls[0]?.cwd;
    expect(actualCwd).toBe(expectedCwd);

    const expectedStageInput = '~/project';
    const actualStageInput = (stage.input as { cwd: string }).cwd;
    expect(actualStageInput).toBe(expectedStageInput);
  });
});
