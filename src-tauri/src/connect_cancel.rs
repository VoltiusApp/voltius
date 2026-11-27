use crate::error::AppError;
use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;

/// A close can reach the backend before the connect it should stop has begun.
const EARLY_CLOSE_WINDOW: Duration = Duration::from_secs(5);

const CANCELLED: &str = "Connection cancelled.";

enum Slot {
    Running(u64, CancellationToken),
    Closed(Instant),
}

/// In-flight connect attempts by session id, so closing a session stops its connect.
#[derive(Default)]
pub struct ConnectCancels {
    slots: Mutex<HashMap<String, Slot>>,
    next: AtomicU64,
}

pub struct ConnectAttempt<'a> {
    cancels: &'a ConnectCancels,
    id: String,
    attempt: u64,
    token: CancellationToken,
}

impl ConnectCancels {
    fn slots(&self) -> std::sync::MutexGuard<'_, HashMap<String, Slot>> {
        let mut slots = self.slots.lock().unwrap_or_else(|e| e.into_inner());
        slots.retain(
            |_, slot| !matches!(slot, Slot::Closed(at) if at.elapsed() >= EARLY_CLOSE_WINDOW),
        );
        slots
    }

    pub fn begin(&self, id: &str) -> ConnectAttempt<'_> {
        self.register(id, &mut self.slots())
    }

    pub fn begin_if_idle(&self, id: &str) -> Result<ConnectAttempt<'_>, AppError> {
        let mut slots = self.slots();
        if matches!(slots.get(id), Some(Slot::Running(..))) {
            return Err("NetBird sign-in already in progress.".into());
        }
        Ok(self.register(id, &mut slots))
    }

    fn register(&self, id: &str, slots: &mut HashMap<String, Slot>) -> ConnectAttempt<'_> {
        let attempt = self.next.fetch_add(1, Ordering::Relaxed);
        let token = CancellationToken::new();
        let previous = slots.insert(id.to_owned(), Slot::Running(attempt, token.clone()));
        if matches!(previous, Some(Slot::Closed(_))) {
            token.cancel();
        }
        ConnectAttempt {
            cancels: self,
            id: id.to_owned(),
            attempt,
            token,
        }
    }

    /// The session is closing: stop its attempt, or the one about to begin.
    pub fn cancel(&self, id: &str) {
        if let Some(Slot::Running(_, token)) = self
            .slots()
            .insert(id.to_owned(), Slot::Closed(Instant::now()))
        {
            token.cancel();
        }
    }

    /// A fresh attempt for this session follows, so an earlier close no longer applies.
    pub fn rearm(&self, id: &str) {
        let mut slots = self.slots();
        if matches!(slots.get(id), Some(Slot::Closed(_))) {
            slots.remove(id);
        }
    }
}

impl ConnectAttempt<'_> {
    pub async fn run<T>(
        &self,
        connect: impl Future<Output = Result<T, AppError>>,
    ) -> Result<T, AppError> {
        tokio::select! {
            biased;
            () = self.token.cancelled() => Err(CANCELLED.into()),
            result = connect => result,
        }
    }

    /// For a close that lands after `run` returned but before the session was registered.
    pub fn cancelled(&self) -> Option<AppError> {
        self.token.is_cancelled().then(|| CANCELLED.into())
    }
}

impl Drop for ConnectAttempt<'_> {
    fn drop(&mut self) {
        let mut slots = self.cancels.slots();
        if matches!(slots.get(&self.id), Some(Slot::Running(a, _)) if *a == self.attempt) {
            slots.remove(&self.id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ConnectCancels;
    use std::future::pending;

    #[tokio::test]
    async fn closing_stops_the_running_attempt() {
        let cancels = ConnectCancels::default();
        let attempt = cancels.begin("s");
        cancels.cancel("s");
        assert!(attempt.run(pending::<Result<(), _>>()).await.is_err());
    }

    #[tokio::test]
    async fn a_duplicate_login_leaves_the_first_attempt_cancellable() {
        let cancels = ConnectCancels::default();
        let attempt = cancels.begin_if_idle("s").unwrap();
        assert!(cancels.begin_if_idle("s").is_err());
        cancels.cancel("s");
        assert!(attempt.run(pending::<Result<(), _>>()).await.is_err());
        cancels.rearm("s");
        assert!(cancels.begin_if_idle("s").unwrap().cancelled().is_none());
    }

    #[tokio::test]
    async fn a_close_that_arrives_first_cancels_the_next_attempt_only() {
        let cancels = ConnectCancels::default();
        cancels.cancel("s");
        assert!(cancels.begin("s").cancelled().is_some());
        assert!(cancels.begin("s").cancelled().is_none());
    }

    #[tokio::test]
    async fn a_reconnect_clears_an_earlier_close() {
        let cancels = ConnectCancels::default();
        cancels.cancel("s");
        cancels.rearm("s");
        let attempt = cancels.begin("s");
        assert!(attempt.cancelled().is_none());
        assert_eq!(
            attempt
                .run(async { Ok::<_, crate::error::AppError>(7) })
                .await
                .unwrap(),
            7
        );
    }

    #[tokio::test]
    async fn a_finished_attempt_leaves_nothing_behind() {
        let cancels = ConnectCancels::default();
        drop(cancels.begin("s"));
        cancels.rearm("s");
        assert!(cancels.slots().is_empty());
    }
}
