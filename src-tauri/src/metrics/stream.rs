use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

pub struct MetricsStreamManager {
    pub streams: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
}

impl MetricsStreamManager {
    pub fn new() -> Self {
        Self {
            streams: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn stop(&self, stream_id: &str) {
        if let Some(handle) = self.streams.lock().await.remove(stream_id) {
            handle.abort();
        }
    }
}
