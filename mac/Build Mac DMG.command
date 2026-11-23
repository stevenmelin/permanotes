#!/bin/bash
# Packages the already-built PermaNotes.app into PermaNotes-Mac.dmg (with README). Does not rebuild the app.
set -euo pipefail
cd "$(dirname "$0")/.."
trap 'echo; echo "DMG FAILED (line $LINENO). The real error is printed above."; exit 1' ERR
APP="release/mac-universal/PermaNotes.app"
[ -d "$APP" ] || { echo "No app found at $APP. Run 'Build Mac App.command' first."; exit 1; }
VERSION=$(node -p "require('./package.json').version")
STAGE="release/dmg-stage"
OUT="release/PermaNotes-${VERSION}-Mac.dmg"
echo "[##########                    ] 1/3  Staging app + README"
rm -rf "$STAGE" "$OUT"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
cp "docs/README.txt" "$STAGE/README.txt"
ln -s /Applications "$STAGE/Applications"
echo "[####################          ] 2/3  Creating DMG"
hdiutil create -volname "PermaNotes" -srcfolder "$STAGE" -ov -format UDZO "$OUT"
echo "[##############################] 3/3  Verifying"
hdiutil verify "$OUT"
rm -rf "$STAGE"
echo
echo "DONE: $OUT"
