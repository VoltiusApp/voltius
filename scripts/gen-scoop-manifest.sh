#!/usr/bin/env bash
# Emits the Scoop manifest for Voltius to stdout.
# Usage: gen-scoop-manifest.sh <tag>   e.g. gen-scoop-manifest.sh v0.27.0
#
# The manifest carries `checkver` + `autoupdate`, so once it is merged into
# ScoopInstaller/Extras their excavator bot bumps the version and re-reads the
# .sha256 assets on every release without any push from us. This script only
# has to produce the FIRST submission (and to regenerate it if the asset naming
# ever changes) — it is deliberately not wired into the release workflow.
#
# Requires: gh (authenticated), awk.
set -euo pipefail

TAG="${1:?usage: gen-scoop-manifest.sh <tag>}"

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/release-assets.sh"
release_assets_init "$TAG"

SHA_X64="$(release_sha "$(release_asset x64-setup.exe)")"
SHA_ARM64="$(release_sha "$(release_asset arm64-setup.exe)")"

cat <<EOF
{
    "version": "${VERSION}",
    "description": "Local-first SSH/SFTP/Serial client with E2EE sync, team vaults and plugins",
    "homepage": "https://voltius.app",
    "license": "AGPL-3.0-or-later",
    "architecture": {
        "64bit": {
            "url": "https://github.com/${REPO}/releases/download/${TAG}/Voltius_${VERSION}_x64-setup.exe#/setup.exe",
            "hash": "${SHA_X64}"
        },
        "arm64": {
            "url": "https://github.com/${REPO}/releases/download/${TAG}/Voltius_${VERSION}_arm64-setup.exe#/setup.exe",
            "hash": "${SHA_ARM64}"
        }
    },
    "installer": {
        "script": [
            "Start-Process -FilePath \"\$dir\\\\setup.exe\" -ArgumentList '/S' -Wait",
            "Remove-Item \"\$dir\\\\setup.exe\" -Force"
        ]
    },
    "uninstaller": {
        "script": [
            "\$keys = @('HKCU:\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\*', 'HKLM:\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\*')",
            "\$entry = Get-ItemProperty \$keys -ErrorAction SilentlyContinue | Where-Object { \$_.DisplayName -eq 'Voltius' } | Select-Object -First 1",
            "\$uninst = if (\$entry -and \$entry.UninstallString) { \$entry.UninstallString.Trim('\"') } else { Join-Path \$env:LOCALAPPDATA 'Voltius\\\\uninstall.exe' }",
            "if (Test-Path \$uninst) { Start-Process -FilePath \$uninst -ArgumentList '/S' -Wait } else { Write-Host \"no uninstaller found at \$uninst\" }"
        ]
    },
    "checkver": {
        "github": "https://github.com/${REPO}"
    },
    "autoupdate": {
        "architecture": {
            "64bit": {
                "url": "https://github.com/${REPO}/releases/download/v\$version/Voltius_\$version_x64-setup.exe#/setup.exe",
                "hash": {
                    "url": "https://github.com/${REPO}/releases/download/v\$version/Voltius_\$version_x64-setup.exe.sha256"
                }
            },
            "arm64": {
                "url": "https://github.com/${REPO}/releases/download/v\$version/Voltius_\$version_arm64-setup.exe#/setup.exe",
                "hash": {
                    "url": "https://github.com/${REPO}/releases/download/v\$version/Voltius_\$version_arm64-setup.exe.sha256"
                }
            }
        }
    }
}
EOF
