#!/usr/bin/env bash
# Voltius repository installer — adds the Voltius apt or yum repository and its
# signing key, then installs Voltius. Run as root:
#
#   curl -fsSL https://repo.voltius.app/setup.sh | sudo bash
#
# After this, Voltius updates arrive through your normal `apt upgrade` /
# `dnf upgrade`.
set -euo pipefail

REPO_BASE="https://repo.voltius.app"
KEY_URL="$REPO_BASE/voltius.gpg"

if [ "$(id -u)" -ne 0 ]; then
  echo "This script must run as root. Try:" >&2
  echo "  curl -fsSL $REPO_BASE/setup.sh | sudo bash" >&2
  exit 1
fi

if command -v apt-get >/dev/null 2>&1; then
  echo "==> Configuring the Voltius apt repository"
  apt-get update -qq
  apt-get install -y -qq curl gnupg ca-certificates >/dev/null
  install -d -m 0755 /usr/share/keyrings
  curl -fsSL "$KEY_URL" | gpg --dearmor --yes -o /usr/share/keyrings/voltius.gpg
  echo "deb [signed-by=/usr/share/keyrings/voltius.gpg] $REPO_BASE/deb stable main" \
    > /etc/apt/sources.list.d/voltius.list
  apt-get update -qq
  apt-get install -y voltius
  echo "==> Done. Voltius will update via 'apt upgrade'."
elif command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
  PM="$(command -v dnf || command -v yum)"
  echo "==> Configuring the Voltius yum repository"
  rpm --import "$KEY_URL"
  curl -fsSL "$REPO_BASE/voltius.repo" -o /etc/yum.repos.d/voltius.repo
  "$PM" install -y voltius
  echo "==> Done. Voltius will update via '$(basename "$PM") upgrade'."
elif command -v pacman >/dev/null 2>&1; then
  # AUR helpers refuse to run as root, so build as the user who invoked sudo.
  AUR_HELPER="$(command -v paru || command -v yay || true)"
  if [ -z "$AUR_HELPER" ] || [ -z "${SUDO_USER:-}" ] || [ "$SUDO_USER" = root ]; then
    echo "Arch: Voltius is on the AUR as voltius-bin. Install it with an AUR helper as your user:" >&2
    echo "  yay -S voltius-bin" >&2
    exit 1
  fi
  echo "==> Installing voltius-bin from the AUR with $(basename "$AUR_HELPER")"
  sudo -u "$SUDO_USER" "$AUR_HELPER" -S --needed --noconfirm voltius-bin
  echo "==> Done. Voltius will update via '$(basename "$AUR_HELPER") -Syu'."
else
  echo "Unsupported distribution: need apt-get, dnf/yum or pacman." >&2
  echo "See $REPO_BASE for manual instructions." >&2
  exit 1
fi
