# Changelog

All notable changes to Voltius are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-06-25

### Added

- Built-in code editor for remote files — open and edit files over SFTP, edit
  local files, and diff local↔remote or across hosts, powered by CodeMirror 6
  with syntax highlighting for many languages and theming from the app palette
- VS Code-style editor tab bar — drag tabs to reorder, drag a tab into the
  editor area to open a diff, tab overflow handling, and type icons
- Diff view with apply ribbons, prev/next chunk navigation, collapse-unchanged,
  editable diffs with undo/redo, and color-coded chunks (green add / red delete
  / yellow modified)
- Auto-save — global and per-editor toggle, manual or debounced save, and a
  configurable max file size
- Double-click to open, dirty-close guard, and non-destructive save-error
  handling
- FTP and FTPS support

## [0.5.1] - 2026-06-18

### Fixed

- Linux: produce the aarch64 (ARM) packages again — the build host now ships
  xdg-open, which the URL-opener plugin needs to bundle into the AppImage

## [0.5.0] - 2026-06-18

### Added

- Voltius for Android — the full app now runs on Android (signed arm64 APK),
  with the terminal, hosts and folders, snippets, SFTP, Docker/metrics/processes
  panels, Proxmox, native keychain, and SAF download folders
- Updater: download banner and external-update status for installs that can't
  self-update
- Install options: Homebrew cask, winget, apt/yum package repos, and a client
  `setup.sh`

### Fixed

- Linux: the keychain now persists via the Secret Service instead of volatile
  kernel keyutils
- Updater: surface install errors instead of silently restarting, guard against
  concurrent update checks, and stop reusing a cross-session disk cache

## [0.4.0] - 2026-06-12

### Added

- Persistent SSH sessions via tmux/screen, enabled by default
- Cross-device shared sessions — pick up live sessions from another device
- Restore workspace on launch, behind a restore-workspace toggle
- New Session quick-launcher popover from the + button
- Ephemeral ssh/serial/local quick-connect from OmniSearch
- Local shell profiles as a Local section in the New Session popover and OmniSearch
- "Connect & Save" creates or updates a saved host for ephemeral connections
- Copy hostname/IP from the host context menu

### Changed

- Glass cards and glossy icon tiles for team & remote-device session cards
- Vault header content now counts as icon + count

### Fixed

- Default keepalive to balanced across frontend and backend, with stored-preference migration
- Short-circuit personal-vault writes before the keychain read (vault auth)

## [0.3.1] - 2026-06-09

### Changed

- Linux: the Termius importer now reads the master key through the system
  libsecret instead of a bundled D-Bus client — simpler dependencies and a
  slightly smaller Linux binary, with no change to import behavior

## [0.3.0] - 2026-06-09

### Added

- In-app "What's New" changelog modal with consolidated update controls
- X (Twitter) link in the About section
- Per-host shell integration is now inherit-aware
- SSH auto-retries transient connection failures, with configurable keepalive

### Changed

- Redesigned the interface around a unified glass/depth design language —
  grid cards, modals, buttons, toggles, form fields, command palette, and
  object avatars now share consistent elevation, focus rings, and surfaces

### Fixed

- Closing a pane in a multi-pane tab now preserves its siblings
- Closing a multi-pane tab removes its sessions synchronously
- SSH falls back to POSIX sh integration when the remote lacks bash
- Partial connection updates are routed correctly through the form mapper
- Inherited shell-integration toggle is no longer visually dimmed
- Text selection is suppressed while dragging panes

## [0.2.2] - 2026-06-08

### Fixed

- macOS release build failing to compile: enable the `keychain` feature on `apple-native-keyring-store` (required on macOS)

## [0.2.1] - 2026-06-08

### Fixed

- Termius import on Linux now reads the master key from the Secret Service (libsecret), fixing "Termius key not found in OS keychain" (#12)

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
