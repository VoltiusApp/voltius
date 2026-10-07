use super::VerifyOutcome;
use crate::android_ctx::{load_class, with_env};
use jni::objects::{JClass, JValue};
use jni::JNIEnv;
use std::sync::Mutex;
use tokio::sync::oneshot;

const CLASS: &str = "com.voltius.app.VoltiusBiometric";
static PENDING: Mutex<Option<oneshot::Sender<i32>>> = Mutex::new(None);

fn map_code(code: i32) -> VerifyOutcome {
    match code {
        0 => VerifyOutcome::Ok,
        1 => VerifyOutcome::Cancelled,
        3 => VerifyOutcome::Unavailable,
        _ => VerifyOutcome::Failed,
    }
}

pub fn available() -> bool {
    with_env("biometric available", |env, ctx| {
        let cls = load_class(env, CLASS)?;
        env.call_static_method(
            &cls,
            "available",
            "(Landroid/content/Context;)Z",
            &[JValue::Object(ctx)],
        )?
        .z()
    })
    .unwrap_or(false)
}

pub async fn verify(_app: &tauri::AppHandle, reason: &str) -> VerifyOutcome {
    let (tx, rx) = oneshot::channel();
    *PENDING.lock().unwrap() = Some(tx);
    let launched = with_env("biometric authenticate", |env, _ctx| {
        let cls = load_class(env, CLASS)?;
        let title = env.new_string(reason)?;
        env.call_static_method(
            &cls,
            "authenticate",
            "(Ljava/lang/String;)Z",
            &[JValue::Object(&title)],
        )?
        .z()
    });
    if !matches!(launched, Ok(true)) {
        let _ = PENDING.lock().unwrap().take();
        return VerifyOutcome::Unavailable;
    }
    rx.await.map(map_code).unwrap_or(VerifyOutcome::Failed)
}

fn call_flag(method: &str, on: bool) {
    let _ = with_env(method, |env, _ctx| {
        let cls = load_class(env, CLASS)?;
        env.call_static_method(&cls, method, "(Z)V", &[JValue::Bool(on.into())])?
            .v()
    });
}

pub fn set_secure(on: bool) {
    call_flag("setSecure", on);
}

pub fn set_hide_in_recents(on: bool) {
    call_flag("setHideInRecents", on);
}

#[no_mangle]
pub extern "system" fn Java_com_voltius_app_VoltiusBiometric_nativeAuthResult<'local>(
    _env: JNIEnv<'local>,
    _class: JClass<'local>,
    code: jni::sys::jint,
) {
    if let Some(tx) = PENDING.lock().unwrap().take() {
        let _ = tx.send(code);
    }
}
