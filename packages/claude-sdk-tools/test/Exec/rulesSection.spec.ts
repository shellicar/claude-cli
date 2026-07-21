import { describe, expect, it } from 'vitest';
import { resolveRulesSection, type RulesSectionState } from '../../src/Exec/rulesSection';

// Defines the contract for isolating tools.rules/tools.blockedCommands from the rest of
// sdkConfigSchema: a bad entry in THIS section must not fall back to a silent default, and must
// not take down validation of anything outside this section. resolveRulesSection is the pure
// boundary that makes that possible — it validates only { rules, blockedCommands } against the
// previous known-good state for the same section, so the caller (readConfig) can keep every other
// field's fresh value while pinning only this section to its last good state on failure.
//
// None of this exists yet — these tests fail until the module is implemented. That failure is the
// point: it pins the target shape before writing the code.

const emptyState: RulesSectionState = { rules: {}, blockedCommands: [] };

describe('resolveRulesSection — valid input', () => {
  it('resolves a well-formed rule', () => {
    const raw = { rules: { 'no-custom': { programs: ['whoami'] } }, blockedCommands: [] };
    const result = resolveRulesSection(raw, emptyState);
    const expected = true;
    expect(result.ok).toBe(expected);
  });

  it('reports changed:true when the resolved state differs from previous', () => {
    const raw = { rules: { 'no-custom': { programs: ['whoami'] } }, blockedCommands: [] };
    const result = resolveRulesSection(raw, emptyState);
    const expected = true;
    expect(result.ok && result.changed).toBe(expected);
  });

  it('reports changed:false when the resolved state is identical to previous', () => {
    const previous: RulesSectionState = { rules: { 'no-custom': { programs: ['whoami'] } }, blockedCommands: [] };
    const raw = { rules: { 'no-custom': { programs: ['whoami'] } }, blockedCommands: [] };
    const result = resolveRulesSection(raw, previous);
    const expected = false;
    expect(result.ok && result.changed).toBe(expected);
  });

  it('missing rules/blockedCommands defaults to empty, not an error', () => {
    const result = resolveRulesSection({}, emptyState);
    const expected = true;
    expect(result.ok).toBe(expected);
  });
});

describe('resolveRulesSection — a rule with no matcher fields is rejected, not silently accepted', () => {
  it('fails rather than resolving a rule that would match every command', () => {
    const raw = { rules: { 'no-fooling': { message: 'oops' } }, blockedCommands: [] };
    const result = resolveRulesSection(raw, emptyState);
    const expected = false;
    expect(result.ok).toBe(expected);
  });

  it('keeps the previous state on failure, unmodified', () => {
    const previous: RulesSectionState = { rules: { 'no-sudo-override': { programs: ['sudo'] } }, blockedCommands: [] };
    const raw = { rules: { 'no-fooling': { message: 'oops' } }, blockedCommands: [] };
    const result = resolveRulesSection(raw, previous);
    const expected = previous;
    expect(result.state).toEqual(expected);
  });
});

describe('resolveRulesSection — one bad entry fails the whole section atomically', () => {
  it('does not partially apply the good rules alongside the bad one', () => {
    const previous: RulesSectionState = { rules: {}, blockedCommands: [] };
    const raw = {
      rules: {
        'good-rule': { programs: ['whoami'] },
        'bad-rule': { message: 'no matcher at all' },
      },
      blockedCommands: [],
    };
    const result = resolveRulesSection(raw, previous);
    const expected = false;
    expect(result.ok).toBe(expected);
  });
});

describe('resolveRulesSection — a typo\'d matcher key is rejected, not silently stripped', () => {
  it('fails when "programs" is misspelled as "program"', () => {
    const raw = { rules: { 'no-sudo-2': { program: 'sudo' } }, blockedCommands: [] };
    const result = resolveRulesSection(raw, emptyState);
    const expected = false;
    expect(result.ok).toBe(expected);
  });
});
