use sysinfo::{ProcessesToUpdate, System, Users};

use super::{now_ms, ProcessEntry, ProcessSnapshot};

pub struct LocalProcesses {
    sys: System,
    users: Users,
}

impl LocalProcesses {
    pub fn new() -> Self {
        let mut sys = System::new();
        sys.refresh_processes(ProcessesToUpdate::All, true);
        let users = Users::new_with_refreshed_list();
        Self { sys, users }
    }

    pub fn snapshot(&mut self) -> ProcessSnapshot {
        self.sys.refresh_processes(ProcessesToUpdate::All, true);

        let mut entries: Vec<ProcessEntry> = self
            .sys
            .processes()
            .values()
            .map(|p| {
                let user = p
                    .user_id()
                    .and_then(|uid| self.users.get_user_by_id(uid))
                    .map(|u| u.name().to_string())
                    .unwrap_or_default();

                let command = p
                    .cmd()
                    .iter()
                    .map(|s| s.to_string_lossy())
                    .collect::<Vec<_>>()
                    .join(" ");

                ProcessEntry {
                    pid: p.pid().as_u32(),
                    ppid: p.parent().map(|pid| pid.as_u32()).unwrap_or(0),
                    name: p.name().to_string_lossy().to_string(),
                    command,
                    user,
                    cpu_percent: p.cpu_usage(),
                    mem_kb: p.memory() / 1024,
                    status: process_status_str(p.status()),
                }
            })
            .collect();

        entries.sort_by(|a, b| {
            b.cpu_percent
                .partial_cmp(&a.cpu_percent)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        ProcessSnapshot {
            ts: now_ms(),
            entries,
        }
    }

    /// Send SIGTERM (or SIGKILL if force=true) to a local process by PID.
    pub fn kill(&self, pid: u32, force: bool) -> Result<(), String> {
        use sysinfo::Signal;

        let pid = sysinfo::Pid::from_u32(pid);
        let process = self
            .sys
            .process(pid)
            .ok_or_else(|| format!("Process {pid} not found"))?;

        let signal = if force { Signal::Kill } else { Signal::Term };
        process
            .kill_with(signal)
            .ok_or_else(|| format!("Signal {signal:?} not supported on this platform"))?;

        Ok(())
    }
}

fn process_status_str(status: sysinfo::ProcessStatus) -> String {
    match status {
        sysinfo::ProcessStatus::Run => "running".to_string(),
        sysinfo::ProcessStatus::Sleep => "sleeping".to_string(),
        sysinfo::ProcessStatus::Idle => "idle".to_string(),
        sysinfo::ProcessStatus::Zombie => "zombie".to_string(),
        sysinfo::ProcessStatus::Stop => "stopped".to_string(),
        sysinfo::ProcessStatus::Dead => "dead".to_string(),
        other => format!("{other:?}").to_lowercase(),
    }
}
