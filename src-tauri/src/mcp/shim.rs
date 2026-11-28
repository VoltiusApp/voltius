//! `voltius mcp`: relays the MCP client's stdio to the app's socket. While the app is unreachable
//! it answers the handshake with no tools, keeps dialling, and has the client re-list once it answers.

use super::protocol;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::future::Future;
use std::io;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};

pub(crate) type AppRead = Box<dyn AsyncRead + Unpin + Send>;
pub(crate) type AppWrite = Box<dyn AsyncWrite + Unpin + Send>;

const RECONNECT_EVERY: Duration = Duration::from_secs(2);
/// Answers still owed when stdin closes get this long, so a stray id cannot keep the process alive.
const EOF_DRAIN_LIMIT: Duration = Duration::from_secs(super::transport::CALL_TIMEOUT.as_secs() + 5);
const REPLAY_ID: &str = "voltius-mcp-shim-replay";
const OFFLINE: &str = "Voltius is not running, or its MCP server is off. Open Voltius, turn on the MCP server in Settings, then try again.";

pub fn run_shim() -> io::Result<()> {
    use std::io::{BufRead, Write};

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;

    // stdin and stdout stay on blocking threads so a client that stops reading cannot park the runtime.
    let (stdin_tx, stdin_rx) = unbounded_channel();
    std::thread::spawn(move || {
        for line in io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            if stdin_tx.send(line).is_err() {
                break;
            }
        }
    });
    let (stdout_tx, mut stdout_rx) = unbounded_channel::<String>();
    let stdout_thread = std::thread::spawn(move || {
        let stdout = io::stdout();
        while let Some(line) = stdout_rx.blocking_recv() {
            let mut lock = stdout.lock();
            let _ = lock.write_all(line.as_bytes());
            let _ = lock.write_all(b"\n");
            let _ = lock.flush();
        }
    });

    rt.block_on(relay(connect_app, stdin_rx, stdout_tx, RECONNECT_EVERY));
    let _ = stdout_thread.join();
    Ok(())
}

#[cfg(unix)]
async fn connect_app() -> io::Result<(AppRead, AppWrite)> {
    let (r, w) = tokio::net::UnixStream::connect(super::transport::socket_path())
        .await?
        .into_split();
    Ok((Box::new(r), Box::new(w)))
}

/// The pipe goes through tokio, not `std::fs`: a synchronous handle serializes a pending read
/// with every write, so requests would queue behind the read waiting for the app's reply.
#[cfg(windows)]
async fn connect_app() -> io::Result<(AppRead, AppWrite)> {
    use tokio::net::windows::named_pipe::ClientOptions;
    use windows_sys::Win32::Foundation::ERROR_PIPE_BUSY;
    use windows_sys::Win32::Storage::FileSystem::SECURITY_IDENTIFICATION;

    let path = super::transport::socket_path();
    let mut busy_waits = 0;
    loop {
        // The pipe namespace is global, so the server end may not be ours: identification-level
        // QoS stops it impersonating us. It still receives the requests.
        match ClientOptions::new()
            .security_qos_flags(SECURITY_IDENTIFICATION)
            .open(&path)
        {
            Ok(pipe) => {
                let (r, w) = tokio::io::split(pipe);
                return Ok((Box::new(r), Box::new(w)));
            }
            // A client can land between the server accepting one instance and creating the next.
            Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY as i32) && busy_waits < 20 => {
                busy_waits += 1;
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Err(e) => return Err(e),
        }
    }
}

struct Link {
    to_app: AppWrite,
    from_app: UnboundedReceiver<String>,
}

fn link((r, w): (AppRead, AppWrite)) -> Link {
    let (tx, rx) = unbounded_channel();
    tokio::spawn(async move {
        let mut lines = BufReader::new(r).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    Link {
        to_app: w,
        from_app: rx,
    }
}

async fn send_line(w: &mut AppWrite, line: &str) -> io::Result<()> {
    w.write_all(line.as_bytes()).await?;
    w.write_all(b"\n").await?;
    w.flush().await
}

fn emit(stdout: &UnboundedSender<String>, v: &Value) {
    let _ = stdout.send(v.to_string());
}

fn id_where(line: &str, keep: impl Fn(&Value) -> bool) -> Option<Value> {
    let v: Value = serde_json::from_str(line).ok()?;
    let id = v.get("id").filter(|i| !i.is_null())?;
    keep(&v).then(|| id.clone())
}

/// The id of a client message the app owes an answer to. The app answers an oversized line with a null id.
fn asks(line: &str) -> Option<Value> {
    if line.len() >= super::transport::MAX_LINE_BYTES {
        return None;
    }
    id_where(line, |v| {
        v.get("result").is_none() && v.get("error").is_none()
    })
}

/// The id of an app message answering the client.
fn answers(line: &str) -> Option<Value> {
    id_where(line, |v| v.get("method").is_none())
}

fn is_initialize(line: &str) -> bool {
    protocol::parse_request(line).is_ok_and(|r| r.method == "initialize")
}

/// The client's own `initialize`, re-sent under an id the shim swallows, so the app learns its name.
fn replay_initialize(line: &str) -> Option<String> {
    let mut v: Value = serde_json::from_str(line).ok()?;
    v.as_object_mut()?.insert("id".into(), json!(REPLAY_ID));
    Some(v.to_string())
}

fn offline_reply(line: &str) -> Option<Value> {
    let req = match protocol::parse_request(line) {
        Ok(r) => r,
        Err(resp) => return Some(resp),
    };
    let id = req.id?;
    Some(match req.method.as_str() {
        "initialize" => protocol::success(Some(id), protocol::initialize_result()),
        "ping" => protocol::success(Some(id), json!({})),
        "tools/list" => protocol::success(Some(id), json!({ "tools": [] })),
        "tools/call" => protocol::success(
            Some(id),
            json!({ "content": [{ "type": "text", "text": OFFLINE }], "isError": true }),
        ),
        _ => protocol::error(Some(id), -32601, "method not found"),
    })
}

pub(crate) async fn relay<C, F>(
    mut connect: C,
    mut stdin: UnboundedReceiver<String>,
    stdout: UnboundedSender<String>,
    retry: Duration,
) where
    C: FnMut() -> F,
    F: Future<Output = io::Result<(AppRead, AppWrite)>>,
{
    let mut app = match connect().await {
        Ok(conn) => Some(link(conn)),
        Err(e) => {
            eprintln!("voltius: the app is not running, or its MCP server is off ({e}); serving no tools until it is");
            None
        }
    };
    let mut initialize: Option<String> = None;
    let mut owed: HashMap<String, Value> = HashMap::new();
    let mut stdin_open = true;
    let drain_deadline = tokio::time::sleep(Duration::MAX);
    tokio::pin!(drain_deadline);
    let mut redial = tokio::time::interval(retry);
    redial.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    redial.tick().await;

    loop {
        if !stdin_open && (app.is_none() || owed.is_empty()) {
            break;
        }
        tokio::select! {
            line = stdin.recv(), if stdin_open => {
                let Some(line) = line else {
                    stdin_open = false;
                    drain_deadline.as_mut().reset(tokio::time::Instant::now() + EOF_DRAIN_LIMIT);
                    continue;
                };
                if is_initialize(&line) {
                    initialize = Some(line.clone());
                }
                let Some(link) = app.as_mut() else {
                    if let Some(resp) = offline_reply(&line) {
                        emit(&stdout, &resp);
                    }
                    continue;
                };
                if let Some(id) = asks(&line) {
                    owed.insert(id.to_string(), id);
                }
                if send_line(&mut link.to_app, &line).await.is_err() {
                    if let Some(id) = asks(&line) {
                        owed.remove(&id.to_string());
                    }
                    if let Some(resp) = offline_reply(&line) {
                        emit(&stdout, &resp);
                    }
                    let gone = app.take().expect("connected");
                    went_offline(gone, &stdout, &mut owed, initialize.is_some()).await;
                }
            }
            line = async { app.as_mut().expect("guarded").from_app.recv().await }, if app.is_some() => {
                let Some(line) = line else {
                    let gone = app.take().expect("connected");
                    went_offline(gone, &stdout, &mut owed, initialize.is_some()).await;
                    continue;
                };
                deliver(line, &stdout, &mut owed);
            }
            _ = redial.tick(), if app.is_none() && stdin_open => {
                let Ok(conn) = connect().await else { continue };
                let mut link = link(conn);
                if let Some(replay) = initialize.as_deref().and_then(replay_initialize) {
                    if send_line(&mut link.to_app, &replay).await.is_err() {
                        continue;
                    }
                    emit(&stdout, &protocol::tools_changed_notification());
                }
                app = Some(link);
            }
            _ = &mut drain_deadline => break,
        }
    }
}

fn deliver(line: String, stdout: &UnboundedSender<String>, owed: &mut HashMap<String, Value>) {
    if let Some(id) = answers(&line) {
        if id == json!(REPLAY_ID) {
            return;
        }
        owed.remove(&id.to_string());
    }
    let _ = stdout.send(line);
}

/// Passes on what the app sent before it went, errors what it still owed, and has a client
/// past `initialize` re-list to find the tools gone.
async fn went_offline(
    mut gone: Link,
    stdout: &UnboundedSender<String>,
    owed: &mut HashMap<String, Value>,
    initialized: bool,
) {
    let _ = tokio::time::timeout(Duration::from_secs(1), async {
        while let Some(line) = gone.from_app.recv().await {
            deliver(line, stdout, owed);
        }
    })
    .await;
    for (_, id) in owed.drain() {
        emit(
            stdout,
            &protocol::error(Some(id), -32603, "Voltius closed before answering"),
        );
    }
    if initialized {
        emit(stdout, &protocol::tools_changed_notification());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::io::DuplexStream;

    type Slot = Arc<Mutex<Option<DuplexStream>>>;

    fn dialer(slot: Slot) -> impl FnMut() -> std::future::Ready<io::Result<(AppRead, AppWrite)>> {
        move || {
            std::future::ready(match slot.lock().unwrap().take() {
                Some(s) => {
                    let (r, w) = tokio::io::split(s);
                    Ok((Box::new(r) as AppRead, Box::new(w) as AppWrite))
                }
                None => Err(io::ErrorKind::NotFound.into()),
            })
        }
    }

    struct Harness {
        stdin: Option<UnboundedSender<String>>,
        stdout: UnboundedReceiver<String>,
        slot: Slot,
        done: tokio::task::JoinHandle<()>,
    }

    fn start() -> Harness {
        let slot: Slot = Arc::new(Mutex::new(None));
        let (stdin_tx, stdin_rx) = unbounded_channel();
        let (stdout_tx, stdout_rx) = unbounded_channel();
        let done = tokio::spawn(relay(
            dialer(slot.clone()),
            stdin_rx,
            stdout_tx,
            Duration::from_millis(10),
        ));
        Harness {
            stdin: Some(stdin_tx),
            stdout: stdout_rx,
            slot,
            done,
        }
    }

    impl Harness {
        fn send(&self, v: Value) {
            self.stdin.as_ref().unwrap().send(v.to_string()).unwrap();
        }
        async fn next(&mut self) -> Value {
            let line = tokio::time::timeout(Duration::from_secs(5), self.stdout.recv())
                .await
                .expect("no output")
                .expect("stdout closed");
            serde_json::from_str(&line).unwrap()
        }
        /// Plugs in a fake app and returns its side of the socket.
        fn app_starts(
            &self,
        ) -> (
            BufReader<tokio::io::ReadHalf<DuplexStream>>,
            tokio::io::WriteHalf<DuplexStream>,
        ) {
            let (ours, theirs) = tokio::io::duplex(64 * 1024);
            *self.slot.lock().unwrap() = Some(ours);
            let (r, w) = tokio::io::split(theirs);
            (BufReader::new(r), w)
        }
    }

    fn init(id: i64) -> Value {
        json!({ "jsonrpc": "2.0", "id": id, "method": "initialize", "params": { "clientInfo": { "name": "Claude Desktop" } } })
    }

    fn req(id: i64, method: &str) -> Value {
        json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": {} })
    }

    async fn app_reads(r: &mut BufReader<tokio::io::ReadHalf<DuplexStream>>) -> Value {
        let mut line = String::new();
        tokio::time::timeout(Duration::from_secs(5), r.read_line(&mut line))
            .await
            .unwrap()
            .unwrap();
        serde_json::from_str(&line).unwrap()
    }

    #[tokio::test]
    async fn without_the_app_the_handshake_succeeds_with_no_tools() {
        let mut h = start();
        h.send(init(1));
        assert_eq!(
            h.next().await["result"]["capabilities"]["tools"]["listChanged"],
            json!(true)
        );
        h.send(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }));
        h.send(req(2, "tools/list"));
        let list = h.next().await;
        assert_eq!(list["id"], json!(2));
        assert_eq!(list["result"]["tools"], json!([]));
        h.send(req(3, "tools/call"));
        let call = h.next().await;
        assert_eq!(call["result"]["isError"], json!(true));
        assert!(call["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("not running"));
        h.stdin = None;
        tokio::time::timeout(Duration::from_secs(5), h.done)
            .await
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn the_app_starting_later_announces_its_tools_and_takes_over() {
        let mut h = start();
        h.send(init(1));
        h.next().await;
        let (mut app_r, mut app_w) = h.app_starts();

        let replay = app_reads(&mut app_r).await;
        assert_eq!(replay["method"], json!("initialize"));
        assert_eq!(
            replay["params"]["clientInfo"]["name"],
            json!("Claude Desktop")
        );
        app_w
            .write_all(
                format!(
                    "{}\n",
                    protocol::success(Some(replay["id"].clone()), json!({}))
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        assert_eq!(
            h.next().await["method"],
            json!("notifications/tools/list_changed")
        );

        h.send(req(2, "tools/list"));
        assert_eq!(app_reads(&mut app_r).await["id"], json!(2));
        app_w
            .write_all(
                format!(
                    "{}\n",
                    protocol::success(Some(json!(2)), json!({ "tools": [{ "name": "x" }] }))
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        let listed = h.next().await;
        assert_eq!(
            listed["id"],
            json!(2),
            "the replayed initialize reply must not reach the client"
        );
        assert_eq!(listed["result"]["tools"][0]["name"], json!("x"));
    }

    #[tokio::test]
    async fn the_app_quitting_fails_what_it_owed_and_falls_back_to_no_tools() {
        let mut h = start();
        let (mut app_r, mut app_w) = h.app_starts();
        h.send(init(1));
        app_reads(&mut app_r).await;
        app_w
            .write_all(format!("{}\n", protocol::success(Some(json!(1)), json!({}))).as_bytes())
            .await
            .unwrap();
        assert_eq!(h.next().await["id"], json!(1));
        h.send(req(2, "tools/call"));
        app_reads(&mut app_r).await;
        drop((app_r, app_w));

        let mut seen = vec![h.next().await, h.next().await];
        seen.sort_by_key(|v| v.get("id").is_none());
        assert_eq!(seen[0]["id"], json!(2));
        assert!(seen[0]["error"].is_object());
        assert_eq!(seen[1]["method"], json!("notifications/tools/list_changed"));

        h.send(req(3, "tools/list"));
        assert_eq!(h.next().await["result"]["tools"], json!([]));
    }
}
