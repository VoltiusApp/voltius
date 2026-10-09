use super::seal::{self, PlatformSealer, SealOutcome, Sealer};
use super::VerifyOutcome;
use crate::android_ctx::{load_class, with_env};
use jni::objects::{JByteArray, JClass, JValue};
use jni::JNIEnv;
use std::sync::Mutex;
use tokio::sync::oneshot;

const CLASS: &str = "com.voltius.app.VoltiusBiometric";
type Reply = (i32, Option<Vec<u8>>);
static PENDING: Mutex<Option<oneshot::Sender<Reply>>> = Mutex::new(None);

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

fn map_seal(code: i32, data: Option<Vec<u8>>) -> SealOutcome {
    match (code, data) {
        (0, Some(d)) => SealOutcome::Ok(d),
        (1, _) => SealOutcome::Cancelled,
        (3, _) => SealOutcome::Unavailable,
        (4, _) => SealOutcome::Invalidated,
        _ => SealOutcome::Failed,
    }
}

/// Starts a prompt in `VoltiusBiometric`; None when it could not be shown.
async fn prompt(method: &str, title: &str, bytes: Option<&[u8]>) -> Option<Reply> {
    let (tx, rx) = oneshot::channel();
    *PENDING.lock().unwrap() = Some(tx);
    let launched = with_env(method, |env, _ctx| {
        let cls = load_class(env, CLASS)?;
        let title = env.new_string(title)?;
        match bytes {
            Some(b) => {
                let arr = env.byte_array_from_slice(b)?;
                env.call_static_method(
                    &cls,
                    method,
                    "(Ljava/lang/String;[B)Z",
                    &[JValue::Object(&title), JValue::Object(&arr)],
                )?
                .z()
            }
            None => env
                .call_static_method(
                    &cls,
                    method,
                    "(Ljava/lang/String;)Z",
                    &[JValue::Object(&title)],
                )?
                .z(),
        }
    });
    if !matches!(launched, Ok(true)) {
        let _ = PENDING.lock().unwrap().take();
        return None;
    }
    rx.await.ok()
}

pub async fn verify(_app: &tauri::AppHandle, reason: &str) -> VerifyOutcome {
    match prompt("authenticate", reason, None).await {
        None => VerifyOutcome::Unavailable,
        Some((code, _)) => map_code(code),
    }
}

impl Sealer for PlatformSealer {
    fn available(&self) -> bool {
        with_env("biometric sealAvailable", |env, ctx| {
            let cls = load_class(env, CLASS)?;
            env.call_static_method(
                &cls,
                "sealAvailable",
                "(Landroid/content/Context;)Z",
                &[JValue::Object(ctx)],
            )?
            .z()
        })
        .unwrap_or(false)
    }

    async fn seal(&self, reason: &str, plaintext: &[u8]) -> SealOutcome {
        match prompt("seal", reason, Some(plaintext)).await {
            None => SealOutcome::Unavailable,
            Some((code, data)) => match map_seal(code, data) {
                SealOutcome::Ok(body) => SealOutcome::Ok(seal::frame(seal::ANDROID, &body)),
                other => other,
            },
        }
    }

    async fn unseal(&self, reason: &str, blob: &[u8]) -> SealOutcome {
        let Some(body) = seal::unframe(seal::ANDROID, blob) else {
            return SealOutcome::Invalidated;
        };
        match prompt("unseal", reason, Some(body)).await {
            None => SealOutcome::Unavailable,
            Some((code, data)) => map_seal(code, data),
        }
    }
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
    env: JNIEnv<'local>,
    _class: JClass<'local>,
    code: jni::sys::jint,
    data: JByteArray<'local>,
) {
    let bytes = if data.is_null() {
        None
    } else {
        env.convert_byte_array(&data).ok()
    };
    if let Some(tx) = PENDING.lock().unwrap().take() {
        let _ = tx.send((code, bytes));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seal_codes_map_to_outcomes() {
        assert_eq!(map_seal(4, None), SealOutcome::Invalidated);
        assert_eq!(map_seal(0, Some(vec![1])), SealOutcome::Ok(vec![1]));
        assert_eq!(map_seal(0, None), SealOutcome::Failed);
        assert_eq!(map_seal(1, None), SealOutcome::Cancelled);
    }
}
