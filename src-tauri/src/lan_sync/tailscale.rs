use super::manager::{dedupe, DialOutcome, Shared, Source, PREFERRED_PORT};
use base64::Engine;
use bytes::Bytes;
use futures_util::future::BoxFuture;
use http_body_util::{BodyExt, Empty, Limited};
use hyper::header::{AUTHORIZATION, HOST};
use hyper::{Request, StatusCode};
use hyper_util::rt::TokioIo;
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap};
use std::future::Future;
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite};
use tokio::time::{timeout, MissedTickBehavior};

pub(super) const TAILSCALE_POLL: Duration = if cfg!(test) {
    Duration::from_millis(50)
} else {
    Duration::from_secs(300)
};
pub(super) const TAILSCALE_COOLDOWN: Duration = if cfg!(test) {
    Duration::from_millis(300)
} else {
    Duration::from_secs(1800)
};
const LOCALAPI_TIMEOUT: Duration = Duration::from_secs(2);
const CLI_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_STATUS: usize = 4 * 1024 * 1024;
const LOCALAPI_HOST: &str = "local-tailscaled.sock";
const STATUS_PATH: &str = "/localapi/v0/status";

pub type StatusSource = Arc<dyn Fn() -> BoxFuture<'static, Option<Vec<u8>>> + Send + Sync>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TsPeer {
    pub ips: Vec<IpAddr>,
    pub same_user: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Node {
    key: IpAddr,
    by_ip: Vec<Vec<SocketAddr>>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Transport {
    #[cfg(unix)]
    Unix(PathBuf),
    #[cfg(windows)]
    Pipe(String),
    #[cfg(any(test, target_os = "macos"))]
    Tcp {
        port: u16,
        token: String,
    },
    Cli(PathBuf),
}

#[derive(Deserialize)]
struct Status {
    #[serde(rename = "BackendState", default)]
    backend_state: String,
    #[serde(rename = "Self", default)]
    me: Option<PeerStatus>,
    #[serde(rename = "Peer", default)]
    peer: Option<BTreeMap<String, PeerStatus>>,
}

#[derive(Deserialize)]
struct PeerStatus {
    #[serde(rename = "TailscaleIPs", default)]
    ips: Option<Vec<String>>,
    #[serde(rename = "Online", default)]
    online: bool,
    #[serde(rename = "UserID", default)]
    user: Option<i64>,
}

pub fn parse_status(json: &[u8]) -> Result<Vec<TsPeer>, String> {
    let status: Status = serde_json::from_slice(json).map_err(err)?;
    if status.backend_state != "Running" {
        return Ok(Vec::new());
    }
    let me = status.me.and_then(|m| m.user);
    let peers = status.peer.unwrap_or_default().into_values();
    Ok(peers
        .filter(|p| p.online)
        .map(|p| TsPeer {
            same_user: me.is_some() && p.user == me,
            ips: p
                .ips
                .unwrap_or_default()
                .iter()
                .filter_map(|ip| ip.parse().ok())
                .collect(),
        })
        .filter(|p| !p.ips.is_empty())
        .collect())
}

pub fn targets(
    peers: &[TsPeer],
    remembered_ports: &HashMap<IpAddr, Vec<u16>>,
    tried: &HashMap<IpAddr, Instant>,
) -> Vec<Node> {
    let mut ranked: Vec<_> = peers
        .iter()
        .filter_map(|peer| {
            let mut ips = peer.ips.clone();
            ips.sort_by_key(IpAddr::is_ipv6);
            let key = *ips.first()?;
            let remembered = ips.iter().any(|ip| remembered_ports.contains_key(ip));
            let by_ip = ips
                .iter()
                .map(|&ip| {
                    let ports = remembered_ports.get(&ip).into_iter().flatten().copied();
                    dedupe(
                        std::iter::once(PREFERRED_PORT)
                            .chain(ports)
                            .map(|port| SocketAddr::new(ip, port)),
                    )
                })
                .collect();
            let rank = (!remembered, !peer.same_user, tried.get(&key).copied());
            Some((rank, Node { key, by_ip }))
        })
        .collect();
    ranked.sort_by_key(|(rank, _)| *rank);
    ranked.into_iter().map(|(_, node)| node).collect()
}

// A node's IPv6 is dialed only when its IPv4 got no answer at all.
async fn probe<F>(node: &Node, dial: &mut impl FnMut(SocketAddr) -> F) -> Option<DialOutcome>
where
    F: Future<Output = DialOutcome>,
{
    let mut outcome = DialOutcome::Unreachable;
    for addrs in &node.by_ip {
        for &addr in addrs {
            match dial(addr).await {
                DialOutcome::Throttled => return None,
                DialOutcome::Connected => return Some(DialOutcome::Connected),
                DialOutcome::Unreachable => {}
                answered => outcome = answered,
            }
        }
        if outcome != DialOutcome::Unreachable {
            break;
        }
    }
    Some(outcome)
}

#[derive(Default)]
pub(super) struct Prober {
    cooled: HashMap<IpAddr, Instant>,
    tried: HashMap<IpAddr, Instant>,
}

impl Prober {
    pub(super) async fn round<F>(
        &mut self,
        now: Instant,
        peers: &[TsPeer],
        remembered_ports: &HashMap<IpAddr, Vec<u16>>,
        mut dial: impl FnMut(SocketAddr) -> F,
    ) where
        F: Future<Output = DialOutcome>,
    {
        self.cooled.retain(|_, until| *until > now);
        let nodes = targets(peers, remembered_ports, &self.tried);
        self.tried
            .retain(|ip, _| nodes.iter().any(|n| n.key == *ip));
        let due: Vec<Node> = nodes
            .into_iter()
            .filter(|n| !self.cooled.contains_key(&n.key))
            .collect();
        for node in &due {
            let Some(outcome) = probe(node, &mut dial).await else {
                return;
            };
            self.tried.insert(node.key, now);
            if !matches!(outcome, DialOutcome::Connected | DialOutcome::Skipped) {
                self.cooled.insert(node.key, now + TAILSCALE_COOLDOWN);
            }
        }
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
pub fn transports() -> Vec<Transport> {
    let sockets = [
        "/var/run/tailscale/tailscaled.sock",
        "/run/tailscale/tailscaled.sock",
    ];
    sockets
        .into_iter()
        .map(|s| Transport::Unix(s.into()))
        .chain(on_path("tailscale").map(Transport::Cli))
        .collect()
}

#[cfg(target_os = "macos")]
pub fn transports() -> Vec<Transport> {
    std::iter::once(Transport::Unix("/var/run/tailscaled.socket".into()))
        .chain(same_user_proof(Path::new("/Library/Tailscale")))
        .chain([Transport::Cli(
            "/Applications/Tailscale.app/Contents/MacOS/Tailscale".into(),
        )])
        .collect()
}

#[cfg(windows)]
pub fn transports() -> Vec<Transport> {
    let pipe = r"\\.\pipe\ProtectedPrefix\Administrators\Tailscale\tailscaled";
    let cli = std::env::var_os("ProgramFiles")
        .map(|dir| Transport::Cli(Path::new(&dir).join("Tailscale").join("tailscale.exe")));
    std::iter::once(Transport::Pipe(pipe.into()))
        .chain(cli)
        .collect()
}

#[cfg(not(any(target_os = "macos", windows)))]
fn on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(name))
        .find(|bin| bin.is_file())
}

#[cfg(any(test, target_os = "macos"))]
fn same_user_proof(dir: &Path) -> Option<Transport> {
    let port: u16 = std::fs::read_link(dir.join("ipnport"))
        .ok()?
        .to_str()?
        .parse()
        .ok()?;
    let token = std::fs::read_to_string(dir.join(format!("sameuserproof-{port}"))).ok()?;
    let token = token.trim().to_string();
    Some(Transport::Tcp { port, token })
}

pub async fn fetch_status(transports: &[Transport]) -> Option<Vec<u8>> {
    for transport in transports {
        match fetch_one(transport).await {
            Ok(body) => return Some(body),
            Err(e) => log::debug!("lan-sync: tailscale status unavailable: {e}"),
        }
    }
    None
}

async fn fetch_one(transport: &Transport) -> Result<Vec<u8>, String> {
    let limit = match transport {
        Transport::Cli(_) => CLI_TIMEOUT,
        _ => LOCALAPI_TIMEOUT,
    };
    timeout(limit, fetch_raw(transport))
        .await
        .map_err(|_| "timed out".to_string())?
}

async fn fetch_raw(transport: &Transport) -> Result<Vec<u8>, String> {
    match transport {
        #[cfg(unix)]
        Transport::Unix(path) => {
            let stream = tokio::net::UnixStream::connect(path)
                .await
                .map_err(|e| format!("{}: {e}", path.display()))?;
            get(stream, None).await
        }
        #[cfg(windows)]
        Transport::Pipe(name) => {
            let pipe = tokio::net::windows::named_pipe::ClientOptions::new()
                .open(name)
                .map_err(|e| format!("{name}: {e}"))?;
            get(pipe, None).await
        }
        #[cfg(any(test, target_os = "macos"))]
        Transport::Tcp { port, token } => {
            let stream = tokio::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, *port))
                .await
                .map_err(err)?;
            get(stream, Some(token)).await
        }
        Transport::Cli(bin) => run_cli(bin).await,
    }
}

async fn get<T>(io: T, token: Option<&str>) -> Result<Vec<u8>, String>
where
    T: AsyncRead + AsyncWrite + Unpin,
{
    let (mut sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(io))
        .await
        .map_err(err)?;
    let mut request = Request::get(STATUS_PATH).header(HOST, LOCALAPI_HOST);
    if let Some(token) = token {
        let basic = base64::engine::general_purpose::STANDARD.encode(format!(":{token}"));
        request = request.header(AUTHORIZATION, format!("Basic {basic}"));
    }
    let request = request.body(Empty::<Bytes>::new()).map_err(err)?;
    let exchange = async {
        let response = sender.send_request(request).await.map_err(err)?;
        if response.status() != StatusCode::OK {
            return Err(format!("LocalAPI answered {}", response.status()));
        }
        let body = Limited::new(response.into_body(), MAX_STATUS)
            .collect()
            .await
            .map_err(err)?;
        Ok(body.to_bytes().to_vec())
    };
    let drive = async {
        let _ = conn.await;
        std::future::pending::<()>().await;
    };
    tokio::select! {
        fetched = exchange => fetched,
        () = drive => Err("connection closed".to_string()),
    }
}

async fn run_cli(bin: &Path) -> Result<Vec<u8>, String> {
    let mut command = tokio::process::Command::new(bin);
    command
        .args(["status", "--json"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    crate::commands::win_proc::prevent_visible_child_window(&mut command);
    let mut child = command
        .spawn()
        .map_err(|e| format!("{}: {e}", bin.display()))?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let mut body = Vec::new();
    stdout
        .take(MAX_STATUS as u64 + 1)
        .read_to_end(&mut body)
        .await
        .map_err(err)?;
    if body.len() > MAX_STATUS {
        return Err("status output too large".into());
    }
    let status = child.wait().await.map_err(err)?;
    if !status.success() {
        return Err(format!("{} exited with {status}", bin.display()));
    }
    Ok(body)
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn ports_by_ip(addrs: Vec<SocketAddr>) -> HashMap<IpAddr, Vec<u16>> {
    let mut ports: HashMap<IpAddr, Vec<u16>> = HashMap::new();
    for addr in addrs {
        ports.entry(addr.ip()).or_default().push(addr.port());
    }
    ports
}

pub fn local_status() -> StatusSource {
    Arc::new(|| Box::pin(async { fetch_status(&transports()).await }))
}

pub(super) async fn poll_loop(shared: Arc<Shared>, status: StatusSource) {
    let mut ticker = tokio::time::interval(TAILSCALE_POLL);
    ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut prober = Prober::default();
    loop {
        ticker.tick().await;
        let Some(json) = status().await else {
            continue;
        };
        let peers = match parse_status(&json) {
            Ok(peers) => peers,
            Err(e) => {
                log::debug!("lan-sync: tailscale status unreadable: {e}");
                continue;
            }
        };
        let remembered = ports_by_ip(shared.remembered());
        let dial = |addr| shared.clone().dial_candidate(addr, Source::Tailscale, true);
        prober
            .round(Instant::now(), &peers, &remembered, dial)
            .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;
    use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

    const FIXTURE: &[u8] = include_bytes!("tailscale_fixture.json");

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    fn sa(s: &str) -> SocketAddr {
        s.parse().unwrap()
    }

    fn peer(ips: &[&str], same_user: bool) -> TsPeer {
        TsPeer {
            ips: ips.iter().map(|s| ip(s)).collect(),
            same_user,
        }
    }

    fn flat(nodes: &[Node]) -> Vec<SocketAddr> {
        nodes.iter().flat_map(|n| n.by_ip.concat()).collect()
    }

    #[test]
    fn parse_status_reads_online_peer_ips_and_owner() {
        let peers = parse_status(FIXTURE).unwrap();
        assert_eq!(
            peers,
            vec![
                peer(&["100.101.1.2", "fd7a:115c:a1e0::2"], true),
                peer(&["100.101.1.4"], false),
            ]
        );
        let no_self = br#"{"BackendState":"Running","Peer":{"k":{"TailscaleIPs":["100.101.1.2"],"Online":true}}}"#;
        assert_eq!(
            parse_status(no_self),
            Ok(vec![peer(&["100.101.1.2"], false)])
        );
    }

    #[test]
    fn parse_status_rejects_non_running_and_garbage() {
        let logged_out = br#"{"BackendState":"NeedsLogin","Peer":{"k":{"TailscaleIPs":["100.101.1.2"],"Online":true}}}"#;
        assert_eq!(parse_status(logged_out), Ok(vec![]));
        assert!(parse_status(b"<html>").is_err());
        assert_eq!(
            parse_status(br#"{"BackendState":"Running","Peer":null}"#),
            Ok(vec![])
        );
    }

    #[test]
    fn targets_add_remembered_ports() {
        let peers = [peer(&["100.101.1.2"], false)];
        let remembered = HashMap::from([(ip("100.101.1.2"), vec![50000])]);
        assert_eq!(
            flat(&targets(&peers, &remembered, &HashMap::new())),
            vec![sa("100.101.1.2:47391"), sa("100.101.1.2:50000")]
        );
    }

    #[test]
    fn targets_put_remembered_ips_first_and_dedupe() {
        let peers = [peer(&["100.101.1.9"], false), peer(&["100.101.1.2"], false)];
        let remembered = HashMap::from([(ip("100.101.1.2"), vec![47391, 50000])]);
        assert_eq!(
            flat(&targets(&peers, &remembered, &HashMap::new())),
            vec![
                sa("100.101.1.2:47391"),
                sa("100.101.1.2:50000"),
                sa("100.101.1.9:47391"),
            ]
        );
    }

    #[test]
    fn targets_rank_same_user_then_least_recently_tried() {
        let t0 = Instant::now();
        let peers = [
            peer(&["100.64.0.1"], false),
            peer(&["100.64.0.2"], true),
            peer(&["100.64.0.3"], false),
            peer(&["100.64.0.4"], true),
            peer(&["fd7a:115c:a1e0::5", "100.64.0.5"], false),
        ];
        let remembered = HashMap::from([(ip("fd7a:115c:a1e0::5"), vec![47391])]);
        let tried = HashMap::from([
            (ip("100.64.0.2"), t0 + Duration::from_secs(1)),
            (ip("100.64.0.3"), t0),
        ]);
        let keys: Vec<IpAddr> = targets(&peers, &remembered, &tried)
            .iter()
            .map(|n| n.key)
            .collect();
        assert_eq!(
            keys,
            [
                "100.64.0.5",
                "100.64.0.4",
                "100.64.0.2",
                "100.64.0.1",
                "100.64.0.3"
            ]
            .map(ip)
        );
    }

    type Answer = fn(SocketAddr) -> DialOutcome;

    async fn run_round(
        prober: &mut Prober,
        now: Instant,
        peers: &[TsPeer],
        budget: usize,
        answer: Answer,
    ) -> Vec<SocketAddr> {
        let mut dialed = Vec::new();
        let dial = |addr: SocketAddr| {
            let outcome = if dialed.len() == budget {
                DialOutcome::Throttled
            } else {
                dialed.push(addr);
                answer(addr)
            };
            std::future::ready(outcome)
        };
        prober.round(now, peers, &HashMap::new(), dial).await;
        dialed
    }

    fn tailnet(nodes: u16) -> Vec<TsPeer> {
        (0..nodes)
            .map(|i| TsPeer {
                ips: vec![
                    IpAddr::from([100, 64, (i >> 8) as u8, i as u8]),
                    format!("fd7a:115c:a1e0::{i:x}").parse().unwrap(),
                ],
                same_user: false,
            })
            .collect()
    }

    #[tokio::test]
    async fn large_tailnets_are_probed_past_the_first_hundred_nodes() {
        const BUDGET: usize = 30;
        let peers = tailnet(200);
        let v4 = |i: usize| SocketAddr::new(peers[i].ips[0], PREFERRED_PORT);
        let refuse: Answer = |_| DialOutcome::Refused;
        let mut prober = Prober::default();
        let t0 = Instant::now();
        let cycle = (TAILSCALE_COOLDOWN.as_millis() / TAILSCALE_POLL.as_millis()) as u32;
        let mut first_cycle = Vec::new();
        for k in 0..cycle {
            let now = t0 + TAILSCALE_POLL * k;
            first_cycle.extend(run_round(&mut prober, now, &peers, BUDGET, refuse).await);
        }
        assert_eq!(first_cycle.len(), cycle as usize * BUDGET);
        assert!(first_cycle.iter().all(|a| a.is_ipv4()));
        assert!(first_cycle.contains(&v4(150)));
        let next = run_round(&mut prober, t0 + TAILSCALE_COOLDOWN, &peers, BUDGET, refuse).await;
        let expected: Vec<SocketAddr> = (180..200).chain(0..10).map(v4).collect();
        assert_eq!(next, expected);
    }

    #[tokio::test]
    async fn ipv6_is_dialed_only_when_ipv4_got_no_answer() {
        let peers = [
            peer(&["fd7a:115c:a1e0::1", "100.64.0.1"], false),
            peer(&["100.64.0.2", "fd7a:115c:a1e0::2"], false),
        ];
        let answer: Answer = |a| match a.ip() {
            IpAddr::V4(v4) if v4.octets()[3] == 1 => DialOutcome::Unreachable,
            _ => DialOutcome::Refused,
        };
        let mut prober = Prober::default();
        let dialed = run_round(&mut prober, Instant::now(), &peers, 30, answer).await;
        assert_eq!(
            dialed,
            vec![
                sa("100.64.0.1:47391"),
                sa("[fd7a:115c:a1e0::1]:47391"),
                sa("100.64.0.2:47391"),
            ]
        );
    }

    #[tokio::test]
    async fn failed_node_is_cooled_down_and_listed_node_is_not() {
        let peers = [peer(&["100.64.0.1"], false), peer(&["100.64.0.2"], false)];
        let answer: Answer = |a| match a.ip() {
            IpAddr::V4(v4) if v4.octets()[3] == 1 => DialOutcome::Refused,
            _ => DialOutcome::Skipped,
        };
        let mut prober = Prober::default();
        let t0 = Instant::now();
        let both = vec![sa("100.64.0.1:47391"), sa("100.64.0.2:47391")];
        assert_eq!(run_round(&mut prober, t0, &peers, 30, answer).await, both);
        let early = t0 + TAILSCALE_COOLDOWN - Duration::from_millis(1);
        assert_eq!(
            run_round(&mut prober, early, &peers, 30, answer).await,
            vec![sa("100.64.0.2:47391")]
        );
        let later = t0 + TAILSCALE_COOLDOWN;
        assert_eq!(
            run_round(&mut prober, later, &peers, 30, answer)
                .await
                .len(),
            2
        );
    }

    async fn answer_once(mut io: impl AsyncRead + AsyncWrite + Unpin, body: &str) -> String {
        let mut head = Vec::new();
        let mut byte = [0u8; 1];
        while !head.ends_with(b"\r\n\r\n") {
            io.read_exact(&mut byte).await.unwrap();
            head.push(byte[0]);
        }
        let reply = format!(
            "HTTP/1.1 200 OK\r\ncontent-length: {}\r\n\r\n{body}",
            body.len()
        );
        io.write_all(reply.as_bytes()).await.unwrap();
        io.flush().await.unwrap();
        String::from_utf8(head).unwrap()
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn fetch_over_unix_socket() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tailscaled.sock");
        let listener = tokio::net::UnixListener::bind(&path).unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            answer_once(stream, "{\"ok\":1}").await
        });
        let body = fetch_status(&[Transport::Unix(path)]).await;
        assert_eq!(body.as_deref(), Some(&b"{\"ok\":1}"[..]));
        let head = server.await.unwrap();
        assert!(
            head.starts_with("GET /localapi/v0/status HTTP/1.1\r\n"),
            "{head}"
        );
        assert!(head.contains("host: local-tailscaled.sock\r\n"), "{head}");
    }

    #[tokio::test]
    async fn fetch_over_tcp_sends_basic_auth() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            answer_once(stream, "{}").await
        });
        let token = "tok".to_string();
        let body = fetch_status(&[Transport::Tcp { port, token }]).await;
        assert_eq!(body.as_deref(), Some(&b"{}"[..]));
        let head = server.await.unwrap();
        assert!(head.contains("authorization: Basic OnRvaw==\r\n"), "{head}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn fetch_with_no_transport_is_none() {
        let dir = tempfile::tempdir().unwrap();
        let missing = [
            Transport::Unix(dir.path().join("missing.sock")),
            Transport::Cli(dir.path().join("missing-tailscale")),
        ];
        let started = Instant::now();
        assert_eq!(fetch_status(&missing).await, None);
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cli_transport_runs_status_json() {
        let echo = Transport::Cli(PathBuf::from("/bin/echo"));
        let body = fetch_status(&[echo]).await;
        assert_eq!(body.as_deref(), Some(&b"status --json\n"[..]));
    }

    #[tokio::test]
    async fn non_ok_answer_falls_through_to_the_next_transport() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 1024];
            let _ = stream.read(&mut buf).await;
            let reply = b"HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n";
            stream.write_all(reply).await.unwrap();
        });
        let token = String::new();
        assert_eq!(fetch_status(&[Transport::Tcp { port, token }]).await, None);
    }

    #[cfg(unix)]
    #[test]
    fn same_user_proof_reads_port_link_and_token_file() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(same_user_proof(dir.path()), None);
        std::os::unix::fs::symlink("41112", dir.path().join("ipnport")).unwrap();
        assert_eq!(same_user_proof(dir.path()), None);
        std::fs::write(dir.path().join("sameuserproof-41112"), "s3cret\n").unwrap();
        assert_eq!(
            same_user_proof(dir.path()),
            Some(Transport::Tcp {
                port: 41112,
                token: "s3cret".into()
            })
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_tries_both_sockets_before_the_cli() {
        let all = transports();
        assert_eq!(
            all[..2],
            [
                Transport::Unix("/var/run/tailscale/tailscaled.sock".into()),
                Transport::Unix("/run/tailscale/tailscaled.sock".into()),
            ]
        );
        assert!(all[2..].iter().all(|t| matches!(t, Transport::Cli(_))));
    }
}
