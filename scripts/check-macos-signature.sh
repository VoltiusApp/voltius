#!/usr/bin/env bash
# An ad-hoc signature pins the keychain grant to one build's cdhash; only a certificate survives updates (a self-signed one shows as "certificate root").
set -euo pipefail

requirement=$(codesign -d -r- "$1" 2>&1)
echo "$requirement"
grep -Eq 'certificate (leaf|root) = H' <<< "$requirement" || { echo "$1 is not signed with the Voltius certificate" >&2; exit 1; }
