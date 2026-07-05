import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';
import { createServiceCollection } from '@shellicar/core-di-lite';
import { describe, expect, it } from 'vitest';
import { ISystemIdentity } from '../src/model/ISystemIdentity.js';
import { IDENTITY_COLLECTION, SystemIdentity } from '../src/model/SystemIdentity.js';
import { MemoryFileSystem } from './MemoryFileSystem.js';
import { MemoryObjectStore } from './MemoryObjectStore.js';

const CONV = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const CONV_B = 'bbbbbbbb-e5f6-7890-abcd-ef1234567890';
const PATH = '/home/user/planner.md';

function build(fs: IFileSystem, objects: IObjectStore): ISystemIdentity {
  const services = createServiceCollection();
  services.register(IFileSystem).to(IFileSystem, () => fs);
  services.register(IObjectStore).to(IObjectStore, () => objects);
  services.register(ISystemIdentity).to(SystemIdentity);
  return services.buildProvider().resolve(ISystemIdentity);
}

describe('SystemIdentity — assert', () => {
  it('persists the path keyed by conversation id', () => {
    const objects = new MemoryObjectStore();
    const identity = build(new MemoryFileSystem(), objects);
    identity.assert(CONV, PATH);
    const expected = PATH;
    const actual = objects.get(IDENTITY_COLLECTION, CONV);
    expect(actual).toBe(expected);
  });
});

describe('SystemIdentity — load', () => {
  it('adopts the path the conversation already owns', () => {
    const objects = new MemoryObjectStore();
    objects.set(IDENTITY_COLLECTION, CONV, PATH);
    const identity = build(new MemoryFileSystem({ [PATH]: '---\nname: planner\n---\nB' }), objects);
    identity.load(CONV);
    const expected = PATH;
    const actual = identity.path;
    expect(actual).toBe(expected);
  });

  it('owns nothing when the conversation has no stored identity', () => {
    const identity = build(new MemoryFileSystem(), new MemoryObjectStore());
    identity.load(CONV);
    const expected = null;
    const actual = identity.path;
    expect(actual).toBe(expected);
  });
});

describe('SystemIdentity — inherit', () => {
  it('persists the running path against the new conversation id', () => {
    const objects = new MemoryObjectStore();
    const identity = build(new MemoryFileSystem({ [PATH]: 'B' }), objects);
    identity.assert(CONV, PATH);
    identity.inherit(CONV_B);
    const expected = PATH;
    const actual = objects.get(IDENTITY_COLLECTION, CONV_B);
    expect(actual).toBe(expected);
  });

  it('writes nothing for the new id when no identity is owned', () => {
    const objects = new MemoryObjectStore();
    const identity = build(new MemoryFileSystem(), objects);
    identity.inherit(CONV_B);
    const expected = undefined;
    const actual = objects.get(IDENTITY_COLLECTION, CONV_B);
    expect(actual).toBe(expected);
  });
});

describe('SystemIdentity — read', () => {
  it('reads the live body when the file is present', async () => {
    const identity = build(new MemoryFileSystem({ [PATH]: '---\nname: planner\n---\nBody' }), new MemoryObjectStore());
    identity.assert(CONV, PATH);
    const result = await identity.read();
    const expected = 'Body';
    const actual = result.state === 'present' ? result.body : null;
    expect(actual).toBe(expected);
  });

  it('reads the frontmatter name when the file is present', async () => {
    const identity = build(new MemoryFileSystem({ [PATH]: '---\nname: planner\n---\nBody' }), new MemoryObjectStore());
    identity.assert(CONV, PATH);
    const result = await identity.read();
    const expected = 'planner';
    const actual = result.state === 'present' ? result.name : null;
    expect(actual).toBe(expected);
  });

  it('reports missing when the owned file is absent', async () => {
    const objects = new MemoryObjectStore();
    objects.set(IDENTITY_COLLECTION, CONV, PATH);
    const identity = build(new MemoryFileSystem(), objects);
    identity.load(CONV);
    const result = await identity.read();
    const expected = 'missing';
    const actual = result.state;
    expect(actual).toBe(expected);
  });

  it('reports none when no identity is owned', async () => {
    const identity = build(new MemoryFileSystem(), new MemoryObjectStore());
    const result = await identity.read();
    const expected = 'none';
    const actual = result.state;
    expect(actual).toBe(expected);
  });

  it('reflects a live edit on the next read', async () => {
    const fs = new MemoryFileSystem({ [PATH]: '---\nname: planner\n---\nOld' });
    const identity = build(fs, new MemoryObjectStore());
    identity.assert(CONV, PATH);
    await fs.writeFile(PATH, '---\nname: planner\n---\nNew');
    const result = await identity.read();
    const expected = 'New';
    const actual = result.state === 'present' ? result.body : null;
    expect(actual).toBe(expected);
  });
});
