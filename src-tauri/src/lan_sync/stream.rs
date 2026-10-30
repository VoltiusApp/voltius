use super::handshake::{
    ping_timer, HandshakeError, Session, SessionReader, SessionWriter, MAX_CHUNK,
};
use super::protocol::ProtocolError;
use std::future::Future;
use std::io;
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard};
use std::task::{ready, Context, Poll};
use tokio::io::{
    AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, DuplexStream, ReadBuf, ReadHalf, WriteHalf,
};
use tokio::task::{AbortHandle, JoinHandle};

const PIPE: usize = 4 * MAX_CHUNK;

type Failure = Arc<Mutex<Option<io::Error>>>;

pub struct SessionStream {
    pipe: DuplexStream,
    failure: Failure,
    inbound: JoinHandle<()>,
    outbound: Option<JoinHandle<io::Result<()>>>,
}

impl SessionStream {
    pub fn new(session: Session) -> Self {
        let (reader, writer) = session.split_live();
        let (pipe, far) = tokio::io::duplex(PIPE);
        let (far_rx, far_tx) = tokio::io::split(far);
        let failure = Failure::default();
        let inbound = tokio::spawn(inbound(reader, far_tx, failure.clone()));
        let outbound = outbound(writer, far_rx, failure.clone(), inbound.abort_handle());
        Self {
            pipe,
            inbound,
            outbound: Some(tokio::spawn(outbound)),
            failure,
        }
    }
}

impl Drop for SessionStream {
    fn drop(&mut self) {
        self.inbound.abort();
    }
}

fn to_io(e: HandshakeError) -> io::Error {
    match e {
        HandshakeError::Timeout => io::ErrorKind::TimedOut.into(),
        HandshakeError::Protocol(ProtocolError::Io(e)) => e,
        e => io::Error::other(e),
    }
}

fn copy(e: &io::Error) -> io::Error {
    io::Error::new(e.kind(), e.to_string())
}

fn slot(failure: &Failure) -> MutexGuard<'_, Option<io::Error>> {
    failure.lock().unwrap_or_else(|p| p.into_inner())
}

fn record(failure: &Failure, e: HandshakeError) -> io::Error {
    let e = to_io(e);
    let mine = copy(&e);
    slot(failure).get_or_insert(e);
    mine
}

fn recorded(failure: &Failure) -> Option<io::Error> {
    slot(failure).as_ref().map(copy)
}

async fn inbound(mut reader: SessionReader, mut tx: WriteHalf<DuplexStream>, failure: Failure) {
    loop {
        match reader.recv_chunk().await {
            Ok(Some(chunk)) => {
                if tx.write_all(chunk).await.is_err() {
                    return;
                }
            }
            Ok(None) => break,
            Err(e) => {
                record(&failure, e);
                break;
            }
        }
    }
    let _ = tx.shutdown().await;
}

// Aborting inbound drops the last half of the pipe, so local reads and writes both fail.
async fn outbound(
    writer: SessionWriter,
    rx: ReadHalf<DuplexStream>,
    failure: Failure,
    inbound: AbortHandle,
) -> io::Result<()> {
    send_until_closed(writer, rx).await.map_err(|e| {
        let e = record(&failure, e);
        inbound.abort();
        e
    })
}

// Closing is a TCP half-close, not a Bye frame: in raw mode any sealed chunk is SFTP data.
async fn send_until_closed(
    mut writer: SessionWriter,
    mut rx: ReadHalf<DuplexStream>,
) -> Result<(), HandshakeError> {
    let mut buf = vec![0u8; MAX_CHUNK];
    let mut ping = ping_timer();
    loop {
        tokio::select! {
            read = rx.read(&mut buf) => match read? {
                0 => return writer.finish().await,
                n => {
                    writer.send_raw(&buf[..n]).await?;
                    ping.reset();
                }
            },
            _ = ping.tick() => writer.keepalive().await?,
        }
    }
}

impl AsyncRead for SessionStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let before = buf.filled().len();
        ready!(Pin::new(&mut self.pipe).poll_read(cx, buf))?;
        if buf.filled().len() == before && buf.remaining() > 0 {
            if let Some(e) = recorded(&self.failure) {
                return Poll::Ready(Err(e));
            }
        }
        Poll::Ready(Ok(()))
    }
}

impl AsyncWrite for SessionStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        match ready!(Pin::new(&mut self.pipe).poll_write(cx, buf)) {
            Err(e) => Poll::Ready(Err(recorded(&self.failure).unwrap_or(e))),
            written => Poll::Ready(written),
        }
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.pipe).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        ready!(Pin::new(&mut self.pipe).poll_shutdown(cx))?;
        let Some(sending) = self.outbound.as_mut() else {
            return Poll::Ready(Ok(()));
        };
        let sent = ready!(Pin::new(sending).poll(cx));
        self.outbound = None;
        Poll::Ready(sent.unwrap_or_else(|e| Err(io::Error::other(e))))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::lan_sync::handshake::{handshake, IDLE_TIMEOUT, WRITE_TIMEOUT};
    use crate::lan_sync::identity::{derive_auth_key, test_identity as identity};
    use rand::{Rng, RngCore};
    use std::time::Duration;
    use tokio::io::duplex;
    use tokio::time::Instant;

    pub(crate) async fn sessions() -> (Session, Session) {
        let keys = [derive_auth_key(&[1; 32])];
        let (a, b) = duplex(64 * 1024);
        let (ia, ib) = (identity("dev-a"), identity("dev-b"));
        let (a, b) = tokio::join!(
            handshake(a, true, &ia, &keys),
            handshake(b, false, &ib, &keys)
        );
        (a.unwrap().0, b.unwrap().0)
    }

    async fn streams() -> (SessionStream, SessionStream) {
        let (a, b) = sessions().await;
        (SessionStream::new(a), SessionStream::new(b))
    }

    async fn read_all(s: &mut SessionStream) -> io::Result<Vec<u8>> {
        let mut got = Vec::new();
        s.read_to_end(&mut got).await?;
        Ok(got)
    }

    #[tokio::test]
    async fn echo_survives_odd_chunk_sizes() {
        let (mut a, mut b) = streams().await;
        let mut sent = vec![0u8; 3 * 1024 * 1024];
        rand::thread_rng().fill_bytes(&mut sent);
        let send = async {
            let mut rest = &sent[..];
            while !rest.is_empty() {
                let n = rand::thread_rng().gen_range(1..200_000).min(rest.len());
                a.write_all(&rest[..n]).await.unwrap();
                rest = &rest[n..];
            }
            a.shutdown().await.unwrap();
        };
        let (_, got) = tokio::join!(send, read_all(&mut b));
        assert!(got.unwrap() == sent);
    }

    #[tokio::test(start_paused = true)]
    async fn keepalive_is_invisible() {
        let (a, b) = sessions().await;
        let (_ar, mut aw) = a.split();
        let mut b = SessionStream::new(b);
        let big = vec![7u8; MAX_CHUNK + 5];
        aw.send_raw(b"first").await.unwrap();
        aw.keepalive().await.unwrap();
        aw.send_raw(&big).await.unwrap();
        tokio::time::sleep(IDLE_TIMEOUT / 2).await;
        aw.keepalive().await.unwrap();
        aw.send_raw(b"last").await.unwrap();
        aw.finish().await.unwrap();
        let want = [&b"first"[..], &big, b"last"].concat();
        assert!(read_all(&mut b).await.unwrap() == want);
    }

    #[tokio::test(start_paused = true)]
    async fn idle_writer_keeps_peer_alive() {
        let (mut a, mut b) = streams().await;
        tokio::time::sleep(IDLE_TIMEOUT * 3).await;
        a.write_all(b"still here").await.unwrap();
        let mut got = [0u8; 10];
        b.read_exact(&mut got).await.unwrap();
        assert_eq!(&got, b"still here");
    }

    #[tokio::test]
    async fn shutdown_reads_as_eof() {
        let (mut a, mut b) = streams().await;
        a.write_all(b"bye soon").await.unwrap();
        a.shutdown().await.unwrap();
        assert_eq!(read_all(&mut b).await.unwrap(), b"bye soon");
        b.write_all(b"reply after eof").await.unwrap();
        drop(b);
        assert_eq!(read_all(&mut a).await.unwrap(), b"reply after eof");
    }

    #[tokio::test(start_paused = true)]
    async fn silent_peer_times_out() {
        let (a, _silent) = sessions().await;
        let mut a = SessionStream::new(a);
        let started = Instant::now();
        let err = read_all(&mut a).await.unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::TimedOut);
        assert!(started.elapsed() >= IDLE_TIMEOUT);
        assert!(started.elapsed() < IDLE_TIMEOUT + Duration::from_secs(1));
    }

    #[tokio::test(start_paused = true)]
    async fn stalled_peer_fails_local_writes() {
        let (a, b) = sessions().await;
        let mut a = SessionStream::new(a);
        let (_unread, mut bw) = b.split();
        let pinger = tokio::spawn(async move {
            loop {
                tokio::time::sleep(IDLE_TIMEOUT / 3).await;
                if bw.keepalive().await.is_err() {
                    return;
                }
            }
        });
        let big = vec![1u8; 4 * PIPE];
        let started = Instant::now();
        let wrote = tokio::time::timeout(WRITE_TIMEOUT * 2, a.write_all(&big)).await;
        let err = wrote.expect("write hung").unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::TimedOut);
        assert!(started.elapsed() < WRITE_TIMEOUT + Duration::from_secs(1));
        let mut rest = Vec::new();
        assert!(a.read_to_end(&mut rest).await.is_err());
        pinger.abort();
    }
}
