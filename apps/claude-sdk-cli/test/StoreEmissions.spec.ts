import type { SdkMessageUsage } from '@shellicar/claude-sdk';
import { describe, expect, it } from 'vitest';
import { CommandModeState } from '../src/model/CommandModeState.js';
import { ConversationState } from '../src/model/ConversationState.js';
import { EditorState } from '../src/model/EditorState.js';
import { StatusState } from '../src/model/StatusState.js';
import { ToolApprovalState } from '../src/model/ToolApprovalState.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';

type ChangeEmitter = { on(event: 'change', listener: () => void): void };

/** Counts change emissions produced by `act`, subscribing after any preconditions are set up. */
function emissions(state: ChangeEmitter, act: () => void): number {
  let count = 0;
  state.on('change', () => count++);
  act();
  return count;
}

const usage: SdkMessageUsage = { inputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 1, costUsd: 0, contextWindow: 100 } as SdkMessageUsage;

describe('ConversationState emissions', () => {
  it('emits on addBlocks', () => {
    const state = new ConversationState();
    const expected = 1;
    const actual = emissions(state, () => state.addBlocks([{ type: 'meta', content: 'x' }]));
    expect(actual).toBe(expected);
  });

  it('emits on transitionBlock', () => {
    const state = new ConversationState();
    const expected = 1;
    const actual = emissions(state, () => state.transitionBlock('response'));
    expect(actual).toBe(expected);
  });

  it('does not emit on a no-op transitionBlock', () => {
    const state = new ConversationState();
    state.transitionBlock('response');
    const expected = 0;
    const actual = emissions(state, () => state.transitionBlock('response'));
    expect(actual).toBe(expected);
  });

  it('emits on appendToActive', () => {
    const state = new ConversationState();
    state.transitionBlock('response');
    const expected = 1;
    const actual = emissions(state, () => state.appendToActive('x'));
    expect(actual).toBe(expected);
  });

  it('emits on appendStreaming', () => {
    const state = new ConversationState();
    state.transitionBlock('response');
    const expected = 1;
    const actual = emissions(state, () => state.appendStreaming('x'));
    expect(actual).toBe(expected);
  });

  it('emits on completeActive', () => {
    const state = new ConversationState();
    const expected = 1;
    const actual = emissions(state, () => state.completeActive());
    expect(actual).toBe(expected);
  });

  it('emits on appendToLastSealed when a matching block exists', () => {
    const state = new ConversationState();
    state.transitionBlock('tools');
    const expected = 1;
    const actual = emissions(state, () => state.appendToLastSealed('tools', 'x'));
    expect(actual).toBe(expected);
  });

  it('emits on clear', () => {
    const state = new ConversationState();
    const expected = 1;
    const actual = emissions(state, () => state.clear());
    expect(actual).toBe(expected);
  });

  it('does not emit on advanceFlushedCount', () => {
    const state = new ConversationState();
    const expected = 0;
    const actual = emissions(state, () => state.advanceFlushedCount(0));
    expect(actual).toBe(expected);
  });
});

describe('EditorState emissions', () => {
  it('emits on a consumed handleKey', () => {
    const state = new EditorState();
    const expected = 1;
    const actual = emissions(state, () => state.handleKey({ type: 'char', value: 'a' }));
    expect(actual).toBe(expected);
  });

  it('does not emit on an unconsumed handleKey', () => {
    const state = new EditorState();
    const expected = 0;
    const actual = emissions(state, () => state.handleKey({ type: 'page_up' }));
    expect(actual).toBe(expected);
  });

  it('emits on reset', () => {
    const state = new EditorState();
    const expected = 1;
    const actual = emissions(state, () => state.reset());
    expect(actual).toBe(expected);
  });

  it('emits on moveUpVisual', () => {
    const state = new EditorState();
    const expected = 1;
    const actual = emissions(state, () => state.moveUpVisual(80, 3));
    expect(actual).toBe(expected);
  });

  it('emits on moveDownVisual', () => {
    const state = new EditorState();
    const expected = 1;
    const actual = emissions(state, () => state.moveDownVisual(80, 3));
    expect(actual).toBe(expected);
  });
});

describe('ToolApprovalState emissions', () => {
  it('emits on addTool', () => {
    const state = new ToolApprovalState();
    const expected = 1;
    const actual = emissions(state, () => state.addTool({ requestId: 'r1', name: 'x', input: {} }));
    expect(actual).toBe(expected);
  });

  it('emits on removeTool', () => {
    const state = new ToolApprovalState();
    state.addTool({ requestId: 'r1', name: 'x', input: {} });
    const expected = 1;
    const actual = emissions(state, () => state.removeTool('r1'));
    expect(actual).toBe(expected);
  });

  it('emits on clearTools', () => {
    const state = new ToolApprovalState();
    const expected = 1;
    const actual = emissions(state, () => state.clearTools());
    expect(actual).toBe(expected);
  });

  it('emits on requestApproval', () => {
    const state = new ToolApprovalState();
    const expected = 1;
    const actual = emissions(state, () => {
      void state.requestApproval();
    });
    expect(actual).toBe(expected);
  });

  it('emits on resolveNextApproval', () => {
    const state = new ToolApprovalState();
    void state.requestApproval();
    const expected = 1;
    const actual = emissions(state, () => state.resolveNextApproval(true));
    expect(actual).toBe(expected);
  });

  it('emits on toggleFlash', () => {
    const state = new ToolApprovalState();
    const expected = 1;
    const actual = emissions(state, () => state.toggleFlash());
    expect(actual).toBe(expected);
  });

  it('emits on toggleExpanded', () => {
    const state = new ToolApprovalState();
    const expected = 1;
    const actual = emissions(state, () => state.toggleExpanded());
    expect(actual).toBe(expected);
  });

  it('emits on selectPrev', () => {
    const state = new ToolApprovalState();
    const expected = 1;
    const actual = emissions(state, () => state.selectPrev());
    expect(actual).toBe(expected);
  });

  it('emits on selectNext', () => {
    const state = new ToolApprovalState();
    const expected = 1;
    const actual = emissions(state, () => state.selectNext());
    expect(actual).toBe(expected);
  });

  it('emits on resetExpanded', () => {
    const state = new ToolApprovalState();
    const expected = 1;
    const actual = emissions(state, () => state.resetExpanded());
    expect(actual).toBe(expected);
  });
});

describe('CommandModeState emissions', () => {
  it('emits on toggleCommandMode', () => {
    const state = new CommandModeState();
    const expected = 1;
    const actual = emissions(state, () => state.toggleCommandMode());
    expect(actual).toBe(expected);
  });

  it('emits on exitCommandMode', () => {
    const state = new CommandModeState();
    const expected = 1;
    const actual = emissions(state, () => state.exitCommandMode());
    expect(actual).toBe(expected);
  });

  it('emits on togglePreview', () => {
    const state = new CommandModeState();
    const expected = 1;
    const actual = emissions(state, () => state.togglePreview());
    expect(actual).toBe(expected);
  });

  it('emits on addText', () => {
    const state = new CommandModeState();
    const expected = 1;
    const actual = emissions(state, () => state.addText('hello'));
    expect(actual).toBe(expected);
  });

  it('emits on addFile', () => {
    const state = new CommandModeState();
    const expected = 1;
    const actual = emissions(state, () => state.addFile('/x', 'file', 1));
    expect(actual).toBe(expected);
  });

  it('emits on addImage', () => {
    const state = new CommandModeState();
    const expected = 1;
    const actual = emissions(state, () => state.addImage(Buffer.from([0x01]), 'image/png'));
    expect(actual).toBe(expected);
  });

  it('emits on removeSelected', () => {
    const state = new CommandModeState();
    const expected = 1;
    const actual = emissions(state, () => state.removeSelected());
    expect(actual).toBe(expected);
  });

  it('emits on selectLeft', () => {
    const state = new CommandModeState();
    const expected = 1;
    const actual = emissions(state, () => state.selectLeft());
    expect(actual).toBe(expected);
  });

  it('emits on selectRight', () => {
    const state = new CommandModeState();
    const expected = 1;
    const actual = emissions(state, () => state.selectRight());
    expect(actual).toBe(expected);
  });

  it('emits on reset', () => {
    const state = new CommandModeState();
    let count = 0;
    state.on('change', () => count++);
    state.reset();
    const expected = true;
    const actual = count >= 1;
    expect(actual).toBe(expected);
  });

  it('emits on takeAttachments', () => {
    const state = new CommandModeState();
    const expected = 1;
    const actual = emissions(state, () => state.takeAttachments());
    expect(actual).toBe(expected);
  });
});

describe('StatusState emissions', () => {
  const fs = () => new MemoryFileSystem({}, '/home/user', '/test');

  it('emits on setModel', () => {
    const state = new StatusState(fs());
    const expected = 1;
    const actual = emissions(state, () => state.setModel('claude-x'));
    expect(actual).toBe(expected);
  });

  it('emits on setSessionName', () => {
    const state = new StatusState(fs());
    const expected = 1;
    const actual = emissions(state, () => state.setSessionName('s'));
    expect(actual).toBe(expected);
  });

  it('emits on setShowConversationId', () => {
    const state = new StatusState(fs());
    const expected = 1;
    const actual = emissions(state, () => state.setShowConversationId(true));
    expect(actual).toBe(expected);
  });

  it('emits on update', () => {
    const state = new StatusState(fs());
    const expected = 1;
    const actual = emissions(state, () => state.update(usage));
    expect(actual).toBe(expected);
  });
});
