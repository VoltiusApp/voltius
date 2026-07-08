// Take a look at the license at the top of the repository in the LICENSE file.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use glib::{prelude::*, translate::*};

use crate::{prelude::*, InetAddress, SocketFamily};

#[derive(Debug)]
pub enum InetAddressBytes<'a> {
    V4(&'a [u8; 4]),
    V6(&'a [u8; 16]),
}

impl<'a> InetAddressBytes<'a> {
    #[inline]
    fn deref(&self) -> &[u8] {
        use self::InetAddressBytes::*;

        match *self {
            V4(bytes) => bytes,
            V6(bytes) => bytes,
        }
    }
}

impl InetAddress {
    #[doc(alias = "g_inet_address_new_from_bytes")]
    pub fn from_bytes(inet_address_bytes: InetAddressBytes) -> Self {
        let bytes = inet_address_bytes.deref();

        let family = match inet_address_bytes {
            InetAddressBytes::V4(_) => SocketFamily::Ipv4,
            InetAddressBytes::V6(_) => SocketFamily::Ipv6,
        };
        unsafe {
            from_glib_full(ffi::g_inet_address_new_from_bytes(
                bytes.to_glib_none().0,
                family.into_glib(),
            ))
        }
    }
}

mod sealed {
    pub trait Sealed {}
    impl<T: super::IsA<super::InetAddress>> Sealed for T {}
}

pub trait InetAddressExtManual: sealed::Sealed + IsA<InetAddress> + 'static {
    // rustdoc-stripper-ignore-next
    /// Returns `None` in case the address has a native size different than 4 and 16.
    #[doc(alias = "g_inet_address_to_bytes")]
    #[inline]
    fn to_bytes(&self) -> Option<InetAddressBytes<'_>> {
        let size = self.native_size();
        unsafe {
            let bytes = ffi::g_inet_address_to_bytes(self.as_ref().to_glib_none().0);
            if size == 4 {
                Some(InetAddressBytes::V4(&*(bytes as *const [u8; 4])))
            } else if size == 16 {
                Some(InetAddressBytes::V6(&*(bytes as *const [u8; 16])))
            } else {
                None
            }
        }
    }
}

impl<O: IsA<InetAddress>> InetAddressExtManual for O {}

impl From<IpAddr> for InetAddress {
    fn from(addr: IpAddr) -> Self {
        match addr {
            IpAddr::V4(v4) => Self::from_bytes(InetAddressBytes::V4(&v4.octets())),
            IpAddr::V6(v6) => Self::from_bytes(InetAddressBytes::V6(&v6.octets())),
        }
    }
}

impl From<InetAddress> for IpAddr {
    fn from(addr: InetAddress) -> Self {
        let size = addr.native_size();
        unsafe {
            let bytes = ffi::g_inet_address_to_bytes(addr.to_glib_none().0);
            if size == 4 {
                Self::V4(Ipv4Addr::from(*(bytes as *const [u8; 4])))
            } else if size == 16 {
                Self::V6(Ipv6Addr::from(*(bytes as *const [u16; 8])))
            } else {
                panic!("Unknown IP kind");
            }
        }
    }
}
