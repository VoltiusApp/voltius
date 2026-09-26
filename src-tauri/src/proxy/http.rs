use super::{authority, ProxyError};
use base64::Engine;
use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf};

pub(crate) const MAX_HEAD: usize = 8 * 1024;

#[derive(Debug)]
pub struct PrefixedStream<S> {
    prefix: Vec<u8>,
    pos: usize,
    inner: S,
}

impl<S: AsyncRead + Unpin> AsyncRead for PrefixedStream<S> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if self.pos < self.prefix.len() {
            let n = (self.prefix.len() - self.pos).min(buf.remaining());
            let start = self.pos;
            buf.put_slice(&self.prefix[start..start + n]);
            self.pos += n;
            return Poll::Ready(Ok(()));
        }
        Pin::new(&mut self.inner).poll_read(cx, buf)
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for PrefixedStream<S> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.inner).poll_write(cx, buf)
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

pub fn connect_request(host: &str, port: u16, auth: Option<(&str, &str)>) -> String {
    let target = authority(host, port);
    let auth_line = auth
        .map(|(u, p)| {
            let token = base64::engine::general_purpose::STANDARD.encode(format!("{u}:{p}"));
            format!("Proxy-Authorization: Basic {token}\r\n")
        })
        .unwrap_or_default();
    format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n{auth_line}\r\n")
}

#[derive(Debug, PartialEq)]
pub enum Head {
    Incomplete,
    Done {
        status: u16,
        status_line: String,
        len: usize,
    },
}

pub fn parse_response_head(buf: &[u8]) -> Result<Head, String> {
    let Some(end) = buf.windows(4).position(|w| w == b"\r\n\r\n") else {
        return if buf.len() > MAX_HEAD {
            Err("response header too large".into())
        } else {
            Ok(Head::Incomplete)
        };
    };
    let head = String::from_utf8_lossy(&buf[..end]);
    let status_line = head.lines().next().unwrap_or("").trim().to_string();
    let mut parts = status_line.splitn(3, ' ');
    let version = parts.next().unwrap_or("");
    let status = parts.next().and_then(|s| s.parse::<u16>().ok());
    match status {
        Some(status) if version.starts_with("HTTP/1.") => Ok(Head::Done {
            status,
            status_line,
            len: end + 4,
        }),
        _ => Err(format!("unexpected reply {status_line:?}")),
    }
}

pub async fn connect<S: AsyncRead + AsyncWrite + Unpin>(
    mut stream: S,
    proxy: String,
    host: &str,
    port: u16,
    auth: Option<(&str, &str)>,
) -> Result<PrefixedStream<S>, ProxyError> {
    let io_err = |source: io::Error| ProxyError::Unreachable {
        proxy: proxy.clone(),
        source,
    };
    stream
        .write_all(connect_request(host, port, auth).as_bytes())
        .await
        .map_err(io_err)?;
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    loop {
        let n = stream.read(&mut chunk).await.map_err(io_err)?;
        if n == 0 {
            return Err(ProxyError::Protocol {
                proxy,
                detail: "closed the connection before replying".into(),
            });
        }
        buf.extend_from_slice(&chunk[..n]);
        match parse_response_head(&buf).map_err(|detail| ProxyError::Protocol {
            proxy: proxy.clone(),
            detail,
        })? {
            Head::Incomplete => continue,
            Head::Done {
                status,
                status_line,
                len,
            } => {
                if !(200..300).contains(&status) {
                    return Err(ProxyError::Rejected {
                        target: authority(host, port),
                        status: status_line,
                    });
                }
                return Ok(PrefixedStream {
                    prefix: buf.split_off(len),
                    pos: 0,
                    inner: stream,
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{duplex, AsyncReadExt, AsyncWriteExt};

    #[test]
    fn connect_request_without_auth() {
        assert_eq!(
            connect_request("example.com", 22, None),
            "CONNECT example.com:22 HTTP/1.1\r\nHost: example.com:22\r\n\r\n"
        );
    }

    #[test]
    fn connect_request_with_basic_auth() {
        let req = connect_request("h", 22, Some(("user", "p@ss")));
        assert!(req.contains("Proxy-Authorization: Basic dXNlcjpwQHNz\r\n"));
    }

    #[test]
    fn connect_request_brackets_ipv6() {
        assert!(connect_request("::1", 22, None).starts_with("CONNECT [::1]:22 HTTP/1.1\r\n"));
    }

    #[test]
    fn parse_head_incomplete_then_done() {
        assert_eq!(
            parse_response_head(b"HTTP/1.1 200 OK\r\n").unwrap(),
            Head::Incomplete
        );
        assert_eq!(
            parse_response_head(b"HTTP/1.1 200 Connection established\r\n\r\nSSH-2.0").unwrap(),
            Head::Done {
                status: 200,
                status_line: "HTTP/1.1 200 Connection established".into(),
                len: 39
            }
        );
    }

    #[test]
    fn parse_head_rejects_garbage_and_oversize() {
        assert!(parse_response_head(b"NOPE\r\n\r\n").is_err());
        assert!(parse_response_head(&vec![b'a'; MAX_HEAD + 1]).is_err());
    }

    async fn run_against(reply: &'static [u8]) -> Result<Vec<u8>, ProxyError> {
        let (client, mut server) = duplex(4096);
        tokio::spawn(async move {
            let mut buf = [0u8; 512];
            let _ = server.read(&mut buf).await;
            server.write_all(reply).await.unwrap();
        });
        let mut stream = connect(client, "p:8080".into(), "t", 22, None).await?;
        let mut got = vec![0u8; 7];
        stream.read_exact(&mut got).await.unwrap();
        Ok(got)
    }

    #[tokio::test]
    async fn http_connect_replays_bytes_after_head() {
        let got = run_against(b"HTTP/1.1 200 OK\r\n\r\nSSH-2.0")
            .await
            .unwrap();
        assert_eq!(got, b"SSH-2.0");
    }

    #[tokio::test]
    async fn http_connect_407_is_rejected_with_status_line() {
        let err = run_against(b"HTTP/1.1 407 Proxy Authentication Required\r\n\r\n")
            .await
            .unwrap_err();
        assert_eq!(
            err.to_string(),
            "Proxy rejected CONNECT to t:22: HTTP/1.1 407 Proxy Authentication Required"
        );
    }

    #[tokio::test]
    async fn http_connect_eof_before_reply_is_protocol_error() {
        let (client, mut server) = duplex(4096);
        tokio::spawn(async move {
            let mut buf = [0u8; 512];
            let _ = server.read(&mut buf).await;
        });
        let err = connect(client, "p:8080".into(), "t", 22, None)
            .await
            .unwrap_err();
        assert!(matches!(err, ProxyError::Protocol { .. }), "{err}");
    }

    #[derive(Debug)]
    struct ErrorStream;

    impl AsyncRead for ErrorStream {
        fn poll_read(
            self: Pin<&mut Self>,
            _cx: &mut std::task::Context<'_>,
            _buf: &mut ReadBuf<'_>,
        ) -> Poll<io::Result<()>> {
            Poll::Ready(Err(io::Error::new(
                io::ErrorKind::ConnectionReset,
                "connection reset",
            )))
        }
    }

    impl AsyncWrite for ErrorStream {
        fn poll_write(
            self: Pin<&mut Self>,
            _cx: &mut std::task::Context<'_>,
            buf: &[u8],
        ) -> Poll<io::Result<usize>> {
            Poll::Ready(Ok(buf.len()))
        }

        fn poll_flush(
            self: Pin<&mut Self>,
            _cx: &mut std::task::Context<'_>,
        ) -> Poll<io::Result<()>> {
            Poll::Ready(Ok(()))
        }

        fn poll_shutdown(
            self: Pin<&mut Self>,
            _cx: &mut std::task::Context<'_>,
        ) -> Poll<io::Result<()>> {
            Poll::Ready(Ok(()))
        }
    }

    #[tokio::test]
    async fn http_connect_read_error_is_unreachable_and_transient() {
        let err = connect(ErrorStream, "p:8080".into(), "t", 22, None)
            .await
            .unwrap_err();
        assert!(matches!(err, ProxyError::Unreachable { .. }), "{err}");
        assert!(err.is_transient());
    }
}
