use crate::proxy::{self, ProxySpec};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use tokio::net::UdpSocket;

/// Below Linux's 1 s initial SYN RTO, so a dropped knock is never retransmitted out of order.
const KNOCK_DIAL_LIMIT: Duration = Duration::from_millis(800);
const KNOCK_PROXIED_DIAL_LIMIT: Duration = Duration::from_secs(5);
const MIN_KNOCK_DELAY: Duration = Duration::from_millis(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KnockProtocol {
    Tcp,
    Udp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub struct KnockStep {
    pub port: u16,
    pub protocol: KnockProtocol,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct KnockSpec {
    pub steps: Vec<KnockStep>,
    pub delay_ms: u64,
    pub settle_ms: u64,
}

#[derive(Debug)]
pub enum KnockError {
    UdpViaProxy,
    Io(std::io::Error),
}

impl std::fmt::Display for KnockError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UdpViaProxy => f.write_str("UDP knocks can't go through a proxy"),
            Self::Io(e) => write!(f, "port knock failed: {e}"),
        }
    }
}

type HostKey = (String, u16);
type HostTurn = Arc<tokio::sync::Mutex<()>>;

static LEDGER: LazyLock<Mutex<HashMap<HostKey, Instant>>> = LazyLock::new(Default::default);
static IN_FLIGHT: LazyLock<Mutex<HashMap<HostKey, HostTurn>>> = LazyLock::new(Default::default);

fn ledger_key(host: &str, port: u16) -> HostKey {
    (host.to_ascii_lowercase(), port)
}

fn host_turn(host: &str, port: u16) -> HostTurn {
    Arc::clone(
        IN_FLIGHT
            .lock()
            .unwrap()
            .entry(ledger_key(host, port))
            .or_default(),
    )
}

fn record(host: &str, port: u16) {
    LEDGER
        .lock()
        .unwrap()
        .insert(ledger_key(host, port), Instant::now());
}

/// `None`: not knock-protected. `Some(0)`: protected, window unknown.
pub fn closed(host: &str, ssh_port: u16, window_secs: Option<u64>) -> bool {
    let Some(window) = window_secs else {
        return false;
    };
    if window == 0 {
        return true;
    }
    LEDGER
        .lock()
        .unwrap()
        .get(&ledger_key(host, ssh_port))
        .is_none_or(|at| at.elapsed() > Duration::from_secs(window))
}

pub async fn knock(
    spec: &KnockSpec,
    proxy: Option<&ProxySpec>,
    host: &str,
    ssh_port: u16,
) -> Result<(), KnockError> {
    let turn = host_turn(host, ssh_port);
    let _turn = turn.lock().await;
    let effective = proxy::resolve_spec(proxy, host, ssh_port).await;
    let proxied = matches!(
        effective,
        Some(ProxySpec::Socks5(_) | ProxySpec::Http(_) | ProxySpec::Https(_))
    );
    if proxied && spec.steps.iter().any(|s| s.protocol == KnockProtocol::Udp) {
        return Err(KnockError::UdpViaProxy);
    }
    let dial_limit = if proxied {
        KNOCK_PROXIED_DIAL_LIMIT
    } else {
        KNOCK_DIAL_LIMIT
    };
    let mut pending = Vec::new();
    for (i, step) in spec.steps.iter().enumerate() {
        if i > 0 {
            tokio::time::sleep(Duration::from_millis(spec.delay_ms).max(MIN_KNOCK_DELAY)).await;
        }
        match step.protocol {
            KnockProtocol::Tcp => {
                let (via, target, port) = (effective.clone(), host.to_string(), step.port);
                pending.push(tokio::spawn(async move {
                    let _ = proxy::dial_with_timeout(via.as_ref(), &target, port, dial_limit).await;
                }));
            }
            KnockProtocol::Udp => {
                let addr = tokio::net::lookup_host((host, step.port))
                    .await
                    .map_err(KnockError::Io)?
                    .next()
                    .ok_or_else(|| KnockError::Io(std::io::ErrorKind::NotFound.into()))?;
                let bind = if addr.is_ipv4() {
                    "0.0.0.0:0"
                } else {
                    "[::]:0"
                };
                let sock = UdpSocket::bind(bind).await.map_err(KnockError::Io)?;
                sock.send_to(&[0u8], addr).await.map_err(KnockError::Io)?;
            }
        }
    }
    if proxied {
        futures_util::future::join_all(pending.drain(..)).await;
    }
    tokio::time::sleep(Duration::from_millis(spec.settle_ms)).await;
    for task in pending {
        task.abort();
    }
    record(host, ssh_port);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;
    use tokio::task::JoinHandle;

    fn tcp(port: u16) -> KnockStep {
        KnockStep {
            port,
            protocol: KnockProtocol::Tcp,
        }
    }
    fn udp(port: u16) -> KnockStep {
        KnockStep {
            port,
            protocol: KnockProtocol::Udp,
        }
    }
    fn spec(steps: Vec<KnockStep>) -> KnockSpec {
        KnockSpec {
            steps,
            delay_ms: 50,
            settle_ms: 10,
        }
    }

    async fn listen(n: usize, start: Instant) -> (Vec<u16>, JoinHandle<Vec<Duration>>) {
        let ls: Vec<TcpListener> =
            futures_util::future::join_all((0..n).map(|_| TcpListener::bind("127.0.0.1:0")))
                .await
                .into_iter()
                .map(Result::unwrap)
                .collect();
        let ports = ls.iter().map(|l| l.local_addr().unwrap().port()).collect();
        let accepts = ls.into_iter().map(move |l| async move {
            l.accept().await.unwrap();
            start.elapsed()
        });
        (ports, tokio::spawn(futures_util::future::join_all(accepts)))
    }

    #[tokio::test]
    async fn tcp_steps_arrive_in_order_on_the_cadence() {
        let (ports, arrivals) = listen(3, Instant::now()).await;
        knock(
            &spec(ports.iter().map(|p| tcp(*p)).collect()),
            None,
            "127.0.0.1",
            22,
        )
        .await
        .unwrap();
        let times = arrivals.await.unwrap();
        assert!(times[0] < times[1] && times[1] < times[2], "{times:?}");
        assert!(times[2] >= Duration::from_millis(90), "{times:?}");
    }

    #[tokio::test]
    async fn a_zero_delay_still_spaces_the_steps() {
        let (ports, arrivals) = listen(4, Instant::now()).await;
        let mut sequence = spec(ports.iter().map(|p| tcp(*p)).collect());
        sequence.delay_ms = 0;
        knock(&sequence, None, "127.0.0.1", 22).await.unwrap();
        let times = arrivals.await.unwrap();
        assert!(times.windows(2).all(|w| w[0] < w[1]), "{times:?}");
        assert!(
            times[3] - times[0] >= Duration::from_millis(20),
            "{times:?}"
        );
    }

    #[tokio::test]
    async fn concurrent_knocks_to_one_host_do_not_interleave() {
        let start = Instant::now();
        let (a, a_arrivals) = listen(2, start).await;
        let (b, b_arrivals) = listen(2, start).await;
        let (sa, sb) = (
            spec(a.iter().map(|p| tcp(*p)).collect()),
            spec(b.iter().map(|p| tcp(*p)).collect()),
        );
        let (ra, rb) = tokio::join!(
            knock(&sa, None, "127.0.0.1", 2299),
            knock(&sb, None, "127.0.0.1", 2299)
        );
        ra.unwrap();
        rb.unwrap();
        let (a, b) = (a_arrivals.await.unwrap(), b_arrivals.await.unwrap());
        assert!(a[1] < b[0] || b[1] < a[0], "a={a:?} b={b:?}");
    }

    #[tokio::test]
    async fn udp_step_sends_one_datagram() {
        let sock = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let port = sock.local_addr().unwrap().port();
        knock(&spec(vec![udp(port)]), None, "127.0.0.1", 22)
            .await
            .unwrap();
        let mut buf = [0u8; 8];
        let n = tokio::time::timeout(Duration::from_secs(1), sock.recv(&mut buf))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(n, 1);
    }

    #[tokio::test]
    async fn udp_through_a_custom_proxy_fails_before_sending() {
        let sock = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let port = sock.local_addr().unwrap().port();
        let proxy = ProxySpec::Socks5(crate::proxy::ProxyEndpoint {
            host: "127.0.0.1".into(),
            port: 1,
            username: None,
            password: None,
        });
        let err = knock(
            &spec(vec![tcp(9), udp(port)]),
            Some(&proxy),
            "127.0.0.1",
            22,
        )
        .await
        .unwrap_err();
        assert!(matches!(err, KnockError::UdpViaProxy));
        let mut buf = [0u8; 8];
        assert!(
            tokio::time::timeout(Duration::from_millis(200), sock.recv(&mut buf))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn ledger_opens_the_window_after_a_knock() {
        let host = "ledger.test.invalid";
        assert!(closed(host, 2201, Some(60)));
        assert!(!closed(host, 2201, None));
        assert!(closed(host, 2201, Some(0)));
        record(host, 2201);
        assert!(!closed("LEDGER.test.invalid", 2201, Some(60)));
        assert!(closed(host, 2202, Some(60)));
    }

    #[test]
    fn spec_deserializes_from_frontend_json() {
        let s: KnockSpec = serde_json::from_str(
            r#"{"steps":[{"port":10001,"protocol":"tcp"},{"port":20002,"protocol":"udp"}],"delay_ms":200,"settle_ms":500}"#,
        ).unwrap();
        assert_eq!(s.steps, vec![tcp(10001), udp(20002)]);
    }
}
