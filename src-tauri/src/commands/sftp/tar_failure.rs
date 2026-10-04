#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum End {
    Local,
    Remote,
    Source,
    Destination,
}

impl End {
    fn label(self) -> &'static str {
        match self {
            End::Local => "this device",
            End::Remote => "the remote host",
            End::Source => "the source host",
            End::Destination => "the destination host",
        }
    }
}

const NO_SPACE: &[&str] = &[
    "no space left on device",
    "not enough space on the disk",
    "disk quota exceeded",
];
const NO_PERMISSION: &[&str] = &["permission denied", "access is denied"];
const TAIL: usize = 4096;

pub fn explain(end: End, dir: &str, raw: &str) -> String {
    let raw = raw.trim();
    let lower = raw.to_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|n| lower.contains(n));
    if has(NO_SPACE) {
        if end == End::Local && cfg!(target_os = "android") {
            return "Not enough space in app storage".into();
        }
        return format!("Not enough space in {dir} on {}", end.label());
    }
    if has(NO_PERMISSION) {
        return format!("Permission denied in {dir} on {}", end.label());
    }
    if raw.is_empty() {
        return format!("tar failed on {}", end.label());
    }
    let start = (raw.len().saturating_sub(TAIL)..=raw.len())
        .find(|&i| raw.is_char_boundary(i))
        .unwrap_or(raw.len());
    format!("tar failed on {}: {}", end.label(), &raw[start..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_disks_are_named_in_every_tar_dialect() {
        for raw in [
            "tar: big.bin: Cannot write: No space left on device\ntar: Exiting with failure status",
            "tar: write error: No space left on device",
            "big.bin: Write failed: No space left on device",
            "tar: big.bin: Cannot write: Disk quota exceeded",
        ] {
            assert_eq!(
                explain(End::Remote, "/srv", raw),
                "Not enough space in /srv on the remote host"
            );
        }
        assert_eq!(
            explain(
                End::Destination,
                "/C:/d",
                "There is not enough space on the disk. (os error 112)"
            ),
            "Not enough space in /C:/d on the destination host"
        );
    }

    #[test]
    fn a_full_local_disk_names_this_device_or_app_storage() {
        let msg = explain(
            End::Local,
            "/home/me/dl",
            "No space left on device (os error 28)",
        );
        if cfg!(target_os = "android") {
            assert_eq!(msg, "Not enough space in app storage");
        } else {
            assert_eq!(msg, "Not enough space in /home/me/dl on this device");
        }
    }

    #[test]
    fn permission_problems_name_the_folder_and_end() {
        assert_eq!(
            explain(
                End::Source,
                "/srv",
                "tar: x: Cannot open: Permission denied"
            ),
            "Permission denied in /srv on the source host"
        );
        assert_eq!(
            explain(End::Remote, "/C:/x", "Access is denied."),
            "Permission denied in /C:/x on the remote host"
        );
    }

    #[test]
    fn anything_else_keeps_the_tail_of_what_tar_said() {
        assert_eq!(
            explain(End::Source, "/srv", "  tar: child returned status 2\n"),
            "tar failed on the source host: tar: child returned status 2"
        );
        assert_eq!(
            explain(End::Remote, "/srv", ""),
            "tar failed on the remote host"
        );
        let long = format!("{}é{}", "x".repeat(5000), "y".repeat(10));
        let msg = explain(End::Remote, "/srv", &long);
        assert!(msg.ends_with("yyyyyyyyyy"));
        assert!(msg.len() <= "tar failed on the remote host: ".len() + 4096);
    }
}
