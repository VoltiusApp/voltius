use std::error::Error as StdErr;
use std::path::PathBuf;
use std::{fmt, io};

/// In this crate's `Result`s.
#[derive(Debug)]
#[non_exhaustive]
pub enum Error {
    /// TOML parsing errors
    Parse(Box<toml::de::Error>),
    /// Filesystem access errors
    Io(io::Error),
    /// Manifest uses workspace inheritance, and the workspace failed to load
    Workspace(Box<(Error, Option<PathBuf>)>),
    /// Manifest uses workspace inheritance, and the data hasn't been inherited yet
    InheritedUnknownValue,
    /// Manifest uses workspace inheritance, but the root workspace is missing data
    WorkspaceIntegrity(String),
    /// ???
    Other(&'static str),
}

impl StdErr for Error {
    fn source(&self) -> Option<&(dyn StdErr + 'static)> {
        match self {
            Self::Parse(err) => Some(err),
            Self::Io(err) => Some(err),
            Self::Workspace(err) => Some(&err.0),
            Self::Other(_) | Self::InheritedUnknownValue | Self::WorkspaceIntegrity(_) => None,
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Parse(err) => err.fmt(f),
            Self::Io(err) => err.fmt(f),
            Self::Other(msg) => f.write_str(msg),
            Self::WorkspaceIntegrity(s) => f.write_str(s),
            Self::Workspace(err_path) => {
                f.write_str("can't load root workspace")?;
                if let Some(path) = &err_path.1 {
                    write!(f, " at {}", path.display())?;
                }
                f.write_str(": ")?;
                err_path.0.fmt(f)
            },
            Self::InheritedUnknownValue => f.write_str("value from workspace hasn't been set"),
        }
    }
}

impl Clone for Error {
    fn clone(&self) -> Self {
        match self {
            Self::Parse(err) => Self::Parse(err.clone()),
            Self::Io(err) => Self::Io(io::Error::new(err.kind(), err.to_string())),
            Self::Other(msg) => Self::Other(msg),
            Self::WorkspaceIntegrity(msg) => Self::WorkspaceIntegrity(msg.clone()),
            Self::Workspace(e) => Self::Workspace(e.clone()),
            Self::InheritedUnknownValue => Self::InheritedUnknownValue,
        }
    }
}

impl From<toml::de::Error> for Error {
    fn from(o: toml::de::Error) -> Self {
        Self::Parse(Box::new(o))
    }
}

impl From<io::Error> for Error {
    fn from(o: io::Error) -> Self {
        Self::Io(o)
    }
}
