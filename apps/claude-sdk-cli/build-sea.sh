#!/usr/bin/env bash
# Wrap the pre-built claude-sdk-cli bundle into a Single Executable Application
# (macOS arm64). The Linux build already produced dist/main.js and the SEA blob
# (dist/sea-prep.blob); this script does only the native part — copy the
# platform's Node, inject the blob, and sign.
#
# Why the SEA exists: the CLI's SQLite store uses node:sqlite (a Node builtin, no
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
# CI sets SEA_NODE to the path of a Node 26 binary; locally we fall back to fnm.
if [ -n "${SEA_NODE:-}" ]; then
  NODE26="$SEA_NODE"
else
  NODE26="$(fnm exec --using=26 node -e 'process.stdout.write(process.execPath)')"
fi
echo "bundled runtime: $("$NODE26" -v) ($NODE26)"

# Guard: an ESM SEA entry needs mainFormat support, which lands in Node 26.
# Node <=24 silently ignores mainFormat and runs the entry as CommonJS (crash).
MAJOR="$("$NODE26" -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')"
if [ "$MAJOR" -lt 26 ]; then
  echo "error: bundled runtime is Node $MAJOR; need Node 26+ for the ESM SEA entry" >&2
  exit 1
fi

# Stage into the binary's own platform package: the dir the launcher resolves
# (@shellicar/claude-sdk-cli-<platform>-<arch>) and that publish reads from.
# The platform is DERIVED from the host running this build, never hardcoded — on
# this macOS arm64 host it resolves darwin-arm64; a different runner resolves its
# own. That keeps the per-platform matrix seam: each platform builds into its
# own package, and wrapping is what makes the launcher runnable (no stale copy).
PLATFORM="$("$NODE26" -e 'process.stdout.write(process.platform + "-" + process.arch)')"
BIN="../../platforms/claude-sdk-cli-${PLATFORM}/claude-sdk-cli"

# 1. Copy the Node 26 binary to become our app.
cp "$NODE26" "$BIN"

# 2. macOS: remove the existing code signature before modifying the binary.
codesign --remove-signature "$BIN"

# 3. Inject the blob. The sentinel fuse and segment name are the documented
#    constants the Node SEA loader looks for.
npx -y postject "$BIN" NODE_SEA_BLOB dist/sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  --macho-segment-name NODE_SEA

# 4. macOS: ad-hoc re-sign so the modified binary will run locally.
codesign --sign - "$BIN"

echo "built: $BIN"
