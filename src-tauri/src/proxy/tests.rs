use super::*;
use crate::port_forward::test_ssh::{spawn_server, Behavior, TestClient};
use std::sync::{Arc, LazyLock, Mutex};
use tokio::io::{copy_bidirectional, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivatePkcs8KeyDer};
use tokio_rustls::rustls::{ClientConfig, RootCertStore, ServerConfig};
use tokio_rustls::TlsAcceptor;

fn endpoint(port: u16, auth: Option<(&str, &str)>) -> ProxyEndpoint {
    ProxyEndpoint {
        host: "127.0.0.1".into(),
        port,
        username: auth.map(|(u, _)| u.to_string()),
        password: auth.map(|(_, p)| p.to_string()),
    }
}

async fn fake_socks5(
    upstream: u16,
    creds: Option<(&'static str, &'static str)>,
    handshake_delay: Duration,
) -> (u16, Arc<Mutex<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let requested = Arc::new(Mutex::new(String::new()));
    let seen = Arc::clone(&requested);
    tokio::spawn(async move {
        let (mut c, _) = listener.accept().await.unwrap();
        tokio::time::sleep(handshake_delay).await;
        let mut head = [0u8; 2];
        c.read_exact(&mut head).await.unwrap();
        let mut methods = vec![0u8; head[1] as usize];
        c.read_exact(&mut methods).await.unwrap();
        if let Some((user, pass)) = creds {
            c.write_all(&[5, 2]).await.unwrap();
            let mut v = [0u8; 2];
            c.read_exact(&mut v).await.unwrap();
            let mut u = vec![0u8; v[1] as usize];
            c.read_exact(&mut u).await.unwrap();
            let mut pl = [0u8; 1];
            c.read_exact(&mut pl).await.unwrap();
            let mut p = vec![0u8; pl[0] as usize];
            c.read_exact(&mut p).await.unwrap();
            let ok = u == user.as_bytes() && p == pass.as_bytes();
            c.write_all(&[1, if ok { 0 } else { 1 }]).await.unwrap();
            if !ok {
                return;
            }
        } else {
            c.write_all(&[5, 0]).await.unwrap();
        }
        let mut req = [0u8; 4];
        c.read_exact(&mut req).await.unwrap();
        assert_eq!(req[3], 3, "target must be sent as a domain name");
        let mut len = [0u8; 1];
        c.read_exact(&mut len).await.unwrap();
        let mut name = vec![0u8; len[0] as usize];
        c.read_exact(&mut name).await.unwrap();
        let mut port_bytes = [0u8; 2];
        c.read_exact(&mut port_bytes).await.unwrap();
        *seen.lock().unwrap() = format!(
            "{}:{}",
            String::from_utf8_lossy(&name),
            u16::from_be_bytes(port_bytes)
        );
        c.write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0]).await.unwrap();
        let mut up = TcpStream::connect(("127.0.0.1", upstream)).await.unwrap();
        let _ = copy_bidirectional(&mut c, &mut up).await;
    });
    (port, requested)
}

/// A throwaway CA and a proxy certificate it issues for 127.0.0.1, made once per test run.
struct TestPki {
    ca: CertificateDer<'static>,
    proxy_cert: CertificateDer<'static>,
    proxy_key: Vec<u8>,
}

static TEST_PKI: LazyLock<TestPki> = LazyLock::new(|| {
    let ca_key = rcgen::KeyPair::generate().unwrap();
    let mut ca_params = rcgen::CertificateParams::new(Vec::<String>::new()).unwrap();
    ca_params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    let ca = ca_params.self_signed(&ca_key).unwrap();
    let proxy_key = rcgen::KeyPair::generate().unwrap();
    let proxy_cert = rcgen::CertificateParams::new(vec!["127.0.0.1".to_string()])
        .unwrap()
        .signed_by(&proxy_key, &ca, &ca_key)
        .unwrap();
    TestPki {
        ca: ca.der().clone(),
        proxy_cert: proxy_cert.der().clone(),
        proxy_key: proxy_key.serialize_der(),
    }
});

fn test_acceptor() -> TlsAcceptor {
    let pki = &*TEST_PKI;
    let config = ServerConfig::builder_with_provider(crate::tls::provider())
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(
            vec![pki.proxy_cert.clone()],
            PrivatePkcs8KeyDer::from(pki.proxy_key.clone()).into(),
        )
        .unwrap();
    TlsAcceptor::from(Arc::new(config))
}

fn trusting_test_ca() -> Arc<ClientConfig> {
    let mut roots = RootCertStore::empty();
    roots.add(TEST_PKI.ca.clone()).unwrap();
    crate::tls::client_config_with_roots(roots).unwrap()
}

async fn fake_http(
    upstream: u16,
    expect_auth: Option<&'static str>,
    tls: Option<TlsAcceptor>,
) -> (u16, Arc<Mutex<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let request_line = Arc::new(Mutex::new(String::new()));
    let seen = Arc::clone(&request_line);
    tokio::spawn(async move {
        let (tcp, _) = listener.accept().await.unwrap();
        match tls {
            None => serve_connect(tcp, upstream, expect_auth, seen).await,
            Some(acceptor) => {
                if let Ok(c) = acceptor.accept(tcp).await {
                    serve_connect(c, upstream, expect_auth, seen).await;
                }
            }
        }
    });
    (port, request_line)
}

async fn serve_connect<S: AsyncRead + AsyncWrite + Unpin>(
    mut c: S,
    upstream: u16,
    expect_auth: Option<&'static str>,
    seen: Arc<Mutex<String>>,
) {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 512];
    while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
        let n = c.read(&mut chunk).await.unwrap();
        buf.extend_from_slice(&chunk[..n]);
    }
    let text = String::from_utf8_lossy(&buf).to_string();
    *seen.lock().unwrap() = text.lines().next().unwrap_or("").to_string();
    if let Some(token) = expect_auth {
        if !text.contains(&format!("Proxy-Authorization: Basic {token}\r\n")) {
            c.write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\n\r\n")
                .await
                .unwrap();
            return;
        }
    }
    let mut up = TcpStream::connect(("127.0.0.1", upstream)).await.unwrap();
    let mut banner = vec![0u8; 256];
    let n = up.read(&mut banner).await.unwrap();
    let mut reply = b"HTTP/1.1 200 Connection established\r\n\r\n".to_vec();
    reply.extend_from_slice(&banner[..n]);
    c.write_all(&reply).await.unwrap();
    let _ = copy_bidirectional(&mut c, &mut up).await;
}

async fn ssh_over(spec: ProxySpec) -> Result<Option<String>, String> {
    let dialed = dial(Some(&spec), "ssh.test.invalid", 22)
        .await
        .map_err(|e| e.to_string())?;
    ssh_handshake(dialed.stream).await?;
    Ok(dialed.via)
}

async fn ssh_handshake(stream: ProxiedStream) -> Result<(), String> {
    russh::client::connect_stream(
        Arc::new(russh::client::Config::default()),
        stream,
        TestClient,
    )
    .await
    .map(drop)
    .map_err(|e| e.to_string())
}

#[tokio::test]
async fn ssh_through_socks5_without_auth() {
    let ssh = spawn_server(russh::Preferred::default(), Behavior::GreetThenClose).await;
    let (proxy, requested) = fake_socks5(ssh, None, Duration::ZERO).await;
    let via = ssh_over(ProxySpec::Socks5(endpoint(proxy, None)))
        .await
        .unwrap();
    assert_eq!(requested.lock().unwrap().as_str(), "ssh.test.invalid:22");
    assert_eq!(via.unwrap(), format!("socks5 127.0.0.1:{proxy}"));
}

#[tokio::test]
async fn ssh_through_socks5_with_auth() {
    let ssh = spawn_server(russh::Preferred::default(), Behavior::GreetThenClose).await;
    let (proxy, _) = fake_socks5(ssh, Some(("u", "p")), Duration::ZERO).await;
    ssh_over(ProxySpec::Socks5(endpoint(proxy, Some(("u", "p")))))
        .await
        .unwrap();
}

#[tokio::test]
async fn socks5_wrong_password_is_a_socks_error() {
    let ssh = spawn_server(russh::Preferred::default(), Behavior::GreetThenClose).await;
    let (proxy, _) = fake_socks5(ssh, Some(("u", "p")), Duration::ZERO).await;
    let err = ssh_over(ProxySpec::Socks5(endpoint(proxy, Some(("u", "wrong")))))
        .await
        .unwrap_err();
    assert!(err.starts_with("SOCKS5 proxy refused:"), "{err}");
}

#[tokio::test]
async fn socks5_username_without_password_fails_locally() {
    for password in [None, Some(String::new())] {
        let ep = ProxyEndpoint {
            password,
            ..endpoint(9, Some(("u", "")))
        };
        let err = dial(Some(&ProxySpec::Socks5(ep)), "h", 22)
            .await
            .err()
            .unwrap();
        assert!(matches!(err, ProxyError::Protocol { .. }), "{err}");
        assert_eq!(
            err.to_string(),
            "Proxy 127.0.0.1:9: SOCKS5 username set but no password"
        );
    }
}

#[tokio::test]
async fn ssh_through_http_connect_with_banner_in_reply() {
    let ssh = spawn_server(russh::Preferred::default(), Behavior::GreetThenClose).await;
    let (proxy, line) = fake_http(ssh, None, None).await;
    let via = ssh_over(ProxySpec::Http(endpoint(proxy, None)))
        .await
        .unwrap();
    assert_eq!(
        line.lock().unwrap().as_str(),
        "CONNECT ssh.test.invalid:22 HTTP/1.1"
    );
    assert_eq!(via.unwrap(), format!("http 127.0.0.1:{proxy}"));
}

#[tokio::test]
async fn ssh_through_https_proxy_with_banner_in_reply() {
    let ssh = spawn_server(russh::Preferred::default(), Behavior::GreetThenClose).await;
    let (proxy, line) = fake_http(ssh, None, Some(test_acceptor())).await;
    let stream = https::connect(
        &endpoint(proxy, None),
        trusting_test_ca(),
        "ssh.test.invalid",
        22,
    )
    .await
    .unwrap();
    ssh_handshake(ProxiedStream::Https(Box::new(stream)))
        .await
        .unwrap();
    assert_eq!(
        line.lock().unwrap().as_str(),
        "CONNECT ssh.test.invalid:22 HTTP/1.1"
    );
}

#[tokio::test]
async fn https_proxy_with_untrusted_certificate_is_rejected() {
    let ssh = spawn_server(russh::Preferred::default(), Behavior::GreetThenClose).await;
    let (proxy, line) = fake_http(ssh, None, Some(test_acceptor())).await;
    let err = dial(Some(&ProxySpec::Https(endpoint(proxy, None))), "h", 22)
        .await
        .err()
        .unwrap();
    assert!(matches!(err, ProxyError::Protocol { .. }), "{err}");
    assert!(!err.is_transient());
    assert!(
        err.to_string().starts_with(&format!(
            "Proxy 127.0.0.1:{proxy}: TLS certificate rejected: "
        )),
        "{err}"
    );
    assert!(
        line.lock().unwrap().is_empty(),
        "CONNECT sent over untrusted TLS"
    );
}

#[tokio::test]
async fn http_connect_wrong_auth_reports_407() {
    let ssh = spawn_server(russh::Preferred::default(), Behavior::GreetThenClose).await;
    let (proxy, _) = fake_http(ssh, Some("dTpw"), None).await;
    let err = ssh_over(ProxySpec::Http(endpoint(proxy, Some(("u", "x")))))
        .await
        .unwrap_err();
    assert!(err.contains("407 Proxy Authentication Required"), "{err}");
}

#[tokio::test]
async fn unreachable_proxy_names_the_proxy_and_is_transient() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let err = dial(Some(&ProxySpec::Http(endpoint(port, None))), "h", 22)
        .await
        .err()
        .unwrap();
    assert!(err
        .to_string()
        .starts_with(&format!("Proxy 127.0.0.1:{port} unreachable:")));
    assert!(err.is_transient());
}

#[tokio::test]
async fn stalled_proxy_times_out() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        let (_c, _) = listener.accept().await.unwrap();
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
    });
    let spec = ProxySpec::Http(endpoint(port, None));
    let err = dial_with_timeout(Some(&spec), "h", 22, std::time::Duration::from_millis(200))
        .await
        .err()
        .unwrap();
    assert!(matches!(err, ProxyError::Timeout { .. }), "{err}");
}

#[tokio::test]
async fn direct_is_plain_tcp() {
    let ssh = spawn_server(russh::Preferred::default(), Behavior::GreetThenClose).await;
    let dialed = dial(None, "127.0.0.1", ssh).await.unwrap();
    assert!(dialed.via.is_none());
    assert!(matches!(dialed.stream, ProxiedStream::Tcp(_)));
}

#[test]
fn spec_deserializes_from_frontend_json() {
    let spec: ProxySpec = serde_json::from_str(
        r#"{"kind":"socks5","host":"10.0.0.1","port":1080,"username":"u","password":"p"}"#,
    )
    .unwrap();
    assert_eq!(
        spec,
        ProxySpec::Socks5(ProxyEndpoint {
            host: "10.0.0.1".into(),
            port: 1080,
            username: Some("u".into()),
            password: Some("p".into()),
        })
    );
    assert_eq!(
        serde_json::from_str::<ProxySpec>(r#"{"kind":"system"}"#).unwrap(),
        ProxySpec::System
    );
    assert_eq!(
        serde_json::from_str::<ProxySpec>(r#"{"kind":"https","host":"127.0.0.1","port":443}"#)
            .unwrap(),
        ProxySpec::Https(endpoint(443, None))
    );
}

#[test]
fn debug_redacts_password() {
    let spec = ProxySpec::Http(endpoint(1, Some(("u", "hunter2"))));
    let shown = format!("{spec:?}");
    assert!(!shown.contains("hunter2"), "{shown}");
    assert!(shown.contains("<redacted>"));
}

#[tokio::test]
async fn first_hop_knocks_before_dialing_ssh() {
    use crate::knock::{KnockProtocol, KnockSpec, KnockStep};
    use crate::ssh::client::HopRoute;
    let knock_l = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let knock_port = knock_l.local_addr().unwrap().port();
    let ssh = spawn_server(russh::Preferred::default(), Behavior::GreetThenClose).await;
    let knocked = tokio::spawn(async move { knock_l.accept().await.is_ok() });
    let route = HopRoute {
        proxy: None,
        knock: Some(KnockSpec {
            steps: vec![KnockStep {
                port: knock_port,
                protocol: KnockProtocol::Tcp,
            }],
            delay_ms: 0,
            settle_ms: 20,
        }),
    };
    crate::ssh::client::connect_first_hop(
        Arc::new(russh::client::Config::default()),
        &route,
        "127.0.0.1",
        ssh,
        TestClient,
    )
    .await
    .map_err(|e| e.to_string())
    .unwrap();
    assert!(tokio::time::timeout(Duration::from_secs(1), knocked)
        .await
        .unwrap()
        .unwrap());
    assert!(!crate::knock::closed("127.0.0.1", ssh, Some(60)));
}

async fn knock_through_socks(handshake_delay: Duration) {
    use crate::knock::{knock, KnockProtocol, KnockSpec, KnockStep};
    let target = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target_port = target.local_addr().unwrap().port();
    let (proxy, requested) = fake_socks5(target_port, None, handshake_delay).await;
    let accepted = tokio::spawn(async move { target.accept().await.is_ok() });
    let spec = KnockSpec {
        steps: vec![KnockStep {
            port: 666,
            protocol: KnockProtocol::Tcp,
        }],
        delay_ms: 0,
        settle_ms: 200,
    };
    knock(
        &spec,
        Some(&ProxySpec::Socks5(endpoint(proxy, None))),
        "router.test.invalid",
        22,
    )
    .await
    .unwrap();
    assert!(tokio::time::timeout(Duration::from_secs(1), accepted)
        .await
        .unwrap()
        .unwrap());
    assert!(
        requested.lock().unwrap().contains("666"),
        "{}",
        requested.lock().unwrap()
    );
}

#[tokio::test]
async fn tcp_knock_goes_through_the_socks_proxy() {
    knock_through_socks(Duration::ZERO).await;
}

#[tokio::test]
async fn a_slow_proxy_still_forwards_the_last_knock() {
    knock_through_socks(Duration::from_millis(1500)).await;
}

#[tokio::test]
async fn a_failed_dial_after_a_knock_says_so() {
    use crate::knock::{KnockProtocol, KnockSpec, KnockStep};
    use crate::ssh::client::HopRoute;
    let closed_port = {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        l.local_addr().unwrap().port()
    };
    let route = HopRoute {
        proxy: None,
        knock: Some(KnockSpec {
            steps: vec![KnockStep {
                port: 9,
                protocol: KnockProtocol::Udp,
            }],
            delay_ms: 0,
            settle_ms: 0,
        }),
    };
    let err = crate::ssh::client::connect_first_hop(
        Arc::new(russh::client::Config::default()),
        &route,
        "127.0.0.1",
        closed_port,
        TestClient,
    )
    .await
    .err()
    .unwrap();
    assert!(err.to_string().ends_with(" (after port knock)"), "{err}");
}

#[tokio::test]
async fn first_hop_helper_goes_through_proxy_and_reports_via() {
    let ssh = spawn_server(russh::Preferred::default(), Behavior::GreetThenClose).await;
    let (proxy, _) = fake_socks5(ssh, None, Duration::ZERO).await;
    let spec = ProxySpec::Socks5(endpoint(proxy, None));
    let (_handle, via) = crate::ssh::client::connect_first_hop(
        Arc::new(russh::client::Config::default()),
        &crate::ssh::client::HopRoute {
            proxy: Some(spec),
            knock: None,
        },
        "ssh.test.invalid",
        22,
        TestClient,
    )
    .await
    .map_err(|e| e.to_string())
    .unwrap();
    assert_eq!(
        crate::ssh::client::hop_detail("ssh.test.invalid", 22, " (jump 1)", via.as_deref()),
        format!("ssh.test.invalid:22 (jump 1) via socks5 127.0.0.1:{proxy}")
    );
}
