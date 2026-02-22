import { DateTimeFormatter } from '@js-joda/core';
import type { GitFeatures, UsageFeatures } from './types';

export const SYSTEM_TIME_FORMAT = DateTimeFormatter.ofPattern('yyyy-MM-dd HH:mm:ss.SSS xxx');

export const DEFAULT_USAGE_FEATURES: UsageFeatures = {
  time: true,
  context: true,
  cost: true,
} satisfies UsageFeatures;

export const DEFAULT_GIT_FEATURES: GitFeatures = {
  branch: true,
  status: true,
} satisfies GitFeatures;
