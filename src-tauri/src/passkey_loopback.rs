//! One-shot listener on 127.0.0.1 for the code a passkey ceremony in the browser hands back.

use std::sync::Mutex;
use std::time::Duration;

use tauri::async_runtime::JoinHandle;
use tauri::State;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tokio::time::timeout;

const WAIT: Duration = Duration::from_secs(300);
const READ_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_REQUEST_BYTES: usize = 4096;

struct Waiting {
    code: Option<oneshot::Receiver<String>>,
    task: JoinHandle<()>,
}

#[derive(Default)]
pub struct PasskeyLoopback(Mutex<Option<Waiting>>);

impl PasskeyLoopback {
    fn replace(&self, next: Option<Waiting>) {
        let previous =
            std::mem::replace(&mut *self.0.lock().unwrap_or_else(|e| e.into_inner()), next);
        if let Some(previous) = previous {
            previous.task.abort();
        }
    }
}

fn is_token(value: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// The code in `GET /passkey?c=<code>&s=<state>`, when the state is the one this ceremony was opened with.
fn code_for(request_line: &str, state: &str) -> Option<String> {
    let mut parts = request_line.split(' ');
    let (method, target) = (parts.next()?, parts.next()?);
    let url = url::Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    if method != "GET" || url.path() != "/passkey" {
        return None;
    }
    let param = |name: &str| {
        url.query_pairs()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
    };
    let code = param("c")?;
    (param("s")? == state && is_token(&code, 16, 128)).then_some(code)
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn page(title: &str, message: &str) -> String {
    let (title, message) = (escape(title), escape(message));
    format!(
        "<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
         <title>{title}</title><body style=\"margin:0;min-height:100vh;display:grid;place-items:center;\
         background:#0a0a0f;color:#e4e4e7;font:16px system-ui,sans-serif;text-align:center\">\
         <main><h1 style=\"font-size:20px\">{title}</h1><p style=\"color:#a1a1aa\">{message}</p></main>\
         <script>history.replaceState(null,\"\",\"/\")</script>"
    )
}

async fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\
         Cache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

async fn serve(listener: TcpListener, state: String, page: String, found: oneshot::Sender<String>) {
    loop {
        let Ok((mut stream, _)) = listener.accept().await else {
            return;
        };
        let mut request = vec![0u8; MAX_REQUEST_BYTES];
        let read = timeout(READ_TIMEOUT, stream.read(&mut request)).await;
        let Ok(Ok(length)) = read else {
            continue;
        };
        let request = String::from_utf8_lossy(&request[..length]);
        match code_for(request.lines().next().unwrap_or_default(), &state) {
            Some(code) => {
                respond(&mut stream, "200 OK", &page).await;
                let _ = found.send(code);
                return;
            }
            None => respond(&mut stream, "404 Not Found", "").await,
        }
    }
}

/// Starts listening and returns the port to name in the ceremony's return address.
#[tauri::command]
pub async fn passkey_loopback_start(
    loopback: State<'_, PasskeyLoopback>,
    state: String,
    title: String,
    message: String,
) -> Result<u16, String> {
    if !is_token(&state, 16, 64) {
        return Err("invalid state".to_string());
    }
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let (found, code) = oneshot::channel();
    let task = tauri::async_runtime::spawn(serve(listener, state, page(&title, &message), found));
    loopback.replace(Some(Waiting {
        code: Some(code),
        task,
    }));
    Ok(port)
}

/// Resolves with the code, or fails once the listener is stopped or the wait runs out.
#[tauri::command]
pub async fn passkey_loopback_wait(loopback: State<'_, PasskeyLoopback>) -> Result<String, String> {
    let code = loopback
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_mut()
        .and_then(|waiting| waiting.code.take())
        .ok_or("no passkey ceremony is waiting")?;
    match timeout(WAIT, code).await {
        Ok(Ok(code)) => Ok(code),
        _ => Err("the passkey ceremony was not completed".to_string()),
    }
}

#[tauri::command]
pub fn passkey_loopback_stop(loopback: State<'_, PasskeyLoopback>) {
    loopback.replace(None);
}

#[cfg(test)]
mod tests {
    use super::*;

    const STATE: &str = "state-0123456789abcdef";
    const CODE: &str = "c0de-0123456789abcdef";

    #[test]
    fn only_the_ceremonys_own_return_carries_a_code() {
        let line = |target: &str| format!("GET {target} HTTP/1.1");
        assert_eq!(
            code_for(&line(&format!("/passkey?c={CODE}&s={STATE}")), STATE).as_deref(),
            Some(CODE)
        );
        assert_eq!(
            code_for(
                &line(&format!("/passkey?c={CODE}&s=someone-elses-state")),
                STATE
            ),
            None
        );
        assert_eq!(code_for(&line(&format!("/passkey?c={CODE}")), STATE), None);
        assert_eq!(
            code_for(&line(&format!("/other?c={CODE}&s={STATE}")), STATE),
            None
        );
        assert_eq!(
            code_for(&line(&format!("/passkey?c=short&s={STATE}")), STATE),
            None
        );
        assert_eq!(
            code_for(
                &line(&format!("/passkey?c={CODE}%3Cscript%3E&s={STATE}")),
                STATE
            ),
            None
        );
        assert_eq!(
            code_for(&format!("POST /passkey?c={CODE}&s={STATE} HTTP/1.1"), STATE),
            None
        );
        assert_eq!(code_for("", STATE), None);
    }

    #[test]
    fn the_page_escapes_what_it_is_given() {
        let html = page("Done <b>", "Go back to \"Voltius\" & close this tab");
        assert!(html.contains("Done &lt;b&gt;"));
        assert!(html.contains("&quot;Voltius&quot; &amp; close"));
    }

    async fn get(port: u16, target: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        stream
            .write_all(format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").as_bytes())
            .await
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).await.unwrap();
        response
    }

    #[tokio::test]
    async fn the_listener_ignores_strangers_and_stops_after_the_code() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (found, code) = oneshot::channel();
        let serving = tokio::spawn(serve(
            listener,
            STATE.to_string(),
            page("Done", "Close this tab"),
            found,
        ));

        assert!(get(port, "/favicon.ico").await.starts_with("HTTP/1.1 404"));
        assert!(get(port, &format!("/passkey?c={CODE}&s=wrong"))
            .await
            .starts_with("HTTP/1.1 404"));
        let accepted = get(port, &format!("/passkey?c={CODE}&s={STATE}")).await;
        assert!(accepted.starts_with("HTTP/1.1 200") && accepted.contains("Close this tab"));

        assert_eq!(code.await.unwrap(), CODE);
        serving.await.unwrap();
        assert!(TcpStream::connect(("127.0.0.1", port)).await.is_err());
    }
}
