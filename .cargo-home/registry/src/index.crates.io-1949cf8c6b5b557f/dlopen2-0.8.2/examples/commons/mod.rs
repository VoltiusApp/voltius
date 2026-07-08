use dlopen2::utils::{PLATFORM_FILE_EXTENSION, PLATFORM_FILE_PREFIX};
use std::env;
use std::os::raw::c_int;
use std::path::PathBuf;

//Rust when building dependencies adds some weird numbers to file names
// find the file using this pattern:
//const FILE_PATTERN: &str = concat!(PLATFORM_FILE_PREFIX, "example.*\\.", PLATFORM_FILE_EXTENSION);

use serde::Deserialize;
#[derive(Deserialize)]
struct Manifest {
    workspace_root: String,
}

pub fn example_lib_path() -> PathBuf {
    let file_pattern = format!(r"{PLATFORM_FILE_PREFIX}example.*\.{PLATFORM_FILE_EXTENSION}");
    let file_regex = regex::Regex::new(file_pattern.as_ref()).unwrap();
    //build path to the example library that covers most cases
    let output = std::process::Command::new(env!("CARGO"))
        .arg("metadata")
        .arg("--format-version=1")
        .output()
        .unwrap();
    let manifest: Manifest = serde_json::from_slice(&output.stdout).unwrap();
    let mut lib_path = PathBuf::from(manifest.workspace_root);
    lib_path.extend(["target", "debug", "deps"].iter());
    let entry = lib_path.read_dir().unwrap().find(|e| match *e {
        Ok(ref entry) => file_regex.is_match(entry.file_name().to_str().unwrap()),
        Err(ref err) => panic!("Could not read cargo debug directory: {err}"),
    });
    lib_path.push(entry.unwrap().unwrap().file_name());
    println!("Library path: {}", lib_path.to_str().unwrap());
    lib_path
}

#[allow(dead_code)] //not all examples use this and this generates warnings
#[repr(C)]
pub struct SomeData {
    pub first: c_int,
    pub second: c_int,
}
