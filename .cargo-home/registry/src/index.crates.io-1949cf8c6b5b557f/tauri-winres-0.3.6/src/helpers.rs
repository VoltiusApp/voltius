use std::{
    collections::BTreeMap,
    env,
    fs::File,
    io::{self, Read},
    path::Path,
};

pub(crate) fn parse_cargo_toml(props: &mut BTreeMap<String, String>) -> io::Result<()> {
    let cargo = Path::new(&env::var("CARGO_MANIFEST_DIR").unwrap()).join("Cargo.toml");
    let mut f = File::open(cargo)?;
    let mut cargo_toml = String::new();
    f.read_to_string(&mut cargo_toml)?;
    if let Ok(ml) = toml::from_str::<toml::Value>(&cargo_toml) {
        if let Some(pkg) = ml.get("package") {
            if let Some(pkg) = pkg.get("metadata") {
                if let Some(pkg) = pkg.get("tauri-winres") {
                    if let Some(pkg) = pkg.as_table() {
                        for (k, v) in pkg {
                            if let Some(v) = v.as_str() {
                                props.insert(k.clone(), v.to_string());
                            } else {
                                println!("package.metadata.tauri-winres.{} is not a string", k);
                            }
                        }
                    } else {
                        println!("package.metadata.tauri-winres is not a table");
                    }
                } else {
                    println!("package.metadata.tauri-winres does not exist");
                }
            } else {
                println!("package.metadata does not exist");
            }
        } else {
            println!("package does not exist");
        }
    } else {
        println!("TOML parsing error")
    }
    Ok(())
}

pub(crate) fn escape_string(string: &str) -> String {
    let mut escaped = String::new();
    for chr in string.chars() {
        // In quoted RC strings, double-quotes are escaped by using two
        // consecutive double-quotes.  Other characters are escaped in the
        // usual C way using backslashes.
        match chr {
            '"' => escaped.push_str("\"\""),
            '\'' => escaped.push_str("\\'"),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\t' => escaped.push_str("\\t"),
            '\r' => escaped.push_str("\\r"),
            _ => escaped.push(chr),
        };
    }
    escaped
}
