use std::io::{Seek, SeekFrom, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::ipc::Request;
use tauri::{AppHandle, Manager};

use super::raw_body;
use crate::scratch::transfer_dir;

const AREA: &str = "voltius-uploads";
// The remote name comes from the queue item; the staging copy only needs to be unique per transfer.
const STAGED_NAME: &str = "upload";
#[cfg(target_os = "android")]
const DROP_EVENT: &str = "android://files-dropped";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PickedFile {
    pub uri: String,
    pub name: String,
    pub size: i64,
}

#[cfg(any(target_os = "android", test))]
#[derive(Serialize, Clone, Debug)]
struct DroppedFiles {
    x: f32,
    y: f32,
    files: Vec<PickedFile>,
}

#[cfg(target_os = "android")]
mod android {
    use crate::android_ctx::{call_static_bool, load_class, with_env, PickSlot};
    use jni::objects::{JClass, JString, JValue};
    use jni::JNIEnv;

    const CLASS: &str = "com.voltius.app.VoltiusUploads";
    static PICK: PickSlot = PickSlot::new();

    pub async fn pick() -> Result<Option<String>, String> {
        PICK.pick("file picker", CLASS).await
    }

    pub fn set_drop_target(on: bool) {
        call_static_bool(CLASS, "setDropTarget", on);
    }

    pub fn copy_to_cache(uri: &str, dest: &str, transfer_id: &str) -> Result<(), String> {
        with_env("copy picked file", |env, ctx| {
            let cls = load_class(env, CLASS)?;
            let juri = env.new_string(uri)?;
            let jdest = env.new_string(dest)?;
            let jid = env.new_string(transfer_id)?;
            env.call_static_method(
                &cls,
                "copyToCache",
                "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V",
                &[
                    JValue::Object(ctx),
                    JValue::Object(&juri),
                    JValue::Object(&jdest),
                    JValue::Object(&jid),
                ],
            )?
            .v()
        })
    }

    #[no_mangle]
    pub extern "system" fn Java_com_voltius_app_VoltiusUploads_nativeCopyCancelled<'local>(
        mut env: JNIEnv<'local>,
        _class: JClass<'local>,
        transfer_id: JString<'local>,
    ) -> jni::sys::jboolean {
        use tauri::Manager;
        let Ok(id) = env.get_string(&transfer_id).map(String::from) else {
            return jni::sys::JNI_FALSE;
        };
        let cancelled = crate::android_ctx::app()
            .is_some_and(|app| app.state::<crate::sftp::SftpManager>().is_cancelled(&id));
        u8::from(cancelled)
    }

    #[no_mangle]
    pub extern "system" fn Java_com_voltius_app_VoltiusUploads_nativeFilesPicked<'local>(
        mut env: JNIEnv<'local>,
        _class: JClass<'local>,
        json: JString<'local>,
    ) {
        PICK.fulfil(&mut env, &json);
    }

    #[no_mangle]
    pub extern "system" fn Java_com_voltius_app_VoltiusUploads_nativeFilesDropped<'local>(
        mut env: JNIEnv<'local>,
        _class: JClass<'local>,
        x: jni::sys::jfloat,
        y: jni::sys::jfloat,
        json: JString<'local>,
    ) {
        let json: String = match env.get_string(&json) {
            Ok(s) => s.into(),
            Err(_) => return,
        };
        super::emit_dropped(x, y, &json);
    }
}

#[cfg(any(target_os = "android", test))]
fn parse_picked(json: &str) -> Result<Vec<PickedFile>, String> {
    let files: Vec<PickedFile> =
        serde_json::from_str(json).map_err(|e| format!("Cannot read the picked files: {e}"))?;
    Ok(files
        .into_iter()
        .map(|f| PickedFile {
            size: f.size.max(0),
            ..f
        })
        .collect())
}

#[cfg(any(target_os = "android", test))]
fn parse_dropped(x: f32, y: f32, json: &str) -> Result<DroppedFiles, String> {
    Ok(DroppedFiles {
        x,
        y,
        files: parse_picked(json)?,
    })
}

#[cfg(target_os = "android")]
fn emit_dropped(x: f32, y: f32, json: &str) {
    use tauri::Emitter;
    let Some(app) = crate::android_ctx::app() else {
        return;
    };
    match parse_dropped(x, y, json) {
        Ok(drop) if !drop.files.is_empty() => {
            if let Err(e) = app.emit(DROP_EVENT, drop) {
                log::warn!("files dropped: {e}");
            }
        }
        Ok(_) => {}
        Err(e) => log::warn!("files dropped: {e}"),
    }
}

#[tauri::command]
pub async fn upload_pick() -> Result<Vec<PickedFile>, String> {
    #[cfg(target_os = "android")]
    {
        match android::pick().await? {
            Some(json) => parse_picked(&json),
            None => Err("Cannot read the picked files".into()),
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("file upload picker is Android-only".into())
    }
}

#[tauri::command]
pub fn upload_drop_target(on: bool) {
    #[cfg(target_os = "android")]
    android::set_drop_target(on);
    #[cfg(not(target_os = "android"))]
    let _ = on;
}

#[tauri::command]
pub async fn upload_stage(
    app: AppHandle,
    uri: String,
    name: String,
    transfer_id: String,
) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        let dest = crate::scratch::transfer_file(&app, AREA, &transfer_id, &name)?
            .to_string_lossy()
            .into_owned();
        let (to, id) = (dest.clone(), transfer_id.clone());
        let copied =
            tauri::async_runtime::spawn_blocking(move || android::copy_to_cache(&uri, &to, &id))
                .await
                .map_err(|e| format!("copy picked file: {e}"))?;
        let transfers = app.state::<crate::sftp::SftpManager>();
        copied.map(|()| dest).map_err(|e| {
            if transfers.is_cancelled(&transfer_id) {
                crate::sftp::TRANSFER_CANCELLED.into()
            } else {
                e
            }
        })
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, uri, name, transfer_id);
        Err("upload staging is Android-only".into())
    }
}

/// One chunk of a file the WebView holds (the iOS file picker or a drop), written at
/// the `offset` header into the transfer's staging copy. Returns the copy's path.
#[tauri::command]
pub async fn upload_stage_chunk(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let bytes = raw_body(request.body(), "file")?;
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| format!("missing {name} header"))
    };
    let transfer_id = header("transfer-id")?;
    let offset: u64 = header("offset")?
        .parse()
        .map_err(|_| "invalid offset header".to_string())?;
    if app
        .state::<crate::sftp::SftpManager>()
        .is_cancelled(transfer_id)
    {
        return Err(crate::sftp::TRANSFER_CANCELLED.into());
    }
    let dest = crate::scratch::transfer_file(&app, AREA, transfer_id, STAGED_NAME)?;
    write_chunk(&dest, offset, bytes)?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Chunks arrive in order: offset 0 starts the copy over, any other must be its current end.
fn write_chunk(path: &Path, offset: u64, bytes: &[u8]) -> Result<(), String> {
    let failed = |e: std::io::Error| format!("Cannot write the upload temp copy: {e}");
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(offset == 0)
        .open(path)
        .map_err(failed)?;
    let end = file.seek(SeekFrom::End(0)).map_err(failed)?;
    if end != offset {
        return Err(format!(
            "upload chunk at {offset} but the copy holds {end} bytes"
        ));
    }
    file.write_all(bytes).map_err(failed)
}

#[tauri::command]
pub async fn upload_stage_clear(app: AppHandle, transfer_id: String) -> Result<(), String> {
    match std::fs::remove_dir_all(transfer_dir(&app, AREA, &transfer_id)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            Err(format!("Cannot remove the upload temp copy: {e}"))
        }
        _ => Ok(()),
    }
}

pub fn sweep_stale_copies(app: &AppHandle) {
    if let Ok(cache) = crate::scratch::app_scratch_dir(app) {
        let _ = std::fs::remove_dir_all(cache.join(AREA));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picked_sizes_are_non_negative() {
        let json = r#"[
            {"uri":"content://a/1","name":"../../.bashrc","size":12},
            {"uri":"content://a/2","name":"","size":-1},
            {"uri":"content://a/3","name":"..","size":3},
            {"uri":"content://a/4","name":"photo.jpg","size":7}
        ]"#;
        let got = parse_picked(json).unwrap();
        let names: Vec<_> = got.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["../../.bashrc", "", "..", "photo.jpg"]);
        assert_eq!(got[1].size, 0);
        assert_eq!(got[0].uri, "content://a/1");
    }

    #[test]
    fn cancel_is_an_empty_list() {
        assert!(parse_picked("[]").unwrap().is_empty());
    }

    #[test]
    fn a_drop_carries_its_point_and_the_picker_rules() {
        let json = r#"[
            {"uri":"content://f/1","name":"../../etc/passwd","size":-1},
            {"uri":"content://f/2","name":"clip.mp4","size":9}
        ]"#;
        let got = serde_json::to_value(parse_dropped(12.5, 300.0, json).unwrap()).unwrap();
        assert_eq!(
            got,
            serde_json::json!({
                "x": 12.5,
                "y": 300.0,
                "files": [
                    {"uri":"content://f/1","name":"../../etc/passwd","size":0},
                    {"uri":"content://f/2","name":"clip.mp4","size":9}
                ]
            })
        );
        assert!(parse_dropped(0.0, 0.0, "{}").is_err());
    }

    #[test]
    fn chunks_append_in_order_and_offset_zero_starts_over() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(STAGED_NAME);
        write_chunk(&path, 0, b"abc").unwrap();
        write_chunk(&path, 3, b"de").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"abcde");
        assert!(write_chunk(&path, 2, b"x").is_err());
        assert!(write_chunk(&path, 9, b"x").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"abcde");
        write_chunk(&path, 0, b"z").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"z");
        write_chunk(&path, 0, b"").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"");
    }

    #[test]
    fn garbage_is_an_error() {
        assert!(parse_picked("nope").is_err());
    }
}
