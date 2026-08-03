import type { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import type { sdkConfigSchema } from './schema.js';

/**
 * The config loader, typed by the schema it actually holds.
 *
 * Most of this app injects `ConfigLoader<any>`, which type-checks any key at all: renaming or
 * removing a config field leaves every reader compiling and failing at runtime instead. Naming the
 * schema is what makes `pnpm type-check` notice.
 */
export type CliConfigLoader = ConfigLoader<typeof sdkConfigSchema>;
