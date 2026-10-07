use super::VerifyOutcome;
use gio::glib::{Variant, VariantTy};
use gio::prelude::*;
use std::collections::HashMap;

const ACTION: &str = "com.voltius.app.unlock";
const AUTHORITY_NAME: &str = "org.freedesktop.PolicyKit1";
const AUTHORITY_PATH: &str = "/org/freedesktop/PolicyKit1/Authority";
const AUTHORITY_IFACE: &str = "org.freedesktop.PolicyKit1.Authority";
const ALLOW_USER_INTERACTION: u32 = 1;
const PROMPT_TIMEOUT_MS: i32 = 300_000;

pub(super) fn sandbox_allows_polkit(flatpak_id: Option<&str>) -> bool {
    flatpak_id.is_none()
}

pub(super) fn map_polkit(authorized: bool, details: &HashMap<String, String>) -> VerifyOutcome {
    if authorized {
        VerifyOutcome::Ok
    } else if details.get("polkit.dismissed").map(String::as_str) == Some("true") {
        VerifyOutcome::Cancelled
    } else {
        VerifyOutcome::Failed
    }
}

fn system_bus() -> Option<gio::DBusConnection> {
    gio::bus_get_sync(gio::BusType::System, gio::Cancellable::NONE).ok()
}

fn call(
    bus: &gio::DBusConnection,
    method: &str,
    params: &Variant,
    reply: &str,
    flags: gio::DBusCallFlags,
    timeout_ms: i32,
) -> Option<Variant> {
    bus.call_sync(
        Some(AUTHORITY_NAME),
        AUTHORITY_PATH,
        AUTHORITY_IFACE,
        method,
        Some(params),
        VariantTy::new(reply).ok(),
        flags,
        timeout_ms,
        gio::Cancellable::NONE,
    )
    .ok()
}

fn action_registered(bus: &gio::DBusConnection) -> bool {
    let Some(reply) = call(
        bus,
        "EnumerateActions",
        &("",).to_variant(),
        "(a(ssssssuuua{ss}))",
        gio::DBusCallFlags::NONE,
        5_000,
    ) else {
        return false;
    };
    reply
        .child_value(0)
        .iter()
        .any(|a| a.child_value(0).str() == Some(ACTION))
}

pub fn available() -> bool {
    sandbox_allows_polkit(std::env::var("FLATPAK_ID").ok().as_deref())
        && system_bus().is_some_and(|b| action_registered(&b))
}

fn check(reason: &str) -> VerifyOutcome {
    let Some(bus) = system_bus() else {
        return VerifyOutcome::Unavailable;
    };
    let Some(name) = bus.unique_name() else {
        return VerifyOutcome::Unavailable;
    };
    // A system-bus-name subject spares us the PID start-time a unix-process subject needs.
    let subject: HashMap<String, Variant> =
        HashMap::from([("name".to_string(), name.as_str().to_variant())]);
    let details: HashMap<String, String> =
        HashMap::from([("polkit.message".to_string(), reason.to_string())]);
    let params = (
        ("system-bus-name", subject),
        ACTION,
        details,
        ALLOW_USER_INTERACTION,
        "",
    )
        .to_variant();
    let Some(reply) = call(
        &bus,
        "CheckAuthorization",
        &params,
        "((bba{ss}))",
        gio::DBusCallFlags::ALLOW_INTERACTIVE_AUTHORIZATION,
        PROMPT_TIMEOUT_MS,
    ) else {
        return VerifyOutcome::Failed;
    };
    let result = reply.child_value(0);
    let authorized = result.child_value(0).get::<bool>().unwrap_or(false);
    let details: HashMap<String, String> = result.child_value(2).get().unwrap_or_default();
    map_polkit(authorized, &details)
}

pub async fn verify(_app: &tauri::AppHandle, reason: &str) -> VerifyOutcome {
    let reason = reason.to_string();
    tauri::async_runtime::spawn_blocking(move || check(&reason))
        .await
        .unwrap_or(VerifyOutcome::Failed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn an_authorized_result_is_ok() {
        assert_eq!(map_polkit(true, &HashMap::new()), VerifyOutcome::Ok);
    }

    #[test]
    fn a_dismissed_dialog_is_cancelled() {
        let d = HashMap::from([("polkit.dismissed".to_string(), "true".to_string())]);
        assert_eq!(map_polkit(false, &d), VerifyOutcome::Cancelled);
    }

    #[test]
    fn a_refusal_is_failed() {
        assert_eq!(map_polkit(false, &HashMap::new()), VerifyOutcome::Failed);
    }

    #[test]
    fn flatpak_is_never_available() {
        assert!(!sandbox_allows_polkit(Some("app.voltius.Voltius")));
        assert!(sandbox_allows_polkit(None));
    }
}
