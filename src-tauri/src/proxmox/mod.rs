// Proxmox is remote-only: `pct` exists solely on Proxmox VE hosts, which are
// always reached over SSH. There is no local backend; the command layer rejects
// non-SSH sessions with a clear error instead of dispatching anywhere local.
pub mod remote;
pub mod types;
