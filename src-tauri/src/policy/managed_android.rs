use super::managed_config::load_managed;
use super::LoadedPolicy;
use crate::android_ctx::{load_class, with_env};
use jni::objects::{JString, JValue};
use serde_json::Value;
use std::sync::Mutex;

const CLASS: &str = "com.voltius.app.VoltiusManagedConfig";

static LAST: Mutex<Option<String>> = Mutex::new(None);

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

fn report(json: &str) -> Result<(), String> {
    with_env("managed configuration report", |env, ctx| {
        let cls = load_class(env, CLASS)?;
        let jjson = env.new_string(json)?;
        env.call_static_method(
            &cls,
            "report",
            "(Landroid/content/Context;Ljava/lang/String;)V",
            &[JValue::Object(ctx), JValue::Object(&jjson)],
        )?
        .v()
    })
}

pub fn load() -> LoadedPolicy {
    load_managed(read(), &LAST, report)
}
