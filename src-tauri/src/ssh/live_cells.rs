//! Keyed cells whose contents can be swapped without invalidating the handles
//! already handed out.
//!
//! Long-lived consumers (SFTP panels, port forwards) hold on to a session's SSH
//! handle for minutes or hours. A reconnect replaces that handle under the same
//! session id, so consumers holding a plain snapshot end up pinned to a dead
//! connection. Handing them a `Cell` instead means the swap reaches them.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tokio::sync::Mutex;

pub type Cell<T> = Arc<RwLock<T>>;

pub struct LiveCells<T> {
    cells: Mutex<HashMap<String, Cell<T>>>,
}

impl<T> LiveCells<T> {
    pub fn new() -> Self {
        Self {
            cells: Mutex::new(HashMap::new()),
        }
    }

    /// Store `value` under `key`, updating the existing cell in place when the
    /// key is already known so prior readers see the new value.
    pub async fn set(&self, key: &str, value: T) -> Cell<T> {
        let mut cells = self.cells.lock().await;
        match cells.get(key) {
            Some(cell) => {
                *cell.write().unwrap() = value;
                Arc::clone(cell)
            }
            None => {
                let cell = own_cell(value);
                cells.insert(key.to_string(), Arc::clone(&cell));
                cell
            }
        }
    }

    pub async fn get(&self, key: &str) -> Option<Cell<T>> {
        self.cells.lock().await.get(key).map(Arc::clone)
    }
}

impl<T> Default for LiveCells<T> {
    fn default() -> Self {
        Self::new()
    }
}

/// A standalone cell, for a value nothing else will ever swap (an SSH handle
/// owned by one SFTP connection rather than by a terminal session).
pub fn own_cell<T>(value: T) -> Cell<T> {
    Arc::new(RwLock::new(value))
}

/// Read a cell's current value.
pub fn read_cell<T: Clone>(cell: &Cell<T>) -> T {
    cell.read().unwrap().clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn set_then_get_returns_the_value() {
        let cells: LiveCells<u32> = LiveCells::new();
        cells.set("a", 1).await;
        assert_eq!(read_cell(&cells.get("a").await.unwrap()), 1);
    }

    #[tokio::test]
    async fn resetting_a_key_updates_cells_handed_out_earlier() {
        let cells: LiveCells<u32> = LiveCells::new();
        let held = cells.set("a", 1).await;
        cells.set("a", 2).await;
        assert_eq!(read_cell(&held), 2);
    }

    #[tokio::test]
    async fn distinct_keys_get_distinct_cells() {
        let cells: LiveCells<u32> = LiveCells::new();
        let a = cells.set("a", 1).await;
        let b = cells.set("b", 1).await;
        assert!(!Arc::ptr_eq(&a, &b));
    }
}
