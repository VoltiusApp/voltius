#!/usr/bin/env bash
# Publish the Voltius apt + yum repositories to Cloudflare R2 from the last N
# GitHub releases. Stateless: downloads packages, rebuilds both repos from
# scratch, smoke-tests a real install of each, then rclone-syncs to R2.
#
# Required env:
#   GPG_PRIVATE_KEY, GPG_PASSPHRASE              package signing key
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY     R2 S3 credentials (sync only)
# Optional env:
#   REPO            default VoltiusApp/voltius
#   KEEP            number of releases to publish (default 5)
#   R2_ACCOUNT_ID   default 53d3281538d40462e3d5773cfa2490ec
#   R2_BUCKET       default voltius-repo
#   DEB_PREFIX      R2 path prefix for apt repo (default "deb")
#   RPM_PREFIX      R2 path prefix for yum repo (default "rpm")
#   SKIP_SYNC=1     build + smoke-test only, do not touch R2
#
# Requires: gh, docker, rclone.
set -euo pipefail

REPO="${REPO:-VoltiusApp/voltius}"
KEEP="${KEEP:-5}"
R2_ACCOUNT_ID="${R2_ACCOUNT_ID:-53d3281538d40462e3d5773cfa2490ec}"
R2_BUCKET="${R2_BUCKET:-voltius-repo}"
DEB_PREFIX="${DEB_PREFIX:-deb}"
RPM_PREFIX="${RPM_PREFIX:-rpm}"
: "${GPG_PRIVATE_KEY:?GPG_PRIVATE_KEY required}"
: "${GPG_PASSPHRASE:?GPG_PASSPHRASE required}"

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/debs" "$WORK/rpms" "$WORK/out"

echo "==> Downloading last $KEEP releases' packages from $REPO"
mapfile -t tags < <(gh release list -R "$REPO" -L 50 \
  --json tagName,isDraft,isPrerelease \
  -q '[.[] | select(.isDraft==false and .isPrerelease==false)] | .[0:'"$KEEP"'] | .[].tagName')
(( ${#tags[@]} )) || { echo "no published releases found" >&2; exit 1; }
for t in "${tags[@]}"; do
  echo "  - $t"
  gh release download "$t" -R "$REPO" -p '*.deb' -D "$WORK/debs" --clobber 2>/dev/null || true
  gh release download "$t" -R "$REPO" -p '*.rpm' -D "$WORK/rpms" --clobber 2>/dev/null || true
done
echo "  collected $(ls "$WORK/debs"/*.deb 2>/dev/null | wc -l) debs, $(ls "$WORK/rpms"/*.rpm 2>/dev/null | wc -l) rpms"

echo "==> Building apt repo (debian container)"
docker run --rm -e GPG_PRIVATE_KEY -e GPG_PASSPHRASE \
  -v "$SCRIPTS:/scripts:ro" -v "$WORK:/w" debian:stable bash -euc '
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq && apt-get install -y -qq apt-utils gnupg gzip >/dev/null
    /scripts/build-apt-repo.sh /w/debs /w/out/deb >/dev/null
    echo "  apt repo built"'

echo "==> Building yum repo (fedora container)"
docker run --rm -e GPG_PRIVATE_KEY -e GPG_PASSPHRASE \
  -v "$SCRIPTS:/scripts:ro" -v "$WORK:/w" fedora:latest bash -euc '
    dnf install -y -q createrepo_c rpm-sign gnupg2 >/dev/null
    /scripts/build-yum-repo.sh /w/rpms /w/out/rpm >/dev/null
    echo "  yum repo built"'

# Containers write $WORK as root; hand it back to the host user (sync + cleanup)
# and make it world-traversable so apt's sandbox (_apt) user can read the repo
# over the file: transport during the smoke test.
docker run --rm -v "$WORK:/w" debian:stable \
  bash -c 'chown -R '"$(id -u):$(id -g)"' /w && chmod -R a+rX /w' 2>/dev/null || true

echo "==> Smoke-test: apt install from the built repo (debian container)"
docker run --rm -e GPG_PRIVATE_KEY -v "$WORK:/w:ro" debian:stable bash -euc '
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq && apt-get install -y -qq gnupg ca-certificates >/dev/null
    H=$(mktemp -d); printf "%s" "$GPG_PRIVATE_KEY" | GNUPGHOME=$H gpg --batch --import 2>/dev/null
    install -d /usr/share/keyrings
    GNUPGHOME=$H gpg --export > /usr/share/keyrings/voltius.gpg
    echo "deb [signed-by=/usr/share/keyrings/voltius.gpg] file:/w/out/deb stable main" > /etc/apt/sources.list.d/voltius.list
    apt-get update -qq
    apt-get install -y voltius >/dev/null
    dpkg -s voltius | grep -q "Status: install ok installed"
    echo "  apt smoke-test OK ($(dpkg-query -W -f="\${Version}" voltius))"'

echo "==> Smoke-test: dnf install from the built repo (fedora container)"
docker run --rm -e GPG_PRIVATE_KEY -v "$WORK:/w:ro" fedora:latest bash -euc '
    dnf install -y -q gnupg2 >/dev/null
    H=$(mktemp -d); printf "%s" "$GPG_PRIVATE_KEY" | GNUPGHOME=$H gpg --batch --import 2>/dev/null
    GNUPGHOME=$H gpg --armor --export > /tmp/voltius.gpg
    rpm --import /tmp/voltius.gpg
    cat > /etc/yum.repos.d/voltius.repo <<R
[voltius]
name=Voltius
baseurl=file:///w/out/rpm
enabled=1
gpgcheck=1
gpgkey=file:///tmp/voltius.gpg
R
    dnf install -y voltius >/dev/null
    rpm -q voltius
    echo "  dnf smoke-test OK"'

if [ "${SKIP_SYNC:-}" = "1" ]; then
  echo "==> SKIP_SYNC=1 set; built + smoke-tested, not syncing to R2."
  exit 0
fi

: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID required for sync}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY required for sync}"
echo "==> Syncing to R2 bucket $R2_BUCKET (/$DEB_PREFIX, /$RPM_PREFIX)"
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY"
# sync mirrors source→dest (deletes stale objects beyond the last $KEEP), scoped
# to /deb and /rpm so top-level files (voltius.gpg, setup.sh, voltius.repo) stay.
rclone sync "$WORK/out/deb" "R2:${R2_BUCKET}/${DEB_PREFIX}" --checksum --fast-list
rclone sync "$WORK/out/rpm" "R2:${R2_BUCKET}/${RPM_PREFIX}" --checksum --fast-list
echo "==> Published: https://repo.voltius.app/${DEB_PREFIX}  https://repo.voltius.app/${RPM_PREFIX}"
