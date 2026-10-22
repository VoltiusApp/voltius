#!/usr/bin/env bash
# Imports the Developer ID Application certificate into a throwaway keychain and
# exports APPLE_SIGNING_IDENTITY for tauri-action and codesign. When the App Store
# Connect API key is present, also writes it to disk and exports APPLE_API_KEY_PATH,
# which makes the Tauri bundler notarize and staple the app.
set -euo pipefail

: "${APPLE_CERTIFICATE:?secret APPLE_CERTIFICATE is not set}"
: "${APPLE_CERTIFICATE_PASSWORD:?secret APPLE_CERTIFICATE_PASSWORD is not set}"

keychain="$RUNNER_TEMP/voltius-signing.keychain-db"
keychain_password=$(openssl rand -base64 24)
cert="$RUNNER_TEMP/voltius-signing.p12"

printf '%s' "$APPLE_CERTIFICATE" | base64 --decode > "$cert"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$cert" -k "$keychain" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
rm -f "$cert"
# Without the partition list, codesign fails with errSecInternalComponent on a headless runner.
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" > /dev/null
security list-keychains -d user -s "$keychain" $(security list-keychains -d user | tr -d '"')

identity=$(security find-identity -v -p codesigning "$keychain" | sed -nE 's/.*"(Developer ID Application: [^"]+)".*/\1/p' | head -1)
[ -n "$identity" ] || { security find-identity -v -p codesigning "$keychain" >&2; echo "no valid Developer ID Application identity in the certificate" >&2; exit 1; }
echo "APPLE_SIGNING_IDENTITY=$identity" >> "$GITHUB_ENV"
echo "signing identity: $identity"

if [ -n "${APPLE_API_KEY_P8:-}" ]; then
  key_path="$RUNNER_TEMP/AuthKey.p8"
  printf '%s\n' "$APPLE_API_KEY_P8" > "$key_path"
  chmod 600 "$key_path"
  echo "APPLE_API_KEY_PATH=$key_path" >> "$GITHUB_ENV"
  echo "notarization key written"
fi
