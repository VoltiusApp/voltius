#!/usr/bin/env bash
# One-time: create the initial Voltius.Voltius manifest in microsoft/winget-pkgs
# via komac `new`. Run via the winget-bootstrap workflow (workflow_dispatch).
# After microsoft/winget-pkgs merges this PR, future releases use winget-releaser.
# Env: GITHUB_TOKEN (WINGET_PKGS_TOKEN), TAG.
set -euo pipefail

TAG="${TAG:?set TAG, e.g. v0.4.0}"
VERSION="${TAG#v}"
BASE="https://github.com/VoltiusApp/voltius/releases/download/${TAG}"

# Install komac (Rust binary; x86_64 ubuntu runner).
KOMAC_VER="$(gh release view -R russellbanks/Komac --json tagName --jq '.tagName' | sed 's/^v//')"
curl -fsSL -o komac.deb \
  "https://github.com/russellbanks/Komac/releases/download/v${KOMAC_VER}/komac_${KOMAC_VER}_amd64.deb"
sudo dpkg -i komac.deb

komac new Voltius.Voltius \
  --version "${VERSION}" \
  --urls "${BASE}/Voltius_${VERSION}_x64-setup.exe" \
          "${BASE}/Voltius_${VERSION}_arm64-setup.exe" \
  --submit \
  --token "${GITHUB_TOKEN}"
