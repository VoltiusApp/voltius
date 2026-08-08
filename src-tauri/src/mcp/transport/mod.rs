mod shared;
pub use shared::{dispatch_line, socket_path};

#[cfg(unix)]
mod unix;
#[cfg(unix)]
pub use unix::serve;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::serve;
