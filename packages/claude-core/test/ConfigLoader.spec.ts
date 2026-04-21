import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConfigLoader } from '../src/Config/ConfigLoader';
import { MemoryConfigFileReader } from './MemoryConfigFileReader';
import { MemoryConfigWatcher } from './MemoryConfigWatcher';
import { MemoryFileSystem } from './MemoryFileSystem';

const HOME = '/home.json';
const LOCAL = '/local.json';

// ---------------------------------------------------------------------------
// load — single source
// ---------------------------------------------------------------------------

describe('ConfigLoader — single source', () => {
  it('loads config from a single source file', () => {
    const schema = z.object({ foo: z.string().default('default') });
    const reader = new MemoryConfigFileReader({ [HOME]: '{"foo":"value"}' });
    const loader = new ConfigLoader({ schema, paths: [HOME], reader, fs: new MemoryFileSystem() });
    loader.load();

    const expected = 'value';
    const actual = loader.config.foo;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// load — merge semantics
// ---------------------------------------------------------------------------

describe('ConfigLoader — merge', () => {
  it('merges two sources with local overriding home', () => {
    const schema = z.object({ foo: z.string().default('default') });
    const reader = new MemoryConfigFileReader({
      [HOME]: '{"foo":"home"}',
      [LOCAL]: '{"foo":"local"}',
    });
    const loader = new ConfigLoader({ schema, paths: [HOME, LOCAL], reader, fs: new MemoryFileSystem() });
    loader.load();

    const expected = 'local';
    const actual = loader.config.foo;
    expect(actual).toBe(expected);
  });

  it('deletes a home field when local sets it to null', () => {
    const schema = z.object({ foo: z.string().default('default') });
    const reader = new MemoryConfigFileReader({
      [HOME]: '{"foo":"home-value"}',
      [LOCAL]: '{"foo":null}',
    });
    const loader = new ConfigLoader({ schema, paths: [HOME, LOCAL], reader, fs: new MemoryFileSystem() });
    loader.load();

    const expected = 'default';
    const actual = loader.config.foo;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// sources — origin tracking
// ---------------------------------------------------------------------------

describe('ConfigLoader — sources', () => {
  it('exposes each source path with its raw content', () => {
    const schema = z.object({ foo: z.string().default('default') });
    const reader = new MemoryConfigFileReader({
      [HOME]: '{"foo":"home"}',
      [LOCAL]: '{"foo":"local"}',
    });
    const loader = new ConfigLoader({ schema, paths: [HOME, LOCAL], reader, fs: new MemoryFileSystem() });
    loader.load();

    const expected = [
      { path: HOME, raw: { foo: 'home' } },
      { path: LOCAL, raw: { foo: 'local' } },
    ];
    const actual = loader.sources.map((s) => ({ path: s.path, raw: s.raw }));
    expect(actual).toEqual(expected);
  });

  it('identifies home as the source of an unoverridden field', () => {
    const schema = z.object({ foo: z.string().default('x'), bar: z.string().default('y') });
    const reader = new MemoryConfigFileReader({
      [HOME]: '{"foo":"home","bar":"home"}',
      [LOCAL]: '{"bar":"local"}',
    });
    const loader = new ConfigLoader({ schema, paths: [HOME, LOCAL], reader, fs: new MemoryFileSystem() });
    loader.load();

    const findSource = (key: string): string | null => {
      for (let i = loader.sources.length - 1; i >= 0; i--) {
        const src = loader.sources[i];
        if (src !== undefined && key in src.raw) {
          return src.path;
        }
      }
      return null;
    };

    const expected = HOME;
    const actual = findSource('foo');
    expect(actual).toBe(expected);
  });

  it('identifies local as the source of an overridden field', () => {
    const schema = z.object({ foo: z.string().default('x'), bar: z.string().default('y') });
    const reader = new MemoryConfigFileReader({
      [HOME]: '{"foo":"home","bar":"home"}',
      [LOCAL]: '{"bar":"local"}',
    });
    const loader = new ConfigLoader({ schema, paths: [HOME, LOCAL], reader, fs: new MemoryFileSystem() });
    loader.load();

    const findSource = (key: string): string | null => {
      for (let i = loader.sources.length - 1; i >= 0; i--) {
        const src = loader.sources[i];
        if (src !== undefined && key in src.raw) {
          return src.path;
        }
      }
      return null;
    };

    const expected = LOCAL;
    const actual = findSource('bar');
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// schema validation
// ---------------------------------------------------------------------------

describe('ConfigLoader — schema validation', () => {
  it('runs schema validation on the merged result', () => {
    const schema = z.object({ count: z.number().int().default(0) });
    const reader = new MemoryConfigFileReader({ [HOME]: '{"count":42}' });
    const loader = new ConfigLoader({ schema, paths: [HOME], reader, fs: new MemoryFileSystem() });
    loader.load();

    const expected = 42;
    const actual = loader.config.count;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// watching
// ---------------------------------------------------------------------------

describe('ConfigLoader — watching', () => {
  it('emits a change event when a watched file changes', () => {
    const schema = z.object({ foo: z.string().default('default') });
    const reader = new MemoryConfigFileReader({ [HOME]: '{"foo":"before"}' });
    const watcher = new MemoryConfigWatcher();
    const loader = new ConfigLoader({ schema, paths: [HOME], reader, watcher, fs: new MemoryFileSystem(), debounceMs: 0 });
    loader.load();

    let changed = false;
    loader.onChange(() => {
      changed = true;
    });
    loader.start();

    reader.set(HOME, '{"foo":"after"}');
    watcher.trigger(HOME);

    const expected = true;
    const actual = changed;
    expect(actual).toBe(expected);
  });

  it('does not emit when parsed config is unchanged after a file change', () => {
    const schema = z.object({ foo: z.string().default('default') });
    const reader = new MemoryConfigFileReader({ [HOME]: '{"foo":"same"}' });
    const watcher = new MemoryConfigWatcher();
    const loader = new ConfigLoader({ schema, paths: [HOME], reader, watcher, fs: new MemoryFileSystem(), debounceMs: 0 });
    loader.load();

    let callCount = 0;
    loader.onChange(() => {
      callCount++;
    });
    loader.start();

    // Rewrite with semantically identical content (different whitespace).
    reader.set(HOME, '{ "foo": "same" }');
    watcher.trigger(HOME);

    const expected = 0;
    const actual = callCount;
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// error handling
// ---------------------------------------------------------------------------

describe('ConfigLoader — error handling', () => {
  it('falls back to schema defaults when no source files exist', () => {
    const schema = z.object({ foo: z.string().default('default') });
    const reader = new MemoryConfigFileReader({});
    const loader = new ConfigLoader({ schema, paths: [HOME, LOCAL], reader, fs: new MemoryFileSystem() });
    loader.load();

    const expected = 'default';
    const actual = loader.config.foo;
    expect(actual).toBe(expected);
  });

  it('keeps the previous config when a reload encounters invalid JSON', () => {
    const schema = z.object({ foo: z.string().default('default') });
    const reader = new MemoryConfigFileReader({ [HOME]: '{"foo":"valid"}' });
    const watcher = new MemoryConfigWatcher();
    const loader = new ConfigLoader({ schema, paths: [HOME], reader, watcher, fs: new MemoryFileSystem(), debounceMs: 0 });
    loader.load();

    reader.set(HOME, 'not json');
    watcher.trigger(HOME);

    const expected = 'valid';
    const actual = loader.config.foo;
    expect(actual).toBe(expected);
  });

  it('records a warning when a source file has invalid JSON at load time', () => {
    const schema = z.object({ foo: z.string().default('default') });
    const reader = new MemoryConfigFileReader({ [HOME]: 'not json' });
    const loader = new ConfigLoader({ schema, paths: [HOME], reader, fs: new MemoryFileSystem() });
    loader.load();

    const expected = true;
    const actual = loader.warnings.some((w) => w.includes(HOME));
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// path field resolution
//
// Path fields are addressed by an array of key segments. The real motivating
// case is `hooks.approvalNotify.command` in the sdk-cli config, so the tests
// use a nested shape of the same depth rather than a synthetic top-level
// field.
// ---------------------------------------------------------------------------

const hookSchema = z.object({
  hooks: z
    .object({
      approvalNotify: z.object({ command: z.string().default('') }).default({ command: '' }),
    })
    .default({ approvalNotify: { command: '' } }),
});

describe('ConfigLoader — path resolution', () => {
  it("resolves a relative nested path against the home config file's directory", () => {
    const reader = new MemoryConfigFileReader({
      '/cfg/home.json': '{"hooks":{"approvalNotify":{"command":"./hook.sh"}}}',
    });
    const fs = new MemoryFileSystem('/home/user');
    const loader = new ConfigLoader({
      schema: hookSchema,
      paths: ['/cfg/home.json'],
      reader,
      fs,
      pathFields: [['hooks', 'approvalNotify', 'command']],
    });
    loader.load();

    const expected = '/cfg/hook.sh';
    const actual = loader.config.hooks.approvalNotify.command;
    expect(actual).toBe(expected);
  });

  it("resolves a relative nested path against the local config file's directory when local overrides home", () => {
    const reader = new MemoryConfigFileReader({
      '/a/home.json': '{"hooks":{"approvalNotify":{"command":"./home-hook.sh"}}}',
      '/b/local.json': '{"hooks":{"approvalNotify":{"command":"./local-hook.sh"}}}',
    });
    const fs = new MemoryFileSystem('/home/user');
    const loader = new ConfigLoader({
      schema: hookSchema,
      paths: ['/a/home.json', '/b/local.json'],
      reader,
      fs,
      pathFields: [['hooks', 'approvalNotify', 'command']],
    });
    loader.load();

    const expected = '/b/local-hook.sh';
    const actual = loader.config.hooks.approvalNotify.command;
    expect(actual).toBe(expected);
  });

  it('expands ~ in a nested path field using fs.homedir()', () => {
    const reader = new MemoryConfigFileReader({
      '/cfg/home.json': '{"hooks":{"approvalNotify":{"command":"~/bin/tool"}}}',
    });
    const fs = new MemoryFileSystem('/home/user');
    const loader = new ConfigLoader({
      schema: hookSchema,
      paths: ['/cfg/home.json'],
      reader,
      fs,
      pathFields: [['hooks', 'approvalNotify', 'command']],
    });
    loader.load();

    const expected = '/home/user/bin/tool';
    const actual = loader.config.hooks.approvalNotify.command;
    expect(actual).toBe(expected);
  });

  it('expands $HOME in a nested path field using fs.getEnvVar()', () => {
    const reader = new MemoryConfigFileReader({
      '/cfg/home.json': '{"hooks":{"approvalNotify":{"command":"$HOME/bin/tool"}}}',
    });
    const fs = new MemoryFileSystem('/ignored');
    fs.setEnvVar('HOME', '/env/home');
    const loader = new ConfigLoader({
      schema: hookSchema,
      paths: ['/cfg/home.json'],
      reader,
      fs,
      pathFields: [['hooks', 'approvalNotify', 'command']],
    });
    loader.load();

    const expected = '/env/home/bin/tool';
    const actual = loader.config.hooks.approvalNotify.command;
    expect(actual).toBe(expected);
  });

  it('passes an absolute nested path field through unchanged', () => {
    const reader = new MemoryConfigFileReader({
      '/cfg/home.json': '{"hooks":{"approvalNotify":{"command":"/usr/local/bin/tool"}}}',
    });
    const fs = new MemoryFileSystem('/home/user');
    const loader = new ConfigLoader({
      schema: hookSchema,
      paths: ['/cfg/home.json'],
      reader,
      fs,
      pathFields: [['hooks', 'approvalNotify', 'command']],
    });
    loader.load();

    const expected = '/usr/local/bin/tool';
    const actual = loader.config.hooks.approvalNotify.command;
    expect(actual).toBe(expected);
  });

  it('leaves a declared path field untouched when the source does not contain it', () => {
    const reader = new MemoryConfigFileReader({
      '/cfg/home.json': '{"hooks":{}}',
    });
    const fs = new MemoryFileSystem('/home/user');
    const loader = new ConfigLoader({
      schema: hookSchema,
      paths: ['/cfg/home.json'],
      reader,
      fs,
      pathFields: [['hooks', 'approvalNotify', 'command']],
    });
    loader.load();

    const expected = '';
    const actual = loader.config.hooks.approvalNotify.command;
    expect(actual).toBe(expected);
  });

  it('re-runs nested path resolution on reload after a config file change', () => {
    const reader = new MemoryConfigFileReader({
      '/cfg/home.json': '{"hooks":{"approvalNotify":{"command":"./before.sh"}}}',
    });
    const watcher = new MemoryConfigWatcher();
    const fs = new MemoryFileSystem('/home/user');
    const loader = new ConfigLoader({
      schema: hookSchema,
      paths: ['/cfg/home.json'],
      reader,
      watcher,
      fs,
      pathFields: [['hooks', 'approvalNotify', 'command']],
      debounceMs: 0,
    });
    loader.load();
    loader.start();

    reader.set('/cfg/home.json', '{"hooks":{"approvalNotify":{"command":"./after.sh"}}}');
    watcher.trigger('/cfg/home.json');

    const expected = '/cfg/after.sh';
    const actual = loader.config.hooks.approvalNotify.command;
    expect(actual).toBe(expected);
  });
});
