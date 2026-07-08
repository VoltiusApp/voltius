macro_rules! unescape_assert_eq {
	($l:expr, $r:expr) => {
		assert_eq!(crate::unescape($l).unwrap(), $r);
	};
}

macro_rules! unescape_assert_err {
	($l:expr, $r:expr) => {
		assert_eq!(crate::unescape($l).unwrap_err(), $r);
	};
}

macro_rules! unescape_assert_err_str {
	($s:expr, $e:expr, $e_src:expr) => {{
		let e = crate::unescape($s).unwrap_err();

		assert_eq!(e.to_string(), $e);
		assert_eq!(e.source().unwrap().to_string(), $e_src);
	}};
}

#[test]
fn error() {
	// std
	use std::error::Error;
	// hack-ink
	use crate::Error::*;

	unescape_assert_err!(r"\", IncompleteStr(0));
	unescape_assert_err!(r"\0\", IncompleteStr(2));

	unescape_assert_err!(r"\{}", InvalidChar { char: '{', pos: 1 });
	unescape_assert_err!(r"\0\{}", InvalidChar { char: '{', pos: 3 });

	unescape_assert_err_str!(
		r"\u{g}",
		"parse int error, break at 4",
		"invalid digit found in string"
	);
	unescape_assert_err_str!(
		r"\0\u{g}",
		"parse int error, break at 6",
		"invalid digit found in string"
	);
}

#[test]
fn unescape_unicode() {
	unescape_assert_eq!(r"\u0000", "\0");
	unescape_assert_eq!(r"\u0009", "\t");
	unescape_assert_eq!(r"\u000a", "\n");
	unescape_assert_eq!(r"\uffff", "\u{ffff}");
	unescape_assert_eq!(r"\u0000XavierJane", "\0XavierJane");

	unescape_assert_eq!(r"\u{0}", "\0");
	unescape_assert_eq!(r"\u{9}", "\t");
	unescape_assert_eq!(r"\u{a}", "\n");
	unescape_assert_eq!(r"\u{ffff}", "\u{ffff}");
	unescape_assert_eq!(r"\u{1F600}", "\u{1F600}");
	unescape_assert_eq!(r"\u{1F600}", "😀");
	unescape_assert_eq!(r"\u{0}XavierJane", "\0XavierJane");
}

#[test]
fn unescape_byte() {
	unescape_assert_eq!(r"\x00", "\x00");
	unescape_assert_eq!(r"\x09", "\t");
	unescape_assert_eq!(r"\x0a", "\n");
	unescape_assert_eq!(r"\x7f", "\x7f");
	unescape_assert_eq!(r"\x00XavierJane", "\x00XavierJane");
}

#[test]
fn unescape_octal() {
	unescape_assert_eq!(r"\0", "\0");
	unescape_assert_eq!(r"\11", "\t");
	unescape_assert_eq!(r"\12", "\n");
	unescape_assert_eq!(r"\377", "\u{00ff}");
	unescape_assert_eq!(r"\0XavierJane", "\0XavierJane");
}

#[test]
fn unescape_special_symbols() {
	unescape_assert_eq!(r"\b", "\u{0008}");
	unescape_assert_eq!(r"\f", "\u{000c}");
	unescape_assert_eq!(r"\n", "\n");
	unescape_assert_eq!(r"\r", "\r");
	unescape_assert_eq!(r"\t", "\t");
	unescape_assert_eq!(r"\'", "\'");
	unescape_assert_eq!(r#"\""#, "\"");
	unescape_assert_eq!(r"\\", "\\");
	unescape_assert_eq!(r"//", "//");
}
