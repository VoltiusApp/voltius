use crate::android_ctx::with_env;
use jni::objects::GlobalRef;
use std::sync::{Mutex, MutexGuard};

static MULTICAST_LOCK: Mutex<Option<GlobalRef>> = Mutex::new(None);

fn held() -> MutexGuard<'static, Option<GlobalRef>> {
    MULTICAST_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn acquire_multicast_lock() -> Result<(), String> {
    let mut held = held();
    if held.is_some() {
        return Ok(());
    }
    let lock = with_env("multicast lock acquire", |env, ctx| {
        let service = env.new_string("wifi")?;
        let wifi = env
            .call_method(
                ctx,
                "getSystemService",
                "(Ljava/lang/String;)Ljava/lang/Object;",
                &[(&service).into()],
            )?
            .l()?;
        let tag = env.new_string("voltius-lan-sync")?;
        let lock = env
            .call_method(
                &wifi,
                "createMulticastLock",
                "(Ljava/lang/String;)Landroid/net/wifi/WifiManager$MulticastLock;",
                &[(&tag).into()],
            )?
            .l()?;
        env.call_method(&lock, "setReferenceCounted", "(Z)V", &[false.into()])?;
        env.call_method(&lock, "acquire", "()V", &[])?;
        env.new_global_ref(lock)
    })?;
    *held = Some(lock);
    Ok(())
}

pub fn release_multicast_lock() {
    let Some(lock) = held().take() else {
        return;
    };
    let released = with_env("multicast lock release", |env, _ctx| {
        env.call_method(lock.as_obj(), "release", "()V", &[])
            .map(drop)
    });
    if let Err(e) = released {
        log::warn!("lan-sync: {e}");
    }
}
