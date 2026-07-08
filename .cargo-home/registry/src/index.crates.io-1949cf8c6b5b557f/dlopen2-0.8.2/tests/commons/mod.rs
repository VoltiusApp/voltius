use dlopen2::utils::{PLATFORM_FILE_EXTENSION, PLATFORM_FILE_PREFIX};
use serde::Deserialize;
use std::fs;
use std::os::raw::c_int;
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
struct Manifest {
    workspace_root: String,
}
pub fn example_lib_path() -> PathBuf {
    // Rust when building dependencies adds some weird numbers to file names
    // find the file using this pattern:
    let file_pattern = format!(r"{PLATFORM_FILE_PREFIX}example.*\.{PLATFORM_FILE_EXTENSION}");
    let file_regex = regex::Regex::new(file_pattern.as_ref()).unwrap();

    // find the directory with dependencies - there shold be our
    // example library
    let output = std::process::Command::new(env!("CARGO"))
        .arg("metadata")
        .arg("--format-version=1")
        .output()
        .unwrap();
    let manifest: Manifest = serde_json::from_slice(&output.stdout).unwrap();
    let workspace_root = PathBuf::from(manifest.workspace_root);

    let deps_dirs = [
        workspace_root.join("target").join("debug").join("deps"),
        workspace_root
            .join("target")
            .join(current_platform::CURRENT_PLATFORM)
            .join("debug")
            .join("deps"),
    ];

    // unfortunately rust has no strict pattern of naming dependencies in this directory
    // this is partially platform dependent as there was a bug reported that while the code runs
    // well on Linux, Windows, it stopped working on a new version of Mac.
    // The only way to handle this correctly is by traversing the directory recursively and
    // finding a match.

    let mut lib_path = None;
    for deps_dir in deps_dirs {
        let new_path = match recursive_find(deps_dir.as_path(), &file_regex) {
            None => continue,
            Some(p) => p,
        };

        match &lib_path {
            None => lib_path = Some(new_path),
            Some(old_path) => {
                let new_meta = std::fs::metadata(&new_path).unwrap();
                let old_meta = std::fs::metadata(old_path).unwrap();
                if new_meta.modified().unwrap() > old_meta.modified().unwrap() {
                    lib_path = Some(new_path);
                }
            }
        }
    }

    let lib_path = lib_path.expect("Could not find the example library");
    println!("Library path: {}", lib_path.to_str().unwrap());
    lib_path
}

fn recursive_find(path: &Path, file_regex: &regex::Regex) -> Option<PathBuf> {
    if path.is_dir() {
        match fs::read_dir(path) {
            Err(_) => None,
            Ok(dir) => {
                for entry in dir.filter_map(Result::ok) {
                    if let Some(p) = recursive_find(&entry.path(), file_regex) {
                        return Some(p);
                    }
                }
                None
            }
        }
    } else if file_regex.is_match(path.file_name().unwrap().to_str().unwrap()) {
        Some(path.to_path_buf())
    } else {
        None
    }
}

#[repr(C)]
pub struct SomeData {
    pub first: c_int,
    pub second: c_int,
}
