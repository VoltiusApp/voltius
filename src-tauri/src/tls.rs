use std::sync::{Arc, OnceLock};
use tokio_rustls::rustls::crypto::{ring, CryptoProvider};
use tokio_rustls::rustls::{ClientConfig, RootCertStore};

/// rustls config trusting the OS root store, using the `ring` provider (matches
/// the rest of the tree). Self-signed/invalid certs are rejected. On Android the
/// bundled webpki roots are added too, as reqwest does there (see commands/http.rs).
/// Built once: reading the OS store is slow.
pub fn client_config() -> Result<Arc<ClientConfig>, String> {
    static CONFIG: OnceLock<Result<Arc<ClientConfig>, String>> = OnceLock::new();
    CONFIG.get_or_init(build).clone()
}

fn build() -> Result<Arc<ClientConfig>, String> {
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
    client_config_with_roots(roots)
}

pub fn client_config_with_roots(roots: RootCertStore) -> Result<Arc<ClientConfig>, String> {
    let config = ClientConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("TLS setup failed: {e}"))?
        .with_root_certificates(roots)
        .with_no_client_auth();
    Ok(Arc::new(config))
}

pub fn provider() -> Arc<CryptoProvider> {
    Arc::new(ring::default_provider())
}
