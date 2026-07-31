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

fn main() {
    tauri_build::build();
    embed_seeded_plugins();
}

fn embed_seeded_plugins() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let root = Path::new(&manifest_dir).join("resources").join("plugins");
    println!("cargo:rerun-if-changed=resources/plugins");

    let found = discover(&root);

    if let Err(problems) = check(&found) {
        if std::env::var("PROFILE").as_deref() == Ok("release") {
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

/// folder id -> [(filename, absolute path)], one level deep only.
fn discover(root: &Path) -> BTreeMap<String, Vec<(String, String)>> {
    let mut found: BTreeMap<String, Vec<(String, String)>> = BTreeMap::new();
    let Ok(entries) = fs::read_dir(root) else {
        return found;
    };
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let Some(id) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let mut files = Vec::new();
        for name in EMBEDDED_FILES {
            let path = entry.path().join(name);
            if path.is_file() {
                // Directory mtime alone does not change when a file inside it is
                // rewritten in place, so each artifact is tracked individually.
                println!("cargo:rerun-if-changed={}", path.display());
                files.push((name.to_string(), path.to_string_lossy().replace('\\', "/")));
            }
        }
        found.insert(id, files);
    }
    found
}

fn check(found: &BTreeMap<String, Vec<(String, String)>>) -> Result<(), String> {
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

    if problems.is_empty() {
        Ok(())
    } else {
        Err(problems.join("\n"))
    }
}

fn render(found: &BTreeMap<String, Vec<(String, String)>>) -> String {
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
