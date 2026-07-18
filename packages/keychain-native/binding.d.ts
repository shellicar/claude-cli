/**
 * Read a generic password from the macOS Keychain by service and account name.
 * Throws if the item is absent, access is denied, or the stored bytes aren't valid UTF-8.
 */
export function readGenericPassword(service: string, account: string): string;
