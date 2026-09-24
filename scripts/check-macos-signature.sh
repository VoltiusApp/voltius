#!/usr/bin/env bash
# An ad-hoc signature pins the keychain grant to one build's cdhash; only a certificate survives updates.
set -euo pipefail

requirement=$(codesign -d -r- "$1" 2>&1)
echo "$requirement"
grep -q 'certificate leaf' <<< "$requirement" || { echo "$1 is not signed with the Voltius certificate" >&2; exit 1; }
