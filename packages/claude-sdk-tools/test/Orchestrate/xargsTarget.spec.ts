import { Clock } from '@js-joda/core';
import { fromLines } from '@shellicar/orchestrate-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineToolV2, xargsTarget, xargsTargetKeys } from '../../src/Orchestrate/defineToolV2.js';
import { createToolsV2Registry } from '../../src/Orchestrate/registry.js';
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

function accepts(stages: unknown[]): boolean {
  return makeRegistry().planCall({ stages }).ok;
}

/** The reason a call was refused, without the `stages.1: ` prefix that says where. */
function issueText(stages: unknown[]): string {
  const result = makeRegistry().planCall({ stages });
  return result.ok ? '' : (result.error.split('\n')[0]?.replace(/^[\w.]+: /, '') ?? '');
}

describe('a tool declaring its xargs target', () => {
  it('reports the marked field', () => {
    const expected = ['files'];
    const actual = xargsTargetKeys(z.object({ files: xargsTarget(z.array(z.string())), severity: z.string() }));
    expect(actual).toEqual(expected);
  });

  it('reports a field marked through an optional wrapper', () => {
    const expected = ['args'];
    const actual = xargsTargetKeys(z.object({ args: xargsTarget(z.array(z.string()).optional()) }));
    expect(actual).toEqual(expected);
  });

  it('refuses to define a tool marking two fields, since no pipeline could say which was meant', () => {
    expect(() =>
      defineToolV2({
        name: 'Ambiguous',
        description: 'two targets',
        operations: () => ['none'],
        model: z.object({ files: xargsTarget(z.array(z.string())), extras: xargsTarget(z.array(z.string())) }),
        run: () => ({ stdout: fromLines((async function* () {})()), success: () => true }),
      }),
    ).toThrow('Ambiguous');
  });
});

describe('validating a pipeline before it runs', () => {
  it('accepts a stage fed by Xargs that omits the field being fed', () => {
    const expected = true;
    const actual = accepts([{ tool: 'Find', input: { path: '/root' }, op: '|' }, { xargs: true }, { tool: 'Read', input: {} }]);
    expect(actual).toBe(expected);
  });

  it('accepts a stage fed by Xargs that also names files of its own', () => {
    const expected = true;
    const actual = accepts([{ tool: 'Find', input: { path: '/root' }, op: '|' }, { xargs: true }, { tool: 'Read', input: { paths: ['/known.ts'] } }]);
    expect(actual).toBe(expected);
  });

  it('rejects a stage that stands alone without the field it needs', () => {
    const expected = 'Read needs paths, either supplied here or fed by an Xargs stage before it.';
    const actual = issueText([{ tool: 'Read', input: {} }]);
    expect(actual).toBe(expected);
  });

  it('rejects an Xargs feeding a tool that has no argument list', () => {
    const expected = 'Xargs cannot feed Find: it takes no argument list. Pipe into it directly if it reads a pipe, or drop the Xargs.';
    const actual = issueText([{ tool: 'Paths', input: { paths: ['/a'] }, op: '|' }, { xargs: true }, { tool: 'Find', input: { path: '/root' } }]);
    expect(actual).toBe(expected);
  });

  it('rejects an Xargs with nothing after it to feed', () => {
    const expected = 'Xargs must be followed by the tool stage it feeds.';
    const actual = issueText([{ tool: 'Find', input: { path: '/root' }, op: '|' }, { xargs: true }]);
    expect(actual).toBe(expected);
  });
});

// Silence was the old behaviour here: the producer ran, the consumer ignored what it produced, and
// three stages reported success with no output.
describe('validating a pipe into a tool that cannot read one', () => {
  it('rejects it, naming both ends and the fix', () => {
    const expected = "Find pipes into Read, which does not read a pipe, so its output would be discarded. Put an Xargs stage between them to append the piped values to Read's paths.";
    const actual = issueText([
      { tool: 'Find', input: { path: '/root' }, op: '|' },
      { tool: 'Read', input: { paths: ['/a.ts'] } },
    ]);
    expect(actual).toBe(expected);
  });

  it('accepts a pipe into a tool that does read one', () => {
    const expected = true;
    const actual = accepts([
      { tool: 'Find', input: { path: '/root' }, op: '|' },
      { tool: 'Match', input: { pattern: 'x' } },
    ]);
    expect(actual).toBe(expected);
  });
});
