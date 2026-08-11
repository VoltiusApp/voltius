pub mod local;
pub mod remote;
pub mod stream;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProcessEntry {
    pub pid: u32,
    pub ppid: u32,
    pub name: String,
    pub command: String,
    pub user: String,
    pub cpu_percent: f32,
    pub mem_kb: u64,
    pub status: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProcessSnapshot {
    pub ts: u64,
    pub entries: Vec<ProcessEntry>,
}

pub use crate::clock::now_ms;
