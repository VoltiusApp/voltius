use super::{get_backend, TransferProgress};
use crate::error::AppError;
use crate::sftp::attrs::AttrChange;
use crate::sftp::backend::FileBackend;
use crate::sftp::SftpManager;
use crate::ssh::session::SessionManager;
use base64::Engine;
use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

const PASTE_DIR: [&str; 3] = [".cache", "voltius", "pastes"];
const PREFIX: &str = "voltius-paste-";
const MAX_AGE_SECS: u64 = 7 * 24 * 60 * 60;
const CHUNK: usize = 64 * 1024;
const THUMB_W: u32 = 224;
const THUMB_H: u32 = 144;
const KEPT_IMAGES: usize = 4;

struct Encoded {
    png: Vec<u8>,
}

/// Images read from the clipboard by id, so Retry sends the same picture even if
/// the clipboard has changed since.
static IMAGES: Mutex<(u64, BTreeMap<u64, Encoded>)> = Mutex::new((0, BTreeMap::new()));

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardImage {
    id: u64,
    width: u32,
    height: u32,
    size: u64,
    thumbnail: String,
}

fn encode_png(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .write_header()
        .and_then(|mut w| w.write_image_data(rgba))
        .map_err(|e| format!("couldn't encode the image: {e}"))?;
    Ok(out)
}

/// Nearest-neighbour shrink to fit `max_w`×`max_h`; good enough for a toast thumbnail.
fn shrink(rgba: &[u8], width: u32, height: u32, max_w: u32, max_h: u32) -> (Vec<u8>, u32, u32) {
    let scale = f64::min(
        1.0,
        f64::min(max_w as f64 / width as f64, max_h as f64 / height as f64),
    );
    let (w, h) = (
        ((width as f64 * scale) as u32).max(1),
        ((height as f64 * scale) as u32).max(1),
    );
    let mut out = Vec::with_capacity((w * h * 4) as usize);
    for y in 0..h {
        let sy = (y as u64 * height as u64 / h as u64) as u32;
        for x in 0..w {
            let sx = (x as u64 * width as u64 / w as u64) as u32;
            let i = ((sy * width + sx) * 4) as usize;
            out.extend_from_slice(&rgba[i..i + 4]);
        }
    }
    (out, w, h)
}

fn remember(png: Vec<u8>) -> u64 {
    let mut images = IMAGES.lock().unwrap_or_else(|e| e.into_inner());
    images.0 += 1;
    let id = images.0;
    images.1.insert(id, Encoded { png });
    while images.1.len() > KEPT_IMAGES {
        images.1.pop_first();
    }
    id
}

fn recall(id: u64) -> Option<Vec<u8>> {
    let images = IMAGES.lock().unwrap_or_else(|e| e.into_inner());
    images.1.get(&id).map(|e| e.png.clone())
}

/// The clipboard image as PNG, kept for `paste_image_upload`; `None` when the clipboard holds none.
#[tauri::command]
pub async fn paste_image_read(app: AppHandle) -> Result<Option<ClipboardImage>, String> {
    let Ok(image) = app.clipboard().read_image() else {
        return Ok(None);
    };
    let (width, height) = (image.width(), image.height());
    if width == 0 || height == 0 {
        return Ok(None);
    }
    let rgba = image.rgba().to_vec();
    tauri::async_runtime::spawn_blocking(move || {
        let png = encode_png(&rgba, width, height)?;
        let (thumb, tw, th) = shrink(&rgba, width, height, THUMB_W, THUMB_H);
        let thumbnail = format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(encode_png(&thumb, tw, th)?)
        );
        let size = png.len() as u64;
        Ok(Some(ClipboardImage {
            id: remember(png),
            width,
            height,
            size,
            thumbnail,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn file_name(now: chrono::DateTime<chrono::Local>) -> String {
    format!("{PREFIX}{}.png", now.format("%Y%m%d-%H%M%S-%3f"))
}

async fn ensure_dir(backend: &dyn FileBackend) -> Result<String, AppError> {
    let mut dir = backend.canonicalize(".").await?;
    for segment in PASTE_DIR {
        dir = format!("{}/{segment}", dir.trim_end_matches('/'));
        if backend.stat(&dir).await?.is_none() {
            backend.mkdir(&dir).await?;
        }
    }
    // Screenshots can show anything on screen: owner-only. Best effort, as a host
    // without a shell can't chmod; the home directory still guards them.
    let owner_only = AttrChange {
        paths: vec![dir.clone()],
        set: 0,
        clear: 0o077,
        owner: None,
        group: None,
        recurse: None,
    };
    let _ = backend.set_attrs(&owner_only).await;
    Ok(dir)
}

fn is_stale(name: &str, modified: Option<u64>, now: u64) -> bool {
    name.starts_with(PREFIX) && modified.is_some_and(|m| now.saturating_sub(m) > MAX_AGE_SECS)
}

async fn prune(backend: &dyn FileBackend, dir: &str) {
    let Ok(entries) = backend.list_dir(dir).await else {
        return;
    };
    let now = chrono::Utc::now().timestamp().max(0) as u64;
    for f in entries
        .iter()
        .filter(|f| !f.is_dir && is_stale(&f.name, f.modified, now))
    {
        let _ = backend.delete(&f.path).await;
    }
}

async fn write_part(
    app: &AppHandle,
    backend: &dyn FileBackend,
    part: &str,
    png: &[u8],
    transfer_id: &str,
    cancel: &CancellationToken,
) -> Result<(), AppError> {
    let total = png.len() as u64;
    let mut writer = backend.endpoint().open_write(part, 0, total).await?;
    let mut done = 0;
    for chunk in png.chunks(CHUNK) {
        tokio::select! {
            _ = cancel.cancelled() => return Err("cancelled".into()),
            r = writer.write_all(chunk) => r.map_err(|e| AppError::caused("write failed", &e))?,
        }
        done += chunk.len() as u64;
        let _ = app.emit(
            &format!("sftp-progress-{transfer_id}"),
            TransferProgress {
                transferred: done,
                total,
            },
        );
    }
    writer
        .shutdown()
        .await
        .map_err(|e| AppError::caused("write failed", &e))
}

/// Upload image `image_id` next to the session's shell and return its path. It is
/// written as `.part` and renamed, so a program never reads a half-written file.
#[tauri::command]
pub async fn paste_image_upload(
    app: AppHandle,
    ssh_state: State<'_, SessionManager>,
    sftp_state: State<'_, SftpManager>,
    session_id: String,
    image_id: u64,
    transfer_id: String,
) -> Result<String, AppError> {
    let png = recall(image_id).ok_or("The pasted image is no longer available")?;
    let handle = ssh_state.get_session_handle(&session_id).await?;
    let sftp_id = sftp_state.open(handle).await?;
    let cancel = sftp_state.register_transfer(&transfer_id).await;
    let result = async {
        let backend = get_backend(&sftp_state, &sftp_id).await?;
        let dir = ensure_dir(&*backend).await?;
        prune(&*backend, &dir).await;
        let path = format!("{dir}/{}", file_name(chrono::Local::now()));
        let part = format!("{path}.part");
        if let Err(e) = write_part(&app, &*backend, &part, &png, &transfer_id, &cancel).await {
            let _ = backend.delete(&part).await;
            return Err(e);
        }
        backend.rename(&part, &path).await?;
        Ok(path)
    }
    .await;
    sftp_state.finish_transfer(&transfer_id).await;
    sftp_state.close(&sftp_id).await;
    result
}

#[cfg(test)]
mod tests {
    use super::{file_name, is_stale, recall, remember, shrink, KEPT_IMAGES, MAX_AGE_SECS};
    use chrono::TimeZone;

    #[test]
    fn names_carry_local_time_to_the_millisecond() {
        let at = chrono::Local
            .with_ymd_and_hms(2026, 10, 14, 9, 5, 7)
            .unwrap()
            + chrono::Duration::milliseconds(42);
        assert_eq!(file_name(at), "voltius-paste-20261014-090507-042.png");
    }

    #[test]
    fn prunes_only_its_own_week_old_pastes() {
        let now = MAX_AGE_SECS * 3;
        assert!(is_stale(
            "voltius-paste-1.png",
            Some(now - MAX_AGE_SECS - 1),
            now
        ));
        assert!(is_stale("voltius-paste-1.png.part", Some(0), now));
        assert!(!is_stale("voltius-paste-1.png", Some(now - 60), now));
        assert!(!is_stale("notes.txt", Some(0), now));
        assert!(!is_stale("voltius-paste-1.png", None, now));
    }

    #[test]
    fn thumbnails_keep_the_aspect_ratio_and_never_grow() {
        let rgba = vec![255u8; 400 * 100 * 4];
        let (_, w, h) = shrink(&rgba, 400, 100, 224, 144);
        assert_eq!((w, h), (224, 56));
        let (_, w, h) = shrink(&rgba[..16 * 4], 4, 4, 224, 144);
        assert_eq!((w, h), (4, 4));
    }

    #[test]
    fn keeps_the_last_few_images_for_retry() {
        let ids: Vec<u64> = (0..KEPT_IMAGES as u8 + 1)
            .map(|i| remember(vec![i]))
            .collect();
        assert_eq!(recall(ids[0]), None);
        assert_eq!(recall(*ids.last().unwrap()), Some(vec![KEPT_IMAGES as u8]));
    }
}
