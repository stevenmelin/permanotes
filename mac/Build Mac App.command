#!/bin/bash
# Builds PermaNotes.app (Apple Silicon + Intel). Double-click to run.
set -euo pipefail
cd "$(dirname "$0")/.."
step() { local n=$1 t=$2; local f=$((n*30/4)); printf '\n[%-30s] %d/4  %s\n' "$(printf '#%.0s' $(seq 1 $f))" "$n" "$t"; }
trap 'echo; echo "BUILD FAILED (line $LINENO). The real error is printed above."; exit 1' ERR

command -v npm >/dev/null || { echo "Node.js is not installed. Get the LTS version from https://nodejs.org then run this again."; exit 1; }
step 1 "Installing dependencies"
npm ci
step 2 "Checking the code"
npm run audit
npm run typecheck
npm test
step 3 "Building the app"
npm run build
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --universal --dir --publish never
APP="release/mac-universal/PermaNotes.app"
[ -d "$APP" ] || { echo "Expected $APP but it was not created."; ls -R release | head -40; exit 1; }
step 4 "Signing (ad-hoc, so it runs on Apple Silicon)"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
echo
echo "DONE: $APP"
echo "Next: double-click 'Build Mac DMG.command' to make the installer DMG."
