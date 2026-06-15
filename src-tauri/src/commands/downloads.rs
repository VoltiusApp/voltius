use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadDirInfo {
    pub uri: String,
    pub display_name: Option<String>,
}

#[cfg(target_os = "android")]
mod android {
    use crate::android_ctx::{load_class, with_env};
    use jni::objects::{JClass, JObject, JString, JValue};
    use jni::JNIEnv;
    use std::sync::Mutex;
    use tokio::sync::oneshot;

    // Dotted name for the app class loader (see `android_ctx::load_class`): these commands are
    // `async`, so they run on tokio threads whose default `FindClass` can't see app classes.
    const CLASS: &str = "com.voltius.app.VoltiusDownloads";
    static PICK_TX: Mutex<Option<oneshot::Sender<Option<String>>>> = Mutex::new(None);

    fn opt_string(env: &mut JNIEnv, v: JObject) -> Result<Option<String>, jni::errors::Error> {
        if v.is_null() {
            Ok(None)
        } else {
            Ok(Some(env.get_string(&JString::from(v))?.into()))
        }
    }

    pub fn get_dir() -> Result<Option<String>, String> {
        with_env("download dir get", |env, ctx| {
            let cls = load_class(env, CLASS)?;
            let v = env
                .call_static_method(
                    &cls,
                    "getDir",
                    "(Landroid/content/Context;)Ljava/lang/String;",
                    &[JValue::Object(ctx)],
                )?
                .l()?;
            opt_string(env, v)
        })
    }

    pub fn display_name() -> Result<Option<String>, String> {
        with_env("download dir name", |env, ctx| {
            let cls = load_class(env, CLASS)?;
            let v = env
                .call_static_method(
                    &cls,
                    "displayName",
                    "(Landroid/content/Context;)Ljava/lang/String;",
                    &[JValue::Object(ctx)],
                )?
                .l()?;
            opt_string(env, v)
        })
    }

    pub fn clear_dir() -> Result<(), String> {
        with_env("download dir clear", |env, ctx| {
            let cls = load_class(env, CLASS)?;
            env.call_static_method(
                &cls,
                "clearDir",
                "(Landroid/content/Context;)V",
                &[JValue::Object(ctx)],
            )?
            .v()
        })
    }

    pub fn is_writable() -> Result<bool, String> {
        with_env("download dir writable", |env, ctx| {
            let cls = load_class(env, CLASS)?;
            env.call_static_method(
                &cls,
                "isWritable",
                "(Landroid/content/Context;)Z",
                &[JValue::Object(ctx)],
            )?
            .z()
        })
    }

    pub fn publish_file(rel: &str, src: &str) -> Result<bool, String> {
        with_env("download publish", |env, ctx| {
            let cls = load_class(env, CLASS)?;
            let jrel = env.new_string(rel)?;
            let jsrc = env.new_string(src)?;
            env.call_static_method(
                &cls,
                "publishFile",
                "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)Z",
                &[
                    JValue::Object(ctx),
                    JValue::Object(&jrel),
                    JValue::Object(&jsrc),
                ],
            )?
            .z()
        })
    }

    pub async fn pick() -> Result<Option<String>, String> {
        let (tx, rx) = oneshot::channel();
        *PICK_TX.lock().unwrap() = Some(tx);
        let launched = with_env("download dir pick", |env, _ctx| {
            let cls = load_class(env, CLASS)?;
            env.call_static_method(&cls, "launchPicker", "()Z", &[])?.z()
        })?;
        if !launched {
            // No Activity handled it (app backgrounded); don't park forever.
            let _ = PICK_TX.lock().unwrap().take();
            return Err("could not open the folder picker (app not in foreground)".into());
        }
        rx.await.map_err(|_| "folder picker cancelled".to_string())
    }

    /// JNI entry for `VoltiusDownloads.nativeDirPicked(uri)`. Fulfils the pending picker.
    #[no_mangle]
    pub extern "system" fn Java_com_voltius_app_VoltiusDownloads_nativeDirPicked<'local>(
        mut env: JNIEnv<'local>,
        _class: JClass<'local>,
        uri: JString<'local>,
    ) {
        let val = if uri.is_null() {
            None
        } else {
            env.get_string(&uri).ok().map(|s| s.into())
        };
        if let Some(tx) = PICK_TX.lock().unwrap().take() {
            let _ = tx.send(val);
        }
    }
}

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

/// A unique temp destination under the app cache for an in-flight download. The existing
/// `sftp_download*` commands write here (real fs); `download_publish` then moves it into the
/// SAF tree. Parent dirs are created; the leaf is returned for use as `localPath`.
#[tauri::command]
pub fn download_temp_path(transfer_id: String, name: String) -> Result<String, String> {
    let safe_name = name.replace(['/', '\\'], "_");
    let dir = std::env::temp_dir()
        .join("voltius-downloads")
        .join(&transfer_id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create temp dir: {e}"))?;
    Ok(dir.join(safe_name).to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn download_dir_get() -> Result<Option<DownloadDirInfo>, String> {
    #[cfg(target_os = "android")]
    {
        match android::get_dir()? {
            Some(uri) => Ok(Some(DownloadDirInfo {
                uri,
                display_name: android::display_name().unwrap_or(None),
            })),
            None => Ok(None),
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(None)
    }
}

#[tauri::command]
pub async fn download_dir_pick() -> Result<Option<DownloadDirInfo>, String> {
    #[cfg(target_os = "android")]
    {
        match android::pick().await? {
            Some(uri) => Ok(Some(DownloadDirInfo {
                uri,
                display_name: android::display_name().unwrap_or(None),
            })),
            None => Ok(None),
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("download directory picker is Android-only".into())
    }
}

#[tauri::command]
pub async fn download_dir_clear() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android::clear_dir()
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(())
    }
}

/// Move a completed temp download (`temp_path`, a file or directory) into the SAF tree under
/// `base_name`, then delete the temp. Android-only.
#[tauri::command]
pub async fn download_publish(temp_path: String, base_name: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        if !android::is_writable()? {
            return Err("download folder is not set or no longer writable".into());
        }
        let entries = collect_publish_entries(Path::new(&temp_path), &base_name)
            .map_err(|e| format!("Cannot read downloaded files: {e}"))?;
        for (rel, abs) in &entries {
            let ok = android::publish_file(rel, &abs.to_string_lossy())?;
            if !ok {
                return Err(format!("Failed to save {rel} to the download folder"));
            }
        }
        let _ = std::fs::remove_dir_all(Path::new(&temp_path));
        let _ = std::fs::remove_file(Path::new(&temp_path));
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (temp_path, base_name);
        Err("download publish is Android-only".into())
    }
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
