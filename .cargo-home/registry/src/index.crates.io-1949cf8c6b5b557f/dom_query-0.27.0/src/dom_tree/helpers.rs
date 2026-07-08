pub(crate) fn normalized_char_count(text: &str, start_whitespace: bool) -> usize {
    let mut char_count = 0;
    let mut prev_was_whitespace = start_whitespace;

    for c in text.chars() {
        let is_ws = c.is_whitespace();
        if !(prev_was_whitespace && is_ws) {
            char_count += 1;
        }
        prev_was_whitespace = is_ws;
    }
    char_count
}
