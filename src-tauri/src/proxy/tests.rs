use super::*;
use crate::port_forward::test_ssh::{spawn_server, Behavior, TestClient};
use std::sync::{Arc, Mutex};
use tokio::io::{copy_bidirectional, AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

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
) -> (u16, Arc<Mutex<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let requested = Arc::new(Mutex::new(String::new()));
    let seen = Arc::clone(&requested);
    tokio::spawn(async move {
        let (mut c, _) = listener.accept().await.unwrap();
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

async fn fake_http(upstream: u16, expect_auth: Option<&'static str>) -> (u16, Arc<Mutex<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let request_line = Arc::new(Mutex::new(String::new()));
    let seen = Arc::clone(&request_line);
    tokio::spawn(async move {
        let (mut c, _) = listener.accept().await.unwrap();
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
    });
    (port, request_line)
}

async fn ssh_over(spec: ProxySpec) -> Result<Option<String>, String> {
    let dialed = dial(Some(&spec), "ssh.test.invalid", 22)
        .await
        .map_err(|e| e.to_string())?;
    russh::client::connect_stream(
        Arc::new(russh::client::Config::default()),
        dialed.stream,
        TestClient,
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(dialed.via)
}

#[tokio::test]
async fn ssh_through_socks5_without_auth() {
    let ssh = spawn_server(russh::Preferred::default(), Behavior::GreetThenClose).await;
    let (proxy, requested) = fake_socks5(ssh, None).await;
    let via = ssh_over(ProxySpec::Socks5(endpoint(proxy, None)))
        .await
        .unwrap();
    assert_eq!(requested.lock().unwrap().as_str(), "ssh.test.invalid:22");
    assert_eq!(via.unwrap(), format!("socks5 127.0.0.1:{proxy}"));
}

#[tokio::test]
async fn ssh_through_socks5_with_auth() {
    let ssh = spawn_server(russh::Preferred::default(), Behavior::GreetThenClose).await;
    let (proxy, _) = fake_socks5(ssh, Some(("u", "p"))).await;
    ssh_over(ProxySpec::Socks5(endpoint(proxy, Some(("u", "p")))))
        .await
        .unwrap();
}

#[tokio::test]
async fn socks5_wrong_password_is_a_socks_error() {
    let ssh = spawn_server(russh::Preferred::default(), Behavior::GreetThenClose).await;
    let (proxy, _) = fake_socks5(ssh, Some(("u", "p"))).await;
    let err = ssh_over(ProxySpec::Socks5(endpoint(proxy, Some(("u", "wrong")))))
        .await
        .unwrap_err();
    assert!(err.starts_with("SOCKS5 proxy refused:"), "{err}");
}

#[tokio::test]
async fn ssh_through_http_connect_with_banner_in_reply() {
    let ssh = spawn_server(russh::Preferred::default(), Behavior::GreetThenClose).await;
    let (proxy, line) = fake_http(ssh, None).await;
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
async fn http_connect_wrong_auth_reports_407() {
    let ssh = spawn_server(russh::Preferred::default(), Behavior::GreetThenClose).await;
    let (proxy, _) = fake_http(ssh, Some("dTpw")).await;
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
}

#[test]
fn debug_redacts_password() {
    let spec = ProxySpec::Http(endpoint(1, Some(("u", "hunter2"))));
    let shown = format!("{spec:?}");
    assert!(!shown.contains("hunter2"), "{shown}");
    assert!(shown.contains("<redacted>"));
}

#[tokio::test]
async fn first_hop_helper_goes_through_proxy_and_reports_via() {
    let ssh = spawn_server(russh::Preferred::default(), Behavior::GreetThenClose).await;
    let (proxy, _) = fake_socks5(ssh, None).await;
    let spec = ProxySpec::Socks5(endpoint(proxy, None));
    let (_handle, via) = crate::ssh::client::connect_first_hop(
        Arc::new(russh::client::Config::default()),
        Some(&spec),
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
