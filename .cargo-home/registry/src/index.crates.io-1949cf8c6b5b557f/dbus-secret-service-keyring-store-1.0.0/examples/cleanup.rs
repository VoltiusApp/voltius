//! Example CLI app that finds and prints Secret Service credentials
//! that were probably created while testing this crate.
//! You can specify arguments to delete the entries (`-h` or `--help` for usage).
use std::collections::HashMap;

use regex::Regex;
use sscanf::sscanf;

use dbus_secret_service_keyring_store::Store;
use keyring_core::{Entry, Error, Result, set_default_store};

fn main() -> Result<()> {
    set_default_store(Store::new()?);
    let (names, entries) = find_candidates()?;
    let args = std::env::args().skip(1).collect::<Vec<String>>();
    if args.len() > 1 {
        println!("Usage: cleanup [-a | --all | start-end | index]");
        std::process::exit(1);
    }
    if args.is_empty() {
        show_progress(&names, &entries, false, 1, names.len())?;
    } else {
        let arg = args[0].as_str();
        if arg == "-h" || arg == "--help" {
            println!("Usage: cleanup [-a | --all | start-end | index]");
        } else if arg == "-a" || arg == "--all" {
            show_progress(&names, &entries, true, 1, names.len())?;
        } else if let Some((start, end)) = sscanf!(arg, "{}-{}", usize, usize) {
            show_progress(&names, &entries, true, start, end)?;
        } else if let Some(index) = sscanf!(arg, "{}", usize) {
            show_progress(&names, &entries, true, index, index)?;
        } else {
            println!("Usage: cleanup [-a | --all | start-end | index]");
            std::process::exit(1);
        }
    }
    Ok(())
}

fn find_candidates() -> Result<(Vec<String>, Vec<Entry>)> {
    let pattern = Regex::new(r"(^test-.+)|(\b\w{12}\b)|(\b\w{30}\b)").unwrap();
    let candidates = Entry::search(&HashMap::new())?;
    let mut names = Vec::new();
    let mut entries = Vec::new();
    for entry in candidates {
        if let Some(specs) = entry.get_specifiers()
            && (pattern.is_match(&specs.0) || pattern.is_match(&specs.1))
        {
            names.push(format!("service: {}, user: {}", specs.0, specs.1));
            entries.push(entry);
        }
    }
    Ok((names, entries))
}

fn show_progress(
    names: &[String],
    entries: &[Entry],
    is_deleting: bool,
    start: usize,
    end: usize,
) -> Result<()> {
    if names.is_empty() {
        if is_deleting {
            println!("No candidates found to delete.");
        } else {
            println!("No candidates found.");
        }
        return Ok(());
    }
    if start < 1 {
        return Err(Error::Invalid(
            start.to_string(),
            "out of range".to_string(),
        ));
    }
    if end > names.len() {
        return Err(Error::Invalid(end.to_string(), "out of range".to_string()));
    }
    if start > end {
        return Err(Error::Invalid(
            format!("{start}-{end}"),
            "invalid range".to_string(),
        ));
    }
    let found = if names.len() == 1 {
        "Found 1 candidate".to_string()
    } else {
        format!("Found {} candidates", names.len())
    };
    if is_deleting {
        println!("{found}; deleting {}:", end - start + 1);
    } else {
        println!("{found}:");
    }
    for i in start..=end {
        println!("{i: >3} - {}", names[i - 1]);
        if is_deleting {
            entries[i - 1].delete_credential()?
        }
    }
    Ok(())
}
