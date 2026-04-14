# 08:24

## #266 — Add typescript as a production dependency

Trivial fix. `typescript` was only in `devDependencies`, so consumers running in environments without a separate `typescript` install (e.g. Docker images built from the published package) would fail at `TsServerService` startup when `createRequire` tries to resolve `typescript` to find `tsserver.js`.

The fix is a `pnpm add typescript` in `apps/claude-sdk-cli`. The `pnpm version` bump (beta.2 to beta.3) is the only other change.

No build, type-check, or test failures. No surprises.
