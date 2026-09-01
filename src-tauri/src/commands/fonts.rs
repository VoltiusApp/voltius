use fontdb::{Database, Language};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct SystemFont {
    /// Family name as CSS will match it (the English `name` record).
    pub family: String,
    pub monospace: bool,
}

/// CSS matches the English family name, so prefer it over the localized records
/// `fontdb` also carries. Falls back to whatever the face lists first.
fn english_family(families: &[(String, Language)]) -> Option<&str> {
    families
        .iter()
        .find(|(_, lang)| *lang == Language::English_UnitedStates)
        .or_else(|| families.iter().find(|(_, lang)| is_english(*lang)))
        .or_else(|| families.first())
        .map(|(name, _)| name.as_str())
}

fn is_english(lang: Language) -> bool {
    format!("{lang:?}").starts_with("English")
}

/// One entry per family, sorted, monospace if any face in it claims to be.
/// `fontdb` reports per *face*, so "MesloLGS Nerd Font Mono" arrives four times
/// (Regular/Bold/Italic/BoldItalic) and has to be collapsed.
fn dedupe_families(faces: impl Iterator<Item = (String, bool)>) -> Vec<SystemFont> {
    let mut families: Vec<SystemFont> = Vec::new();
    let mut seen: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    for (family, monospace) in faces {
        let family = family.trim();
        if family.is_empty() {
            continue;
        }
        match seen.get(family) {
            Some(&index) => families[index].monospace |= monospace,
            None => {
                seen.insert(family.to_string(), families.len());
                families.push(SystemFont {
                    family: family.to_string(),
                    monospace,
                });
            }
        }
    }

    families.sort_by_key(|f| f.family.to_lowercase());
    families
}

/// Families installed on this machine, for the theme editor's font pickers.
/// Bundled webfonts (JetBrains Mono, Source Code Pro) are *not* here — they ship
/// inside the app rather than being installed, so the frontend pins them itself.
#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<SystemFont>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut db = Database::new();
        db.load_system_fonts();
        dedupe_families(db.faces().filter_map(|face| {
            english_family(&face.families).map(|name| (name.to_string(), face.monospaced))
        }))
    })
    .await
    .map_err(|e| format!("Font enumeration failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn font(family: &str, monospace: bool) -> (String, bool) {
        (family.to_string(), monospace)
    }

    #[test]
    fn collapses_a_family_that_has_several_faces() {
        let families = dedupe_families(
            [
                font("MesloLGS Nerd Font Mono", true),
                font("MesloLGS Nerd Font Mono", true),
            ]
            .into_iter(),
        );

        assert_eq!(
            families,
            vec![SystemFont {
                family: "MesloLGS Nerd Font Mono".to_string(),
                monospace: true,
            }]
        );
    }

    #[test]
    fn one_monospace_face_marks_the_whole_family() {
        let families = dedupe_families(
            [font("Patched Family", false), font("Patched Family", true)].into_iter(),
        );

        assert!(families[0].monospace);
    }

    #[test]
    fn sorts_case_insensitively() {
        let families: Vec<String> = dedupe_families(
            [
                font("iosevka", true),
                font("Courier New", true),
                font("Andale Mono", true),
            ]
            .into_iter(),
        )
        .into_iter()
        .map(|f| f.family)
        .collect();

        assert_eq!(families, vec!["Andale Mono", "Courier New", "iosevka"]);
    }

    #[test]
    fn trims_and_drops_blank_family_names() {
        let families =
            dedupe_families([font("  Fira Code  ", true), font("   ", true)].into_iter());

        assert_eq!(
            families,
            vec![SystemFont {
                family: "Fira Code".to_string(),
                monospace: true,
            }]
        );
    }

    #[test]
    fn prefers_the_english_family_record() {
        let records = vec![
            ("ヒラギノ角ゴ".to_string(), Language::Japanese_Japan),
            ("Hiragino Sans".to_string(), Language::English_UnitedStates),
        ];

        assert_eq!(english_family(&records), Some("Hiragino Sans"));
    }

    #[test]
    fn falls_back_to_the_first_record_when_no_english_one_exists() {
        let records = vec![("ヒラギノ角ゴ".to_string(), Language::Japanese_Japan)];

        assert_eq!(english_family(&records), Some("ヒラギノ角ゴ"));
    }

    #[test]
    fn accepts_a_non_us_english_record() {
        let records = vec![
            ("Zapfino".to_string(), Language::English_UnitedKingdom),
            ("Zapfino JP".to_string(), Language::Japanese_Japan),
        ];

        assert_eq!(english_family(&records), Some("Zapfino"));
    }
}
