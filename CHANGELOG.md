# Changelog

All notable changes to Voltius are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-06-06

### Added

- Badge tar-accelerated transfers in the transfer queue
- Fall back to plain transfer when tar is unavailable
- Local-to-local SFTP transfers with progress
- Cancel-all button in the transfer queue
- Browse WSL distros as local SFTP hosts
- Toolbar layout controls replaced with always-visible icon pills
- Single and bulk export for snippets and PF rules

### Fixed

- Solid background for InfoTooltip
- Remote read handles now closed to prevent handle-limit exhaustion
- Symlinks dereferenced for tar downloads to local Windows paths
- Clipboard now uses native Tauri plugin to avoid WebView permission prompt
- Right-panel search results deduplicated when no folders exist
- No longer navigates into a folder when confirming its deletion
- Docked transfer queue styling matches global widget style

### Security

- Bumped russh 0.60 → 0.61.1 (fixes 3 SSH advisories)
- Bumped tar 0.4.45 → 0.4.46 (fixes GHSA-3pv8-6f4r-ffg2)

## [0.1.54] - 2026-06-03

### Added

- macOS `.dmg` installers, plus `.app` updater artifacts so macOS auto-updates work.

## [0.1.52] - 2026-06-03

### Added

- Fedora / RHEL builds: releases now include a native `.rpm` package, installable
  with `sudo dnf install ./Voltius-*.x86_64.rpm`.

### Fixed

- Release build profile settings are now applied (they were previously ignored),
  producing roughly 10% smaller binaries.
