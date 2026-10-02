use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[derive(Clone, Debug)]
pub struct Seen {
    pub head: String,
    pub body: Vec<u8>,
}

/// Answers each connection's single request with the next canned response, then closes it.
pub async fn canned(responses: Vec<String>) -> (u16, Arc<Mutex<Vec<Seen>>>) {
    serve(responses, Mode::Normal).await
}

/// Replies right after the request head and keeps the socket open without reading the body.
pub async fn canned_early(responses: Vec<String>) -> (u16, Arc<Mutex<Vec<Seen>>>) {
    serve(responses, Mode::Hold).await
}

/// Replies right after the request head, then half-closes without reading the body.
pub async fn canned_then_close(responses: Vec<String>) -> (u16, Arc<Mutex<Vec<Seen>>>) {
    serve(responses, Mode::Close).await
}

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Normal,
    Hold,
    Close,
}

async fn serve(responses: Vec<String>, mode: Mode) -> (u16, Arc<Mutex<Vec<Seen>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = Arc::clone(&seen);
    tokio::spawn(async move {
        for response in responses {
            let Ok((mut tcp, _)) = listener.accept().await else {
                return;
            };
            let mut buf = Vec::new();
            let mut chunk = [0u8; 4096];
            let head_end = loop {
                let n = tcp.read(&mut chunk).await.unwrap();
                if n == 0 {
                    return;
                }
                buf.extend_from_slice(&chunk[..n]);
                if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                    break i + 4;
                }
            };
            let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
            let len = head
                .lines()
                .find_map(|l| {
                    l.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .map(|v| v.trim().parse::<usize>().unwrap())
                })
                .unwrap_or(0);
            while mode == Mode::Normal && buf.len() < head_end + len {
                let n = tcp.read(&mut chunk).await.unwrap();
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&chunk[..n]);
            }
            log.lock().unwrap().push(Seen {
                head,
                body: buf[head_end..].to_vec(),
            });
            tcp.write_all(response.as_bytes()).await.unwrap();
            match mode {
                Mode::Normal => {
                    let _ = tcp.shutdown().await;
                }
                Mode::Hold | Mode::Close => {
                    if mode == Mode::Close {
                        let _ = tcp.shutdown().await;
                    }
                    tokio::spawn(async move {
                        let _hold = tcp;
                        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                    });
                }
            }
        }
    });
    (port, seen)
}

pub fn reply(status: &str, extra_headers: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\nConnection: close\r\nContent-Length: {}\r\n{extra_headers}\r\n{body}",
        body.len()
    )
}

pub fn multistatus(body: &str) -> String {
    reply(
        "207 Multi-Status",
        "Content-Type: application/xml\r\n",
        body,
    )
}
