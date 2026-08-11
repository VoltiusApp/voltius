/// Milliseconds since the Unix epoch, as every snapshot and log line stamps it.
/// A clock reading before the epoch is reported as 0 rather than failing.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
