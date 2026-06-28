import { Clock } from '@js-joda/core';
import { IClockProvider } from '@shellicar/claude-core/providers/IClockProvider';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import type { PermissionsConfigInput } from '../src/cli-config/formatPermissionsDisplay.js';
import { ConversationState } from '../src/model/ConversationState.js';
import { PermissionsNoticeGate } from '../src/model/PermissionsNoticeGate.js';
import { renderConversation } from '../src/view/renderConversation.js';

// ConversationState injects IClockProvider; build it through a container.
function buildConversationState(): ConversationState {
  const services = createServiceCollection();
  services.register(IClockProvider).to(IClockProvider, () => ({ clock: Clock.systemUTC() }));
  services.register(ConversationState).to(ConversationState);
  return services.buildProvider().resolve(ConversationState);
}

// Strip ANSI escape codes so assertions can match plain text.
function stripAnsi(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI for test assertions
  return s.replace(/\x1b\[[^m]*m/g, '');
}

const BASE_PERMISSIONS = {
  default: { read: 'approve', write: 'approve', delete: 'ask' },
  outside: { read: 'approve', write: 'ask', delete: 'deny' },
} satisfies PermissionsConfigInput;

// Mirrors the entry/main.ts onChange wiring: the gate decides, and the
// conversation state splices a notice only when the gate returns one. Driving
// the test through this seam pins the config-change → rendered-notice path that
// the deleted pure-function test left uncovered.
function applyConfigChange(gate: PermissionsNoticeGate, state: ConversationState, permissions: PermissionsConfigInput): void {
  const notice = gate.update(permissions);
  if (notice != null) {
    state.spliceNotice(notice);
  }
}

function permissionsNoticeRendered(state: ConversationState): boolean {
  const lines = renderConversation(state, 80).map(stripAnsi);
  return lines.some((line) => line.includes('Permissions'));
}

describe('PermissionsNoticeGate — rendered notice', () => {
  it('renders no permissions notice after the initial config load', () => {
    const state = buildConversationState();
    new PermissionsNoticeGate(BASE_PERMISSIONS);

    const expected = false;
    const actual = permissionsNoticeRendered(state);
    expect(actual).toBe(expected);
  });

  it('renders no permissions notice when a config change leaves the permissions unchanged', () => {
    const state = buildConversationState();
    const gate = new PermissionsNoticeGate(BASE_PERMISSIONS);
    applyConfigChange(gate, state, BASE_PERMISSIONS);

    const expected = false;
    const actual = permissionsNoticeRendered(state);
    expect(actual).toBe(expected);
  });

  it('renders the permissions notice when a config change alters the displayed permissions', () => {
    const state = buildConversationState();
    const gate = new PermissionsNoticeGate(BASE_PERMISSIONS);
    const changed = {
      default: { read: 'approve', write: 'deny', delete: 'ask' },
      outside: { read: 'approve', write: 'ask', delete: 'deny' },
    } satisfies PermissionsConfigInput;
    applyConfigChange(gate, state, changed);

    const expected = true;
    const actual = permissionsNoticeRendered(state);
    expect(actual).toBe(expected);
  });
});
