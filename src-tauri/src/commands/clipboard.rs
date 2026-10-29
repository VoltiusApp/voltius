use super::raw_body;
use tauri::image::Image;
use tauri::ipc::Request;
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

fn check_pixels(len: usize, width: u32, height: u32) -> Result<(), String> {
    if len as u64 == u64::from(width) * u64::from(height) * 4 && len > 0 {
        Ok(())
    } else {
        Err(format!("{len} bytes are not {width}×{height} RGBA pixels"))
    }
}

/// RGBA pixels arrive as the raw IPC body, sized by the `width`/`height` headers:
/// as JSON, a 4K image would be tens of MB of numbers.
#[tauri::command]
pub async fn clipboard_write_rgba(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let rgba = raw_body(request.body(), "RGBA")?;
    let dim = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u32>().ok())
            .ok_or_else(|| format!("missing {name} header"))
    };
    let (width, height) = (dim("width")?, dim("height")?);
    check_pixels(rgba.len(), width, height)?;
    app.clipboard()
        .write_image(&Image::new(rgba, width, height))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::check_pixels;

    #[test]
    fn the_body_must_match_the_announced_size() {
        assert!(check_pixels(2 * 3 * 4, 2, 3).is_ok());
        assert!(check_pixels(2 * 3 * 4 - 1, 2, 3).is_err());
        assert!(check_pixels(0, 0, 0).is_err());
    }
}
