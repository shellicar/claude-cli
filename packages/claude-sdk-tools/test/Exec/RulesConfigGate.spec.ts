import { describe, expect, it } from 'vitest';
import { RulesConfigGate } from '../../src/Exec/RulesConfigGate';

// RulesConfigGate reuses resolveRulesSection for both its constructor and update() — the same
// validation logic, two different failure policies:
//   - construction (initial config at boot): fail fast, throw with a useful message. A bad
//     initial config must stop the CLI from starting, not silently run with defaults.
//   - update() (a live reload): never throw. One bad edit to one machine's config file must not be
//     able to take down anything depending on this gate staying alive. It reports what happened
//     via its return value instead — showing that is the caller/UI's job, not this class's.
//
// Fails until the module exists — pins the contract first.

const validRaw = { rules: { 'no-custom': { programs: ['whoami'] } }, blockedCommands: [] };
const invalidRaw = { rules: { 'no-fooling': { message: 'no matcher at all' } }, blockedCommands: [] };
const otherValidRaw = { rules: { 'no-other': { programs: ['whoami2'] } }, blockedCommands: [] };

describe('RulesConfigGate — construction', () => {
  it('accepts a valid initial config', () => {
    const gate = new RulesConfigGate(validRaw);
    const expected = { rules: { 'no-custom': { programs: ['whoami'] } }, blockedCommands: [] };
    expect(gate.state).toEqual(expected);
  });

  it('throws on an invalid initial config, rather than starting on a silent default', () => {
    const actual = () => new RulesConfigGate(invalidRaw);
    expect(actual).toThrow();
  });

  it('the thrown error names what was wrong, not a generic failure', () => {
    const actual = () => new RulesConfigGate(invalidRaw);
    expect(actual).toThrow(/no-fooling/);
  });
});

describe('RulesConfigGate — update() never throws', () => {
  it('reports an invalid update instead of throwing', () => {
    const gate = new RulesConfigGate(validRaw);
    const actual = () => gate.update(invalidRaw);
    expect(actual).not.toThrow();
  });

  it('an invalid update returns an "invalid" notice', () => {
    const gate = new RulesConfigGate(validRaw);
    const notice = gate.update(invalidRaw);
    const expected = 'invalid';
    expect(notice?.kind).toBe(expected);
  });

  it('an invalid update keeps the previous state in effect', () => {
    const gate = new RulesConfigGate(validRaw);
    gate.update(invalidRaw);
    const expected = { rules: { 'no-custom': { programs: ['whoami'] } }, blockedCommands: [] };
    expect(gate.state).toEqual(expected);
  });

  it('a repeated identical failure while already degraded does not notify again', () => {
    const gate = new RulesConfigGate(validRaw);
    gate.update(invalidRaw);
    const notice = gate.update(invalidRaw);
    const expected = null;
    expect(notice).toBe(expected);
  });

  it('a fix back to the exact pre-break value still notifies as recovered', () => {
    const gate = new RulesConfigGate(validRaw);
    gate.update(invalidRaw);
    const notice = gate.update(validRaw);
    const expected = 'recovered';
    expect(notice?.kind).toBe(expected);
  });

  it('recovering applies the newly valid state', () => {
    const gate = new RulesConfigGate(validRaw);
    gate.update(invalidRaw);
    gate.update(otherValidRaw);
    const expected = { rules: { 'no-other': { programs: ['whoami2'] } }, blockedCommands: [] };
    expect(gate.state).toEqual(expected);
  });

  it('a valid update that differs from the current state notifies as changed', () => {
    const gate = new RulesConfigGate(validRaw);
    const notice = gate.update(otherValidRaw);
    const expected = 'changed';
    expect(notice?.kind).toBe(expected);
  });

  it('a valid update identical to the current state does not notify', () => {
    const gate = new RulesConfigGate(validRaw);
    const notice = gate.update(validRaw);
    const expected = null;
    expect(notice).toBe(expected);
  });
});
