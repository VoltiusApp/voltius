pub mod flatpak;
pub mod session;

/// A shell as found on disk, and the file it resolves to once symlinks are followed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellPath {
    pub path: String,
    pub target: String,
}

impl ShellPath {
    pub fn new(path: &str, target: &str) -> Self {
        let target = if target.is_empty() { path } else { target };
        Self {
            path: path.to_string(),
            target: target.to_string(),
        }
    }
}
