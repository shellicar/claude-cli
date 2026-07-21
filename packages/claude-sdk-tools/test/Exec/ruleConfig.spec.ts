import { describe, expect, it } from 'vitest';
import { buildExecRules, resolveRules, ruleConfigMatches } from '../../src/Exec/ruleConfig';

// ruleConfig unit tests — pure logic, no spawn, no real fs. One describe per behaviour,
// one assertion per it, expected/actual variables.

describe('ruleConfigMatches — programs', () => {
  it('matches when the program is in the set', () => {
    const expected = true;
    const actual = ruleConfigMatches({ program: 'sudo', args: [] }, { programs: ['sudo'] });
    expect(actual).toBe(expected);
  });

  it('does not match when the program is not in the set', () => {
    const expected = false;
    const actual = ruleConfigMatches({ program: 'echo', args: [] }, { programs: ['sudo'] });
    expect(actual).toBe(expected);
  });

  it('matches an absolute path by its basename', () => {
    const expected = true;
    const actual = ruleConfigMatches({ program: '/usr/bin/sudo', args: [] }, { programs: ['sudo'] });
    expect(actual).toBe(expected);
  });

  it('matches a relative path by its basename', () => {
    const expected = true;
    const actual = ruleConfigMatches({ program: './sudo', args: [] }, { programs: ['sudo'] });
    expect(actual).toBe(expected);
  });
});

describe('ruleConfigMatches — programSuffix', () => {
  it('matches a program ending with the suffix', () => {
    const expected = true;
    const actual = ruleConfigMatches({ program: 'whatever.exe', args: [] }, { programSuffix: '.exe' });
    expect(actual).toBe(expected);
  });

  it('matches the suffix against the basename, not the full path', () => {
    const expected = true;
    const actual = ruleConfigMatches({ program: 'C:\\tools\\whatever.exe', args: [] }, { programSuffix: '.exe' });
    expect(actual).toBe(expected);
  });

  it('does not match a program without the suffix', () => {
    const expected = false;
    const actual = ruleConfigMatches({ program: 'whatever', args: [] }, { programSuffix: '.exe' });
    expect(actual).toBe(expected);
  });
});

describe('ruleConfigMatches — argsAllOf with "=" attached values', () => {
  it('matches "--force-with-lease=main:abc" against argsAllOf ["--force-with-lease"]', () => {
    const expected = true;
    const actual = ruleConfigMatches({ program: 'git', args: ['push', '--force-with-lease=main:abc'] }, { argsAllOf: ['--force-with-lease'] });
    expect(actual).toBe(expected);
  });

  it('does not match the attached value itself', () => {
    const expected = false;
    const actual = ruleConfigMatches({ program: 'git', args: ['push', '--force-with-lease=main:abc'] }, { argsAllOf: ['main:abc'] });
    expect(actual).toBe(expected);
  });
});

describe('ruleConfigMatches — bundled short flags', () => {
  it('matches "-ni" against argsAnyOf ["-i"] (bundled expands to -n, -i)', () => {
    const expected = true;
    const actual = ruleConfigMatches({ program: 'sed', args: ['-ni', 'p'] }, { argsAnyOf: ['-i'] });
    expect(actual).toBe(expected);
  });

  it('matches "-ni" against argsAnyOf ["-n"] (bundled expands to -n, -i)', () => {
    const expected = true;
    const actual = ruleConfigMatches({ program: 'sed', args: ['-ni', 'p'] }, { argsAnyOf: ['-n'] });
    expect(actual).toBe(expected);
  });

  it('does not treat a long "--" flag as bundled short flags', () => {
    const expected = false;
    const actual = ruleConfigMatches({ program: 'git', args: ['--in-place'] }, { argsAnyOf: ['-i'] });
    expect(actual).toBe(expected);
  });
});

describe('ruleConfigMatches — argsAllOf requires every flag', () => {
  it('does not match when only one of two required flags is present', () => {
    const expected = false;
    const actual = ruleConfigMatches({ program: 'git', args: ['push'] }, { argsAllOf: ['push', '--force'] });
    expect(actual).toBe(expected);
  });

  it('matches when every required flag is present, in any order', () => {
    const expected = true;
    const actual = ruleConfigMatches({ program: 'git', args: ['--force', 'push'] }, { argsAllOf: ['push', '--force'] });
    expect(actual).toBe(expected);
  });
});

describe('ruleConfigMatches — argsAnyOf requires at least one flag', () => {
  it('does not match when none of the flags are present', () => {
    const expected = false;
    const actual = ruleConfigMatches({ program: 'git', args: ['push'] }, { argsAnyOf: ['-f', '--force'] });
    expect(actual).toBe(expected);
  });

  it('matches when one of several flags is present', () => {
    const expected = true;
    const actual = ruleConfigMatches({ program: 'git', args: ['push', '-f'] }, { argsAnyOf: ['-f', '--force'] });
    expect(actual).toBe(expected);
  });
});

describe('ruleConfigMatches — combined argsAllOf and argsAnyOf (force-push shape)', () => {
  it('requires the subcommand and one of the force flags together', () => {
    const rule = { argsAllOf: ['push'], argsAnyOf: ['-f', '--force'] };
    const expected = false;
    const actual = ruleConfigMatches({ program: 'git', args: ['push'] }, rule);
    expect(actual).toBe(expected);
  });

  it('matches once both the subcommand and a force flag are present', () => {
    const rule = { argsAllOf: ['push'], argsAnyOf: ['-f', '--force'] };
    const expected = true;
    const actual = ruleConfigMatches({ program: 'git', args: ['push', '--force'] }, rule);
    expect(actual).toBe(expected);
  });
});

describe('ruleConfigMatches — maxArgs', () => {
  it('matches when args length is at or below the ceiling', () => {
    const expected = true;
    const actual = ruleConfigMatches({ program: 'env', args: [] }, { maxArgs: 0 });
    expect(actual).toBe(expected);
  });

  it('does not match when args exceed the ceiling', () => {
    const expected = false;
    const actual = ruleConfigMatches({ program: 'env', args: ['FOO'] }, { maxArgs: 0 });
    expect(actual).toBe(expected);
  });
});

describe('ruleConfigMatches — a rule with no matcher fields', () => {
  it('does not match every command (a rule must name at least one condition)', () => {
    const expected = false;
    const actual = ruleConfigMatches({ program: 'ls', args: [] }, { message: 'oops, forgot to set programs' });
    expect(actual).toBe(expected);
  });

  it('does not match even an empty rule object', () => {
    const expected = false;
    const actual = ruleConfigMatches({ program: 'anything', args: ['at', 'all'] }, {});
    expect(actual).toBe(expected);
  });
});

describe('resolveRules — a key names a built-in: replaces it wholesale', () => {
  it('replaces the whole rule, not a shallow merge of fields', () => {
    const defaults = { 'no-sudo': { programs: ['sudo'], message: 'original' } };
    const overrides = { 'no-sudo': { message: 'replaced' } };
    const expected = { 'no-sudo': { message: 'replaced' } };
    const actual = resolveRules(defaults, overrides);
    expect(actual).toEqual(expected);
  });
});

describe('resolveRules — a key set to null removes that rule', () => {
  it('drops the rule entirely', () => {
    const defaults = { 'no-sudo': { programs: ['sudo'] } };
    const overrides = { 'no-sudo': null };
    const expected = {};
    const actual = resolveRules(defaults, overrides);
    expect(actual).toEqual(expected);
  });
});

describe('resolveRules — an unmentioned key is untouched', () => {
  it('leaves a default rule as-is when overrides never names it', () => {
    const defaults = { 'no-sudo': { programs: ['sudo'] } };
    const overrides = {};
    const expected = { 'no-sudo': { programs: ['sudo'] } };
    const actual = resolveRules(defaults, overrides);
    expect(actual).toEqual(expected);
  });
});

describe('resolveRules — a key not present in defaults adds a new rule', () => {
  it('adds the rule under that name', () => {
    const defaults = { 'no-sudo': { programs: ['sudo'] } };
    const overrides = { 'no-custom': { programs: ['whoami'] } };
    const expected = 2;
    const actual = Object.keys(resolveRules(defaults, overrides)).length;
    expect(actual).toBe(expected);
  });
});

describe('buildExecRules — message templating', () => {
  it("replaces {program} with the matched command's program string", () => {
    const rules = { 'no-exe': { programSuffix: '.exe', message: "'{program}' is blocked" } };
    const [rule] = buildExecRules(rules);
    const expected = "'whatever.exe' is blocked";
    const actual = rule?.check([{ program: 'whatever.exe', args: [], merge_stderr: false }]);
    expect(actual).toBe(expected);
  });
});

describe('buildExecRules — the ExecRule name comes from the map key', () => {
  it('names the compiled rule after its key', () => {
    const rules = { 'no-whoami': { programs: ['whoami'] } };
    const [rule] = buildExecRules(rules);
    const expected = 'no-whoami';
    const actual = rule?.name;
    expect(actual).toBe(expected);
  });
});
