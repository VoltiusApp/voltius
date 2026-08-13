# Changelog

All notable changes to Voltius are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.23.0] - 2026-08-13

### Added

- The MCP server can now send real keystrokes. `send_keys` types into any open
  session — literal text or named keys like `Enter`, `Up`, `Escape`, `C-c`,
  `F1`–`F12` — and returns the screen once it stops changing, so an agent can
  drive a full-screen program (top, less, fzf, vim, whiptail) that `run_command`
  structurally cannot: that verb wraps its input so it can read an exit code,
  and the wrapper is typed into such a program as literal text.
- Ten further verbs join it, taking the MCP surface from 48 to 59. Snippets can
  be run on a host, known hosts listed, trusted and deleted, and shell history
  searched across hosts. Transfers can be listed, cancelled and retried;
  configuration sync state and host reachability can be read.
- Transfers started over MCP now appear in your own transfer queue, marked with
  the name of the client that started them, and can be cancelled from there like
  any other transfer.
- Tabs a connected MCP client is driving are marked in the tab strip and the
  pane header, with the controlling client named in the tooltip, so it is always
  visible which sessions are not being driven by you.
- A failed transfer can be retried from the transfer queue.

### Fixed

- A local shell could come up blank, and starting the app a second time opened a
  second copy instead of focusing the running one.
- Opening a new split tab cloned the previous tab's terminals into it.
- A session opened by an MCP client no longer steals the tab you are working in.
- An SFTP handle evicted from the cache was dropped without being closed,
  leaking it on the server.
- A transfer being retried could be evicted from the queue mid-retry.
- Editing a port-forwarding rule or a snippet over MCP no longer needs the whole
  record restated, and a transfer that failed to start reports the real error
  instead of silently resolving.

## [0.22.0] - 2026-08-11

### Added

- The MCP server gained eleven verbs, taking its own surface to 48: snippets and
  port-forwarding rules can now be listed, created, updated and deleted, and a
  rule's tunnels started, stopped and inspected. Updates read-modify-write the
  current record, so naming one field no longer blanks a snippet's steps. A rule
  in a team vault can have its tunnel started but not edited, and starting one
  needs the gated `ports:forward` grant.
- Every object the MCP surface returns now reports which vault and folder it is
  filed in, and `object_move` / `object_copy` report the destination they wrote
  to — so an agent can confirm where something landed instead of guessing.

### Fixed

- Saving a snippet with a transfer step failed for every user, in the app's own
  UI as much as over MCP ("missing field `direction`"). Transfer steps now
  round-trip their full shape, including mode and conflict handling; snippets
  saved under the old shape still load.
- The SFTP file pane's header and rows are laid out on one shared grid: columns
  no longer drift apart when resized, the pane scrolls sideways instead of
  clipping the right-hand columns out of reach, and column widths and visibility
  survive a pane remount.
- The right-panel SFTP tab now rides the terminal's own SSH connection. It used
  to dial a second one that died on sleep, failing every operation with "Channel
  send error" until the app restarted.
- Alt-clicking a link inside a TUI that opens URLs itself (Claude Code) opened
  it twice; OSC 8 hyperlinks opened nothing at all. Both now go through the same
  policy.
- Downloading a missing path from a container, or checking whether one exists,
  could report success when the command's exit status was lost.
- A host-to-host directory transfer used the same temp archive name on both
  ends, so a same-host transfer collided with itself.
- The WSL distro list rendered twice in the host picker.
- The host picker's NEW HOST button did nothing visible and is gone.
- The theme badge no longer shows a meaningless infinity glyph.
- MCP refusals are marked explicitly instead of inferred from result shape.
- Importing a key through the UI now validates its public half.

## [0.21.1] - 2026-08-11

### Fixed

- Republishes 0.21.0, whose release only carried the Windows x64 installers and
  the Android APK. A network failure part-way through the build split the
  release in two, so the macOS, Linux and Windows ARM downloads never appeared
  and the updater manifest offered an update to Windows x64 only. No
  application code changed between 0.21.0 and 0.21.1.

## [0.21.0] - 2026-08-11

### Added

- Published container ports are now clickable everywhere Docker lists them —
  the container list, the stack view and the mobile screen. Clicking one opens
  it in your browser, or copies the address; a port on a remote host is
  tunnelled to this machine first, automatically, and an existing tunnel is
  reused.
- The MCP server gained eleven verbs, taking its own surface to 37 (52 with the
  bundled plugins' tools). An agent can now organise your vault, not just read
  and write inside it: `vault_list/create/rename/delete`,
  `folder_list/create/rename/delete`, `object_move` and `object_copy` — the same
  cut/copy-and-paste the pages do, including whole folder subtrees — and
  `key_add_to_host`, which appends a saved key's public half to a host's
  `authorized_keys` over SSH. Deleting a vault or folder cascades, moving
  objects into a different vault has to be asked for explicitly, and team vaults
  are refused throughout.
- Plugins gained four new gated namespaces mirroring that surface: `api.vaults`,
  `api.folders`, `api.objects` and `api.ports.reach`. Object moves are gated per
  object type rather than wholesale — a plugin allowed to file snippets cannot
  move your keys — and snippets and port forwarding rules now have their own
  write permissions. Every new permission ships with plain-language consent
  copy, and the install dialog now distinguishes read-only grants (a container
  list, a vault name) from the destructive ones.

### Fixed

- Ad-hoc port forwarding tunnels no longer die when their host reconnects, and
  tunnel channels now open on the session's current SSH handle — after a sleep
  or a dropped link, forwarding kept using the handle that was already gone.
- File panes keep working after the SSH link behind them is replaced, instead
  of failing every operation until the tab is reopened.
- The titlebar no longer swallows clicks on the close and new-tab buttons.
- Docker no longer lists the same published port twice when it is bound on both
  IPv4 and IPv6, and pressing Enter on a port chip in the mobile view acts on
  the chip instead of the row behind it.
- `ssh_exec_command` now reports a command's exit code and stderr rather than
  presenting a failed command as a success — this silently affected Proxmox
  actions.
- An MCP tool call that the app refuses is now returned to the client as an
  error instead of a successful result carrying a refusal message.

### Security

- Pinned js-yaml to 4.3.1 or later, clearing CVE-2026-59870.

## [0.20.0] - 2026-08-10

### Added

- A host's Shell integration override is now three-state — Inherit, On, Off —
  matching Persistent session. Before, the override could only turn shell
  integration off, so a host could never force it on while the global toggle was
  off. Existing hosts keep their behaviour: an override that said "disabled"
  becomes an explicit Off, everything else inherits.

### Fixed

- Closing the app no longer waits with the window still on screen while an
  enabled plugin runs its quit-time work — the Gist sync plugin's push to GitHub
  made closing take about two seconds. The window now closes immediately and the
  sync finishes in the background. Thanks to @Flash303 for the report and the
  fix.
- Persistent sessions now work against dropbear servers (OpenWrt/ImmortalWrt and
  other embedded targets). The bootstrap payload was base64-encoded twice and
  ran to 21,718 bytes with persistent sessions and shell integration both on,
  past dropbear's 9,000-byte limit, which killed the connection the moment
  authentication succeeded — the session appeared stuck on "Authenticating"
  forever.
- A host whose only Advanced override was Persistent session now shows the
  usual dirty dot when the section is collapsed, instead of hiding the override
  entirely. The two global toggle descriptions also name where the per-host
  overrides live.

## [0.19.0] - 2026-08-09

### Added

- Voltius can now act as an MCP server, so Claude Code and other MCP clients
  drive your infrastructure directly: 41 tools covering keys, identities,
  connections, sessions, commands and file transfers. It is off by default —
  turn it on in Settings → Integrations, which also carries the one-line client
  setup command and what granting a client this access means.
- Plugins can contribute their own MCP tools. With the server on, the bundled
  Docker, Proxmox, process manager and monitoring plugins contribute 15 verbs
  between them — container and image listings, LXC actions, snapshots, process
  listing and metrics — and each plugin can be excluded on its own.
- An MCP client can read its own audit trail through `audit_query`, behind a new
  danger-gated `audit:read` permission.
- Plugins get a gated SFTP file domain and a gated `api.mcp` capability for
  contributing tools.

### Fixed

- A Proxmox command that failed reported success. Creating, rolling back or
  deleting an LXC snapshot returned OK even when Proxmox refused the operation,
  so a rollback could target a snapshot that was never created.
- Creating a folder from the Snippets page put it in the Personal vault instead
  of the vault being viewed.
- Team-vault connections were adopted and rewritten by SSH config sync.
- Streaming a container's logs left a listener behind after the call finished.
- Russian was missing plural forms in the MCP integrations screen.

## [0.18.0] - 2026-08-06

### Added

- Pasting a host into another vault now carries its key and identity across, so
  the pasted host still connects instead of landing without credentials.
- `useT` and `useSessionById` are available to plugins from `@voltius/ui`.

### Fixed

- Renaming a folder moved it into the Personal vault. Any folder kept in another
  vault was silently relocated, taking everything filed in it along.
- Moving a key, identity, connection or folder to another vault unpinned it, as
  did renaming or reparenting a folder.
- Members of a team vault received a passphrase-protected connection key without
  its passphrase, so they could not connect. Both the current and the legacy
  storage paths now publish it.
- The folder picker in the host, serial-host, key and identity editors offered
  every page's folders, so a host could be filed into a keychain folder — the
  editor then showed it in a folder its own page does not list, leaving it
  sitting unfiled at the top level. Creating a folder from the key or identity
  editor made a host folder for the same reason.
- Pasting a copied object no longer appends "(copy)" when nothing of that name
  is there to collide with.

## [0.17.1] - 2026-08-05

### Added

- Plugins can record audit events through `api.audit.record`, behind a new
  danger-gated `audit` permission that has to be granted explicitly. The action
  set is closed, so a plugin cannot invent event types.
- `registerGlobalPanel` returns a control handle, letting a plugin open, close
  and resize its own panel.
- `ConnectionAvatar` and `ConfirmModal` are available to plugins from
  `@voltius/ui`.

### Fixed

- Pasting into another vault put the object back in the vault it came from.
  A vault's root now names that vault as the destination, so a paste there
  changes vault and asks for confirmation first. Cutting between two vault
  roots was also silently discarded as a no-op.

## [0.17.0] - 2026-08-05

### Added

- Cut, copy and paste for vault objects on Hosts, Keychain, Port Forwarding and
  Snippets — objects and folders alike. `Ctrl+X` / `Ctrl+C` / `Ctrl+V` by
  default, rebindable in Settings → Shortcuts, and offered in the right-click
  menu on a single item as well as on a multi-selection. A pill shows what is on
  the clipboard; `Escape` or its clear button empties it. Cut moves, copy
  duplicates, and the clipboard is kept after a copy so it can be pasted more
  than once.
- A paste that would move objects into a different vault asks for confirmation
  first, naming the destination.

### Changed

- Deleting a folder now deletes everything inside it, on every tab. Previously
  its contents were left behind — subfolders survived but became invisible.
  Because the delete now cascades, it can no longer be undone.
- A paste is refused when it would leave a reference pointing outside the
  destination vault: a host whose identity or key stays behind, a port
  forwarding rule whose host stays behind, or a snippet whose snippet-call
  target stays behind. Use "Move to vault", which brings the referenced objects
  along.

### Fixed

- Team vaults: moving any object out of a team vault failed with
  "Connection &lt;id&gt; not found".
- Team vaults: the write-permission check rejected every team vault as
  "Vault permission data is corrupted", and a team using a custom-named role
  with write permissions was refused locally even though the server allowed it.
- Team vaults: an object's password or key material stayed in the vault after
  the object left it, readable by everyone still in that vault. Removing an
  object from a team vault now removes its secrets too.
- Keychain: "Move to vault" and "Copy to vault" moved the key or identity
  without its key material, leaving it unusable in the destination.
- Snippets: folders belonging to a team vault were not shown on the Snippets
  page.
- Port forwarding: moving a rule between vaults gave it a new id, breaking
  anything that referenced it.
- Each paste is a single undo entry, and undo restores objects to the vault and
  folder they came from.

## [0.16.1] - 2026-08-04

### Fixed

- Snippets: a snippet's variable prompt was dismissed when the picker navigated
  away from the Snippets page, so the snippet ran with empty variables or did
  not run at all.

## [0.16.0] - 2026-08-04

### Added

- Hosts: a Pre/Post command can now be a saved snippet instead of a single
  inline command, and runs its whole sequence — multi-step, snippet calls and
  file transfers included. Pick one with the `{}` button beside either field.
  Snippet variables are prompted for on connect (and on disconnect for a
  post-command) and remembered per host; `password` variables are never
  remembered, and "Ask for variables each time" turns remembering off for a
  host. Inline commands are unchanged (#63).
- Snippets: a Community tab for browsing and installing snippets and packs from
  the public catalogue. Every step is shown exactly as it will run before you
  install, a snippet that calls another pulls its target in and says so, and
  what lands in your vault is a plain owned snippet.
- Snippets: "Share to community" on a snippet's or folder's menu turns it into a
  catalogue entry. Nothing is uploaded — you get the JSON to submit and a
  prefilled GitHub link. Before that it scans the steps for private keys,
  passwords, API tokens and routable hosts, and warns if it finds any.
- Hosts: the latency shown for a connected host is now measured over the SSH
  session itself instead of a separate connection.

### Fixed

- Hosts: connection status probing hammered hosts often enough that rate-limit
  firewalls (ufw `limit`, fail2ban) would lock users out of their own servers.
  Probes now run from a single scheduler with jitter, deduplicated per
  host:port, at much longer intervals (#90).
- Hosts: the status dot could flicker, and a stalled jump-host lookup could
  freeze a host's status indefinitely.
- Snippets: a snippet that calls another one imported as a dangling reference,
  because export carried a machine-local id. Nested calls now survive
  export/import, and an export that would produce a broken reference fails
  visibly instead of silently.
- Hosts: a post-command snippet resolved `{{connection.*}}` against the local
  shell instead of the host it just disconnected from.
- Hosts: when several snippet variables were prompted in a row, each prompt
  inherited the previous one's typed values, passwords included.
- Serial: the Pre/Post command fields on a serial connection were saved but
  never actually run, and closing a tab no longer waits for the port to be
  released.
- Links: external links on the signup screen, the changelog popup, the roles
  section and in Gist Sync did nothing when clicked. They now open in your
  browser.
- Themes: the drop shadow under page toolbars was a near-black smudge on light
  themes; it now follows the light-appearance shadow tokens.

## [0.15.1] - 2026-08-03

### Fixed

- SSH: connecting with an RSA key to an older server — notably OpenWrt routers
  running dropbear before 2020.79 — was rejected even though the server accepts
  the key. The signature algorithm is now taken from what the server says it
  supports (#85).
- SSH: a server that accepted the connection but never answered the
  authentication request left the app on "Authenticating" forever. It now stops
  with an explanation instead of waiting indefinitely.
- Plugins: the built-in plugins reported an update was available when their code
  was already identical to the published one.

## [0.15.0] - 2026-08-03

### Added

- Plugins: if none of the built-in plugins can load, the app now says so instead
  of quietly showing an empty plugin list.

### Fixed

- Plugins: plugin names in the right-hand rail and in Settings now follow the
  language you pick, instead of staying in whichever language the app started in.
- Plugins: a plugin that was disabled could still briefly publish its state after
  being switched off.
- Icons: the Docker and GitHub icons were fetched over the network, so they were
  blank on a first launch without internet. Every icon now ships with the app.

### Removed

- Plugins: the unimplemented `sidebarItems` and `contextMenuItems` plugin APIs,
  along with their permissions. Use `ui.registerContribution` instead.

### Security

- The app window now runs under a content security policy, so a plugin can no
  longer load remote code or reach an arbitrary host directly (#84).
- Plugins: a plugin can no longer replace the app's own icons.

## [0.14.1] - 2026-07-31

### Fixed

- Windows: the app could not be packaged at all, so 0.14.0 produced no Windows
  installers. Everything in 0.14.0 reaches Windows users with this release.

## [0.14.0] - 2026-07-31

### Added

- Plugins: the six built-in plugins — SSH Config Sync, GitHub Gist Sync, Metrics,
  Docker, Proxmox LXC and Process Manager — now run as ordinary plugins on the
  public plugin API. You can disable, uninstall and reinstall any of them, and
  they can receive fixes without waiting for a full app release.
- Plugins: your installed-plugin list now syncs, and a new device restores it
  automatically.
- Plugins: finer-grained permissions. Docker, Proxmox and Processes now separate
  read-only access from management, and read-only permissions appear as their own
  tier in the install dialog instead of being flagged as destructive.
- Plugins: `api.i18n`, so plugin authors can translate their interface.
- Plugins: installs are checked against the plugin's minimum app version, and a
  plugin's stylesheet is verified against a published hash before it is applied.
- Sessions: right-click a remote session to kill it, with an undo window before
  it takes effect.

### Fixed

- Proxmox: snapshot names were read with a leading tree character, which broke
  rolling back and deleting snapshots (#83).
- Plugins: plugin ids are now validated consistently at install and load (#79).

### Security

- Docker: container and stack identifiers are now shell-quoted when building
  remote commands, so a name containing shell metacharacters cannot alter the
  command that runs on the host.

## [0.13.0] - 2026-07-29

### Added

- Simplified Chinese (简体中文) interface language, contributed by
  [@CoconutHR](https://github.com/CoconutHR). Pick it under Appearance settings;
  like every language, it syncs across your devices.
- Plugins: an update flow. Voltius now detects when an installed plugin has a
  newer version, offers a one-click update, and asks you to re-consent if the
  update declares permissions you had not already granted (#52).
- Plugins: bundle integrity. A plugin's bundle hash is verified on install and
  recorded, plugins that cannot be verified carry an "unverified" badge, and
  install failures are surfaced instead of failing quietly (#44).
- Plugins: new capabilities for plugin authors — session open/close lifecycle
  verbs, a streaming `http.stream` verb backed by server-sent events, terminal
  reading (snapshot and live stream), selection reading, and OS-keychain storage
  for plugin secrets.
- Plugins: two new UI surfaces — a shell-level panel mount and a reusable
  `titlebar.right` status-bar slot.
- Settings: plugin pages now appear as expandable children under the Plugins
  nav entry rather than as flat top-level items, on both desktop and mobile.
- SFTP: a "Copy path" action in the file-row context menu on desktop (#62).
- Sync: an exclusion filter, so objects you exclude are stripped from outbound
  sync on push, on pull merge, and from the gist-sync export path (#43, #47).
- Themes: Dracula and Monokai reworked with real elevation and text ramps
  instead of flat approximations (#40, #60).

### Fixed

- Terminal: the wheel and touchpad now scroll full-screen terminal apps (vim,
  less, htop) instead of doing nothing, and Select-to-Copy is respected there
  (#50).
- Team vaults: members who accepted an invitation while the vault owner was
  offline could be left without a vault key and silently unable to decrypt.
  Key distribution is now reconciled for those members (#41, #49).
- Audit log: the local per-vault log is capped, so a full quota can no longer
  silently stop recording new entries.
- Settings: the About-page links and the update-download button now open.
- Themes: on-accent text now picks its colour at the WCAG 0.179 luminance
  crossover, fixing low-contrast label text on some accent colours.
- Interface languages: corrected the Select-to-Copy setting description.

### Security

- Plugins: the gated capability tier — reading, watching, and typing into your
  terminal sessions, plus per-plugin keychain storage — is now grantable to
  third-party marketplace plugins behind explicit, danger-styled install-time
  consent. It was previously first-party-only. The install and update dialogs
  now show every declared permission in plain language, with the powerful ones
  called out in a separate warning block; a plugin that declares one always
  prompts for consent, even when install review is turned off. Command injection
  (`sessions.sendCommand`) moved from the public `sessions:write` permission to
  a new gated `terminal:write`, split from terminal reading. Keychain storage is
  now isolated per plugin (keys are namespaced `plugin:<id>:`), so one plugin can
  no longer read or overwrite another's secrets. No installed plugin gains
  anything without a fresh consent, and no shipped build exposed cross-plugin
  keychain data. Side-loaded and locally-scanned plugins still load without a
  consent prompt — writing to the plugins folder already implies full app
  privileges — so only install a local bundle you trust.
- Updated the bundled `quinn-proto` dependency to 0.11.15, picking up the fix
  for GHSA-4w2j-m93h-cj5j (#82).

## [0.12.0] - 2026-07-22

### Added

- Light/dark theme switching — switch manually from the Command Palette, the
  sidebar account menu, or Appearance settings, with live preview as you browse
- Automatic theme switching — follow the system appearance, a fixed schedule, or
  local sunrise/sunset
- New built-in "Voltius Light" theme
- Importing an SSH config now adopts existing matching connections instead of
  creating duplicates (#39)

### Changed

- Terminal behavior toggles (scrollback, minimap, select-to-copy, plain paste)
  now live in their own dedicated Terminal settings section (#37)

### Fixed

- Session cards no longer clip their shadows at the scroll edge (team and
  cross-device sessions)

## [0.11.0] - 2026-07-21

### Added

- Search within the Docker panel — a per-sub-tab find-bar filters resources live
  as you type, and Ctrl+F focuses it
- Redesigned snippet step editor — drag to reorder step cards with a clearer
  visual hierarchy, plus a slide-over picker for choosing remote paths

### Fixed

- Sync: a secret you changed locally is no longer overwritten by a stale copy
  from the server (#35)

## [0.10.1] - 2026-07-20

### Fixed

- Android: native IME bridge so the on-screen keyboard types into the terminal
  correctly, and the keyboard now dismisses when the terminal unmounts (#34)

## [0.10.0] - 2026-07-19

### Added

- Per-host notes — attach freeform notes to any host, kept in sync with the
  host's data
- Plain-paste toggle for the terminal — bypass bracketed paste when a remote
  program mishandles it
- Russian language support, selectable from the language picker in Appearance
  settings (#26)

### Fixed

- Country flag emoji now render as actual flags on Windows instead of
  two-letter codes (#31)
- Linux: worked around a WebKitGTK white-screen on AppImage under Wayland
- SSH: shell-integration wrappers now inherit the pty, so commands like
  `sudo -i` behave correctly

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
