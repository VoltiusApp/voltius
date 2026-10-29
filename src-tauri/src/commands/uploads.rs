use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::scratch::transfer_dir;

const AREA: &str = "voltius-uploads";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PickedFile {
    pub uri: String,
    pub name: String,
    pub size: i64,
}

#[cfg(target_os = "android")]
mod android {
    use crate::android_ctx::{load_class, with_env, PickSlot};
    use jni::objects::{JClass, JString, JValue};
    use jni::JNIEnv;

    const CLASS: &str = "com.voltius.app.VoltiusUploads";
    static PICK: PickSlot = PickSlot::new();

    pub async fn pick() -> Result<Option<String>, String> {
        PICK.pick("file picker", CLASS).await
    }

    pub fn copy_to_cache(uri: &str, dest: &str) -> Result<(), String> {
        with_env("copy picked file", |env, ctx| {
            let cls = load_class(env, CLASS)?;
            let juri = env.new_string(uri)?;
            let jdest = env.new_string(dest)?;
            env.call_static_method(
                &cls,
                "copyToCache",
                "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)V",
                &[
                    JValue::Object(ctx),
                    JValue::Object(&juri),
                    JValue::Object(&jdest),
                ],
            )?
            .v()
        })
    }

    #[no_mangle]
    pub extern "system" fn Java_com_voltius_app_VoltiusUploads_nativeFilesPicked<'local>(
        mut env: JNIEnv<'local>,
        _class: JClass<'local>,
        json: JString<'local>,
    ) {
        PICK.fulfil(&mut env, &json);
    }
}

#[cfg(any(target_os = "android", test))]
fn parse_picked(json: &str) -> Result<Vec<PickedFile>, String> {
    let files: Vec<PickedFile> =
        serde_json::from_str(json).map_err(|e| format!("Cannot read the picked files: {e}"))?;
    Ok(files
        .into_iter()
        .map(|f| PickedFile {
            name: crate::scratch::safe_file_name(&f.name),
            size: f.size.max(0),
            uri: f.uri,
        })
        .collect())
}

/// System document picker (any type, multiple). Empty when the user cancels.
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

/// Copy a `content://` URI into `<cache>/voltius-uploads/<transfer id>/<name>`; returns that path.
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
        let to = dest.clone();
        tauri::async_runtime::spawn_blocking(move || android::copy_to_cache(&uri, &to))
            .await
            .map_err(|e| format!("copy picked file: {e}"))??;
        Ok(dest)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, uri, name, transfer_id);
        Err("upload staging is Android-only".into())
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picked_names_are_made_safe_and_sizes_non_negative() {
        let json = r#"[
            {"uri":"content://a/1","name":"../../.bashrc","size":12},
            {"uri":"content://a/2","name":"","size":-1},
            {"uri":"content://a/3","name":"..","size":3},
            {"uri":"content://a/4","name":"photo.jpg","size":7}
        ]"#;
        let got = parse_picked(json).unwrap();
        let names: Vec<_> = got.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, [".._.._.bashrc", "file", "file", "photo.jpg"]);
        assert_eq!(got[1].size, 0);
        assert_eq!(got[0].uri, "content://a/1");
    }

    #[test]
    fn cancel_is_an_empty_list() {
        assert!(parse_picked("[]").unwrap().is_empty());
    }

    #[test]
    fn garbage_is_an_error() {
        assert!(parse_picked("nope").is_err());
    }
}
