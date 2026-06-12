---
name: voltius-release
description: "Use this skill to cut a Voltius release: reading commits since the last release tag, bumping the version, updating CHANGELOG.md, committing, and pushing to main. Trigger whenever the user says 'release', 'cut a release', 'bump version', 'prepare release', 'ship', or anything implying they want to publish a new Voltius version."
trigger: /release
---

# /release — Voltius Release Skill

Cut a new Voltius release end-to-end: discover what changed, write the changelog entry, bump all version files, and push to main (which auto-tags via CI).

## Project release facts (memorize these)

- **Version bump command**: `pnpm run version:bump X.Y.Z` — updates `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `Cargo.lock` in one shot.
- **CI trigger**: pushing to `main` triggers `tag-release.yml`, which reads the new version and creates the immutable tag + release automatically. Never create or delete release tags manually.
- **CHANGELOG requirement**: `release.yml` has a `changelog` step that reads the version's section from `CHANGELOG.md` and **fails the entire release if the section is missing**. The new version section MUST be present and non-empty before pushing.
- **No Co-Authored-By trailers** on any commit.
- **Commit format**: `chore: release X.Y.Z` — under 72 chars, no body.

## Workflow

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

### Step 8 — Commit and push

Stage only the files that changed:

```bash
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml Cargo.lock CHANGELOG.md
git commit -m "chore: release X.Y.Z"
git push origin main
```

No `Co-Authored-By` trailer. No body. Just the subject line.

After pushing, tell the user: "Pushed — CI will now create tag vX.Y.Z and start the release build."

## Edge cases

- **Nothing to release**: if `git log $LAST_TAG..HEAD` returns nothing, tell the user there are no commits since `$LAST_TAG` and stop.
- **Dirty working tree**: check `git status --porcelain` before starting. If there are uncommitted changes, warn the user and ask how to proceed — don't blow past it.
- **Not on main**: check `git branch --show-current`. If not on `main`, warn the user — the CI trigger only fires on pushes to `main`.
- **[Unreleased] already has a version header**: someone may have pre-staged changelog content with a version number. Read it carefully and ask the user before overwriting anything.
