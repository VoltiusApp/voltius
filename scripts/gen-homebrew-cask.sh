#!/usr/bin/env bash
# Emits a complete Homebrew Cask for Voltius to stdout.
# Usage: gen-homebrew-cask.sh <tag>   e.g. gen-homebrew-cask.sh v0.4.0
# Requires: gh (authenticated), awk. Reads the .dmg.sha256 release assets.
set -euo pipefail

TAG="${1:?usage: gen-homebrew-cask.sh <tag>}"
REPO="${REPO:-VoltiusApp/voltius}"
VERSION="${TAG#v}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fetch_sha() {
  # $1 = arch token in the asset filename (aarch64|x64)
  local arch="$1" name="Voltius_${VERSION}_$1.dmg.sha256"
  gh release download "$TAG" -R "$REPO" -p "$name" -O "$tmp/$arch.sha256" >/dev/null
  awk '{print $1}' "$tmp/$arch.sha256"
}

SHA_ARM="$(fetch_sha aarch64)"
SHA_INTEL="$(fetch_sha x64)"

cat <<EOF
cask "voltius" do
  arch arm: "aarch64", intel: "x64"

  version "${VERSION}"
  sha256 arm:   "${SHA_ARM}",
         intel: "${SHA_INTEL}"

  url "https://github.com/VoltiusApp/voltius/releases/download/v#{version}/Voltius_#{version}_#{arch}.dmg"
  name "Voltius"
  desc "Cross-platform SSH client and terminal"
  homepage "https://voltius.app/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: :high_sierra

  app "Voltius.app"

  caveats <<~CAVEATS
    Voltius is not yet signed or notarized, so on first launch macOS Gatekeeper
    will warn that the app cannot be checked for malware.

    Right-click (or Control-click) Voltius in Applications and choose Open, then
    confirm. You only need to do this once.

    To skip the warning entirely, install with:
      brew install --cask --no-quarantine voltiusapp/voltius/voltius

    Voltius updates itself in-app after installation.
  CAVEATS
end
EOF
