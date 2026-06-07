import { describe, expect, it } from 'vitest';
import type { InputHandler } from '../src/controller/InputHandler.js';
import { PrimaryViewState } from '../src/model/PrimaryViewState.js';
import { PrimaryPresentation } from '../src/view/PrimaryPresentation.js';
import type { View } from '../src/view/View.js';

const stubView: View = { render: () => [] };
const editorChain: readonly InputHandler[] = [{ handleKey: () => false }];
const streamingChain: readonly InputHandler[] = [{ handleKey: () => false }];

describe('PrimaryPresentation — activeChain', () => {
  it('selects the editor chain in editor phase', () => {
    const phase = new PrimaryViewState();
    const presentation = new PrimaryPresentation(stubView, phase, editorChain, streamingChain);
    const expected = editorChain;
    const actual = presentation.activeChain();
    expect(actual).toBe(expected);
  });

  it('selects the streaming chain in streaming phase', () => {
    const phase = new PrimaryViewState();
    phase.setPhase('streaming');
    const presentation = new PrimaryPresentation(stubView, phase, editorChain, streamingChain);
    const expected = streamingChain;
    const actual = presentation.activeChain();
    expect(actual).toBe(expected);
  });
});

describe('PrimaryPresentation — view', () => {
  it('exposes the injected view', () => {
    const phase = new PrimaryViewState();
    const presentation = new PrimaryPresentation(stubView, phase, editorChain, streamingChain);
    const expected = stubView;
    const actual = presentation.view;
    expect(actual).toBe(expected);
  });
});
