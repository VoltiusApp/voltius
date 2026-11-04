use crate::policy::{load_machine, LoadedPolicy};

#[tauri::command]
pub fn policy_load() -> LoadedPolicy {
    load_machine()
}
