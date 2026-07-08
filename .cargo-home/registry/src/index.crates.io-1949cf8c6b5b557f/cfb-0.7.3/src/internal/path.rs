use std::cmp::Ordering;
use std::io;
use std::path::{Component, Path, PathBuf};

// ========================================================================= //

const MAX_NAME_LEN: usize = 31;

// ========================================================================= //

/// Compares two directory entry names according to CFB ordering, which is
/// case-insensitive, and which always puts shorter names before longer names,
/// as encoded in UTF-16 (i.e. [shortlex
/// order](https://en.wikipedia.org/wiki/Shortlex_order), rather than
/// dictionary order).
pub fn compare_names(name1: &str, name2: &str) -> Ordering {
    match name1.encode_utf16().count().cmp(&name2.encode_utf16().count()) {
        // This is actually not 100% correct -- the MS-CFB spec specifies a
        // particular way of doing the uppercasing on individual UTF-16 code
        // units, along with a list of weird exceptions and corner cases.  But
        // hopefully this is good enough for 99+% of the time.
        Ordering::Equal => name1.to_uppercase().cmp(&name2.to_uppercase()),
        other => other,
    }
}

/// Converts a storage/stream name to UTF-16, or returns an error if the name
/// is invalid.
pub fn validate_name(name: &str) -> io::Result<Vec<u16>> {
    let name_utf16: Vec<u16> =
        name.encode_utf16().take(MAX_NAME_LEN + 1).collect();
    if name_utf16.len() > MAX_NAME_LEN {
        invalid_input!(
            "Object name cannot be more than {} UTF-16 code units \
                        (was {})",
            MAX_NAME_LEN,
            name.encode_utf16().count()
        );
    }
    for &chr in &['/', '\\', ':', '!'] {
        if name.contains(chr) {
            invalid_input!("Object name cannot contain {} character", chr);
        }
    }
    Ok(name_utf16)
}

// ========================================================================= //

/// Given a path within a compound file, turns it into a list of child names
/// descending from the root.  Returns an error if the name is invalid.
pub fn name_chain_from_path(path: &Path) -> io::Result<Vec<&str>> {
    let mut names: Vec<&str> = Vec::new();
    for component in path.components() {
        match component {
            Component::Prefix(_) => {
                invalid_input!("Invalid path (must not have prefix)");
            }
            Component::RootDir => names.clear(),
            Component::CurDir => {}
            Component::ParentDir => {
                if names.pop().is_none() {
                    invalid_input!("Invalid path (must be within root)");
                }
            }
            Component::Normal(osstr) => match osstr.to_str() {
                Some(name) => names.push(name),
                None => invalid_input!("Non UTF-8 path"),
            },
        }
    }
    Ok(names)
}

pub fn path_from_name_chain(names: &[&str]) -> PathBuf {
    let mut path = PathBuf::from("/");
    for name in names {
        path.push(name);
    }
    path
}

// ========================================================================= //

#[cfg(test)]
mod tests {
    use super::{
        compare_names, name_chain_from_path, path_from_name_chain,
        validate_name,
    };
    use std::cmp::Ordering;
    use std::path::{Path, PathBuf};

    #[test]
    fn name_ordering() {
        assert_eq!(compare_names("foobar", "FOOBAR"), Ordering::Equal);
        assert_eq!(compare_names("foo", "barfoo"), Ordering::Less);
        assert_eq!(compare_names("Foo", "bar"), Ordering::Greater);
    }

    #[test]
    fn short_name_is_valid() {
        assert_eq!(
            validate_name("Foobar").unwrap(),
            vec![70, 111, 111, 98, 97, 114]
        );
    }

    #[test]
    #[should_panic(
        expected = "Object name cannot be more than 31 UTF-16 code \
                               units (was 35)"
    )]
    fn long_name_is_invalid() {
        validate_name("ThisNameIsMostDefinitelyMuchTooLong").unwrap();
    }

    #[test]
    #[should_panic(expected = "Object name cannot contain / character")]
    fn name_with_slash_is_invalid() {
        validate_name("foo/bar").unwrap();
    }

    #[test]
    fn absolute_path_is_valid() {
        assert_eq!(
            name_chain_from_path(&Path::new("/foo/bar/baz/")).unwrap(),
            vec!["foo", "bar", "baz"]
        );
    }

    #[test]
    fn relative_path_is_valid() {
        assert_eq!(
            name_chain_from_path(&Path::new("foo/bar/baz")).unwrap(),
            vec!["foo", "bar", "baz"]
        );
    }

    #[test]
    fn path_with_parents_is_valid() {
        assert_eq!(
            name_chain_from_path(&Path::new("foo/bar/../baz")).unwrap(),
            vec!["foo", "baz"]
        );
    }

    #[test]
    #[should_panic(expected = "Invalid path (must be within root)")]
    fn parent_of_root_is_invalid() {
        name_chain_from_path(&Path::new("foo/../../baz")).unwrap();
    }

    #[test]
    fn canonical_path_is_absolute() {
        let path = Path::new("foo/bar/../baz");
        let names = name_chain_from_path(&path).unwrap();
        assert_eq!(path_from_name_chain(&names), PathBuf::from("/foo/baz"));
    }
}

// ========================================================================= //
