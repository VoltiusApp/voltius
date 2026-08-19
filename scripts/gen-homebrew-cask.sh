#!/usr/bin/env bash
# Emits a complete Homebrew Cask for Voltius to stdout.
#
# Usage: gen-homebrew-cask.sh <tag> [--core]
#   e.g. gen-homebrew-cask.sh v0.4.0
#
#   --core  emit the variant intended for a homebrew-cask *core* submission
#           rather than for the VoltiusApp/homebrew-voltius tap. Core rejects
#           casks whose caveats tell the user to reinstall with
#           --no-quarantine, so that hint is dropped there; the right-click
#           Open instructions stay, which core does accept for an app that is
#           ad-hoc signed but not notarized.
#
# Requires: gh (authenticated), awk. Reads the .dmg.sha256 release assets.
set -euo pipefail

TAG="${1:?usage: gen-homebrew-cask.sh <tag> [--core]}"
VARIANT="${2:-}"

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/release-assets.sh"
release_assets_init "$TAG"

SHA_ARM="$(release_sha "$(release_asset aarch64.dmg)")"
SHA_INTEL="$(release_sha "$(release_asset x64.dmg)")"

if [ "$VARIANT" = "--core" ]; then
  QUARANTINE_HINT=""
else
  QUARANTINE_HINT="
    To skip the warning entirely, install with:
      brew install --cask --no-quarantine voltiusapp/voltius/voltius
"
fi

cat <<EOF
cask "voltius" do
  arch arm: "aarch64", intel: "x64"

  version "${VERSION}"
  sha256 arm:   "${SHA_ARM}",
         intel: "${SHA_INTEL}"

  url "https://github.com/${REPO}/releases/download/v#{version}/Voltius_#{version}_#{arch}.dmg",
      verified: "github.com/${REPO}/"
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

  caveats <<~CAVEATS
    Voltius is ad-hoc signed but not notarized, so on first launch macOS
    Gatekeeper will warn that the app cannot be checked for malware.

    Right-click (or Control-click) Voltius in Applications and choose Open, then
    confirm. You only need to do this once.
${QUARANTINE_HINT}
    Voltius updates itself in-app after installation.
  CAVEATS
end
EOF
