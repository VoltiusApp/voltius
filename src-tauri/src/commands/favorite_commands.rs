use crate::storage::config::{load_favorite_commands, save_favorite_commands};
use serde_json::Value;
use std::sync::Mutex;

fn id_of(item: &Value) -> Option<&str> {
    item.get("id").and_then(Value::as_str)
}

fn upsert(items: &mut Vec<Value>, entry: Value) -> Result<(), String> {
    let id = id_of(&entry)
        .ok_or("favorite command has no id")?
        .to_string();
    match items.iter_mut().find(|it| id_of(it) == Some(id.as_str())) {
        Some(slot) => *slot = entry,
        None => items.push(entry),
    }
    Ok(())
}

#[tauri::command]
pub fn favorite_command_list() -> Result<Vec<Value>, String> {
    load_favorite_commands()
}

/// Deletion is a `put` of the tombstoned record, so it keeps propagating through sync.
#[tauri::command]
pub fn favorite_command_put(entry: Value) -> Result<(), String> {
    static WRITE: Mutex<()> = Mutex::new(());
    let _guard = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    let mut items = load_favorite_commands()?;
    upsert(&mut items, entry)?;
    save_favorite_commands(&items)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn upsert_replaces_the_record_with_the_same_id_and_appends_new_ones() {
        let mut items = vec![
            json!({"id": "a", "command": "ls"}),
            json!({"id": "b", "command": "pwd"}),
        ];
        upsert(&mut items, json!({"id": "a", "command": "ls -la"})).unwrap();
        upsert(&mut items, json!({"id": "c", "command": "top"})).unwrap();
        assert_eq!(
            items,
            vec![
                json!({"id": "a", "command": "ls -la"}),
                json!({"id": "b", "command": "pwd"}),
                json!({"id": "c", "command": "top"}),
            ]
        );
    }

    #[test]
    fn upsert_refuses_a_record_without_an_id() {
        let mut items = vec![];
        assert!(upsert(&mut items, json!({"command": "ls"})).is_err());
        assert!(items.is_empty());
    }
}
