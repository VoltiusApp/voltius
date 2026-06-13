//! Android JavaVM + application `Context`, captured once at startup.
//!
//! tao 0.35 stores the Android context in its own statics and no longer populates the
//! `ndk_context` global, so `ndk_context::android_context()` panics here — and a panic
//! across the `Java_..._ipc` JNI boundary (no-unwind) aborts the whole process (SIGABRT).
//! Instead `VoltiusKeychain.nativeInit(context)` (called from `MainActivity.onCreate`,
//! after the native lib is loaded) hands us the Context, from which we derive the VM.
//!
//! Any JNI consumer (keychain store, ANDROID_ID machine fingerprint) goes through
//! [`with_env`] rather than touching `ndk_context`.

use std::sync::OnceLock;

use jni::objects::{GlobalRef, JClass, JObject};
use jni::{JNIEnv, JavaVM};

struct AndroidCtx {
    vm: JavaVM,
    context: GlobalRef,
}

// JavaVM and GlobalRef are both Send + Sync, so this is too.
static CTX: OnceLock<AndroidCtx> = OnceLock::new();

/// JNI entry point for `VoltiusKeychain.nativeInit(context)`. Idempotent; stores the VM and
/// a global ref to the application Context. Named for the Kotlin class that declares the
/// `external fun`, but the captured context serves all native consumers.
#[no_mangle]
pub extern "system" fn Java_com_voltius_app_VoltiusKeychain_nativeInit<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    context: JObject<'local>,
) {
    let vm = match env.get_java_vm() {
        Ok(v) => v,
        Err(_) => return,
    };
    let global = match env.new_global_ref(&context) {
        Ok(g) => g,
        Err(_) => return,
    };
    let _ = CTX.set(AndroidCtx { vm, context: global });
}

/// Run `f` with an attached `JNIEnv` and the application `Context`. Returns `Err` (never
/// panics) if `nativeInit` hasn't run or the attach fails. On a Java exception, describes it
/// to logcat and clears it so the VM stays usable.
pub fn with_env<T>(
    op: &str,
    f: impl FnOnce(&mut JNIEnv, &JObject) -> Result<T, jni::errors::Error>,
) -> Result<T, String> {
    let ctx = CTX
        .get()
        .ok_or_else(|| format!("{op}: android context not initialized (nativeInit not called)"))?;
    let mut env = ctx
        .vm
        .attach_current_thread()
        .map_err(|e| format!("{op}: attach: {e}"))?;
    f(&mut env, ctx.context.as_obj()).map_err(|e| {
        let _ = env.exception_describe();
        let _ = env.exception_clear();
        format!("{op}: {e}")
    })
}
