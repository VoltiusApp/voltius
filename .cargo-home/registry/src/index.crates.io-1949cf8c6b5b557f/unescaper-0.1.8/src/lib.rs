#![warn(missing_docs)]

//! Unescape the given string.
//! This is the opposite operation of [`std::ascii::escape_default`].

// crates.io
use thiserror::Error as ThisError;

#[cfg(test)] mod test;

/// Unescaper's `Result`.
pub type Result<T> = ::std::result::Result<T, Error>;

/// Unescaper's `Error`.
#[allow(missing_docs)]
#[cfg_attr(test, derive(PartialEq, Eq))]
#[derive(Debug, ThisError)]
pub enum Error {
	#[error("incomplete str, break at {0}")]
	IncompleteStr(usize),
	#[error("invalid char, {char:?} break at {pos}")]
	InvalidChar { char: char, pos: usize },
	#[error("parse int error, break at {pos}")]
	ParseIntError { source: ::std::num::ParseIntError, pos: usize },
}
use Error::*;

/// Unescaper struct which holding the chars cache for unescaping.
#[derive(Debug)]
pub struct Unescaper {
	/// [`str`] cache, in reverse order.
	pub chars: Vec<char>,
}
impl Unescaper {
	/// Build a new [`Unescaper`] from the given [`str`].
	pub fn new(s: &str) -> Self {
		Self { chars: s.chars().rev().collect() }
	}

	/// Unescape the given [`str`].
	pub fn unescape(&mut self) -> Result<String> {
		let chars_count = self.chars.len();
		let offset = |mut e, remaining_count| {
			let (IncompleteStr(pos) | InvalidChar { pos, .. } | ParseIntError { pos, .. }) = &mut e;

			*pos += chars_count - remaining_count - 1;

			e
		};
		let mut unescaped = String::new();

		while let Some(c) = self.chars.pop() {
			if c != '\\' {
				unescaped.push(c);

				continue;
			}

			let c = self.chars.pop().ok_or(IncompleteStr(chars_count - self.chars.len() - 1))?;
			let c = match c {
				'b' => '\u{0008}',
				'f' => '\u{000c}',
				'n' => '\n',
				'r' => '\r',
				't' => '\t',
				// https://github.com/hack-ink/unescaper/pull/10#issuecomment-1676443635
				//
				// https://www.ecma-international.org/wp-content/uploads/ECMA-404_2nd_edition_december_2017.pdf
				// On page 4 it says: "\/ represents the solidus character (U+002F)."
				'\'' | '\"' | '\\' | '/' => c,
				'u' => self.unescape_unicode_internal().map_err(|e| offset(e, self.chars.len()))?,
				'x' => self.unescape_byte_internal().map_err(|e| offset(e, self.chars.len()))?,
				_ => self.unescape_octal_internal(c).map_err(|e| offset(e, self.chars.len()))?,
			};

			unescaped.push(c);
		}

		Ok(unescaped)
	}

	// pub fn unescape_unicode(&mut self) -> Result<char> {}
	fn unescape_unicode_internal(&mut self) -> Result<char> {
		let c = self.chars.pop().ok_or(Error::IncompleteStr(0))?;
		let mut unicode = String::new();

		// \u + { + regex(d*) + }
		if c == '{' {
			while let Some(n) = self.chars.pop() {
				if n == '}' {
					break;
				}

				unicode.push(n);
			}
		}
		// \u + regex(d{4})
		else {
			// [0, 65536), 16^4
			unicode.push(c);

			for i in 0..3 {
				let c = self.chars.pop().ok_or(IncompleteStr(i))?;

				unicode.push(c);
			}
		}

		char::from_u32(
			u32::from_str_radix(&unicode, 16).map_err(|e| ParseIntError { source: e, pos: 0 })?,
		)
		.ok_or(Error::InvalidChar {
			char: unicode.chars().last().expect("empty unicode will exit earlier; qed"),
			pos: 0,
		})
	}

	// pub fn unescape_byte(&mut self) -> Result<char> {}
	fn unescape_byte_internal(&mut self) -> Result<char> {
		let mut byte = String::new();

		// [0, 256), 16^2
		for i in 0..2 {
			let c = self.chars.pop().ok_or(IncompleteStr(i))?;

			byte.push(c);
		}

		Ok(u8::from_str_radix(&byte, 16).map_err(|e| ParseIntError { source: e, pos: 0 })? as _)
	}

	// pub fn unescape_octal(&mut self) -> Result<char> {}
	fn unescape_octal_internal(&mut self, c: char) -> Result<char> {
		let mut octal = String::new();
		let mut try_push_next = |octal: &mut String| {
			if let Some(c) =
				self.chars.last().cloned().filter(|c| c.is_digit(8)).and_then(|_| self.chars.pop())
			{
				octal.push(c);
			}
		};

		match c {
			// decimal [0, 256) == octal [0, 400)
			// 0 <= first digit < 4
			// \ + regex(d{1,3})
			'0' | '1' | '2' | '3' => {
				octal.push(c);

				(0..2).for_each(|_| try_push_next(&mut octal));
			},
			// \ + regex(d{1,2})
			'4' | '5' | '6' | '7' => {
				octal.push(c);

				try_push_next(&mut octal);
			},
			_ => Err(InvalidChar { char: c, pos: 0 })?,
		}

		Ok(u8::from_str_radix(&octal, 8).map_err(|e| ParseIntError { source: e, pos: 0 })? as _)
	}
}

/// Unescape the given [`str`].
pub fn unescape(s: &str) -> Result<String> {
	Unescaper::new(s).unescape()
}
