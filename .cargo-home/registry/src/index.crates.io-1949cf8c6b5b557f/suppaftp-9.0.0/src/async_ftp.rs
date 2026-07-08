//! # Async
//!
//! This module contains the definition for all async implementation of suppaftp
#[cfg(feature = "smol")]
mod smol_ftp;
#[cfg(feature = "tokio")]
mod tokio_ftp;

#[cfg(feature = "smol")]
#[cfg_attr(docsrs, doc(cfg(feature = "smol")))]
pub mod smol {
    #[cfg(feature = "smol")]
    #[cfg_attr(docsrs, doc(cfg(feature = "smol")))]
    use crate::async_ftp::smol_ftp::AsyncNoTlsStream;
    pub use crate::async_ftp::smol_ftp::SmolPassiveStreamBuilder;
    #[cfg(feature = "smol")]
    #[cfg_attr(docsrs, doc(cfg(feature = "smol")))]
    pub use crate::async_ftp::smol_ftp::{ImplAsyncFtpStream, SmolTlsStream};

    #[cfg(feature = "smol")]
    #[cfg_attr(docsrs, doc(cfg(feature = "smol")))]
    pub type AsyncFtpStream = ImplAsyncFtpStream<AsyncNoTlsStream>;

    // -- export async secure (native-tls)
    #[cfg(all(feature = "smol", feature = "smol-async-native-tls"))]
    #[cfg_attr(
        docsrs,
        doc(cfg(all(feature = "smol", feature = "smol-async-native-tls")))
    )]
    pub use crate::async_ftp::smol_ftp::AsyncNativeTlsConnector;
    #[cfg(all(feature = "smol", feature = "smol-async-native-tls"))]
    #[cfg_attr(
        docsrs,
        doc(cfg(all(feature = "smol", feature = "smol-async-native-tls")))
    )]
    use crate::async_ftp::smol_ftp::AsyncNativeTlsStream;
    #[cfg(feature = "smol")]
    #[cfg_attr(docsrs, doc(cfg(feature = "smol")))]
    pub use crate::async_ftp::smol_ftp::DataStream as AsyncDataStream;

    #[cfg(feature = "smol-async-native-tls")]
    #[cfg_attr(docsrs, doc(cfg(feature = "smol-async-native-tls")))]
    pub type AsyncNativeTlsFtpStream = ImplAsyncFtpStream<AsyncNativeTlsStream>;
    // -- export async secure (rustls) smol-rustls
    #[cfg(all(
        feature = "smol",
        any(feature = "smol-rustls-aws-lc-rs", feature = "smol-rustls-ring")
    ))]
    #[cfg_attr(
        docsrs,
        doc(cfg(all(
            any(feature = "smol-rustls-aws-lc-rs", feature = "smol-rustls-ring"),
            any(feature = "smol-rustls-aws-lc-rs", feature = "smol-rustls-ring")
        )))
    )]
    pub use crate::async_ftp::smol_ftp::AsyncRustlsConnector;
    #[cfg(all(
        feature = "smol",
        any(feature = "smol-rustls-aws-lc-rs", feature = "smol-rustls-ring")
    ))]
    #[cfg_attr(
        docsrs,
        doc(cfg(all(
            feature = "smol",
            any(feature = "smol-rustls-aws-lc-rs", feature = "smol-rustls-ring")
        )))
    )]
    use crate::async_ftp::smol_ftp::AsyncRustlsStream;

    #[cfg(all(
        feature = "smol",
        any(feature = "smol-rustls-aws-lc-rs", feature = "smol-rustls-ring")
    ))]
    #[cfg_attr(
        docsrs,
        doc(cfg(all(
            feature = "smol",
            any(feature = "smol-rustls-aws-lc-rs", feature = "smol-rustls-ring")
        )))
    )]
    pub type AsyncRustlsFtpStream = ImplAsyncFtpStream<AsyncRustlsStream>;
}

#[cfg(feature = "tokio")]
#[cfg_attr(docsrs, doc(cfg(feature = "tokio")))]
pub mod tokio {
    pub use super::tokio_ftp::{AsyncNoTlsStream, ImplAsyncFtpStream};
    pub type AsyncFtpStream = ImplAsyncFtpStream<AsyncNoTlsStream>;

    #[cfg(all(feature = "tokio", feature = "tokio-async-native-tls"))]
    #[cfg_attr(
        docsrs,
        doc(cfg(all(feature = "tokio", feature = "tokio-async-native-tls")))
    )]
    pub use super::tokio_ftp::AsyncNativeTlsConnector;
    #[cfg(all(feature = "tokio", feature = "tokio-async-native-tls"))]
    #[cfg_attr(
        docsrs,
        doc(cfg(all(feature = "tokio", feature = "tokio-async-native-tls")))
    )]
    pub use super::tokio_ftp::AsyncNativeTlsStream;
    pub use super::tokio_ftp::{
        DataStream as AsyncDataStream, TokioPassiveStreamBuilder, TokioTlsStream,
    };

    #[cfg(feature = "tokio-async-native-tls")]
    #[cfg_attr(docsrs, doc(cfg(feature = "tokio-async-native-tls")))]
    pub type AsyncNativeTlsFtpStream = ImplAsyncFtpStream<AsyncNativeTlsStream>;

    #[cfg(all(
        feature = "tokio",
        any(feature = "tokio-rustls-aws-lc-rs", feature = "tokio-rustls-ring")
    ))]
    #[cfg_attr(
        docsrs,
        doc(cfg(all(
            feature = "tokio",
            any(feature = "tokio-rustls-aws-lc-rs", feature = "tokio-rustls-ring")
        )))
    )]
    pub use super::tokio_ftp::AsyncRustlsConnector;
    #[cfg(all(
        feature = "tokio",
        any(feature = "tokio-rustls-aws-lc-rs", feature = "tokio-rustls-ring")
    ))]
    #[cfg_attr(
        docsrs,
        doc(cfg(all(
            feature = "tokio",
            any(feature = "tokio-rustls-aws-lc-rs", feature = "tokio-rustls-ring")
        )))
    )]
    pub use super::tokio_ftp::AsyncRustlsStream;

    #[cfg(all(
        feature = "tokio",
        any(feature = "tokio-rustls-aws-lc-rs", feature = "tokio-rustls-ring")
    ))]
    #[cfg_attr(
        docsrs,
        doc(cfg(all(
            feature = "tokio",
            any(feature = "tokio-rustls-aws-lc-rs", feature = "tokio-rustls-ring")
        )))
    )]
    pub type AsyncRustlsFtpStream = ImplAsyncFtpStream<AsyncRustlsStream>;
}
