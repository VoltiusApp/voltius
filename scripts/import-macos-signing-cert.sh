#!/usr/bin/env bash
# Ad-hoc signatures change every build, so macOS re-prompts for every keychain item
# after an update; a fixed self-signed certificate keeps "Always Allow" valid.
set -euo pipefail

: "${MACOS_SIGNING_CERTIFICATE:?secret MACOS_SIGNING_CERTIFICATE is not set}"
: "${MACOS_SIGNING_CERTIFICATE_PASSWORD:?secret MACOS_SIGNING_CERTIFICATE_PASSWORD is not set}"

keychain="$RUNNER_TEMP/voltius-signing.keychain-db"
keychain_password=$(openssl rand -base64 24)
cert="$RUNNER_TEMP/voltius-signing.p12"

printf '%s' "$MACOS_SIGNING_CERTIFICATE" | base64 --decode > "$cert"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$cert" -k "$keychain" -P "$MACOS_SIGNING_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
rm -f "$cert"
# Without the partition list, codesign fails with errSecInternalComponent on a headless runner.
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" > /dev/null
security list-keychains -d user -s "$keychain" $(security list-keychains -d user | tr -d '"')

# No -v: a self-signed certificate is untrusted, which filters it out of the valid list but still signs.
identity=$(security find-identity -p codesigning "$keychain" | awk '$1 ~ /^[0-9]+\)$/ && $2 ~ /^[0-9A-F]{40}$/ {print $2; exit}')
[ -n "$identity" ] || { security find-identity -p codesigning "$keychain" >&2; echo "no code-signing identity in the certificate" >&2; exit 1; }
echo "APPLE_SIGNING_IDENTITY=$identity" >> "$GITHUB_ENV"
echo "signing identity $identity"
