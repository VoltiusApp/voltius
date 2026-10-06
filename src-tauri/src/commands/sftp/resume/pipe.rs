//! Readers and writers for transports whose byte stream lives in a task of
//! its own (an FTP data connection, an HTTP body, an exec channel).

use crate::error::AppError;
use std::future::Future;
use std::io;
use std::pin::Pin;
use std::task::{ready, Context, Poll};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncWrite, DuplexStream, ReadBuf};
use tokio::task::JoinHandle;
use tokio::time::{sleep, Sleep};
use tokio_util::sync::{CancellationToken, DropGuard};

const PIPE: usize = 256 * 1024;
/// How long a broken pipe waits for the far end to say why it hung up.
pub(crate) const REFUSAL_GRACE: Duration = Duration::from_secs(1);

type Task = JoinHandle<Result<(), AppError>>;

/// A reader `run` feeds, or a writer it drains; its error surfaces at end of stream or
/// on `shutdown`, and dropping the stream early cancels `run`'s token.
pub(crate) fn piped<F, Fut>(run: F) -> Piped
where
    F: FnOnce(DuplexStream, CancellationToken) -> Fut,
    Fut: Future<Output = Result<(), AppError>> + Send + 'static,
{
    let (ours, theirs) = tokio::io::duplex(PIPE);
    let cancel = CancellationToken::new();
    let task = tokio::spawn(run(theirs, cancel.clone()));
    Piped {
        pipe: ours,
        task: Some(task),
        broke: None,
        _guard: cancel.drop_guard(),
    }
}

pub(crate) struct Piped {
    pipe: DuplexStream,
    task: Option<Task>,
    broke: Option<(io::Error, Pin<Box<Sleep>>)>,
    _guard: DropGuard,
}

impl Piped {
    /// The task's outcome once it has finished; Ok once it has been reported.
    fn finished(&mut self, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let Some(task) = self.task.as_mut() else {
            return Poll::Ready(Ok(()));
        };
        let joined = ready!(Pin::new(task).poll(cx));
        self.task = None;
        Poll::Ready(match joined {
            Ok(Ok(())) => Ok(()),
            Ok(Err(e)) => Err(io::Error::other(e)),
            Err(e) => Err(io::Error::other(e.to_string())),
        })
    }

    /// The pipe broke: the task's own error says why, if it gives one within `REFUSAL_GRACE`.
    fn broken(&mut self, cx: &mut Context<'_>, e: Option<io::Error>) -> Poll<io::Error> {
        if let (None, Some(e)) = (&self.broke, e) {
            self.broke = Some((e, Box::pin(sleep(REFUSAL_GRACE))));
        }
        let why = match self.finished(cx) {
            Poll::Ready(Err(why)) => Some(why),
            Poll::Ready(Ok(())) => None,
            Poll::Pending => {
                let (_, grace) = self.broke.as_mut().expect("set above");
                ready!(grace.as_mut().poll(cx));
                None
            }
        };
        let (pipe_error, _) = self.broke.take().expect("set above");
        Poll::Ready(why.unwrap_or(pipe_error))
    }
}

impl AsyncRead for Piped {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        let before = buf.filled().len();
        match ready!(Pin::new(&mut this.pipe).poll_read(cx, buf)) {
            Err(e) => this.broken(cx, Some(e)).map(Err),
            Ok(()) if buf.filled().len() == before => this.finished(cx),
            Ok(()) => Poll::Ready(Ok(())),
        }
    }
}

impl AsyncWrite for Piped {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        data: &[u8],
    ) -> Poll<io::Result<usize>> {
        let this = self.get_mut();
        if this.broke.is_some() {
            return this.broken(cx, None).map(Err);
        }
        // A drain that gave up early may leave its end of the pipe open, so writes would just block.
        if let Poll::Ready(ended) = this.finished(cx) {
            let early = ended
                .err()
                .unwrap_or_else(|| io::ErrorKind::BrokenPipe.into());
            return Poll::Ready(Err(early));
        }
        match ready!(Pin::new(&mut this.pipe).poll_write(cx, data)) {
            Err(e) => this.broken(cx, Some(e)).map(Err),
            ok => Poll::Ready(ok),
        }
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().pipe).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        ready!(Pin::new(&mut this.pipe).poll_shutdown(cx))?;
        this.finished(cx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn a_reader_yields_what_was_fed_then_the_feeders_error() {
        let mut r = piped(|mut tx, _| async move {
            tx.write_all(b"abc").await?;
            Err(AppError::coded(ErrorCode::ConnectionLost, "gone"))
        });
        let mut got = [0u8; 3];
        r.read_exact(&mut got).await.unwrap();
        assert_eq!(&got, b"abc");
        let e = r.read(&mut got).await.unwrap_err();
        assert_eq!(AppError::from(e).code(), Some(ErrorCode::ConnectionLost));
    }

    #[tokio::test]
    async fn dropping_a_reader_cancels_its_feeder() {
        let (tx, rx) = tokio::sync::oneshot::channel();
        drop(piped(|_pipe, cancel| async move {
            cancel.cancelled().await;
            let _ = tx.send(());
            Ok(())
        }));
        rx.await.unwrap();
    }

    #[tokio::test]
    async fn shutdown_waits_for_the_drain_and_reports_its_error() {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let mut w = piped(|mut pipe, _| async move {
            let mut all = Vec::new();
            pipe.read_to_end(&mut all).await?;
            let _ = tx.send(all);
            Ok(())
        });
        w.write_all(b"hello").await.unwrap();
        w.shutdown().await.unwrap();
        assert_eq!(rx.await.unwrap(), b"hello");

        let mut w = piped(|_, _| async { Err("refused".into()) });
        let e = loop {
            if let Err(e) = w.write_all(&[0u8; 64 * 1024]).await {
                break e;
            }
        };
        assert!(e.to_string().contains("refused"), "{e}");
    }
}
