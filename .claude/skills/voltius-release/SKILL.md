---
name: voltius-release
description: "Use this skill to cut a Voltius release: reading commits since the last release tag, bumping the version, updating CHANGELOG.md, committing on dev, merging dev into main, and watching CI until the release is published. Trigger whenever the user says 'release', 'cut a release', 'bump version', 'prepare release', 'ship', or anything implying they want to publish a new Voltius version."
trigger: /release
---

# /release — Voltius Release Skill

Cut a new Voltius release end-to-end: discover what changed, write the changelog entry, bump all version files on `dev`, merge `dev` into `main` (which auto-tags via CI), and watch CI through to a published release.

## Project release facts (memorize these)

- **Version bump command**: `pnpm run version:bump X.Y.Z` — updates `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `Cargo.lock` in one shot.
- **Branch flow — dev first, then main**: this project develops on `dev`. The release commit (version bump + CHANGELOG) is made **on `dev`**, `dev` is pushed, and only then is `dev` merged into `main` and pushed. Never cut the release directly on `main`.
- **CI trigger**: pushing to `main` triggers `tag-release.yml`, which reads the new version and creates the immutable tag + release automatically. Never create or delete release tags manually.
- **CHANGELOG requirement**: `release.yml` has a `changelog` step that reads the version's section from `CHANGELOG.md` and **fails the entire release if the section is missing**. The new version section MUST be present and non-empty before pushing.
- **No Co-Authored-By trailers** on any commit.
- **Commit format**: `chore: release X.Y.Z` — under 72 chars, no body.

## Workflow

### Step 0 — Get onto `dev` and reconcile any drift with `main`

The release happens on `dev`, so start there and make sure `main` holds nothing `dev` is missing:

```bash
git fetch origin --tags
git log origin/dev..origin/main --oneline   # stray commits released straight from main
git log origin/main..origin/dev --oneline   # what this release will ship
```

If the first command prints anything, `main` was released from directly and those commits (and
their CHANGELOG sections) never came back. Merge `origin/main` into `dev` and resolve conflicts
**before** bumping, so history and `CHANGELOG.md` stay continuous.

Then check out `dev` and fast-forward it:

```bash
git checkout dev && git pull --ff-only origin dev
```

If the release work arrived on a feature branch, confirm it is really in `dev` first. A
squash-merged branch still reads as unmerged, so diff the content instead of trusting
`git branch --merged`:

```bash
git diff --stat origin/dev origin/<feature-branch>
```

### Step 1 — Discover the last release tag

```bash
git tag --sort=-version:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1
```

Store this as `LAST_TAG`. Show it to the user.

### Step 2 — Collect commits since last tag

```bash
git log $LAST_TAG..HEAD --format="%s" --no-merges
```

Merge commits (subjects starting with `Merge `) add noise — exclude them. List the raw commit subjects to the user so they can see what's going in.

### Step 3 — Categorize commits into changelog sections

Map commit types to Keep-a-Changelog sections:

| Commit prefix | Section |
|---|---|
| `feat:` | **Added** |
| `fix:` | **Fixed** |
| `perf:` | **Added** (if user-visible) or **Changed** |
| `refactor:`, `chore:`, `docs:` | Skip (internal, not user-facing) — unless the subject clearly describes something users care about |

Strip the `type: ` prefix and capitalize the first letter of each entry. Write entries as bullet points (`- …`).

**If a section would be empty, omit it entirely.** A release with only refactor commits may have no user-visible entries — ask the user if they still want to cut a release, or if they'd rather wait.

### Step 4 — Check the [Unreleased] section

Read `CHANGELOG.md` and extract any content under `## [Unreleased]`. If there's manually written content there, merge it into the appropriate sections generated from commits (deduplicate obvious overlaps). Tell the user what you found.

### Step 5 — Propose the next version

Look at the commit types:
- Any `feat:` commit → **minor bump** (0.X+1.0) unless the user specifies
- Only `fix:` / `perf:` / other → **patch bump** (0.Y.Z+1)
- Breaking changes (rare, user will say so) → **major bump**

Show the proposed version to the user and ask them to confirm or override it before continuing.

**Wait for confirmation before proceeding past this point.**

### Step 6 — Run the version bump

```bash
pnpm run version:bump X.Y.Z
```

Verify it succeeded (exit code 0 and the output says "Bumped to X.Y.Z").

### Step 7 — Update CHANGELOG.md

Edit `CHANGELOG.md`:

1. Keep the header and `## [Unreleased]` line as-is (empty section — future work goes here).
2. Insert the new version section immediately after `## [Unreleased]`, using today's date:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added

- …

### Fixed

- …
```

3. Only include sections that have entries. The order is: Added, Changed, Deprecated, Removed, Fixed, Security.
4. Do **not** remove any older version sections.

After editing, show the user the new section and ask them to review it before committing.

**Wait for a thumbs-up before committing.**

### Step 8 — Commit on `dev`, then merge `dev` into `main`

Stage only the files that changed, and commit on `dev`:

```bash
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml Cargo.lock CHANGELOG.md
git commit -m "chore: release X.Y.Z"
git push origin dev
```

No `Co-Authored-By` trailer. No body. Just the subject line.

Then carry the release onto `main`. The merge should fast-forward — if it does not, `main` has
drifted and Step 0 was skipped or incomplete; stop and reconcile rather than forcing a merge
commit:

```bash
git checkout main && git pull --ff-only origin main
git merge --ff-only dev
git push origin main
```

That last push is what fires `tag-release`. After pushing, tell the user: "Pushed — CI will now
create tag vX.Y.Z and start the release build."

### Step 9 — Watch CI until the release is actually published

**Always do this. Do not wait to be asked.** Pushing is not shipping: the user has asked for
a CI watch on every past release, so arm it yourself as the last step of the release.

**Everything lives inside one `tag-release` run.** `release.yml`, `publish-repo` and
`publish-installers` are reusable workflows called by `tag-release.yml`, so they appear as
*nested jobs* (`release / publish-tauri (…)`, `publish-installers / homebrew`) and **never as
their own runs** in `gh run list`. `tag-release` concluding `success` means the whole release —
build, release assets, Homebrew, winget, AUR — succeeded. Do not wait for a separate
`publish-installers` run; there will not be one.

Arm a persistent `Monitor` that polls the `tag-release` run's jobs and emits one event per job
state change, exiting when the run itself concludes:

```bash
prev=""
while true; do
  rid=$(gh run list --workflow=tag-release.yml --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)
  if [ -n "$rid" ]; then
    v=$(gh run view "$rid" --json status,conclusion,jobs 2>/dev/null || true)
    if [ -n "$v" ]; then
      cur=$(jq -r '.jobs[] | select((.conclusion//"")!="") | "\(.conclusion)\t\(.name)"' <<<"$v" | sort)
      comm -13 <(printf '%s\n' "$prev") <(printf '%s\n' "$cur")
      prev="$cur"
      jq -e '.status=="completed"' <<<"$v" >/dev/null 2>&1 \
        && { jq -r '"tag-release "+.conclusion' <<<"$v"; break; }
    fi
  fi
  sleep 60
done
```

Use `persistent: true` — a full release build takes ~20 minutes, past the default monitor
timeout. Emitting every job's `conclusion` (not just successes) means a red leg shows up on its
own rather than as silence.

Traps that make a release look finished when it isn't:

- A `release-published` job going green is **not** the run being done — `publish-repo` and the
  four `publish-installers` jobs (tag/homebrew/winget/aur) run after it and fail independently.
- One red leg of the build matrix skips the whole publish tail. Recover with
  `gh run rerun --failed <run-id>` — but only when the fix is already in the commit the run
  was built from. If the fix landed afterwards, re-dispatch against the new HEAD instead
  (`gh workflow run publish-installers.yml -f tag=vX.Y.Z`), and check every job in that
  workflow is idempotent before doing so, since there is no per-job dispatch input.

When the run concludes, confirm the artefacts rather than trusting the green tick, then tell the
user plainly that the release is out — or which job is red:

```bash
gh release view vX.Y.Z --json tagName,isDraft,publishedAt,assets -q '{tag:.tagName,draft:.isDraft,published:.publishedAt,assets:(.assets|length)}'
```

## Edge cases

- **Nothing to release**: if `git log $LAST_TAG..HEAD` returns nothing, tell the user there are no commits since `$LAST_TAG` and stop.
- **Dirty working tree**: check `git status --porcelain` before starting. If there are uncommitted changes, warn the user and ask how to proceed — don't blow past it.
- **Not on `dev`**: check `git branch --show-current`. The bump belongs on `dev`, not on whatever feature branch the work was done on — go through Step 0 instead of bumping in place.
- **`main` ahead of `dev`**: a past release (or hotfix) went straight to `main`. Merge it back into `dev` before bumping, or this release silently drops it from history and from `CHANGELOG.md`.
- **[Unreleased] already has a version header**: someone may have pre-staged changelog content with a version number. Read it carefully and ask the user before overwriting anything.
