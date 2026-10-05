pub(crate) mod names;

use std::collections::HashSet;
use std::sync::{LazyLock, Mutex as StdMutex};
use std::time::Duration;

pub(crate) const OVERLAP: u64 = 64 * 1024;
pub(crate) const LARGE_FILE: u64 = 64 * 1024 * 1024;
pub(crate) const LINK_WAIT: Duration = Duration::from_secs(300);
pub(crate) const RESTARTS: u32 = 3;

// Keyed by transfer id: the engine has no SftpManager to ask.
static RESUMING: LazyLock<StdMutex<HashSet<String>>> = LazyLock::new(Default::default);

pub fn mark_resume(tid: &str) {
    RESUMING.lock().unwrap().insert(tid.to_string());
}

pub fn is_resume(tid: &str) -> bool {
    RESUMING.lock().unwrap().contains(tid)
}

pub fn clear_resume(tid: &str) {
    RESUMING.lock().unwrap().remove(tid);
}

#[cfg(test)]
mod mark_tests {
    use super::*;

    #[test]
    fn a_mark_lasts_until_cleared() {
        assert!(!is_resume("m1"));
        mark_resume("m1");
        assert!(is_resume("m1"));
        clear_resume("m1");
        assert!(!is_resume("m1"));
    }
}
