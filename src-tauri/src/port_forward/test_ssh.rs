//! In-process SSH server for exercising `pipe::pump` against a real
//! `direct-tcpip` channel.

use russh::keys::ssh_key::private::Ed25519Keypair;
use russh::keys::PrivateKey;
use russh::server::{Auth, ChannelOpenHandle, Msg as ServerMsg, Session};
use russh::{Channel, ChannelMsg};
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;

/// Derived at runtime rather than embedded as a key file: the client here
/// accepts any host key, so the seed only has to be stable within a test run.
fn host_key() -> PrivateKey {
    let mut seed = [0u8; 32];
    for (i, b) in seed.iter_mut().enumerate() {
        *b = i as u8;
    }
    Ed25519Keypair::from_seed(&seed).into()
}

pub const GREETING: &[u8] = b"HTTP/1.1 200 OK\r\n\r\n";
pub const SAW_EOF: &[u8] = b"SAW-EOF";

#[derive(Clone, Copy)]
pub enum Behavior {
    /// Write a response, then end the channel — a keep-alive server hanging up.
    GreetThenClose,
    /// Wait for the client's EOF, then answer and end the channel.
    AnswerOnEof,
}

struct TestServer {
    behavior: Behavior,
}

impl russh::server::Handler for TestServer {
    type Error = russh::Error;

    async fn auth_none(&mut self, _user: &str) -> Result<Auth, Self::Error> {
        Ok(Auth::Accept)
    }

    async fn channel_open_direct_tcpip(
        &mut self,
        channel: Channel<ServerMsg>,
        _host_to_connect: &str,
        _port_to_connect: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        let behavior = self.behavior;
        tokio::spawn(async move {
            let (mut read_half, write_half) = channel.split();
            let reply_body = match behavior {
                Behavior::GreetThenClose => GREETING,
                Behavior::AnswerOnEof => {
                    loop {
                        match read_half.wait().await {
                            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                            _ => {}
                        }
                    }
                    SAW_EOF
                }
            };
            let mut writer = write_half.make_writer();
            let _ = writer.write_all(reply_body).await;
            let _ = write_half.eof().await;
            let _ = write_half.close().await;
        });
        Ok(())
    }
}

pub struct TestClient;

impl russh::client::Handler for TestClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

pub struct TestSession {
    _handle: Arc<russh::client::Handle<TestClient>>,
}

/// Start a one-connection SSH server and return an open `direct-tcpip` channel
/// to it. The returned `TestSession` keeps the client session alive.
pub async fn open_direct_channel(behavior: Behavior) -> (TestSession, Channel<russh::client::Msg>) {
    let mut handle = connect_to_server(
        russh::client::Config::default(),
        Default::default(),
        behavior,
    )
    .await
    .unwrap();
    assert!(handle.authenticate_none("test").await.unwrap().success());

    let channel = handle
        .channel_open_direct_tcpip("127.0.0.1", 80, "127.0.0.1", 0)
        .await
        .unwrap();

    (
        TestSession {
            _handle: Arc::new(handle),
        },
        channel,
    )
}

/// Serve one connection offering only `server_preferred`, and complete the key exchange with it.
pub async fn connect_to_server(
    client_config: russh::client::Config,
    server_preferred: russh::Preferred,
    behavior: Behavior,
) -> Result<russh::client::Handle<TestClient>, russh::Error> {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    let server_config = Arc::new(russh::server::Config {
        keys: vec![host_key()],
        preferred: server_preferred,
        ..Default::default()
    });
    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        if let Ok(session) =
            russh::server::run_stream(server_config, stream, TestServer { behavior }).await
        {
            let _ = session.await;
        }
    });

    russh::client::connect(Arc::new(client_config), ("127.0.0.1", port), TestClient).await
}

/// A connected loopback TCP pair: the local end a client would hold, and the
/// end `pump` bridges onto the SSH channel.
pub async fn tcp_pair() -> (tokio::net::TcpStream, tokio::net::TcpStream) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let connect = tokio::spawn(async move { tokio::net::TcpStream::connect(addr).await.unwrap() });
    let (accepted, _) = listener.accept().await.unwrap();
    (connect.await.unwrap(), accepted)
}
