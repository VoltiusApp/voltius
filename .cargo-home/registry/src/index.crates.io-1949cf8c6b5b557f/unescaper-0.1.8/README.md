<div align="center">

# Unescaper
### Unescape strings with escape sequences written out as literal characters.

[![License GPLv3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![License MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Checks](https://github.com/hack-ink/unescaper/actions/workflows/checks.yml/badge.svg?branch=main)](https://github.com/hack-ink/unescaper/actions/workflows/checks.yml)
[![GitHub tag (latest by date)](https://img.shields.io/github/v/tag/hack-ink/unescaper)](https://github.com/hack-ink/unescaper/tags)
[![GitHub code lines](https://tokei.rs/b1/github/hack-ink/unescaper)](https://github.com/hack-ink/unescaper)
[![GitHub last commit](https://img.shields.io/github/last-commit/hack-ink/unescaper?color=red&style=plastic)](https://github.com/hack-ink/unescaper)

</div>

## Usage
[More Examples](src/test.rs)
```rust
fn main() {
	assert_eq!(unescaper::unescape(r"\u000a").unwrap(), "\n");
	assert_eq!(unescaper::unescape(r"\u{a}").unwrap(), "\n");
	assert_eq!(unescaper::unescape(r"\x0a").unwrap(), "\n");
	assert_eq!(unescaper::unescape(r"\12").unwrap(), "\n");
}
```

## Thanks
The idea comes from [unescape-rs](https://github.com/saghm/unescape-rs).<br>
The last commit of that repository was seven years ago.<br>
So, I think it is no longer maintained.<br>
That's why I created this repository, and I have made some improvements.
