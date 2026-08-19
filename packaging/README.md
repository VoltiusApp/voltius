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
| Microsoft Store | `packaging/msix/`, `scripts/build-msix.ps1` | `publish-msix.yml` on every release |
| Scoop | `scripts/gen-scoop-manifest.sh` | Scoop's excavator bot, after the first merge |
| Flathub | `scripts/gen-flatpak-manifest.sh` | Flathub's external-data-checker, after the first merge |

Scoop and Flathub have no job here on purpose: their manifests carry `checkver`
and `x-checker-data`, so each ecosystem's own bot follows new releases once the
manifest is merged. For Flathub that bot opens a PR against
`flathub/app.voltius.Voltius`; add `{"automerge-flathubbot-prs": true}` to
`flathub.json` in that repo to let it land unattended.

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

### Flathub

`packaging/flatpak/` holds the three files a submission needs. Regenerate the
manifest with `scripts/gen-flatpak-manifest.sh <tag>` if the release asset
naming changes; otherwise Flathub's bot keeps it current.

Validate before submitting:

```bash
docker run --rm -v "$PWD/packaging/flatpak:/w" -w /w \
  ghcr.io/flathub-infra/flatpak-builder-lint:latest manifest app.voltius.Voltius.yml
```

Three linter errors are expected and each needs a written justification in the
submission PR, which Flathub records as an exception:

- `finish-args-home-filesystem-access` — SFTP has to reach the local side of a
  transfer, and `~/.ssh` is where the keys users import already live.
- `finish-args-has-socket-ssh-auth` — agent forwarding, so the passphrase is not
  re-asked on every connection.
- `finish-args-flatpak-spawn-access` — the local-terminal feature opens the
  user's real shell with their real toolchain. Without host spawn it silently
  becomes a shell inside the sandbox. Same permission, for the same reason, that
  the terminal emulators already on Flathub carry.

The app id is `app.voltius.Voltius`, matching the `voltius.app` domain rather
than the Tauri identifier (`com.voltius.app`), because Flathub verification
checks the id against a domain the publisher controls.

The in-app updater needs no change: a Flatpak install has no `APPIMAGE`
environment variable, so `classify_install` already reports it as
externally-updated and the app tells the user to update through their package
manager instead of writing to the read-only `/app`.

### Microsoft Store

Registration is free for both individual and company accounts. The MSIX path
needs **no code-signing certificate** — the Store re-signs MSIX on submission.
(Submitting the NSIS `.exe` instead would require a certificate chaining to the
Microsoft Trusted Root Program, which is the recurring cost this avoids.)

Releases submit themselves through `publish-msix.yml`, but the listing has to
exist first — the Store CLI can only *update* an app that is already live.

**Build the first submission from a release tag, not from a branch.** The MSIX
version comes from `tauri.conf.json`, and that file only carries the released
version at a tag — on `dev` it lags, because the bump lands on `main`. A bundle
built from a branch is therefore labelled with a stale version. Store versions
only ever move forward, so a first submission at the wrong version cannot be
taken back. `publish-msix` refuses to submit a bundle whose version trails the
latest release, and only the release job passes `publish: true` — the packaging
check builds the bundle and stops there.

One-time:

1. Reserve the app name in Partner Center.
2. Copy the assigned identity values into repository variables:
   `MSIX_IDENTITY_NAME`, `MSIX_PUBLISHER`, `MSIX_PUBLISHER_DISPLAY_NAME`.
   Partner Center rejects a package whose identity does not match the
   reservation exactly.
3. Run `publish-msix` manually with `publish: false`, download the `msixbundle`
   artifact, and complete the first submission by hand in Partner Center.
4. Once that submission is live, wire up the automation:
   - Associate a Microsoft Entra tenant with the Partner Center account.
   - Register an Entra application and give it the **Manager** role under
     Account settings → User management → Microsoft Entra applications.
   - Add the secrets `AZURE_AD_TENANT_ID`, `AZURE_AD_APPLICATION_CLIENT_ID`,
     `AZURE_AD_APPLICATION_SECRET`, `SELLER_ID`, and the repository variable
     `MSSTORE_PRODUCT_ID`.

After that every release builds both architectures, bundles them into one
`.msixbundle` and submits it. Until the secrets exist the submission step warns
and skips, so a release cannot fail on it.

Every image the listing form asks for is in `packaging/msix/store-listing`,
numbered in upload order, with the captions to go with them and the rules they
satisfy. Refresh the screenshots from the docs repo with
`scripts/copy-store-screenshots.sh`.

Two limits worth knowing:

- The CLI cannot create a listing, only update one. That is why step 3 is
  manual and cannot be automated away.
- Microsoft supports app updates through this action for **free products only**.
  Voltius is free in the Store — Pro is billed outside it — so this holds today,
  but adding a paid Store product would break the automation.

The packages are unsigned by design (the Store signs them), so they are workflow
artifacts rather than release assets — a user who downloaded one could not
install it.

`classify_install` treats an install under `C:\Program Files\WindowsApps` as
externally-updated, so the Store build does not try to self-update into a tree
it cannot write.

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
ready for the day notarization exists: core rejects casks whose caveats tell the
user to reinstall with `--no-quarantine`, so that hint is dropped, leaving the
right-click-Open instructions.
