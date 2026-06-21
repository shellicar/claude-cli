#!/usr/bin/env bash
# Build the minimal SEA app on macOS arm64.
#
# Runtime is Node 24 (for node:sqlite). The recipe is the standard SEA flow:
# generate the blob, copy the Node 24 binary, strip its signature, inject the
# blob with postject, then ad-hoc re-sign so macOS will run the modified binary.
set -euo pipefail
cd "$(dirname "$0")"

# The bundled runtime must be Node 24 — node:sqlite lives in the binary.
NODE24="$(fnm exec --using=24 node -e 'process.stdout.write(process.execPath)')"
echo "bundled runtime: $("$NODE24" -v) ($NODE24)"

# 1. Generate the SEA blob from the config.
"$NODE24" --experimental-sea-config sea-config.json

# 2. Copy the Node 24 binary to become our app.
cp "$NODE24" sea-poc-app

# 3. macOS: remove the existing code signature before modifying the binary.
codesign --remove-signature sea-poc-app

# 4. Inject the blob. The sentinel fuse and segment name are the documented
#    constants the Node SEA loader looks for.
npx -y postject sea-poc-app NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  --macho-segment-name NODE_SEA

# 5. macOS: ad-hoc re-sign so the modified binary will run locally.
codesign --sign - sea-poc-app

echo "built: sea-poc-app"
