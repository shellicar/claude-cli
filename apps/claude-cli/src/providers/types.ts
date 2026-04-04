export interface UsageFeatures {
  readonly time: boolean;
  readonly context: boolean;
  readonly cost: boolean;
}

export interface GitFeatures {
  readonly branch: boolean;
  readonly status: boolean;
  readonly sha: boolean;
}
