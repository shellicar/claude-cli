import { describe, expect, it } from 'vitest';
import { isKeychainPlatformSupported } from '../src/secrets/EnvProvider.js';

describe('isKeychainPlatformSupported', () => {
  it('is true on darwin arm64', () => {
    const actual = isKeychainPlatformSupported('darwin', 'arm64');
    expect(actual).toBe(true);
  });

  it('is false on darwin x64', () => {
    const actual = isKeychainPlatformSupported('darwin', 'x64');
    expect(actual).toBe(false);
  });

  it('is false on linux arm64', () => {
    const actual = isKeychainPlatformSupported('linux', 'arm64');
    expect(actual).toBe(false);
  });

  it('is false on win32 arm64', () => {
    const actual = isKeychainPlatformSupported('win32', 'arm64');
    expect(actual).toBe(false);
  });

  it('is false on linux x64', () => {
    const actual = isKeychainPlatformSupported('linux', 'x64');
    expect(actual).toBe(false);
  });
});
