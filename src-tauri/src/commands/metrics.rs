use tauri::{AppHandle, Emitter, State};
use tokio::time::Duration;
use uuid::Uuid;

use crate::{
    metrics::{local::LocalMetrics, remote::RemoteMetricsState, stream::MetricsStreamManager},
    ssh::session::SessionManager,
};

const SAMPLE_INTERVAL: Duration = Duration::from_secs(1);
const PRIME_INTERVAL: Duration = Duration::from_millis(250);

#[tauri::command]
pub async fn metrics_start(
    app: AppHandle,
    stream_manager: State<'_, MetricsStreamManager>,
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
) -> Result<String, String> {
    let stream_id = Uuid::new_v4().to_string();
    let event = format!("metrics:snapshot:{}", stream_id);

    let join_handle = if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        let app = app.clone();
        tokio::spawn(async move {
            let mut state = RemoteMetricsState::new();
            // The first sample's deltas run from boot; a short prime gets the first reading on screen fast.
            let mut primed = false;
            loop {
                match state.snapshot(&handle).await {
                    Ok(snap) if primed => {
                        let _ = app.emit(&event, &snap);
                    }
                    Ok(_) => {}
                    Err(_) => break,
                }
                let pause = if primed {
                    SAMPLE_INTERVAL
                } else {
                    PRIME_INTERVAL
                };
                primed = true;
                tokio::time::sleep(pause).await;
            }
        })
    } else {
        let app = app.clone();
        tokio::spawn(async move {
            let mut metrics = LocalMetrics::new();
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            loop {
                let snap = metrics.snapshot();
                let _ = app.emit(&event, &snap);
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            }
        })
    };

    stream_manager
        .streams
        .lock()
        .await
        .insert(stream_id.clone(), join_handle);
    Ok(stream_id)
}

#[tauri::command]
pub async fn metrics_stop(
    stream_manager: State<'_, MetricsStreamManager>,
    stream_id: String,
) -> Result<(), String> {
    stream_manager.stop(&stream_id).await;
    Ok(())
}
