export interface ApproveRule {
  program: string;
  args?: string[];
}

export interface ExecPermissions {
  presets?: string[];
  approve?: ApproveRule[];
}
