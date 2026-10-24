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

use jni::objects::{GlobalRef, JClass, JObject, JString};
use jni::{JNIEnv, JavaVM};

struct AndroidCtx {
    vm: JavaVM,
    context: GlobalRef,
    class_loader: GlobalRef,
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
    // Capture the app class loader: native (async-command) threads attach with only the
    // system class loader, whose FindClass can't see app dex classes (see `load_class`).
    let class_loader = match env
        .call_method(&context, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])
        .and_then(|v| v.l())
        .and_then(|o| env.new_global_ref(&o))
    {
        Ok(g) => g,
        Err(_) => return,
    };
    let _ = CTX.set(AndroidCtx {
        vm,
        context: global,
        class_loader,
    });
}

/// Run `f` with an attached `JNIEnv` and the application `Context`. Returns `Err` (never
/// panics) if `nativeInit` hasn't run or the attach fails. On a Java exception, describes it
/// to logcat, clears it so the VM stays usable, and names it in the error.
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
    let result = f(&mut env, ctx.context.as_obj());
    result.map_err(|e| match take_java_exception(&mut env) {
        Some(thrown) => format!("{op}: {thrown}"),
        None => format!("{op}: {e}"),
    })
}

/// Clears the pending Java exception and renders it with its causes.
fn take_java_exception(env: &mut JNIEnv) -> Option<String> {
    if !env.exception_check().unwrap_or(false) {
        return None;
    }
    let thrown = env.exception_occurred().ok();
    let _ = env.exception_describe();
    let _ = env.exception_clear();
    let mut current = JObject::from(thrown?);
    let mut parts = Vec::new();
    for _ in 0..4 {
        match throwable_text(env, &current) {
            Some(text) => parts.push(text),
            None => break,
        }
        let cause = env
            .call_method(&current, "getCause", "()Ljava/lang/Throwable;", &[])
            .and_then(|v| v.l());
        match cause {
            Ok(next) if !next.is_null() && !env.is_same_object(&next, &current).unwrap_or(true) => {
                current = next;
            }
            _ => break,
        }
    }
    let _ = env.exception_clear();
    (!parts.is_empty()).then(|| parts.join(", caused by: "))
}

fn throwable_text(env: &mut JNIEnv, thrown: &JObject) -> Option<String> {
    let text = env
        .call_method(thrown, "toString", "()Ljava/lang/String;", &[])
        .and_then(|v| v.l())
        .ok()?;
    let text: String = env.get_string(&JString::from(text)).ok()?.into();
    Some(text.split_whitespace().collect::<Vec<_>>().join(" "))
}

/// Resolve an app class by dotted binary name (e.g. `com.voltius.app.VoltiusDownloads`) via
/// the application class loader captured at `nativeInit`. Use this instead of
/// `env.find_class`/`call_static_method(<str>, ..)` from threads Rust attaches itself (async
/// Tauri commands run on tokio workers), where the default `FindClass` only sees the system
/// class loader and raises `ClassNotFoundException` for app classes.
pub fn load_class<'a>(
    env: &mut JNIEnv<'a>,
    dotted_name: &str,
) -> Result<JClass<'a>, jni::errors::Error> {
    let ctx = CTX.get().ok_or(jni::errors::Error::JavaException)?;
    let name = env.new_string(dotted_name)?;
    let cls = env
        .call_method(
            ctx.class_loader.as_obj(),
            "loadClass",
            "(Ljava/lang/String;)Ljava/lang/Class;",
            &[(&name).into()],
        )?
        .l()?;
    Ok(JClass::from(cls))
}

/// Call a static `(Z)V` method on an app class (dotted name), resolved via [`load_class`]. Logs a
/// warning instead of failing: these are fire-and-forget UI nudges from Tauri commands.
pub fn call_static_bool(class: &str, method: &str, value: bool) {
    let args = [jni::objects::JValue::Bool(value.into())];
    let res = with_env(method, |env, _ctx| {
        let cls = load_class(env, class)?;
        env.call_static_method(&cls, method, "(Z)V", &args)?.v()
    });
    if let Err(e) = res {
        log::warn!("{class}.{method}: {e}");
    }
}
