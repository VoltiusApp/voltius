#!/usr/bin/env bash
# Checks a macOS binary or .app is signed with the Voltius Developer ID certificate.
# With --notarized, also checks Gatekeeper accepts it as notarized and the ticket is stapled,
# which is what lets a downloaded .app open without any warning.
# Usage: check-macos-signature.sh [--notarized] <path>
set -euo pipefail

notarized=false
if [ "${1:-}" = "--notarized" ]; then notarized=true; shift; fi
target="$1"

details=$(codesign -dvv "$target" 2>&1)
echo "$details" | grep -E '^(Authority|TeamIdentifier|Runtime Version|Timestamp)=' || true
grep -q '^Authority=Developer ID Application: ' <<< "$details" \
  || { echo "$target is not signed with a Developer ID Application certificate" >&2; exit 1; }
codesign --verify --strict --deep "$target"

if $notarized; then
  assessment=$(spctl --assess --type execute -vv "$target" 2>&1 || true)
  echo "$assessment"
  grep -q 'source=Notarized Developer ID' <<< "$assessment" \
    || { echo "$target is not accepted by Gatekeeper as notarized" >&2; exit 1; }
  xcrun stapler validate "$target"
fi
