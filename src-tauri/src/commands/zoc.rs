use std::path::{Path, PathBuf};

type DataFolder = (u32, PathBuf);

fn host_directory(data_folder: &Path) -> PathBuf {
    data_folder.join("Options").join("HostDirectory.zhd")
}

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
    name.strip_prefix("ZOC")?.parse().ok()
}

fn default_folders(root: &Path) -> Vec<DataFolder> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            Some((zoc_version(name.strip_suffix(" Files")?)?, e.path()))
        })
        .collect()
}

#[cfg(target_os = "windows")]
fn relocated_folders() -> Vec<DataFolder> {
    let Ok(emtec) = windows_registry::CURRENT_USER.open(r"Software\EmTec") else {
        return Vec::new();
    };
    let Ok(names) = emtec.keys() else {
        return Vec::new();
    };
    names
        .filter_map(|name| {
            let folder = emtec
                .open(&name)
                .ok()?
                .get_string("UserConfigFolder")
                .ok()?;
            Some((zoc_version(&name)?, PathBuf::from(folder)))
        })
        .collect()
}

#[cfg(not(target_os = "windows"))]
fn relocated_folders() -> Vec<DataFolder> {
    Vec::new()
}

// max_by_key keeps the last of equal versions: a relocated folder must follow the default it overrides.
fn newest_host_directory(folders: &[DataFolder]) -> Option<PathBuf> {
    folders
        .iter()
        .map(|(version, folder)| (version, host_directory(folder)))
        .filter(|(_, file)| file.is_file())
        .max_by_key(|(version, _)| *version)
        .map(|(_, file)| file)
}

#[tauri::command]
pub fn zoc_host_directory() -> Result<Vec<u8>, String> {
    let root = data_root().ok_or("Could not locate the Documents folder")?;
    let relocated = relocated_folders();
    let mut folders = default_folders(&root);
    folders.extend(relocated.iter().cloned());
    let file = newest_host_directory(&folders).ok_or_else(|| {
        let looked: Vec<String> = std::iter::once(root.join("ZOC<version> Files"))
            .chain(relocated.into_iter().map(|(_, folder)| folder))
            .map(|folder| host_directory(&folder).display().to_string())
            .collect();
        format!(
            "ZOC host directory not found. Looked in:\n  {}",
            looked.join("\n  ")
        )
    })?;
    std::fs::read(&file).map_err(|e| format!("{}: {e}", file.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data_folder(root: &Path, dir: &str, with_file: bool) -> PathBuf {
        let folder = root.join(dir);
        std::fs::create_dir_all(folder.join("Options")).unwrap();
        if with_file {
            std::fs::write(host_directory(&folder), dir).unwrap();
        }
        folder
    }

    fn found(folders: &[DataFolder]) -> Option<String> {
        newest_host_directory(folders).map(|f| std::fs::read_to_string(f).unwrap())
    }

    #[test]
    fn picks_the_newest_zoc_data_folder_holding_a_host_directory() {
        let root = tempfile::tempdir().unwrap();
        for (dir, with_file) in [
            ("ZOC8 Files", true),
            ("ZOC9 Files", true),
            ("ZOC10 Files", false),
            ("ZOCX Files", true),
        ] {
            data_folder(root.path(), dir, with_file);
        }
        assert_eq!(
            found(&default_folders(root.path())).as_deref(),
            Some("ZOC9 Files")
        );
    }

    #[test]
    fn a_relocated_folder_overrides_the_default_of_its_version_only() {
        let root = tempfile::tempdir().unwrap();
        let default9 = (9, data_folder(root.path(), "ZOC9 Files", true));
        let moved9 = (9, data_folder(root.path(), "moved9", true));
        let moved8 = (8, data_folder(root.path(), "moved8", true));
        assert_eq!(
            found(&[default9.clone(), moved9]).as_deref(),
            Some("moved9")
        );
        assert_eq!(found(&[default9, moved8]).as_deref(), Some("ZOC9 Files"));
    }

    #[test]
    fn finds_nothing_without_a_zoc_folder() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(found(&default_folders(root.path())), None);
    }
}
