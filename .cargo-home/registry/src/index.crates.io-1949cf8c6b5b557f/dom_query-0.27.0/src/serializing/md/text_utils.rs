use tendril::StrTendril;

use super::constants::ESCAPE_CHARS;

pub(super) fn push_normalized_text(text: &mut StrTendril, new_text: &str, escape_all: bool) {
    let follows_newline = text.ends_with(['\n', ' ']) || text.is_empty();
    let push_start_whitespace = !follows_newline && new_text.starts_with(char::is_whitespace);
    let push_end_whitespace = new_text.ends_with(char::is_whitespace);

    let mut result = StrTendril::with_capacity(new_text.len() as u32);
    let mut iter = new_text.split_whitespace();

    if let Some(first) = iter.next() {
        if push_start_whitespace {
            result.push_char(' ');
        }
        push_escaped_chunk(&mut result, first, escape_all);
        for word in iter {
            result.push_char(' ');
            push_escaped_chunk(&mut result, word, escape_all);
        }
    }
    if result.is_empty() && follows_newline {
        return;
    }

    text.push_tendril(&result);

    if push_end_whitespace && !text.ends_with(char::is_whitespace) {
        text.push_char(' ');
    }
}

pub(super) fn push_escaped_chunk(text: &mut StrTendril, chunk: &str, escape_all: bool) {
    let should_escape = if escape_all {
        |c: char| ESCAPE_CHARS.contains(&c)
    } else {
        |c: char| c == '`'
    };
    let mut prev_escape = false;
    for c in chunk.chars() {
        if should_escape(c) && !prev_escape {
            text.push_char('\\');
        }
        prev_escape = c == '\\';
        text.push_char(c);
    }
}

pub(super) fn trim_right_tendril_space(s: &mut StrTendril) {
    while !s.is_empty() && s.ends_with(' ') {
        s.pop_back(1);
    }
}

pub(super) fn join_tendril_strings(seq: &[StrTendril], sep: &str) -> StrTendril {
    let mut result = StrTendril::new();
    let mut iter = seq.iter();

    if let Some(first) = iter.next() {
        result.push_tendril(first);
    }

    for tendril in iter {
        result.push_slice(sep);
        result.push_tendril(tendril);
    }
    result
}

pub(super) fn add_linebreaks(text: &mut StrTendril, linebreak: &str, end: &str) {
    trim_right_tendril_space(text);
    while !text.ends_with(&end) {
        text.push_slice(linebreak);
    }
}

/// Keep only the first whitespace‑delimited token and a conservative set of characters.
pub(super) fn sanitize_attr_value(raw: &str) -> String {
    let token = raw.split_ascii_whitespace().next().unwrap_or("");
    token
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '+' | '.' | '#'))
        .collect()
}

#[cfg(test)]
mod tests {

    use tendril::StrTendril;

    use super::*;

    #[test]
    fn test_escape_text() {
        let t = r"Some text with characters to be escaped: \,`,*,_,{,},[,],<,>,(,),#,+,.,!,|";
        let mut text = StrTendril::new();
        push_normalized_text(&mut text, t, true);
        assert_eq!(
            text.as_ref(),
            r"Some text with characters to be escaped: \,\`,\*,\_,\{,\},\[,\],\<,\>,\(,\),\#,\+,\.,\!,\|"
        );

        // test with escape_all: false
        let mut text = StrTendril::new();
        push_normalized_text(&mut text, t, false);
        assert_eq!(
            text.as_ref(),
            r"Some text with characters to be escaped: \,\`,*,_,{,},[,],<,>,(,),#,+,.,!,|"
        );
    }
}
