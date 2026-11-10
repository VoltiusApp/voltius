use super::managed_config::load_managed;
use super::LoadedPolicy;
use block2::RcBlock;
use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::AnyObject;
use objc2::Message;
use objc2_foundation::{
    NSDictionary, NSNotification, NSNotificationCenter, NSNumber, NSOperationQueue, NSString,
    NSUserDefaults, NSUserDefaultsDidChangeNotification,
};
use serde_json::Value;
use std::collections::BTreeMap;
use std::ffi::CStr;
use std::ptr::NonNull;
use std::sync::{Mutex, Once};
use tauri::{AppHandle, Manager};

const CONFIG_KEY: &str = "com.apple.configuration.managed";
const FEEDBACK_KEY: &str = "com.apple.feedback.managed";

static LAST: Mutex<Option<String>> = Mutex::new(None);
static WATCH: Once = Once::new();

fn plist_value(obj: &AnyObject) -> Value {
    if let Some(s) = obj.downcast_ref::<NSString>() {
        return Value::String(s.to_string());
    }
    let Some(n) = obj.downcast_ref::<NSNumber>() else {
        return Value::Null;
    };
    if unsafe { CStr::from_ptr(n.objCType().as_ptr()) }.to_bytes() == b"c" {
        Value::Bool(n.boolValue())
    } else {
        serde_json::Number::from_f64(n.doubleValue()).map_or(Value::Null, Value::Number)
    }
}

fn read() -> Value {
    let dict =
        NSUserDefaults::standardUserDefaults().dictionaryForKey(&NSString::from_str(CONFIG_KEY));
    let (keys, values) = dict.map(|d| d.to_vecs()).unwrap_or_default();
    let entries: BTreeMap<String, Value> = keys
        .iter()
        .zip(&values)
        .filter_map(|(key, value)| {
            let key: &AnyObject = key;
            Some((
                key.downcast_ref::<NSString>()?.to_string(),
                plist_value(value),
            ))
        })
        .collect();
    Value::Object(entries.into_iter().collect())
}

fn dict<V: Message>(
    entries: impl Iterator<Item = (String, Retained<V>)>,
) -> Retained<NSDictionary<NSString, V>> {
    let (keys, values): (Vec<_>, Vec<_>) = entries
        .map(|(key, value)| (NSString::from_str(&key), value))
        .unzip();
    let keys: Vec<&NSString> = keys.iter().map(|key| &**key).collect();
    NSDictionary::from_retained_objects(&keys, &values)
}

fn report(json: &str) -> Result<(), String> {
    let entries: Vec<BTreeMap<String, String>> =
        serde_json::from_str(json).map_err(|e| format!("managed configuration report: {e}"))?;
    let feedback = dict(entries.into_iter().map(|mut fields| {
        let key = fields.remove("key").unwrap_or_default();
        let fields = fields.into_iter().map(|(k, v)| (k, NSString::from_str(&v)));
        (key, dict(fields))
    }));
    let value: &AnyObject = &feedback;
    unsafe {
        NSUserDefaults::standardUserDefaults()
            .setObject_forKey(Some(value), &NSString::from_str(FEEDBACK_KEY));
    }
    Ok(())
}

pub fn load() -> LoadedPolicy {
    autoreleasepool(|_| load_managed(Ok(read()), &LAST, report))
}

pub fn watch(app: AppHandle) {
    WATCH.call_once(move || {
        // Our own feedback write also posts this notification: only a changed config reloads.
        let seen = Mutex::new(read().to_string());
        let block = RcBlock::new(move |_: NonNull<NSNotification>| {
            let json = read().to_string();
            {
                let mut seen = seen.lock().unwrap_or_else(|e| e.into_inner());
                if *seen == json {
                    return;
                }
                *seen = json;
            }
            if let Some(window) = app.get_webview_window("main") {
                if let Err(e) =
                    window.eval("window.dispatchEvent(new Event('voltius:policy-changed'))")
                {
                    log::warn!("managed configuration change not delivered: {e}");
                }
            }
        });
        let token = unsafe {
            NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(
                Some(NSUserDefaultsDidChangeNotification),
                None,
                Some(&NSOperationQueue::mainQueue()),
                &block,
            )
        };
        std::mem::forget(token);
    });
}
