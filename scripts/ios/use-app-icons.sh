#!/usr/bin/env bash
# `tauri ios init` writes Tauri's placeholder icons into the generated project; replace them with ours.
set -euo pipefail
dir=src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset
cp src-tauri/icons/ios/*.png "$dir/"
for f in $(sed -n 's/.*"filename" *: *"\([^"]*\)".*/\1/p' "$dir/Contents.json"); do
  cmp -s "src-tauri/icons/ios/$f" "$dir/$f" || { echo "AppIcon $f is not the Voltius icon" >&2; exit 1; }
done
echo "AppIcon: $(ls "$dir"/*.png | wc -l) Voltius icons"
