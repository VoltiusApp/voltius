#![allow(dead_code)]

use std::sync::OnceLock;

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct TmuxAsset {
    pub arch: String,
    pub url: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TmuxPin {
    pub version: String,
    pub assets: Vec<TmuxAsset>,
}

pub fn pin() -> &'static TmuxPin {
    static PIN: OnceLock<TmuxPin> = OnceLock::new();
    PIN.get_or_init(|| {
        serde_json::from_str(include_str!("../tmux-pin.json")).expect("tmux-pin.json is valid")
    })
}

pub fn asset_for(uname_s: &str, uname_m: &str) -> Option<&'static TmuxAsset> {
    if uname_s != "Linux" {
        return None;
    }
    let arch = match uname_m {
        "x86_64" | "amd64" => "x86_64",
        "aarch64" | "arm64" => "aarch64",
        _ => return None,
    };
    pin().assets.iter().find(|a| a.arch == arch)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pin_parses_with_both_arches() {
        let p = pin();
        assert_eq!(p.assets.len(), 2);
        assert!(!p.version.is_empty());
        for a in &p.assets {
            assert_eq!(a.sha256.len(), 64);
            assert!(a
                .sha256
                .chars()
                .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)));
        }
    }

    #[test]
    fn asset_for_maps_aliases() {
        assert_eq!(asset_for("Linux", "amd64").unwrap().arch, "x86_64");
        assert_eq!(asset_for("Linux", "x86_64").unwrap().arch, "x86_64");
        assert_eq!(asset_for("Linux", "arm64").unwrap().arch, "aarch64");
        assert_eq!(asset_for("Linux", "aarch64").unwrap().arch, "aarch64");
    }

    #[test]
    fn asset_for_rejects_unsupported() {
        assert!(asset_for("Linux", "armv7l").is_none());
        assert!(asset_for("Darwin", "arm64").is_none());
        assert!(asset_for("FreeBSD", "amd64").is_none());
    }
}
