pub mod link;
#[cfg_attr(not(desktop), allow(dead_code))]
pub mod policy;
#[cfg(desktop)]
pub mod roots;
#[cfg(desktop)]
pub mod server;
#[cfg(desktop)]
pub mod service;

#[cfg(desktop)]
type Slot = Option<std::sync::Arc<service::FileService>>;

#[cfg(desktop)]
#[derive(Default)]
pub struct DeviceFilesState {
    pub(crate) service: tokio::sync::Mutex<Slot>,
}

#[cfg(desktop)]
pub(crate) fn stop_running(slot: &mut Slot) {
    if let Some(svc) = slot.take() {
        svc.stop();
    }
}

#[cfg(desktop)]
pub(crate) fn for_account<'a>(
    slot: &'a Slot,
    account: &str,
) -> Option<&'a std::sync::Arc<service::FileService>> {
    slot.as_ref().filter(|s| s.account() == account)
}
