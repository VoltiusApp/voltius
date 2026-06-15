use std::path::{Path, PathBuf};

/// Flatten a downloaded temp path into `(relPath, absSrc)` pairs to publish into the SAF
/// tree. `base_name` is the destination name chosen by the user (the remote file/dir name).
/// For a single file the result is one entry `(base_name, temp_root)`. For a directory the
/// entries are `base_name/<sub/path>` for every regular file, with `/` separators.
pub fn collect_publish_entries(
    temp_root: &Path,
    base_name: &str,
) -> std::io::Result<Vec<(String, PathBuf)>> {
    let meta = std::fs::metadata(temp_root)?;
    if meta.is_file() {
        return Ok(vec![(base_name.to_string(), temp_root.to_path_buf())]);
    }
    let mut out = Vec::new();
    let mut stack = vec![temp_root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            let ft = entry.file_type()?;
            // Downloaded trees contain only regular files and directories;
            // skip symlinks to avoid infinite loops.
            if ft.is_symlink() {
                continue;
            }
            if ft.is_dir() {
                stack.push(path);
            } else {
                let rel = path
                    .strip_prefix(temp_root)
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
                let rel_str = rel
                    .components()
                    .map(|c| c.as_os_str().to_string_lossy())
                    .collect::<Vec<_>>()
                    .join("/");
                out.push((format!("{base_name}/{rel_str}"), path));
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn single_file_yields_one_entry() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("blob.bin");
        fs::write(&f, b"hi").unwrap();

        let entries = collect_publish_entries(&f, "blob.bin").unwrap();
        assert_eq!(entries, vec![("blob.bin".to_string(), f)]);
    }

    #[test]
    fn directory_yields_nested_entries_with_forward_slashes() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("proj");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("README"), b"r").unwrap();
        fs::write(root.join("src").join("main.rs"), b"m").unwrap();

        let mut entries = collect_publish_entries(&root, "proj").unwrap();
        entries.sort();
        assert_eq!(
            entries.iter().map(|(r, _)| r.clone()).collect::<Vec<_>>(),
            vec!["proj/README".to_string(), "proj/src/main.rs".to_string()],
        );
    }

    #[test]
    fn empty_directory_yields_no_entries() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("empty");
        std::fs::create_dir_all(&root).unwrap();
        assert!(collect_publish_entries(&root, "empty").unwrap().is_empty());
    }
}
