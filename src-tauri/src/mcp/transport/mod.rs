mod shared;
pub use shared::{dispatch_line, socket_path};
pub(crate) use shared::{CALL_TIMEOUT, MAX_LINE_BYTES};

#[cfg(unix)]
mod unix;
#[cfg(unix)]
pub use unix::serve;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::serve;
