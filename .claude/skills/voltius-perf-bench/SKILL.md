---
name: voltius-perf-bench
description: Use when measuring or optimizing Voltius performance — idle RAM, installed size, startup JS, binary size, idle CPU, PTY throughput, tab switch or resize cost — or when a PR claims a perf win or a README number needs checking. Gives the repeatable benches and the before/after format every perf PR uses.
---

# Measuring Voltius performance

Every perf change is measured the same way before and after, or it does not count. Pick the bench that matches the claim, run it on the base commit and on the branch, and put both numbers in the PR.

## Which bench

| Question | Bench | Where |
| --- | --- | --- |
| Idle RAM and installed size on Windows, vs competitors | `perf-windows` workflow | GitHub Actions `windows-latest` |
| Startup JS / chunk sizes | `pnpm build`, then sizes in `dist/assets` | host |
| Binary size and what is in it | `cargo bloat --release --crates` | host |
| Idle RAM / CPU on Linux, PTY throughput, tab switch, resize | `scripts/perf/linux/*.sh` | private headless container |

## Windows idle RAM and size (the README numbers)

```bash
gh workflow run perf-windows.yml -f tag=v0.71.0                       # Voltius only
gh workflow run perf-windows.yml -f tag=latest -f competitors=true    # plus Reach, Termix, Tabby, Termius
gh run watch "$(gh run list -w perf-windows.yml -L1 --json databaseId -q '.[0].databaseId')"
gh run download <run-id> -n perf-windows -D /tmp/perf-windows        # results.json + one screenshot per app
```

- Each app is installed silently, launched cold, left idle on its first-run screen, and sampled three times up to `idle_seconds` (default 90).
- RAM = private working set (the Task Manager figure) summed over the app and all its child processes, so WebView2 counts for Tauri apps. Report that figure; the plain working set double-counts shared pages.
- Installed size = the install folder. The shared WebView2 runtime is excluded because Windows 10/11 ship it.
- **Open every screenshot before trusting a row.** An app stuck on an installer, an error dialog or a blank window still produces a number.
- The run is noisy by ~10 MB between runs. Claim a RAM win only above that, or from the median of three runs.
- To measure an unreleased branch, publish a pre-release build first; the workflow installs from release assets.

## Linux benches (CPU, throughput, tab switch, resize)

The scripts drive a release build over WebDriver inside a headless container (see `iterating-on-voltius-ui` for the image and `wd.mjs`). Copy `scripts/perf/linux/` into the container and run from there:

| Script | Measures |
| --- | --- |
| `build.sh <worktree> <out-dir> <name>` | release binary for benching (run on the host) |
| `memidle.sh <bin>` | fresh launch, onboarding skipped, CPU and PSS after 30 s idle |
| `launch.sh <bin>` | fresh session with one local Bash tab tagged `[data-perf]` |
| `opentabs.sh <n> [lines]` | opens n local tabs, each printing `seq 1 lines` |
| `seqbench.sh <N>` | CPU to render `seq 1 N` in the tagged terminal (`REMOTE=1` for SSH) |
| `tabbench.sh <label> [n]` | idle CPU over 20 s, then CPU per Ctrl+Tab |
| `resizebench.sh <label> [n]` | CPU per window resize |
| `sshopen.sh [host]` | quick-connects to the test SSH host and tags that terminal |
| `mem.sh`, `cpu.sh`, `cpu2.sh` | PSS per process; CPU ms of main + web process |

Rules that keep these numbers honest:

- Measure **CPU time** (`utime+stime` from `/proc`), never wall time. This host runs the production server, so wall time moves with its load.
- Build base and branch the same way with `scripts/perf/linux/build.sh <worktree> <out-dir> <name>`: release, LTO off, 16 codegen units, one shared `CARGO_TARGET_DIR`. The first build is long (over an hour cold on this host); later ones are incremental. Mount `<out-dir>` at `/bin-perf/` in the container.
- Benches settle to the measured idle rate instead of a fixed threshold. An SSH tab idles at 70-170 ms/s; a fixed threshold reads idle time as work.
- Delete the app's local state between runs (`launch.sh` and `memidle.sh` do). A previous run's settings poison the next.

## Startup JS and binary size

```bash
pnpm build && ls -S -l dist/assets/*.js | head          # main chunk first; compare against the base commit
pnpm dlx vite-bundle-visualizer                          # what is in the main chunk
cargo bloat --release --crates --manifest-path src-tauri/Cargo.toml | head -30
```

## Reporting

In the PR body, one line per number, base vs branch, same bench, same machine:

```
idle private WS (Windows, 90 s): 109 MB -> 96 MB
main chunk: 1.91 MB -> 1.62 MB
seq 1 400000, local: 3.48 s -> 2.90 s CPU
```

Say what got worse too. A trade-off the user has not approved is not shipped.
