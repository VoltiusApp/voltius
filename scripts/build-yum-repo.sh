#!/usr/bin/env bash
# Build a signed yum/dnf repository from a directory of .rpm files using
# createrepo_c. Signs every rpm and the repomd metadata.
#
# Usage: build-yum-repo.sh <rpm_dir> <out_dir>
# Required env:
#   GPG_PRIVATE_KEY  ASCII-armored private signing key
#   GPG_PASSPHRASE   passphrase for that key
#
# Produces a yum repo tree under <out_dir> (packages/, repodata/) with signed
# rpms and a signed repomd.xml.asc, ready to serve at
# https://repo.voltius.app/rpm. Stateless: rebuilt from scratch each run. Every
# rpm in the pool is published, so multiple versions coexist.
set -euo pipefail

RPM_DIR="${1:?usage: build-yum-repo.sh <rpm_dir> <out_dir>}"
OUT_DIR="${2:?usage: build-yum-repo.sh <rpm_dir> <out_dir>}"
: "${GPG_PRIVATE_KEY:?GPG_PRIVATE_KEY env required}"
: "${GPG_PASSPHRASE:?GPG_PASSPHRASE env required}"

shopt -s nullglob
rpms=( "$RPM_DIR"/*.rpm )
(( ${#rpms[@]} )) || { echo "no .rpm files in $RPM_DIR" >&2; exit 1; }

# --- isolated GPG keyring; cache passphrase in the agent so rpm --addsign and
#     the repomd signature both sign non-interactively ---
GNUPGHOME="$(mktemp -d)"; export GNUPGHOME; chmod 700 "$GNUPGHOME"
trap 'gpgconf --kill gpg-agent 2>/dev/null || true; rm -rf "$GNUPGHOME"' EXIT
printf 'allow-preset-passphrase\nallow-loopback-pinentry\n' > "$GNUPGHOME/gpg-agent.conf"
gpgconf --kill gpg-agent 2>/dev/null || true
printf '%s' "$GPG_PRIVATE_KEY" | gpg --batch --import 2>/dev/null
FPR="$(gpg --list-secret-keys --with-colons | awk -F: '/^fpr:/{print $10; exit}')"
KEYGRIP="$(gpg --list-secret-keys --with-keygrip --with-colons | awk -F: '/^grp:/{print $10; exit}')"
gpg-connect-agent /bye >/dev/null 2>&1 || true
"$(gpgconf --list-dirs libexecdir)/gpg-preset-passphrase" --preset "$KEYGRIP" <<<"$GPG_PASSPHRASE"
echo "Signing yum repo with key $FPR"

# --- layout: copy rpms into the pool ---
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/packages"
cp -f "${rpms[@]}" "$OUT_DIR/packages/"

# --- sign each rpm (rpm's default sign command uses gpg-agent's cached pass) ---
rpm --define "_gpg_name $FPR" --addsign "$OUT_DIR"/packages/*.rpm

# --- repo metadata, then detached-sign repomd.xml for repo_gpgcheck ---
createrepo_c --quiet "$OUT_DIR"
gpg --batch --yes --detach-sign --armor --local-user "$FPR" "$OUT_DIR/repodata/repomd.xml"

echo "yum repo built at $OUT_DIR"
find "$OUT_DIR" -maxdepth 2 -type f | sort
