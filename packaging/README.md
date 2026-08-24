# Packaging channels

Where Voltius is published, and what each channel needs from a human.

Automated channels live in `.github/workflows/publish-installers.yml`, which
`tag-release.yml` calls once a release is published. Their generators are in
`scripts/`, sharing `scripts/lib/release-assets.sh` for the "read the sha256 of
a named release asset" step every channel needs.

| Channel | Manifest source | Kept current by |
| --- | --- | --- |
| Homebrew tap | `scripts/gen-homebrew-cask.sh` | `publish-installers.yml` on every release |
| winget | komac | `publish-installers.yml` on every release |
| AUR (`voltius-bin`) | `scripts/gen-aur-pkgbuild.sh` | `publish-installers.yml` on every release |
| apt / yum | `scripts/build-apt-repo.sh`, `scripts/build-yum-repo.sh` | `publish-repo.yml` on every release |
| Microsoft Store | `packaging/msix/`, `scripts/build-msix.ps1` | **retired** — no tenant for the submission API, see below |
| Scoop | `scripts/gen-scoop-manifest.sh` | Scoop's excavator bot, after the first merge |
| Flathub | — | **abandoned** — submission rejected, files removed, see below |

Scoop has no job here on purpose: its manifest carries `checkver`, so the
excavator bot follows new releases once the manifest is merged.

## One-time setup, per channel

### AUR

The release job pushes to `ssh://aur@aur.archlinux.org/voltius-bin.git`, which
requires:

1. An AUR account with an SSH public key registered on it.
2. The matching private key stored as the `AUR_SSH_PRIVATE_KEY` repository
   secret. Without it the `aur` job warns and skips, so releases keep working.
3. The first push creates the package — the AUR has no separate "submit" step.

Verify a PKGBUILD locally before the first push:

```bash
bash scripts/gen-aur-pkgbuild.sh v0.27.0 > /tmp/aur/PKGBUILD
docker run --rm -v /tmp/aur:/w archlinux:base-devel bash -euc '
  useradd -m b && chown -R b /w
  su b -c "cd /w && makepkg --printsrcinfo > .SRCINFO && makepkg -f --nodeps --noconfirm"
'
```

### Scoop

One PR adding the generated manifest to
[`ScoopInstaller/Extras`](https://github.com/ScoopInstaller/Extras) as
`bucket/voltius.json`:

```bash
bash scripts/gen-scoop-manifest.sh v0.27.0
```

The manifest carries `checkver` + `autoupdate`, so Scoop's excavator bot follows
releases afterwards and nothing here has to run again.

The install and uninstall scripts drive the NSIS installer with `/S` and assume
Tauri's per-user install location (`%LOCALAPPDATA%\Voltius`). **Test both on a
real Windows machine before opening the PR** — nothing in CI exercises them.

### Flathub — abandoned 2026-08-24

**Not a Voltius channel, and the files are gone.** `packaging/flatpak/` and
`scripts/gen-flatpak-manifest.sh` were removed with this section; recover them
from git history if this is ever revisited.

The manifest worked. It built with `flatpak-builder` against
`org.gnome.Platform//50` on aarch64, `appstreamcli compose` and
`desktop-file-validate` passed, and the resulting Flatpak installed and ran.

The submission did not. flathub/flathub#9821 was closed automatically —
"Checklist(s) not completed or missing", because the PR description replaced the
mandatory template instead of filling it in — and was labelled **AI Slop** by the
maintainers. The bot forbids opening a replacement PR; the only way back in is a
comment on the closed one, and it must carry a video of the app running from the
Flatpak on Linux. Between the video and a submission already marked as
low-quality, the channel was not worth pursuing.

Three things worth keeping if it ever is:

- The app id is `app.voltius.Voltius`, matching the `voltius.app` domain rather
  than the Tauri identifier (`com.voltius.app`), because Flathub verification
  checks the id against a domain the publisher controls.
- Three linter errors were expected and deliberate, each needing a written
  exception: `finish-args-home-filesystem-access` (SFTP has to reach the local
  side of a transfer, and `~/.ssh` is where imported keys live),
  `finish-args-has-socket-ssh-auth` (agent forwarding), and
  `finish-args-flatpak-spawn-access` (the local-terminal feature opens the user's
  real shell; without host spawn it silently becomes a shell inside the sandbox).
- The submission PR must go against the `new-pr` base branch, and the checklist
  in flathub/flathub's pull request template must be completed literally.

The in-app updater needed no change either way: a Flatpak install has no
`APPIMAGE` environment variable, so `classify_install` already reports it as
externally updated rather than writing to the read-only `/app`.

### Microsoft Store — retired 2026-08-24

**The Store is not a Voltius channel.** The listing was reserved, submitted by
hand at 0.28.0, certified, and then unpublished. `tag-release` does not call
`publish-msix.yml`. Nothing here needs maintaining; this section records why, so
the decision does not get re-litigated from scratch.

What worked: registration is free for individual accounts, and the MSIX path
needs **no code-signing certificate** — the Store re-signs MSIX on submission.
(Submitting the NSIS `.exe` instead would require a certificate chaining to the
Microsoft Trusted Root Program.) The package built, bundled, passed
certification and installed.

What killed it was authentication, not packaging. The Store submission API
accepts exactly one credential: a Microsoft Entra application. An Entra
application needs an Entra tenant. A Partner Center account opened with a
personal Microsoft account has no tenant, and every route to creating one for
free now dead-ends in a paid Microsoft 365 signup:

- Partner Center → Account settings → Tenants → *Create* redirects to the
  "Microsoft for your business" flow, which ends at a payment step.
- The Azure portal refuses a personal account outright: "the selected user
  account does not exist in tenant Microsoft Services".
- Signing up at azure.microsoft.com/free does create a tenant, but requires a
  card for identity verification.

So the choice was a card, a manual upload per release, or dropping the channel.
The channel was dropped. A listing frozen at one version is worse than no
listing: an MSIX installs under `C:\Program Files\WindowsApps`, which is
unwritable, so `classify_install` reports it as externally updated and the
in-app updater deliberately does nothing — Store users would never be offered a
newer version at all.

**If this is ever revisited** (a tenant becomes available, or Microsoft reopens
free tenant creation), nothing has to be rebuilt:

1. Set the secrets `AZURE_AD_TENANT_ID`, `AZURE_AD_APPLICATION_CLIENT_ID`,
   `AZURE_AD_APPLICATION_SECRET`, `SELLER_ID` and the variable
   `MSSTORE_PRODUCT_ID` (the Store ID, `9P8VC6P11R4D`).
2. Republish the listing in Partner Center — the CLI can only *update* a live
   listing, never create one.
3. Run `publish-msix` with a release **tag** as `ref` and `publish: true`, then
   restore the job in `tag-release.yml` (see the history of this file).

Build from a release tag, never from a branch: the MSIX version comes from
`tauri.conf.json`, which only carries the released version at a tag — on `dev`
it lags, because the bump lands on `main`. Store versions only ever move
forward, so a submission at a stale version cannot be taken back.
`publish-msix` refuses to submit a bundle whose version trails the latest
release, and no caller passes `publish: true` any more.

`MSIX_IDENTITY_NAME`, `MSIX_PUBLISHER` and `MSIX_PUBLISHER_DISPLAY_NAME` are
still set as repository variables: the packing step needs them, and they must
match the Partner Center reservation exactly. Every image the listing form asks
for is still in `packaging/msix/store-listing`, numbered in upload order with
its caption, refreshable with `scripts/copy-store-screenshots.sh`.

What still runs is `verify-packaging`, which calls `publish-msix.yml` with
`publish: false` to prove the package packs on Windows — a cheap guard on
`packaging/msix/` and the two PowerShell scripts. The packages are unsigned by
design (the Store signs them), so they are workflow artifacts rather than
release assets — a user who downloaded one could not install it.

### Homebrew

`VoltiusApp/homebrew-voltius` is a third-party tap: `brew search voltius` finds
nothing until the user has tapped it. A submission to homebrew-cask core is what
would make it discoverable, and the notability bar (75 stars) is cleared.

**Core is blocked on notarization.** `brew audit --cask --new`, the gate a
submission has to pass, runs a signature scan and fails:

```
Signature verification failed: Scan completed, but failed because the software
is not signed by a distributor that meets the system Gatekeeper requirements.
```

Voltius is ad-hoc signed, not notarized, so this cannot pass without an Apple
Developer account. `brew style` and the rest of the audit are clean, so this is
the only thing standing in the way.

`scripts/gen-homebrew-cask.sh <tag> --core` emits the variant for that PR, kept
ready for the day notarization exists: core is hostile to caveats that talk the
user out of Gatekeeper, so the quarantine-clearing `xattr` command the tap
caveat carries is dropped there, leaving the right-click-Open instructions.

Never put `brew install --no-quarantine` in either variant. Homebrew 6 removed
the flag, so the hint fails with `Error: invalid option: --no-quarantine` for
tap users, and core rejected it before that. `brew audit` does not catch it, so
the `cask-audit` action greps the generated cask and fails the run (#176).
