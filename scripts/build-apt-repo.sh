#!/usr/bin/env bash
# Build a signed apt repository from a directory of .deb files using
# apt-ftparchive (multi-version: every .deb in the pool is published).
#
# Usage: build-apt-repo.sh <deb_dir> <out_dir>
# Required env:
#   GPG_PRIVATE_KEY  ASCII-armored private signing key
#   GPG_PASSPHRASE   passphrase for that key
#
# Produces an apt repo tree under <out_dir> (pool/, dists/) with a signed
# InRelease + Release.gpg, ready to serve at https://repo.voltius.app/deb.
# Stateless: the output dir is rebuilt from scratch on every run.
set -euo pipefail

DEB_DIR="${1:?usage: build-apt-repo.sh <deb_dir> <out_dir>}"
OUT_DIR="${2:?usage: build-apt-repo.sh <deb_dir> <out_dir>}"
: "${GPG_PRIVATE_KEY:?GPG_PRIVATE_KEY env required}"
: "${GPG_PASSPHRASE:?GPG_PASSPHRASE env required}"

SUITE="stable"
COMPONENT="main"
ARCHES="amd64 arm64"

shopt -s nullglob
debs=( "$DEB_DIR"/*.deb )
(( ${#debs[@]} )) || { echo "no .deb files in $DEB_DIR" >&2; exit 1; }

# --- isolated GPG keyring; sign non-interactively with loopback passphrase ---
GNUPGHOME="$(mktemp -d)"; export GNUPGHOME; chmod 700 "$GNUPGHOME"
trap 'gpgconf --kill gpg-agent 2>/dev/null || true; rm -rf "$GNUPGHOME"' EXIT
printf '%s' "$GPG_PRIVATE_KEY" | gpg --batch --import 2>/dev/null
FPR="$(gpg --list-secret-keys --with-colons | awk -F: '/^fpr:/{print $10; exit}')"
echo "Signing apt repo with key $FPR"

gpg_sign() {  # gpg_sign <gpg-mode-args...> -o <out> <in>
  printf '%s' "$GPG_PASSPHRASE" | gpg --batch --yes --pinentry-mode loopback \
    --passphrase-fd 0 --local-user "$FPR" "$@"
}

# --- layout: copy debs into the pool ---
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/pool/$COMPONENT"
cp -f "${debs[@]}" "$OUT_DIR/pool/$COMPONENT/"

cd "$OUT_DIR"

# --- per-arch Packages indexes (paths are relative to the repo root) ---
for arch in $ARCHES; do
  dir="dists/$SUITE/$COMPONENT/binary-$arch"
  mkdir -p "$dir"
  apt-ftparchive --arch "$arch" packages "pool/$COMPONENT" > "$dir/Packages"
  gzip -9c "$dir/Packages" > "$dir/Packages.gz"
done

# --- Release (over the dists/<suite> tree), then sign ---
apt-ftparchive \
  -o APT::FTPArchive::Release::Origin=Voltius \
  -o APT::FTPArchive::Release::Label=Voltius \
  -o APT::FTPArchive::Release::Suite="$SUITE" \
  -o APT::FTPArchive::Release::Codename="$SUITE" \
  -o APT::FTPArchive::Release::Components="$COMPONENT" \
  -o APT::FTPArchive::Release::Architectures="$ARCHES" \
  release "dists/$SUITE" > "dists/$SUITE/Release"

gpg_sign --clearsign     -o "dists/$SUITE/InRelease"  "dists/$SUITE/Release"
gpg_sign --detach-sign -a -o "dists/$SUITE/Release.gpg" "dists/$SUITE/Release"

echo "apt repo built at $OUT_DIR"
find . -maxdepth 4 -type f | sort
