use super::managed_config::managed_config_doc;
use super::{Issue, IssueKind, LoadedPolicy, PolicyDoc};
use crate::android_ctx::{load_class, with_env};
use jni::objects::{JString, JValue};
use serde_json::Value;
use std::sync::Mutex;

const CLASS: &str = "com.voltius.app.VoltiusManagedConfig";

static LAST_REPORTED: Mutex<Option<String>> = Mutex::new(None);

fn read() -> Result<Value, String> {
    let text = with_env("cannot read managed configuration", |env, ctx| {
        let cls = load_class(env, CLASS)?;
        let out = env
            .call_static_method(
                &cls,
                "read",
                "(Landroid/content/Context;)Ljava/lang/String;",
                &[JValue::Object(ctx)],
            )?
            .l()?;
        let text: String = env.get_string(&JString::from(out))?.into();
        Ok(text)
    })?;
    serde_json::from_str(&text)
        .map_err(|e| format!("cannot read managed configuration: invalid JSON from the app: {e}"))
}

fn report(issues: &[Issue]) {
    let Ok(json) = serde_json::to_string(issues) else {
        return;
    };
    let mut last = LAST_REPORTED.lock().unwrap_or_else(|e| e.into_inner());
    if last.as_deref() == Some(json.as_str()) {
        return;
    }
    let sent = with_env("managed configuration report", |env, ctx| {
        let cls = load_class(env, CLASS)?;
        let jjson = env.new_string(&json)?;
        env.call_static_method(
            &cls,
            "report",
            "(Landroid/content/Context;Ljava/lang/String;)V",
            &[JValue::Object(ctx), JValue::Object(&jjson)],
        )?
        .v()
    });
    match sent {
        Ok(()) => *last = Some(json),
        Err(e) => log::warn!("{e}"),
    }
}

pub fn load() -> LoadedPolicy {
    let (doc, issues) = match read() {
        Ok(bundle) => managed_config_doc(&bundle),
        Err(e) => {
            log::warn!("{e}");
            (
                PolicyDoc::default(),
                vec![Issue::general(IssueKind::File, e)],
            )
        }
    };
    report(&issues);
    LoadedPolicy {
        path: None,
        doc,
        issues,
    }
}
