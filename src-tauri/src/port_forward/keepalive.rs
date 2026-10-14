use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};

use super::{SessionPfState, TunnelState};

/// Android freezes a backgrounded app and its listeners; a foreground service
/// keeps them reachable for as long as any tunnel is up.
pub(crate) fn sync(sessions: &HashMap<String, SessionPfState>) {
    static LAST: AtomicUsize = AtomicUsize::new(0);
    let active = active_tunnels(sessions);
    if LAST.swap(active, Ordering::Relaxed) != active {
        notify(active);
    }
}

fn active_tunnels(sessions: &HashMap<String, SessionPfState>) -> usize {
    sessions
        .values()
        .flat_map(|s| &s.tunnels)
        .filter(|e| matches!(e.tunnel.state, TunnelState::Active))
        .count()
}

#[cfg(target_os = "android")]
fn notify(active: usize) {
    use jni::objects::JValue;
    let res = crate::android_ctx::with_env("tunnel service", |env, ctx| {
        let cls = crate::android_ctx::load_class(env, "com.voltius.app.VoltiusTunnelService")?;
        env.call_static_method(
            &cls,
            "update",
            "(Landroid/content/Context;I)V",
            &[JValue::Object(ctx), JValue::Int(active as i32)],
        )?;
        Ok(())
    });
    if let Err(e) = res {
        eprintln!("{e}");
    }
}

#[cfg(not(target_os = "android"))]
fn notify(_active: usize) {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::port_forward::tests::{entry_of, state_with};
    use crate::port_forward::TunnelEntry;
    use crate::storage::config::TunnelType;

    fn entry(state: TunnelState) -> TunnelEntry {
        let mut e = entry_of(TunnelType::Local, None, None);
        e.tunnel.state = state;
        e
    }

    #[test]
    fn counts_only_listening_tunnels_across_hosts() {
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
        assert_eq!(active_tunnels(&sessions), 2);
    }
}
