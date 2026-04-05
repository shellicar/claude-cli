export const isNodeError = (err: unknown, code: string): err is NodeJS.ErrnoException => {
  return err instanceof Error && 'code' in err && err.code === code;
};
