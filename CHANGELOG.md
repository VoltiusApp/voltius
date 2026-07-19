# Changelog

All notable changes to Voltius are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.3] - 2026-07-19

### Fixed

- Auto port-forwarding no longer hijacks a local port that another process
  already uses. On Windows, connecting to a Docker-published service on
  `127.0.0.1` (e.g. MongoDB on `27017`) could reach Voltius's tunnel instead of
  the real service; Voltius now detects the in-use port and falls back to the
  next free one (#33)

## [0.9.2] - 2026-07-13

### Fixed

- SSH Config Sync and GitHub Gist Sync no longer keep syncing after the plugin
  is disabled — a disabled plugin now stays fully inert (no file watcher, no
  background sync, no push on quit)
- SFTP file panes now remember the "show hidden files" setting across panes,
  sessions, and relaunches, so dotfiles stay visible once you enable them

## [0.9.1] - 2026-07-13

### Fixed

- macOS: the app bundle is now ad-hoc signed, so a directly downloaded `.dmg`
  no longer fails on Apple Silicon with "Voltius.app is damaged and cannot be
  opened"; the standard Gatekeeper prompt appears instead

## [0.9.0] - 2026-07-05

### Added

- Multi-language support — the entire app can now run in French, selectable
  from a new language picker in Appearance settings (built on i18next)
- Snippet sequences — build multi-step snippets from script, file-transfer, and
  nested-snippet steps, run them across multiple hosts with variable prompts,
  choose a per-target conflict policy for transfers, and see a run-summary
  toast; includes a mobile step-list editor
- In-app bug reporting — generate a redacted diagnostics zip from a new
  Diagnostics settings section (or the command palette, dropdown, about page,
  and error toasts), backed by unified logging with a verbose toggle
- SFTP file-pane clipboard and keyboard navigation — copy/cut/paste files
  including across hosts, Explorer-style navigation keys (Backspace to go up,
  Alt-arrows for history, Home/End, Esc, F5 to refresh), and type-ahead search

## [0.8.1] - 2026-07-02

### Fixed

- Windows OpenSSH sessions that connected but showed a blank terminal now fall
  back to a plain shell
- Host metrics sparklines reset when switching hosts, so a newly selected host
  no longer briefly shows the previous host's graph data

## [0.8.0] - 2026-06-30

### Added

- SFTP intra-pane drag-to-move — drag files within a pane, including onto
  parent and breadcrumb drop targets, in both the terminal SFTP panel and
  fullscreen panes

### Fixed

- Ports tab badge counts the current host instead of all sessions
- Port-forward tunnels are cancelled on teardown so the local listener is freed
- WSL distro is pre-warmed so cold-start sessions don't hang
- Git Bash launches correctly (the `--rcfile` argument is passed before `-i`)
- Docker stack services refresh on poll and after actions
- Dropped a redundant SFTP panel drag ghost

## [0.7.1] - 2026-06-28

### Fixed

- Windows and macOS builds — renamed a mobile-terminal helper module so its
  filename no longer collides with a component file by letter case only, which
  broke the build on case-insensitive filesystems

## [0.7.0] - 2026-06-28

### Added

- Port forwarding panel overhaul — inline quick-forward row to create ad-hoc
  tunnels, save ad-hoc/auto tunnels as named rules with inline rename, copy
  localhost:port from active tunnel rows, an active-tunnel count badge on the
  ports rail icon, and a panel header with active count and section labels
- Auto port-forwarding is now shared across all terminals of the same host
  instead of being set up per-terminal
- Mobile terminal gestures — swipe-to-scroll, long-press text selection with a
  copy/paste toolbar, blank-area paste, and double-tap for Tab
- OSC 52 clipboard support, with a shared copy/paste helper across the terminal
- Per-connection toggle for legacy SSH algorithms, for connecting to old devices
- SFTP "follow cwd" now works through tmux and screen by polling the multiplexer

### Fixed

- New-session host status dot now reflects true reachability
- Pane close button closes the session instead of just detaching it
- Mobile terminal toolbar fixes — Copy now works, the toolbar is positioned
  correctly and closes on teardown, and swipe-scroll no longer triggers a stray
  tap

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
