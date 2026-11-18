use crate::policy::{check_team_doc, load_machine, Issue, LoadedPolicy, PolicyDoc};
use serde::Serialize;

#[tauri::command]
pub fn policy_load() -> LoadedPolicy {
    load_machine()
}

#[derive(Serialize)]
pub struct CheckedPolicy {
    doc: PolicyDoc,
    issues: Vec<Issue>,
}

#[tauri::command]
pub fn policy_check_team_doc(text: String) -> CheckedPolicy {
    let (doc, issues) = check_team_doc(&text);
    CheckedPolicy { doc, issues }
}
