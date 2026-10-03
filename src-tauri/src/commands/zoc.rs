use std::path::{Path, PathBuf};

const HOST_DIRECTORY: &str = "Options/HostDirectory.zhd";

fn data_root() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        dirs::data_dir()
    }
    #[cfg(not(target_os = "macos"))]
    {
        dirs::document_dir()
    }
}

fn zoc_version(name: &str) -> Option<u32> {
    name.strip_prefix("ZOC")?
        .strip_suffix(" Files")?
        .parse()
        .ok()
}

fn newest_host_directory(root: &Path) -> Option<PathBuf> {
    std::fs::read_dir(root)
        .ok()?
        .flatten()
        .filter_map(|e| {
            let version = zoc_version(&e.file_name().to_string_lossy())?;
            let file = e.path().join(HOST_DIRECTORY);
            file.is_file().then_some((version, file))
        })
        .max_by_key(|(version, _)| *version)
        .map(|(_, file)| file)
}

#[tauri::command]
pub fn zoc_host_directory() -> Result<Vec<u8>, String> {
    let root = data_root().ok_or("Could not locate the Documents folder")?;
    let file = newest_host_directory(&root).ok_or_else(|| {
        format!(
            "ZOC host directory not found in {}",
            root.join("ZOC<version> Files")
                .join(HOST_DIRECTORY)
                .display()
        )
    })?;
    std::fs::read(&file).map_err(|e| format!("{}: {e}", file.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_newest_zoc_data_folder_holding_a_host_directory() {
        let root = tempfile::tempdir().unwrap();
        for (dir, with_file) in [
            ("ZOC8 Files", true),
            ("ZOC9 Files", true),
            ("ZOC10 Files", false),
            ("ZOCX Files", true),
        ] {
            let options = root.path().join(dir).join("Options");
            std::fs::create_dir_all(&options).unwrap();
            if with_file {
                std::fs::write(options.join("HostDirectory.zhd"), dir).unwrap();
            }
        }
        let found = newest_host_directory(root.path()).unwrap();
        assert_eq!(std::fs::read_to_string(found).unwrap(), "ZOC9 Files");
    }

    #[test]
    fn finds_nothing_without_a_zoc_folder() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(newest_host_directory(root.path()), None);
    }
}
