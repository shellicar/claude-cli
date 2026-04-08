import type { z } from 'zod';
import type { sdkConfigSchema } from './schema';

export type ResolvedSdkConfig = Omit<z.infer<typeof sdkConfigSchema>, '$schema'>;
export type HistoryReplayConfig = NonNullable<ResolvedSdkConfig['historyReplay']>;
