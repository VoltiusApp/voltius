use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use super::{ActiveTunnel, SessionPfState, TunnelState};
use crate::storage::config::TunnelType;

/// Android freezes a backgrounded app and cuts its network shortly after, which
/// kills tunnel listeners and SSH connections; a foreground service keeps them
/// alive for as long as any tunnel is up or any SSH session is connected. Its
/// notification lists the listening tunnels, one line each.
pub(crate) fn sync(sessions: &HashMap<String, SessionPfState>) {
    static LAST: Mutex<Vec<String>> = Mutex::new(Vec::new());
    let lines = active_tunnel_lines(sessions);
    let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
    if *last != lines {
        notify_tunnels(&lines);
        *last = lines;
    }
}

/// Same service, counting connected SSH terminal sessions (`SessionManager`).
pub(crate) fn sync_ssh_sessions(count: usize) {
    static LAST: AtomicUsize = AtomicUsize::new(0);
    if LAST.swap(count, Ordering::Relaxed) != count {
        notify_sessions(count);
    }
}

fn active_tunnel_lines(sessions: &HashMap<String, SessionPfState>) -> Vec<String> {
    let mut lines: Vec<String> = sessions
        .values()
        .flat_map(|s| &s.tunnels)
        .filter(|e| matches!(e.tunnel.state, TunnelState::Active))
        .map(|e| tunnel_line(&e.tunnel))
        .collect();
    // HashMap order is arbitrary: sort so an unchanged set never re-posts the notification.
    lines.sort();
    lines
}

/// One notification line, the way `ssh -L/-R/-D` reads: `L 8080 → db:5432`.
fn tunnel_line(t: &ActiveTunnel) -> String {
    match t.tunnel_type {
        TunnelType::Local => format!("L {} → {}:{}", t.local_port, t.remote_host, t.remote_port),
        TunnelType::Remote => {
            let target = t.target_host.as_deref().unwrap_or(&t.remote_host);
            format!("R {} → {}:{}", t.remote_port, target, t.local_port)
        }
        TunnelType::Dynamic => format!("D {} (SOCKS)", t.local_port),
    }
}

#[cfg(target_os = "android")]
fn notify_tunnels(lines: &[String]) {
    use jni::objects::JValue;
    let joined = lines.join("\n");
    let res = crate::android_ctx::with_env("tunnel service", |env, ctx| {
        let cls = crate::android_ctx::load_class(env, "com.voltius.app.VoltiusTunnelService")?;
        let text = env.new_string(&joined)?;
        env.call_static_method(
            &cls,
            "updateTunnels",
            "(Landroid/content/Context;Ljava/lang/String;)V",
            &[JValue::Object(ctx), JValue::Object(&text)],
        )?;
        Ok(())
    });
    if let Err(e) = res {
        eprintln!("{e}");
    }
}

#[cfg(target_os = "android")]
fn notify_sessions(count: usize) {
    use jni::objects::JValue;
    let res = crate::android_ctx::with_env("tunnel service", |env, ctx| {
        let cls = crate::android_ctx::load_class(env, "com.voltius.app.VoltiusTunnelService")?;
        env.call_static_method(
            &cls,
            "updateSessions",
            "(Landroid/content/Context;I)V",
            &[JValue::Object(ctx), JValue::Int(count as i32)],
        )?;
        Ok(())
    });
    if let Err(e) = res {
        eprintln!("{e}");
    }
}

#[cfg(not(target_os = "android"))]
fn notify_tunnels(_lines: &[String]) {}

#[cfg(not(target_os = "android"))]
fn notify_sessions(_count: usize) {}

/// Closes every tunnel of every host, as if the user closed each one. Returns how many.
#[cfg(target_os = "android")]
pub(crate) async fn stop_all_tunnels() -> usize {
    use tauri::Manager;
    let Some(app) = crate::android_ctx::app() else {
        return 0;
    };
    let Some(pf) = app.try_state::<super::PortForwardManager>() else {
        return 0;
    };
    pf.stop_all_tunnels().await
}

/// JNI entry for `VoltiusTunnelService.nativeStopTunnels()`: the notification's "Stop
/// tunnels" action. SSH sessions are left alone. Never panics (no-unwind JNI boundary).
#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_com_voltius_app_VoltiusTunnelService_nativeStopTunnels<'local>(
    _env: jni::JNIEnv<'local>,
    _class: jni::objects::JClass<'local>,
) {
    tauri::async_runtime::spawn(async {
        let n = stop_all_tunnels().await;
        eprintln!("tunnel service: stopped {n} tunnel(s) from the notification");
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::port_forward::tests::{entry_of, state_with};
    use crate::port_forward::TunnelEntry;

    fn entry(state: TunnelState) -> TunnelEntry {
        let mut e = entry_of(TunnelType::Local, None, None);
        e.tunnel.state = state;
        e
    }

    #[test]
    fn lists_only_listening_tunnels_across_hosts() {
        let failed = TunnelState::Error("bind".into());
        let sessions = HashMap::from([
            (
                "a".to_string(),
                state_with(vec![entry(TunnelState::Active), entry(failed)], false, None),
            ),
            (
                "b".to_string(),
                state_with(vec![entry(TunnelState::Active)], false, None),
            ),
        ]);
        assert_eq!(active_tunnel_lines(&sessions).len(), 2);
    }

    #[test]
    fn lines_read_like_ssh_flags() {
        let mut t = entry_of(TunnelType::Local, None, None).tunnel;
        t.local_port = 8080;
        t.remote_host = "db".into();
        t.remote_port = 5432;
        assert_eq!(tunnel_line(&t), "L 8080 → db:5432");

        t.tunnel_type = TunnelType::Remote;
        t.remote_port = 9000;
        t.local_port = 3000;
        t.target_host = Some("localhost".into());
        assert_eq!(tunnel_line(&t), "R 9000 → localhost:3000");

        t.tunnel_type = TunnelType::Dynamic;
        t.local_port = 1080;
        assert_eq!(tunnel_line(&t), "D 1080 (SOCKS)");
    }
}
