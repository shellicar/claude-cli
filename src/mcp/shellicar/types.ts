import type { ValidationRule } from './exec/types';

export interface ShellicarMcpOptions {
  /** Working directory for command execution. Defaults to process.cwd(). */
  cwd?: string;
  /** Custom validation rules. Defaults to builtinRules. */
  rules?: ValidationRule[];
}
