#![allow(dead_code)]

pub(crate) fn squash_whitespace(src: &str) -> String {
    src.split_whitespace().collect::<String>()
}
