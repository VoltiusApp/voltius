pub(super) const LIST_OFFSET_BASE: usize = 4;
pub(super) const ESCAPE_CHARS: &[char] = &[
    '`', '*', '_', '{', '}', '[', ']', '<', '>', '(', ')', '#', '+', '.', '!', '|', '"',
];
pub(super) const DEFAULT_SKIP_TAGS: [&str; 4] = ["script", "style", "meta", "head"];
pub(super) const CODE_LANGUAGE_ATTRIBUTES: [&str; 2] = ["data-lang", "data-language"];
pub(super) const CODE_LANGUAGE_PREFIX: &str = "language-";
