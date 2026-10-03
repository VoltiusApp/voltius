// "02:" = AES-256-CBC(SHA-256(passphrase), IV 0); "03:" = 16-byte salt, bcrypt_pbkdf(16 rounds) → key+IV.
// Plaintext: u32 LE len || UTF-8 || SHA-256 || pad. Global "Config Passphrase" encrypts the passphrase itself.

use crate::commands::crypto::decode_hex;
use serde::Serialize;
use sha2::{Digest, Sha256, Sha512};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const BHASH_SEED: &[u8; 32] = b"OxychromaticBlowfishSwatDynamite";
const KDF_ROUNDS: u32 = 16;
const MAX_KEY_FILE: u64 = 64 * 1024;
const IDENTITY_OPTION: &str = "S:\"Identity Filename V2\"=";

fn bhash(sha2_pass: &[u8], sha2_salt: &[u8]) -> [u8; 32] {
    let mut bf = blowfish::Blowfish::bc_init_state();
    bf.salted_expand_key(sha2_salt, sha2_pass);
    for _ in 0..64 {
        bf.bc_expand_key(sha2_salt);
        bf.bc_expand_key(sha2_pass);
    }
    let mut cdata: [u32; 8] = std::array::from_fn(|i| {
        u32::from_be_bytes([
            BHASH_SEED[i * 4],
            BHASH_SEED[i * 4 + 1],
            BHASH_SEED[i * 4 + 2],
            BHASH_SEED[i * 4 + 3],
        ])
    });
    for _ in 0..64 {
        for pair in cdata.chunks_exact_mut(2) {
            let [l, r] = bf.bc_encrypt([pair[0], pair[1]]);
            pair[0] = l;
            pair[1] = r;
        }
    }
    let mut out = [0u8; 32];
    for (chunk, word) in out.chunks_exact_mut(4).zip(cdata) {
        chunk.copy_from_slice(&word.to_le_bytes());
    }
    out
}

// The bcrypt-pbkdf crate rejects an empty passphrase, which is what SecureCRT uses by default.
fn bcrypt_pbkdf(passphrase: &[u8], salt: &[u8], rounds: u32, out: &mut [u8]) {
    let sha2_pass = Sha512::digest(passphrase);
    let stride = out.len().div_ceil(32);
    for block in 0..stride {
        let count = u32::try_from(block + 1).unwrap_or(u32::MAX);
        let first_salt = Sha512::new()
            .chain_update(salt)
            .chain_update(count.to_be_bytes())
            .finalize();
        let mut tmp = bhash(&sha2_pass, &first_salt);
        let mut acc = tmp;
        for _ in 1..rounds {
            tmp = bhash(&sha2_pass, &Sha512::digest(tmp));
            acc.iter_mut().zip(tmp).for_each(|(a, t)| *a ^= t);
        }
        for (i, byte) in acc.iter().enumerate() {
            if let Some(slot) = out.get_mut(i * stride + block) {
                *slot = *byte;
            }
        }
    }
}

fn aes_cbc_decrypt(key: &[u8], iv: &[u8], data: &[u8]) -> Option<Vec<u8>> {
    use aes::cipher::{block_padding::NoPadding, BlockModeDecrypt, KeyIvInit};
    if data.is_empty() || !data.len().is_multiple_of(16) {
        return None;
    }
    let mut buf = data.to_vec();
    cbc::Decryptor::<aes::Aes256>::new_from_slices(key, iv)
        .ok()?
        .decrypt_padded::<NoPadding>(&mut buf)
        .ok()?;
    Some(buf)
}

fn unpack(plain: &[u8]) -> Option<String> {
    let len = usize::try_from(u32::from_le_bytes(plain.get(..4)?.try_into().ok()?)).ok()?;
    let text_end = len.checked_add(4)?;
    let text = plain.get(4..text_end)?;
    let digest = plain.get(text_end..text_end.checked_add(32)?)?;
    if Sha256::digest(text).as_slice() != digest {
        return None;
    }
    String::from_utf8(text.to_vec()).ok()
}

struct Decryptor<'a> {
    passphrase: &'a str,
    kdf_by_salt: HashMap<Vec<u8>, [u8; 48]>,
}

impl<'a> Decryptor<'a> {
    fn new(passphrase: &'a str) -> Self {
        Self {
            passphrase,
            kdf_by_salt: HashMap::new(),
        }
    }

    fn decrypt(&mut self, value: &str) -> Option<String> {
        let (prefix, hex) = value.split_once(':')?;
        let bytes = decode_hex(hex.trim()).ok()?;
        match prefix {
            "02" => {
                let key = Sha256::digest(self.passphrase.as_bytes());
                unpack(&aes_cbc_decrypt(&key, &[0u8; 16], &bytes)?)
            }
            "03" => {
                let (salt, body) = bytes.split_at_checked(16)?;
                let passphrase = self.passphrase.as_bytes();
                let kdf = self.kdf_by_salt.entry(salt.to_vec()).or_insert_with(|| {
                    let mut out = [0u8; 48];
                    bcrypt_pbkdf(passphrase, salt, KDF_ROUNDS, &mut out);
                    out
                });
                unpack(&aes_cbc_decrypt(&kdf[..32], &kdf[32..], body)?)
            }
            _ => None,
        }
    }
}

fn is_encrypted(value: &str) -> bool {
    value.starts_with("02:") || value.starts_with("03:")
}

#[derive(Serialize, Debug, PartialEq)]
pub struct SecureCrtDecrypted {
    pub passphrase_ok: bool,
    pub values: Vec<Option<String>>,
}

fn decrypt_all(values: &[String], verifier: Option<&str>, passphrase: &str) -> SecureCrtDecrypted {
    let mut decryptor = Decryptor::new(passphrase);
    let decrypted: Vec<Option<String>> = values.iter().map(|v| decryptor.decrypt(v)).collect();
    let passphrase_ok = match verifier.filter(|v| is_encrypted(v)) {
        Some(v) => decryptor.decrypt(v).as_deref() == Some(passphrase),
        None => decrypted.iter().any(Option::is_some) || !values.iter().any(|v| is_encrypted(v)),
    };
    SecureCrtDecrypted {
        passphrase_ok,
        values: if passphrase_ok {
            decrypted
        } else {
            vec![None; values.len()]
        },
    }
}

#[tauri::command]
pub async fn securecrt_decrypt(
    values: Vec<String>,
    verifier: Option<String>,
    passphrase: String,
) -> SecureCrtDecrypted {
    decrypt_all(&values, verifier.as_deref(), &passphrase)
}

// ─── Config folder ──────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct SecureCrtFile {
    pub path: String,
    pub text: String,
}

#[derive(Serialize)]
pub struct SecureCrtConfig {
    /// Session path relative to Sessions/, `/`-separated, without `.ini`.
    pub sessions: Vec<SecureCrtFile>,
    pub global: Option<String>,
    pub ssh2: Option<String>,
    /// Identity files referenced by the config, keyed by the path as written there.
    pub files: Vec<SecureCrtFile>,
}

fn decode_text(bytes: &[u8]) -> String {
    let body = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    String::from_utf8_lossy(body).into_owned()
}

fn read_text(path: &Path) -> Option<String> {
    std::fs::read(path).ok().map(|b| decode_text(&b))
}

fn collect_sessions(dir: &Path, prefix: &str, out: &mut Vec<SecureCrtFile>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        if path.is_dir() {
            collect_sessions(&path, &format!("{prefix}{name}/"), out);
        } else if let Some(stem) = name.strip_suffix(".ini") {
            if stem == "__FolderData__" {
                continue;
            }
            if let Some(text) = read_text(&path) {
                out.push(SecureCrtFile {
                    path: format!("{prefix}{stem}"),
                    text,
                });
            }
        }
    }
}

fn ssh_data_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".ssh"))
}

fn expand_vars(raw: &str, config_dir: &Path) -> PathBuf {
    let vars = [
        ("${VDS_CONFIG_PATH}", Some(config_dir.to_path_buf())),
        ("${VDS_SSH_DATA_PATH}", ssh_data_dir()),
        ("${VDS_USER_DATA_PATH}", dirs::home_dir()),
    ];
    for (var, dir) in vars {
        if let (Some(rest), Some(dir)) = (raw.strip_prefix(var), dir) {
            return dir.join(rest.trim_start_matches(['/', '\\']));
        }
    }
    PathBuf::from(raw)
}

fn identity_paths(texts: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut paths: Vec<String> = texts
        .into_iter()
        .flat_map(|t| {
            t.lines()
                .filter_map(|l| l.trim_end().strip_prefix(IDENTITY_OPTION))
                .filter(|p| !p.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .collect();
    paths.sort();
    paths.dedup();
    paths
}

fn read_key_file(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    (meta.is_file() && meta.len() <= MAX_KEY_FILE)
        .then(|| read_text(path))
        .flatten()
}

fn read_config(config_dir: &Path) -> Result<SecureCrtConfig, String> {
    let sessions_dir = config_dir.join("Sessions");
    if !sessions_dir.is_dir() {
        return Err(format!(
            "No SecureCRT Sessions folder in {}",
            config_dir.display()
        ));
    }
    let mut sessions = Vec::new();
    collect_sessions(&sessions_dir, "", &mut sessions);
    let ssh2 = read_text(&config_dir.join("SSH2.ini"));
    let referenced = identity_paths(sessions.iter().map(|s| s.text.clone()).chain(ssh2.clone()));
    let files = referenced
        .into_iter()
        .filter_map(|raw| {
            let text = read_key_file(&expand_vars(&raw, config_dir))?;
            Some(SecureCrtFile { path: raw, text })
        })
        .collect();
    Ok(SecureCrtConfig {
        sessions,
        global: read_text(&config_dir.join("Global.ini")),
        ssh2,
        files,
    })
}

/// A folder the user picked: the Config folder itself, or its Sessions subfolder.
fn config_dir_from_pick(dir: &Path) -> PathBuf {
    if !dir.join("Sessions").is_dir() && dir.file_name().is_some_and(|n| n == "Sessions") {
        if let Some(parent) = dir.parent() {
            return parent.to_path_buf();
        }
    }
    dir.to_path_buf()
}

#[cfg(target_os = "linux")]
fn custom_config_dir() -> Option<PathBuf> {
    let conf = read_text(&dirs::config_dir()?.join("VanDyke/SecureCRT.conf"))?;
    conf.lines()
        .find_map(|l| l.strip_prefix("Config%20Path="))
        .map(|p| PathBuf::from(p.trim()))
}

#[cfg(target_os = "windows")]
fn custom_config_dir() -> Option<PathBuf> {
    let key = windows_registry::CURRENT_USER
        .open(r"Software\VanDyke\SecureCRT")
        .ok()?;
    key.get_string("Config Path").ok().map(PathBuf::from)
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
fn custom_config_dir() -> Option<PathBuf> {
    None
}

fn default_config_dirs() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = custom_config_dir().into_iter().collect();
    #[cfg(target_os = "windows")]
    if let Ok(appdata) = std::env::var("APPDATA") {
        out.push(PathBuf::from(appdata).join(r"VanDyke\Config"));
    }
    #[cfg(target_os = "macos")]
    if let Some(home) = dirs::home_dir() {
        out.push(home.join("Library/Application Support/VanDyke/SecureCRT/Config"));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    if let Some(home) = dirs::home_dir() {
        out.push(home.join(".vandyke/SecureCRT/Config"));
    }
    out
}

#[tauri::command]
pub async fn securecrt_read_config(dir: Option<String>) -> Result<SecureCrtConfig, String> {
    if let Some(dir) = dir {
        return read_config(&config_dir_from_pick(Path::new(&dir)));
    }
    let candidates = default_config_dirs();
    candidates
        .iter()
        .find(|d| d.join("Sessions").is_dir())
        .map(|d| read_config(d))
        .unwrap_or_else(|| {
            Err(format!(
                "SecureCRT configuration not found. Looked in:\n  {}",
                candidates
                    .iter()
                    .map(|p| p.display().to_string())
                    .collect::<Vec<_>>()
                    .join("\n  ")
            ))
        })
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // Written by SecureCRT 9.7.3 (Linux): "Hunter2-é€" saved without a config passphrase,
    // and again in a config protected with "Pa55-ßeta".
    const NO_PASSPHRASE: &str = "03:2ec07f83619929d066a4dafe4792987355f5805ca7fd0ffda2588d2e99830eb1dddf6b24e3f25310a1706f08fed317631a7c87d1ceecf2ed59684f7e4548a92dce0439fe23722d599c287c7a3ebf2f2f";
    const NO_PASSPHRASE_VERIFIER: &str = "03:2ec07f83619929d066a4dafe47929873313fa32fec78d14cf727ea7811407a1d7d5bdcc41401e6d929c29807616385b2ccef866ab6e6e4e121e60a7bc4d86c02";
    const WITH_PASSPHRASE: &str = "03:23bd7d86f0448bea4baf1e8ef25fdb89b5b2dcd09d62ffcff0441a55b16ee2c8089d6d56d8fb68683711c169f608efdec1f941bc0986ab3386be8bc951ead561703bc35f853bd0f3fc82c2432fc3e551";
    const WITH_PASSPHRASE_VERIFIER: &str = "03:23bd7d86f0448bea4baf1e8ef25fdb89edd44951ba9dc970c8041f59ed11296a6b0c717f979552711291823ab6c232ea928f2cb0ed98bf672e597bf50a7613d98050ccadd804ed573179b015667b2178";
    // A hand-written "02:" session that SecureCRT 9.7.3 logged in with ("voltius").
    const V02: &str = "02:3cbfeadc5e36e1f715f4ddcb9ee903f50ca059f8801a54f17207b1f4cd579ae9b00777e2f168cbb39d7314856411c53db5fe5b117566800e8f30395b1c5d17a3";
    const PASSPHRASE: &str = "Pa55-ßeta";

    fn one(value: &str, passphrase: &str) -> Option<String> {
        Decryptor::new(passphrase).decrypt(value)
    }

    #[test]
    fn decrypts_03_without_a_config_passphrase() {
        assert_eq!(one(NO_PASSPHRASE, "").as_deref(), Some("Hunter2-é€"));
    }

    #[test]
    fn decrypts_03_with_the_config_passphrase() {
        assert_eq!(
            one(WITH_PASSPHRASE, PASSPHRASE).as_deref(),
            Some("Hunter2-é€")
        );
        assert_eq!(one(WITH_PASSPHRASE, ""), None);
    }

    #[test]
    fn decrypts_02() {
        assert_eq!(one(V02, "").as_deref(), Some("voltius"));
        assert_eq!(one(V02, "wrong"), None);
    }

    #[test]
    fn rejects_malformed_values() {
        for v in [
            "",
            "03:",
            "03:zz",
            "04:00",
            "02:00",
            "03:é",
            &NO_PASSPHRASE[..40],
        ] {
            assert_eq!(one(v, ""), None, "{v}");
        }
    }

    #[test]
    fn verifier_decides_whether_the_passphrase_is_right() {
        let values = vec![WITH_PASSPHRASE.to_string()];
        let locked = decrypt_all(&values, Some(WITH_PASSPHRASE_VERIFIER), "");
        assert_eq!(
            locked,
            SecureCrtDecrypted {
                passphrase_ok: false,
                values: vec![None]
            }
        );
        let open = decrypt_all(&values, Some(WITH_PASSPHRASE_VERIFIER), PASSPHRASE);
        assert_eq!(open.values, vec![Some("Hunter2-é€".to_string())]);
        assert!(decrypt_all(&[], Some(NO_PASSPHRASE_VERIFIER), "").passphrase_ok);
    }

    #[test]
    fn without_a_verifier_any_successful_value_unlocks() {
        let values = vec![WITH_PASSPHRASE.to_string(), String::new()];
        assert!(!decrypt_all(&values, None, "").passphrase_ok);
        assert!(decrypt_all(&values, None, PASSPHRASE).passphrase_ok);
        assert!(decrypt_all(&[String::new()], None, "").passphrase_ok);
    }

    #[test]
    fn expands_secure_crt_path_variables() {
        let config = Path::new("/cfg");
        assert_eq!(
            expand_vars("${VDS_CONFIG_PATH}/Keys/k", config),
            Path::new("/cfg/Keys/k")
        );
        assert_eq!(expand_vars("/abs/key", config), Path::new("/abs/key"));
        let ssh = expand_vars("${VDS_SSH_DATA_PATH}/id_ed25519", config);
        assert!(ssh.ends_with(".ssh/id_ed25519"), "{}", ssh.display());
    }

    #[test]
    fn finds_identity_files_once() {
        let texts = [
            "D:\"Is Session\"=00000001\nS:\"Identity Filename V2\"=${VDS_SSH_DATA_PATH}/a\r\n"
                .to_string(),
            "S:\"Identity Filename V2\"=${VDS_SSH_DATA_PATH}/a\nS:\"Identity Filename V2\"=\n"
                .to_string(),
        ];
        assert_eq!(identity_paths(texts), vec!["${VDS_SSH_DATA_PATH}/a"]);
    }

    #[test]
    #[allow(clippy::disallowed_methods)]
    fn reads_a_config_folder() {
        let root = std::env::temp_dir().join(format!("voltius-scrt-test-{}", std::process::id()));
        let sessions = root.join("Sessions/Prod");
        std::fs::create_dir_all(&sessions).unwrap();
        std::fs::write(
            sessions.join("__FolderData__.ini"),
            "Z:\"Session List V2\"=00000000\n",
        )
        .unwrap();
        std::fs::write(
            sessions.join("web.ini"),
            b"\xEF\xBB\xBFS:\"Hostname\"=web\nS:\"Identity Filename V2\"=${VDS_CONFIG_PATH}/k\n",
        )
        .unwrap();
        std::fs::write(root.join("k"), "KEY").unwrap();
        let cfg = read_config(&config_dir_from_pick(&root.join("Sessions"))).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        assert_eq!(cfg.sessions.len(), 1);
        assert_eq!(cfg.sessions[0].path, "Prod/web");
        assert!(cfg.sessions[0].text.starts_with("S:\"Hostname\"=web"));
        assert_eq!(cfg.files.len(), 1);
        assert_eq!(
            (cfg.files[0].path.as_str(), cfg.files[0].text.as_str()),
            ("${VDS_CONFIG_PATH}/k", "KEY")
        );
    }
}
