#!/usr/bin/env bash
# Build claude-sdk-cli as a Single Executable Application (macOS arm64).
#
# Why this exists: the CLI's SQLite store uses node:sqlite (a Node builtin, no
# native addon). Bundling the CLI's own Node runtime into the binary means the
# store runs on that runtime regardless of whatever `node` the user's shell is
# pinned to — no NODE_MODULE_VERSION / ABI lock, no crash on the "wrong" Node.
#
# Two load-bearing constraints:
#   1. ESM entry. The CLI bundle is ESM (top-level await in entry/main.ts).
#      A SEA runs an ESM entry only via the "mainFormat": "module" config field,
#      which exists from Node 26 (Node <=24 silently ignores it and runs the
#      entry as CommonJS, which then fails on the import statements). So the
#      bundled runtime MUST be Node 26+. node:sqlite is unflagged there too.
#   2. macOS signing. postject injection invalidates the binary's signature;
#      the strip-signature -> inject -> ad-hoc-re-sign bracket is mandatory or
#      the OS kills the modified binary on launch. The order is load-bearing.
set -euo pipefail
cd "$(dirname "$0")"

# The bundled runtime must be Node 26+ for the ESM SEA entry (mainFormat: module).
NODE26="$(fnm exec --using=26 node -e 'process.stdout.write(process.execPath)')"
echo "bundled runtime: $("$NODE26" -v) ($NODE26)"

# 1. Produce the self-contained ESM bundle (dist/main.js, all deps bundled in).
pnpm build

# 2. Generate the SEA blob from the config (reads dist/main.js as an ES module).
"$NODE26" --experimental-sea-config sea-config.json

# 3. Copy the Node 26 binary to become our app.
cp "$NODE26" dist/claude-sdk-cli

# 4. macOS: remove the existing code signature before modifying the binary.
codesign --remove-signature dist/claude-sdk-cli

# 5. Inject the blob. The sentinel fuse and segment name are the documented
#    constants the Node SEA loader looks for.
npx -y postject dist/claude-sdk-cli NODE_SEA_BLOB dist/sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  --macho-segment-name NODE_SEA

# 6. macOS: ad-hoc re-sign so the modified binary will run locally.
codesign --sign - dist/claude-sdk-cli

echo "built: dist/claude-sdk-cli"
