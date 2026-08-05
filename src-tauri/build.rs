use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

/// Folders that must be embedded in a release build. A mismatch fails the build
/// rather than silently shipping a binary with missing built-ins.
const SEEDED_IDS: [&str; 6] = [
    "docker",
    "gist-sync",
    "monitoring",
    "process-manager",
    "proxmox",
    "ssh-config",
];

/// Only these filenames are embedded; anything else in a plugin folder is ignored.
const EMBEDDED_FILES: [&str; 3] = ["manifest.json", "index.js", "voltius.css"];

/// Present in every plugin, and non-empty, or the release build fails.
const REQUIRED_FILES: [&str; 2] = ["manifest.json", "index.js"];

/// folder id -> [(filename, absolute path)].
type Discovered = BTreeMap<String, Vec<(String, String)>>;

fn main() {
    tauri_build::build();
    embed_seeded_plugins();
}

fn embed_seeded_plugins() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let root = Path::new(&manifest_dir).join("resources").join("plugins");
    println!("cargo:rerun-if-changed=resources/plugins");
    println!("cargo:rerun-if-env-changed=VOLTIUS_REQUIRE_SEEDED_PLUGINS");

    let (found, mut problems) = discover(&root);
    problems.extend(check(&found));

    if !problems.is_empty() {
        let problems = problems.join("\n");
        if must_be_shippable() {
            panic!(
                "seeded plugin artifacts are not shippable:\n{problems}\n\
                 Run `pnpm build:plugins` before a release build."
            );
        }
        println!(
            "cargo:warning=seeded plugins incomplete, embedding what exists: {}",
            problems.replace('\n', "; ")
        );
    }

    let out = render(&found);
    let dest = Path::new(&std::env::var("OUT_DIR").expect("OUT_DIR")).join("seeded_plugins.rs");
    fs::write(&dest, out).expect("write seeded_plugins.rs");
}

/// Whether an incomplete artifact set must fail the build rather than warn.
///
/// `PROFILE=release` covers a normal release build. The env var exists because
/// `tauri build --debug` bundles a real, distributable installer under the DEBUG
/// profile, where the assertion would otherwise be disabled — set it for any build
/// whose output ships. The debug default stays permissive so `cargo test`/`cargo
/// check` still work on a fresh clone, where the gitignored artifacts do not exist
/// until `pnpm build:plugins` has run.
fn must_be_shippable() -> bool {
    std::env::var("PROFILE").as_deref() == Ok("release")
        || matches!(
            std::env::var("VOLTIUS_REQUIRE_SEEDED_PLUGINS").as_deref(),
            Ok(v) if !v.is_empty() && v != "0"
        )
}

/// Mirrors `validate_id` in `src/commands/plugins.rs`. An id embedded here that
/// `validate_id` rejects would be listed by `plugins_list_seeded` and then refused by
/// `plugin_seeded_read` — listable but unreadable.
fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id != "."
        && id != ".."
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

/// folder id -> [(filename, absolute path)], one level deep only, plus anything found
/// that cannot be embedded. Rejected entries are reported rather than dropped silently:
/// every one of them would otherwise resurface later as a confusing "missing" error or
/// an rustc error against generated code.
fn discover(root: &Path) -> (Discovered, Vec<String>) {
    let mut found: Discovered = BTreeMap::new();
    let mut problems = Vec::new();
    let Ok(entries) = fs::read_dir(root) else {
        return (found, problems);
    };
    for entry in entries.flatten() {
        // `DirEntry::file_type` has lstat semantics, so a SYMLINKED plugin folder reads
        // as a symlink rather than a directory and vanishes from the build while sitting
        // in plain sight. `Path::is_dir` follows the link.
        if !entry.path().is_dir() {
            continue;
        }
        let Some(id) = entry.file_name().to_str().map(str::to_string) else {
            problems.push(format!(
                "non-UTF-8 plugin folder name: {:?}",
                entry.file_name()
            ));
            continue;
        };
        if !is_valid_id(&id) {
            problems.push(format!("invalid plugin folder name: {id}"));
            continue;
        }
        let mut files = Vec::new();
        for name in EMBEDDED_FILES {
            let path = entry.path().join(name);
            if !path.is_file() {
                continue;
            }
            // Directory mtime alone does not change when a file inside it is
            // rewritten in place, so each artifact is tracked individually.
            println!("cargo:rerun-if-changed={}", path.display());
            // `include_str!` requires UTF-8. Validated here so the failure reads as a
            // build-script problem naming the file, not as a rustc error pointing into
            // generated code.
            match fs::read(&path) {
                Err(e) => {
                    problems.push(format!("{id}: cannot read {name} ({e})"));
                    continue;
                }
                Ok(bytes) if std::str::from_utf8(&bytes).is_err() => {
                    problems.push(format!("{id}: {name} is not valid UTF-8"));
                    continue;
                }
                Ok(_) => {}
            }
            // No lossy conversion: a path that is not UTF-8 cannot be written into the
            // generated source at all, and silently mangling it would embed the wrong
            // file or fail obscurely.
            let Some(path_str) = path.to_str() else {
                problems.push(format!("{id}: non-UTF-8 path for {name}"));
                continue;
            };
            // `\` is a path SEPARATOR on Windows but a legal FILENAME character
            // everywhere else, so this rewrite is only ever correct on Windows. Applied
            // unconditionally it silently repointed `include_str!` at a different path
            // for any repo checked out under a directory containing a backslash.
            // `cfg!` here is the HOST, which is what a build-script path belongs to.
            let path_str = if cfg!(windows) {
                path_str.replace('\\', "/")
            } else {
                path_str.to_string()
            };
            files.push((name.to_string(), path_str));
        }
        found.insert(id, files);
    }
    (found, problems)
}

fn check(found: &Discovered) -> Vec<String> {
    let mut problems = Vec::new();

    for id in SEEDED_IDS {
        if !found.contains_key(id) {
            problems.push(format!("missing plugin folder: {id}"));
        }
    }
    for id in found.keys() {
        if !SEEDED_IDS.contains(&id.as_str()) {
            problems.push(format!("unexpected plugin folder: {id}"));
        }
    }
    for (id, files) in found {
        for required in REQUIRED_FILES {
            match files.iter().find(|(name, _)| name == required) {
                None => problems.push(format!("{id}: missing {required}")),
                Some((_, path)) => {
                    let len = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
                    if len == 0 {
                        problems.push(format!("{id}: {required} is empty"));
                    }
                }
            }
        }
    }

    problems
}

fn render(found: &Discovered) -> String {
    let mut out = String::from("pub static SEEDED_PLUGINS: &[(&str, &[(&str, &str)])] = &[\n");
    for (id, files) in found {
        out.push_str(&format!("    ({id:?}, &[\n"));
        for (name, path) in files {
            out.push_str(&format!("        ({name:?}, include_str!({path:?})),\n"));
        }
        out.push_str("    ]),\n");
    }
    out.push_str("];\n");
    out
}
