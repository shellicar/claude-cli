import { describe, expect, it } from 'vitest';
import { createToolsV2Registry } from '../../src/Orchestrate/registry.js';
import { FakeExecutor } from '../FakeExecutor.js';
import { MemoryFileSystem } from '../MemoryFileSystem.js';

function makeRegistry() {
  return createToolsV2Registry({ fs: new MemoryFileSystem(), executor: new FakeExecutor(() => ({ exitCode: 0 })) });
}

describe('createToolsV2Registry', () => {
  it('gives every registered tool its own wire entry', () => {
    const registry = makeRegistry();

    const expected = ['Find', 'Match', 'Head', 'Tail', 'Range', 'Read', 'Program'].sort();
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
});

describe('ToolsV2Registry.toStage', () => {
  it('resolves a tool-shaped wire stage into a real orchestrate-core Stage', () => {
    const registry = makeRegistry();

    const stage = registry.toStage({ tool: 'Head', input: { count: 5 } });

    const expected = 'tool';
    const actual = stage.kind;
    expect(actual).toBe(expected);
  });

  it('resolves an Xargs wire stage without consulting the tool registry', () => {
    const registry = makeRegistry();

    const stage = registry.toStage({ xargs: 'files' });

    const expected = 'xargs';
    const actual = stage.kind;
    expect(actual).toBe(expected);
  });
});
