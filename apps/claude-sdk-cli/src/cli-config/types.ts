import type { z } from 'zod';
import type { permissionActionSchema, sdkConfigSchema } from './schema';

export type ResolvedSdkConfig = Omit<z.infer<typeof sdkConfigSchema>, '$schema'>;
export type HistoryReplayConfig = NonNullable<ResolvedSdkConfig['historyReplay']>;
export type ApprovalNotifyConfig = NonNullable<NonNullable<ResolvedSdkConfig['hooks']>['approvalNotify']>;
export type PermissionActionOutput = z.output<typeof permissionActionSchema>;
