import { describe, expect, it } from 'vitest';
import { ToolObject } from '../src/model/ToolObject.js';

describe('ToolObject — render', () => {
  it('renders the streaming phase as the tool name followed by the partial input', () => {
    const tool = new ToolObject('t1', 'client', 'ReadFile');
    tool.appendInput('{"path":');
    const expected = 'ReadFile{"path":';
    const actual = tool.render();
    expect(actual).toBe(expected);
  });

  it('renders the pending phase using the resolved view', () => {
    const tool = new ToolObject('t1', 'client', 'ReadFile');
    tool.resolve('ReadFile(a.ts)');
    const expected = 'ReadFile(a.ts)\n';
    const actual = tool.render();
    expect(actual).toBe(expected);
  });

  it('renders the approved phase with a checkmark suffix', () => {
    const tool = new ToolObject('t1', 'client', 'ReadFile');
    tool.resolve('ReadFile(a.ts)');
    tool.approve();
    const expected = 'ReadFile(a.ts) ✅\n';
    const actual = tool.render();
    expect(actual).toBe(expected);
  });
});

/**
 * ToolObject.render() is memoised (a #dirty flag set by every mutator, cleared by render()) because
 * AgentMessageHandler's #redrawTools re-renders every tool in a batch on every single tool's change —
 * and the Anthropic API streams content blocks sequentially, never interleaved, so at any instant at
 * most one tool in a batch is actually changing. Caching is therefore always safe, not just usually
 * safe: an object that isn't the one which just emitted 'change' cannot have mutated concurrently.
 */
describe('ToolObject — render caching', () => {
  it('returns the identical string reference on a second call with no mutation in between', () => {
    const tool = new ToolObject('t1', 'client', 'ReadFile');
    tool.appendInput('{"path":"a.ts"}');
    const first = tool.render();
    const second = tool.render();
    const actual = second === first;
    expect(actual).toBe(true);
  });

  it('recomputes after appendInput, reflecting the newly appended chunk', () => {
    const tool = new ToolObject('t1', 'client', 'ReadFile');
    tool.appendInput('{"path":');
    tool.render();
    tool.appendInput('"a.ts"}');
    const expected = 'ReadFile{"path":"a.ts"}';
    const actual = tool.render();
    expect(actual).toBe(expected);
  });

  it('recomputes after resolve, reflecting the new phase', () => {
    const tool = new ToolObject('t1', 'client', 'ReadFile');
    tool.appendInput('{"path":"a.ts"}');
    tool.render();
    tool.resolve('ReadFile(a.ts)');
    const expected = 'ReadFile(a.ts)\n';
    const actual = tool.render();
    expect(actual).toBe(expected);
  });

  it('recomputes after approve, denying a stale cached render from the pending phase', () => {
    const tool = new ToolObject('t1', 'client', 'ReadFile');
    tool.resolve('ReadFile(a.ts)');
    tool.render();
    tool.approve();
    const expected = 'ReadFile(a.ts) ✅\n';
    const actual = tool.render();
    expect(actual).toBe(expected);
  });

  it('a tool untouched since its last render returns the same cached line across many renders of a batch', () => {
    // Simulates #redrawTools calling render() on every tool in the batch for every delta that
    // arrives on just one of them — the untouched tool's render() must not recompute each time.
    const streaming = new ToolObject('t1', 'client', 'ReadFile');
    const idle = new ToolObject('t2', 'client', 'Grep');
    idle.resolve('Grep(pattern)');
    const idleFirstRender = idle.render();

    for (let i = 0; i < 20; i++) {
      streaming.appendInput('x');
      const idleRenderDuringBatch = idle.render();
      const actual = idleRenderDuringBatch === idleFirstRender;
      expect(actual).toBe(true);
    }
  });
});
