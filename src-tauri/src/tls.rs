use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tokio_rustls::rustls::client::danger::{
    HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier,
};
use tokio_rustls::rustls::client::WebPkiServerVerifier;
use tokio_rustls::rustls::crypto::{ring, CryptoProvider};
use tokio_rustls::rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use tokio_rustls::rustls::{
    ClientConfig, ConfigBuilder, DigitallySignedStruct, Error as TlsError, RootCertStore,
    SignatureScheme, WantsVerifier,
};

pub const TLS_PIN_PREFIX: &str = "tls-sha256:";
/// Known-hosts entry for a host whose certificate a CA vouched for; never a pin.
pub const TLS_WEBPKI_MARKER: &str = "tls-webpki";

/// rustls config trusting the OS root store, using the `ring` provider (matches
/// the rest of the tree). Self-signed/invalid certs are rejected. On Android the
/// bundled webpki roots are added too, as reqwest does there (see commands/http.rs).
/// Built once: reading the OS store is slow.
pub fn client_config() -> Result<Arc<ClientConfig>, String> {
    static CONFIG: OnceLock<Result<Arc<ClientConfig>, String>> = OnceLock::new();
    CONFIG
        .get_or_init(|| client_config_with_roots((*root_store()?).clone()))
        .clone()
}

pub fn root_store() -> Result<Arc<RootCertStore>, String> {
    static ROOTS: OnceLock<Result<Arc<RootCertStore>, String>> = OnceLock::new();
    ROOTS.get_or_init(load_roots).clone()
}

fn load_roots() -> Result<Arc<RootCertStore>, String> {
    let mut roots = RootCertStore::empty();
    let loaded = rustls_native_certs::load_native_certs();
    for cert in loaded.certs {
        let _ = roots.add(cert);
    }
    #[cfg(target_os = "android")]
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    if roots.is_empty() {
        return Err("No system root certificates available".into());
    }
    Ok(Arc::new(roots))
}

pub fn tls_fingerprint(cert: &CertificateDer<'_>) -> String {
    let hex: String = Sha256::digest(cert.as_ref())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    format!("{TLS_PIN_PREFIX}{hex}")
}

pub fn client_config_with_roots(roots: RootCertStore) -> Result<Arc<ClientConfig>, String> {
    let config = config_builder()?
        .with_root_certificates(roots)
        .with_no_client_auth();
    Ok(Arc::new(config))
}

fn config_builder() -> Result<ConfigBuilder<ClientConfig, WantsVerifier>, String> {
    ClientConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .map_err(setup_failed)
}

fn setup_failed(e: impl std::fmt::Display) -> String {
    format!("TLS setup failed: {e}")
}

pub fn provider() -> Arc<CryptoProvider> {
    Arc::new(ring::default_provider())
}

/// WebPKI first; a certificate it refuses passes only if its fingerprint is pinned.
#[derive(Debug)]
pub struct PinningVerifier {
    webpki: Arc<WebPkiServerVerifier>,
    pins: Vec<String>,
    rejected: Mutex<Option<String>>,
    webpki_accepted: AtomicBool,
}

impl PinningVerifier {
    pub fn new(roots: Arc<RootCertStore>, pins: Vec<String>) -> Result<Arc<Self>, String> {
        let webpki = WebPkiServerVerifier::builder_with_provider(roots, provider())
            .build()
            .map_err(setup_failed)?;
        Ok(Arc::new(Self {
            webpki,
            pins,
            rejected: Mutex::new(None),
            webpki_accepted: AtomicBool::new(false),
        }))
    }

    pub fn client_config(self: &Arc<Self>) -> Result<Arc<ClientConfig>, String> {
        let config = config_builder()?
            .dangerous()
            .with_custom_certificate_verifier(Arc::clone(self) as Arc<dyn ServerCertVerifier>)
            .with_no_client_auth();
        Ok(Arc::new(config))
    }

    pub fn rejected_fingerprint(&self) -> Option<String> {
        self.rejected.lock().unwrap().clone()
    }

    pub fn accepted_by_webpki(&self) -> bool {
        self.webpki_accepted.load(Ordering::Relaxed)
    }
}

impl ServerCertVerifier for PinningVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, TlsError> {
        match self.webpki.verify_server_cert(
            end_entity,
            intermediates,
            server_name,
            ocsp_response,
            now,
        ) {
            Ok(verified) => {
                self.webpki_accepted.store(true, Ordering::Relaxed);
                Ok(verified)
            }
            Err(e) => {
                let fp = tls_fingerprint(end_entity);
                if self.pins.contains(&fp) {
                    return Ok(ServerCertVerified::assertion());
                }
                *self.rejected.lock().unwrap() = Some(fp);
                Err(e)
            }
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        self.webpki.verify_tls12_signature(message, cert, dss)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        self.webpki.verify_tls13_signature(message, cert, dss)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.webpki.supported_verify_schemes()
    }
}

#[cfg(test)]
pub(crate) mod pin_tests {
    use super::*;
    use tokio::net::{TcpListener, TcpStream};
    use tokio_rustls::rustls::pki_types::PrivatePkcs8KeyDer;
    use tokio_rustls::rustls::ServerConfig;
    use tokio_rustls::{TlsAcceptor, TlsConnector};

    pub(crate) struct Leaf {
        pub cert: CertificateDer<'static>,
        pub key: Vec<u8>,
    }

    pub(crate) fn self_signed() -> Leaf {
        let ck = rcgen::generate_simple_self_signed(vec!["127.0.0.1".to_string()]).unwrap();
        Leaf {
            cert: ck.cert.der().clone(),
            key: ck.key_pair.serialize_der(),
        }
    }

    pub(crate) fn ca_signed() -> (Leaf, CertificateDer<'static>) {
        let ca_key = rcgen::KeyPair::generate().unwrap();
        let mut ca_params = rcgen::CertificateParams::new(Vec::<String>::new()).unwrap();
        ca_params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
        let ca = ca_params.self_signed(&ca_key).unwrap();
        let key = rcgen::KeyPair::generate().unwrap();
        let cert = rcgen::CertificateParams::new(vec!["127.0.0.1".to_string()])
            .unwrap()
            .signed_by(&key, &ca, &ca_key)
            .unwrap();
        (
            Leaf {
                cert: cert.der().clone(),
                key: key.serialize_der(),
            },
            ca.der().clone(),
        )
    }

    pub(crate) fn unrelated_roots() -> RootCertStore {
        let mut roots = RootCertStore::empty();
        roots.add(ca_signed().1).unwrap();
        roots
    }

    pub(crate) async fn serve_tls(leaf: &Leaf) -> u16 {
        let config = ServerConfig::builder_with_provider(provider())
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(
                vec![leaf.cert.clone()],
                PrivatePkcs8KeyDer::from(leaf.key.clone()).into(),
            )
            .unwrap();
        let acceptor = TlsAcceptor::from(Arc::new(config));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((tcp, _)) = listener.accept().await {
                let acceptor = acceptor.clone();
                tokio::spawn(async move {
                    let _ = acceptor.accept(tcp).await;
                });
            }
        });
        port
    }

    async fn handshake(
        port: u16,
        roots: RootCertStore,
        pins: Vec<String>,
    ) -> (bool, Option<String>, bool) {
        let verifier = PinningVerifier::new(Arc::new(roots), pins).unwrap();
        let connector = TlsConnector::from(verifier.client_config().unwrap());
        let tcp = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let ok = connector
            .connect(ServerName::try_from("127.0.0.1").unwrap(), tcp)
            .await
            .is_ok();
        (
            ok,
            verifier.rejected_fingerprint(),
            verifier.accepted_by_webpki(),
        )
    }

    #[test]
    fn the_ca_marker_is_never_read_as_a_pin() {
        assert!(!TLS_WEBPKI_MARKER.starts_with(TLS_PIN_PREFIX));
    }

    #[test]
    fn fingerprints_are_prefixed_lowercase_sha256_hex() {
        assert_eq!(
            tls_fingerprint(&CertificateDer::from(b"abc".to_vec())),
            "tls-sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[tokio::test]
    async fn a_ca_signed_certificate_passes_without_a_pin() {
        let (leaf, ca) = ca_signed();
        let port = serve_tls(&leaf).await;
        let mut roots = RootCertStore::empty();
        roots.add(ca).unwrap();
        assert_eq!(handshake(port, roots, vec![]).await, (true, None, true));
    }

    #[tokio::test]
    async fn an_unpinned_self_signed_certificate_is_refused_and_reported() {
        let leaf = self_signed();
        let port = serve_tls(&leaf).await;
        assert_eq!(
            handshake(port, unrelated_roots(), vec![]).await,
            (false, Some(tls_fingerprint(&leaf.cert)), false)
        );
    }

    #[tokio::test]
    async fn a_pinned_self_signed_certificate_passes() {
        let leaf = self_signed();
        let port = serve_tls(&leaf).await;
        let pins = vec![tls_fingerprint(&leaf.cert)];
        assert_eq!(
            handshake(port, unrelated_roots(), pins).await,
            (true, None, false)
        );
    }
}
