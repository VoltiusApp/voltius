pub mod addrs;
#[cfg(target_os = "android")]
pub mod android;
pub mod discovery;
pub mod handshake;
pub mod identity;
pub mod manager;
pub mod peers;
pub mod protocol;
pub mod route;

pub(crate) fn lock<T>(mutex: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}
