use std::sync::mpsc::Sender;

/// Calls `tx` whenever the OS assigns an address that can reach beyond the local link.
pub fn watch_address_added(tx: Sender<()>) -> Result<(), String> {
    imp::watch(tx)
}

#[cfg(any(windows, target_os = "macos", target_os = "ios", test))]
fn reaches_beyond_link(ip: std::net::IpAddr) -> bool {
    match ip {
        // 169.254.x.x is what Windows self-assigns when DHCP fails.
        std::net::IpAddr::V4(v4) => {
            !(v4.is_link_local() || v4.is_loopback() || v4.is_unspecified())
        }
        std::net::IpAddr::V6(v6) => {
            !(v6.is_unicast_link_local() || v6.is_loopback() || v6.is_unspecified())
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
mod imp {
    use std::sync::mpsc::Sender;

    // Not exported by libc on Android.
    const RTMGRP_IPV4_IFADDR: u32 = 0x10;
    const RTMGRP_IPV6_IFADDR: u32 = 0x100;
    const RT_SCOPE_UNIVERSE: u8 = 0;

    pub fn watch(tx: Sender<()>) -> Result<(), String> {
        let fd = unsafe {
            libc::socket(
                libc::AF_NETLINK,
                libc::SOCK_RAW | libc::SOCK_CLOEXEC,
                libc::NETLINK_ROUTE,
            )
        };
        if fd < 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let mut addr: libc::sockaddr_nl = unsafe { std::mem::zeroed() };
        addr.nl_family = libc::AF_NETLINK as libc::sa_family_t;
        addr.nl_groups = RTMGRP_IPV4_IFADDR | RTMGRP_IPV6_IFADDR;
        let bound = unsafe {
            libc::bind(
                fd,
                &addr as *const libc::sockaddr_nl as *const libc::sockaddr,
                std::mem::size_of::<libc::sockaddr_nl>() as libc::socklen_t,
            )
        };
        if bound < 0 {
            let err = std::io::Error::last_os_error().to_string();
            unsafe { libc::close(fd) };
            return Err(err);
        }
        std::thread::Builder::new()
            .name("network-watch".into())
            .spawn(move || {
                let mut buf = [0u8; 8192];
                loop {
                    let n = unsafe {
                        libc::recv(fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len(), 0)
                    };
                    if n < 0 {
                        match std::io::Error::last_os_error().raw_os_error() {
                            Some(libc::EINTR) => continue,
                            // Overflowed kernel queue: events were lost, so assume one was an add.
                            Some(libc::ENOBUFS) => {}
                            _ => break,
                        }
                    } else if n == 0 || !has_new_address(&buf[..n as usize]) {
                        continue;
                    }
                    if tx.send(()).is_err() {
                        break;
                    }
                }
                unsafe { libc::close(fd) };
            })
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    fn has_new_address(mut buf: &[u8]) -> bool {
        let header = std::mem::size_of::<libc::nlmsghdr>();
        while buf.len() >= header {
            let msg: libc::nlmsghdr =
                unsafe { std::ptr::read_unaligned(buf.as_ptr() as *const libc::nlmsghdr) };
            // ifaddrmsg follows the header: family, prefixlen, flags, scope.
            if msg.nlmsg_type == libc::RTM_NEWADDR
                && buf.len() >= header + 4
                && buf[header + 3] == RT_SCOPE_UNIVERSE
            {
                return true;
            }
            let len = (msg.nlmsg_len as usize + 3) & !3;
            if len < header || len > buf.len() {
                return false;
            }
            buf = &buf[len..];
        }
        false
    }
}

/// The interface address carried by a BSD `RTM_NEWADDR` message.
#[cfg(any(target_os = "macos", target_os = "ios", test))]
fn bsd_new_address(msg: &[u8]) -> Option<std::net::IpAddr> {
    const IFA_MSGHDR_LEN: usize = 20;
    const RTAX_IFA: u32 = 5;
    const AF_INET: u8 = 2;
    const AF_INET6: u8 = 30;
    let addrs = u32::from_ne_bytes(msg.get(4..8)?.try_into().ok()?);
    let mut offset = IFA_MSGHDR_LEN;
    for bit in 0..RTAX_IFA {
        if addrs & (1 << bit) != 0 {
            let len = *msg.get(offset)? as usize;
            offset += if len == 0 { 4 } else { (len + 3) & !3 };
        }
    }
    if addrs & (1 << RTAX_IFA) == 0 {
        return None;
    }
    match *msg.get(offset + 1)? {
        AF_INET => {
            let b: [u8; 4] = msg.get(offset + 4..offset + 8)?.try_into().ok()?;
            Some(b.into())
        }
        AF_INET6 => {
            let b: [u8; 16] = msg.get(offset + 8..offset + 24)?.try_into().ok()?;
            Some(b.into())
        }
        _ => None,
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod imp {
    use std::sync::mpsc::Sender;

    const _: () = assert!(std::mem::size_of::<libc::ifa_msghdr>() == 20);

    pub fn watch(tx: Sender<()>) -> Result<(), String> {
        let fd = unsafe { libc::socket(libc::PF_ROUTE, libc::SOCK_RAW, libc::AF_UNSPEC) };
        if fd < 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        std::thread::Builder::new()
            .name("network-watch".into())
            .spawn(move || {
                let mut buf = [0u8; 2048];
                loop {
                    let n =
                        unsafe { libc::read(fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len()) };
                    if n < 0 {
                        if std::io::Error::last_os_error().raw_os_error() == Some(libc::EINTR) {
                            continue;
                        }
                        break;
                    }
                    // Every routing message starts msglen:u16, version:u8, type:u8.
                    let msg = &buf[..n as usize];
                    let added = n >= 4
                        && msg[3] as libc::c_int == libc::RTM_NEWADDR
                        && super::bsd_new_address(msg).is_some_and(super::reaches_beyond_link);
                    if added && tx.send(()).is_err() {
                        break;
                    }
                }
                unsafe { libc::close(fd) };
            })
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;
    use std::net::IpAddr;
    use std::sync::mpsc::Sender;
    use windows_sys::Win32::Foundation::{HANDLE, NO_ERROR};
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        MibAddInstance, MibParameterNotification, NotifyUnicastIpAddressChange,
        MIB_NOTIFICATION_TYPE, MIB_UNICASTIPADDRESS_ROW,
    };
    use windows_sys::Win32::Networking::WinSock::{AF_INET, AF_INET6, AF_UNSPEC};

    unsafe fn address(row: &MIB_UNICASTIPADDRESS_ROW) -> Option<IpAddr> {
        match row.Address.si_family {
            AF_INET => Some(IpAddr::from(
                row.Address.Ipv4.sin_addr.S_un.S_addr.to_ne_bytes(),
            )),
            AF_INET6 => Some(IpAddr::from(row.Address.Ipv6.sin6_addr.u.Byte)),
            _ => None,
        }
    }

    // A parameter change covers an address leaving the tentative (duplicate-check) state.
    unsafe extern "system" fn on_change(
        context: *const c_void,
        row: *const MIB_UNICASTIPADDRESS_ROW,
        kind: MIB_NOTIFICATION_TYPE,
    ) {
        if kind != MibAddInstance && kind != MibParameterNotification {
            return;
        }
        if row
            .as_ref()
            .and_then(|r| address(r))
            .is_some_and(|ip| !super::reaches_beyond_link(ip))
        {
            return;
        }
        let tx = &*(context as *const Sender<()>);
        let _ = tx.send(());
    }

    pub fn watch(tx: Sender<()>) -> Result<(), String> {
        // Leaked on purpose: the registration lives as long as the app.
        let context = Box::into_raw(Box::new(tx));
        let mut handle: HANDLE = std::ptr::null_mut();
        let rc = unsafe {
            NotifyUnicastIpAddressChange(
                AF_UNSPEC,
                Some(on_change),
                context as *const c_void,
                0,
                &mut handle,
            )
        };
        if rc != NO_ERROR {
            drop(unsafe { Box::from_raw(context) });
            return Err(format!("NotifyUnicastIpAddressChange failed: {rc}"));
        }
        Ok(())
    }
}

#[cfg(not(any(unix, windows)))]
mod imp {
    pub fn watch(_tx: std::sync::mpsc::Sender<()>) -> Result<(), String> {
        Err("unsupported platform".into())
    }
}

#[cfg(test)]
mod tests {
    use super::{bsd_new_address, reaches_beyond_link};

    #[test]
    fn only_addresses_that_can_reach_the_internet_count() {
        assert!(reaches_beyond_link("192.168.1.20".parse().unwrap()));
        assert!(reaches_beyond_link("2a01:e0a::1".parse().unwrap()));
        assert!(!reaches_beyond_link("169.254.10.3".parse().unwrap()));
        assert!(!reaches_beyond_link("fe80::1".parse().unwrap()));
        assert!(!reaches_beyond_link("127.0.0.1".parse().unwrap()));
    }

    fn sockaddr(family: u8, len: u8, addr_at: usize, addr: &[u8]) -> Vec<u8> {
        let mut sa = vec![0u8; ((len as usize) + 3) & !3];
        sa[0] = len;
        sa[1] = family;
        sa[addr_at..addr_at + addr.len()].copy_from_slice(addr);
        sa
    }

    #[test]
    fn reads_the_interface_address_after_the_netmask_and_interface_name() {
        let mut msg = vec![0u8; 20];
        msg[3] = 0xc;
        // RTA_NETMASK | RTA_IFP | RTA_IFA | RTA_BRD
        msg[4..8].copy_from_slice(&(0x04u32 | 0x10 | 0x20 | 0x80).to_ne_bytes());
        msg.extend(sockaddr(2, 7, 4, &[255, 255, 255]));
        msg.extend(sockaddr(18, 20, 8, b"en0"));
        msg.extend(sockaddr(2, 16, 4, &[192, 168, 1, 20]));
        msg.extend(sockaddr(2, 16, 4, &[192, 168, 1, 255]));
        assert_eq!(bsd_new_address(&msg), Some("192.168.1.20".parse().unwrap()));

        let mut v6 = msg[..20].to_vec();
        v6[4..8].copy_from_slice(&0x20u32.to_ne_bytes());
        let fe80 = "fe80::1".parse::<std::net::Ipv6Addr>().unwrap().octets();
        v6.extend(sockaddr(30, 28, 8, &fe80));
        assert_eq!(bsd_new_address(&v6), Some("fe80::1".parse().unwrap()));
        assert_eq!(bsd_new_address(&v6[..30]), None);
    }
}
