import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { annotatePathDescriptions, collectPaths, IS_PATH, normalisePaths, pathSchema, TOOL_INPUT_KEYED_BY } from '../src/public/pathSchema';

// A stand-in for expandPath: turns a leading ~ into a home directory.
const expand = (p: string): string => (p.startsWith('~/') ? p.replace('~', '/home/me') : p);

describe('pathSchema — the marker', () => {
  it('marks a field as a path in its meta', () => {
    const expected = true;
    const actual = (pathSchema.meta() as Record<string, unknown>)[IS_PATH] === true;
    expect(actual).toBe(expected);
  });

  it('keeps the marker when a description is layered on (.meta merges)', () => {
    const schema = pathSchema.describe('a file');
    const expected = true;
    const actual = (schema.meta() as Record<string, unknown>)[IS_PATH] === true;
    expect(actual).toBe(expected);
  });

  it('keeps the description alongside the marker', () => {
    const schema = pathSchema.describe('a file');
    const expected = 'a file';
    const actual = (schema.meta() as Record<string, unknown>).description;
    expect(actual).toBe(expected);
  });
});

describe('collectPaths — locates marked values', () => {
  it('finds a scalar marked path', () => {
    const schema = z.object({ path: pathSchema });
    const expected = ['~/a'];
    const actual = collectPaths(schema, { path: '~/a' });
    expect(actual).toEqual(expected);
  });

  it('finds marked array elements', () => {
    const schema = z.object({ paths: z.array(pathSchema) });
    const expected = ['~/a', '~/b'];
    const actual = collectPaths(schema, { paths: ['~/a', '~/b'] });
    expect(actual).toEqual(expected);
  });

  it('finds a marked field through optional', () => {
    const schema = z.object({ cwd: pathSchema.optional() });
    const expected = ['~/x'];
    const actual = collectPaths(schema, { cwd: '~/x' });
    expect(actual).toEqual(expected);
  });

  it('finds a marked field nested in an object', () => {
    const schema = z.object({ redirect: z.object({ path: pathSchema }).optional() });
    const expected = ['~/out'];
    const actual = collectPaths(schema, { redirect: { path: '~/out' } });
    expect(actual).toEqual(expected);
  });

  it('walks a union branch (the recursive Exec pipeline shape)', () => {
    const command = z.object({ cwd: pathSchema.optional() });
    const schema = z.union([command, z.object({ op: z.string() })]);
    const expected = ['~/w'];
    const actual = collectPaths(schema, { cwd: '~/w' });
    expect(actual).toEqual(expected);
  });

  it('returns nothing for an unmarked field', () => {
    const schema = z.object({ program: z.string() });
    const expected: string[] = [];
    const actual = collectPaths(schema, { program: 'git' });
    expect(actual).toEqual(expected);
  });
});

describe('normalisePaths — replaces the marked values in place', () => {
  it('replaces a scalar path in place', () => {
    const schema = z.object({ path: pathSchema });
    const input = { path: '~/a' };
    normalisePaths(schema, input, expand);
    const expected = '/home/me/a';
    const actual = input.path;
    expect(actual).toBe(expected);
  });

  it('replaces array elements in place', () => {
    const schema = z.object({ paths: z.array(pathSchema) });
    const input = { paths: ['~/a', '~/b'] };
    normalisePaths(schema, input, expand);
    const expected = ['/home/me/a', '/home/me/b'];
    const actual = input.paths;
    expect(actual).toEqual(expected);
  });

  it('leaves an unmarked field untouched while replacing the marked one', () => {
    const schema = z.object({ program: z.string(), cwd: pathSchema.optional() });
    const input = { program: '~/git', cwd: '~/w' };
    normalisePaths(schema, input, expand);
    const expected = { program: '~/git', cwd: '/home/me/w' };
    const actual = input;
    expect(actual).toEqual(expected);
  });
});

describe('annotatePathDescriptions — tells the model a path is normalised', () => {
  const NOTE = 'Normalised before use.';

  it('appends the note to an existing description on a marked scalar', () => {
    const json = z.toJSONSchema(z.object({ file: pathSchema.describe('The file.') }), { target: 'draft-07', io: 'input' });
    annotatePathDescriptions(json, NOTE);
    const expected = 'The file. Normalised before use.';
    const actual = (json.properties as Record<string, { description: string }>).file.description;
    expect(actual).toBe(expected);
  });

  it('sets the note as the description on a marked array item that had none', () => {
    const json = z.toJSONSchema(z.object({ paths: z.array(pathSchema) }), { target: 'draft-07', io: 'input' });
    annotatePathDescriptions(json, NOTE);
    const expected = NOTE;
    const actual = (json.properties as Record<string, { items: { description: string } }>).paths.items.description;
    expect(actual).toBe(expected);
  });

  it('reaches a marked field inside a $ref definition (the recursive Exec shape)', () => {
    const leaf = z.object({ cwd: pathSchema });
    const pipe = z.object({
      get left() {
        return z.union([leaf, pipe]);
      },
      right: leaf,
    });
    const json = z.toJSONSchema(z.union([leaf, pipe]), { target: 'draft-07', io: 'input' });
    annotatePathDescriptions(json, NOTE);
    const defs = json.definitions as Record<string, { properties: { right: { properties: { cwd: { description: string } } } } }>;
    const expected = NOTE;
    const actual = defs.__schema0.properties.right.properties.cwd.description;
    expect(actual).toBe(expected);
  });

  it('leaves an unmarked field without a description', () => {
    const json = z.toJSONSchema(z.object({ program: z.string() }), { target: 'draft-07', io: 'input' });
    annotatePathDescriptions(json, NOTE);
    const expected = undefined;
    const actual = (json.properties as Record<string, { description?: string }>).program.description;
    expect(actual).toBe(expected);
  });
});

describe('normalisePaths — nested tool input (the Pipe step descent)', () => {
  const findSchema = z.object({ path: pathSchema });
  const resolve = (name: string): z.ZodType | undefined => (name === 'Find' ? findSchema : undefined);
  const stepSchema = z.object({ tool: z.string(), input: z.record(z.string(), z.unknown()).meta({ [TOOL_INPUT_KEYED_BY]: 'tool' }) });
  const pipeSchema = z.object({ steps: z.array(stepSchema) });

  it('descends into a step input via its sibling tool name and replaces the path', () => {
    const input = { steps: [{ tool: 'Find', input: { path: '~/dir' } as Record<string, unknown> }] };
    normalisePaths(pipeSchema, input, expand, resolve);
    const expected = '/home/me/dir';
    const actual = input.steps[0].input.path;
    expect(actual).toBe(expected);
  });

  it('leaves a step input untouched when the tool has no resolvable schema', () => {
    const input = { steps: [{ tool: 'Unknown', input: { path: '~/dir' } as Record<string, unknown> }] };
    normalisePaths(pipeSchema, input, expand, resolve);
    const expected = '~/dir';
    const actual = input.steps[0].input.path;
    expect(actual).toBe(expected);
  });

  it('does not reach the nested path without a resolver (the opaque record stops the walk)', () => {
    const input = { steps: [{ tool: 'Find', input: { path: '~/dir' } }] };
    const expected: string[] = [];
    const actual = collectPaths(pipeSchema, input);
    expect(actual).toEqual(expected);
  });
});
