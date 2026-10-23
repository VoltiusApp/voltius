#!/usr/bin/env bash
# Emits a complete Homebrew Cask for Voltius to stdout.
#
# Usage: gen-homebrew-cask.sh <tag>
#   e.g. gen-homebrew-cask.sh v0.4.0
#
# The app is signed with Developer ID and notarized, so the cask needs no
# Gatekeeper caveat. The same file suits the tap and a homebrew-cask core PR.
#
# Requires: gh (authenticated), awk. Reads the .dmg.sha256 release assets.
set -euo pipefail

TAG="${1:?usage: gen-homebrew-cask.sh <tag>}"

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/release-assets.sh"
release_assets_init "$TAG"

SHA_ARM="$(release_sha "$(release_asset aarch64.dmg)")"
SHA_INTEL="$(release_sha "$(release_asset x64.dmg)")"

cat <<EOF
cask "voltius" do
  arch arm: "aarch64", intel: "x64"

  version "${VERSION}"
  sha256 arm:   "${SHA_ARM}",
         intel: "${SHA_INTEL}"

  url "https://github.com/${REPO}/releases/download/v#{version}/Voltius_#{version}_#{arch}.dmg"
  name "Voltius"
  desc "Cross-platform SSH client and terminal"
  homepage "https://voltius.app/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on :macos

  app "Voltius.app"
end
EOF
