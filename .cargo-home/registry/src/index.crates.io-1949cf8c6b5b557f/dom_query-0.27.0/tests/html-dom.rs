use dom_query::{Document, SerializableNodeRef};
use html5ever::parse_document;
use html5ever::serialize;
use html5ever::serialize::{SerializeOpts, TraversalScope};
use tendril::SliceExt;
use tendril::StrTendril;
use tendril::TendrilSink;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::*;

mod alloc;

fn parse_and_serialize(input: StrTendril) -> StrTendril {
    let dom = Document::fragment(input);

    let validity_check = dom.tree.validate();
    assert!(
        validity_check.is_ok(),
        "Tree is not valid: {}",
        validity_check.unwrap_err()
    );

    let root = dom.root();
    let inner: SerializableNodeRef = root.first_child().unwrap().into();

    let mut result = vec![];
    serialize(&mut result, &inner, Default::default()).unwrap();
    StrTendril::try_from_byte_slice(&result).unwrap()
}

macro_rules! test_fn {
    ($f:ident, $name:ident, $input:expr, $output:expr) => {
        #[cfg_attr(not(target_arch = "wasm32"), test)]
        #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
        fn $name() {
            assert_eq!($output, &*$f($input.to_tendril()));
        }
    };

    // Shorthand for $output = $input
    ($f:ident, $name:ident, $input:expr) => {
        test_fn!($f, $name, $input, $input);
    };
}

macro_rules! test {
    ($($t:tt)*) => {
        test_fn!(parse_and_serialize, $($t)*);
    };
}

test!(empty, r#""#);
test!(fuzz, "<a a=\r\n", "");
test!(smoke_test, r#"<p><i>Hello</i>, World!</p>"#);

test!(
    misnest,
    r#"<p><i>Hello!</p>, World!</i>"#,
    r#"<p><i>Hello!</i></p><i>, World!</i>"#
);

test!(
    attr_literal,
    r#"<base foo="<'>">"#,
    r#"<base foo="&lt;'&gt;">"#
);
test!(attr_escape_amp, r#"<base foo="&amp;">"#);
test!(
    attr_escape_amp_2,
    r#"<base foo=&amp>"#,
    r#"<base foo="&amp;">"#
);
test!(
    attr_escape_nbsp,
    "<base foo=x\u{a0}y>",
    r#"<base foo="x&nbsp;y">"#
);
test!(
    attr_escape_quot,
    r#"<base foo='"'>"#,
    r#"<base foo="&quot;">"#
);
test!(
    attr_escape_several,
    r#"<span foo=3 title='test "with" &amp;quot;'>"#,
    r#"<span foo="3" title="test &quot;with&quot; &amp;quot;"></span>"#
);

test!(text_literal, r#"<p>"'"</p>"#);
test!(text_escape_amp, r#"<p>&amp;</p>"#);
test!(text_escape_amp_2, r#"<p>&amp</p>"#, r#"<p>&amp;</p>"#);
test!(text_escape_nbsp, "<p>x\u{a0}y</p>", r#"<p>x&nbsp;y</p>"#);
test!(text_escape_lt, r#"<p>&lt;</p>"#);
test!(text_escape_gt, r#"<p>&gt;</p>"#);
test!(text_escape_gt2, r#"<p>></p>"#, r#"<p>&gt;</p>"#);

test!(
    script_literal,
    r#"<script>(x & 1) < 2; y > "foo" + 'bar'</script>"#
);
test!(
    style_literal,
    r#"<style>(x & 1) < 2; y > "foo" + 'bar'</style>"#
);
test!(xmp_literal, r#"<xmp>(x & 1) < 2; y > "foo" + 'bar'</xmp>"#);
test!(
    iframe_literal,
    r#"<iframe>(x & 1) < 2; y > "foo" + 'bar'</iframe>"#
);
test!(
    noembed_literal,
    r#"<noembed>(x & 1) < 2; y > "foo" + 'bar'</noembed>"#
);
test!(
    noframes_literal,
    r#"<noframes>(x & 1) < 2; y > "foo" + 'bar'</noframes>"#
);

test!(pre_lf_0, "<pre>foo bar</pre>");
test!(pre_lf_1, "<pre>\nfoo bar</pre>", "<pre>foo bar</pre>");
test!(pre_lf_2, "<pre>\n\nfoo bar</pre>", "<pre>\nfoo bar</pre>");

test!(textarea_lf_0, "<textarea>foo bar</textarea>");
test!(
    textarea_lf_1,
    "<textarea>\nfoo bar</textarea>",
    "<textarea>foo bar</textarea>"
);
test!(
    textarea_lf_2,
    "<textarea>\n\nfoo bar</textarea>",
    "<textarea>\nfoo bar</textarea>"
);

test!(listing_lf_0, "<listing>foo bar</listing>");
test!(
    listing_lf_1,
    "<listing>\nfoo bar</listing>",
    "<listing>foo bar</listing>"
);
test!(
    listing_lf_2,
    "<listing>\n\nfoo bar</listing>",
    "<listing>\nfoo bar</listing>"
);

test!(comment_1, r#"<p>hi <!--world--></p>"#);
test!(comment_2, r#"<p>hi <!-- world--></p>"#);
test!(comment_3, r#"<p>hi <!--world --></p>"#);
test!(comment_4, r#"<p>hi <!-- world --></p>"#);

// FIXME: test serialization of qualified tag/attribute names that can't be
// parsed from HTML

test!(attr_ns_1, r#"<svg xmlns="bleh"></svg>"#);
test!(attr_ns_2, r#"<svg xmlns:foo="bleh"></svg>"#);
test!(attr_ns_3, r#"<svg xmlns:xlink="bleh"></svg>"#);
test!(attr_ns_4, r#"<svg xlink:href="bleh"></svg>"#);

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn doctype() {
    let dom = parse_document(Document::default(), Default::default()).one("<!doctype html>");
    let mut result = vec![];
    let root = dom.root();
    let document: SerializableNodeRef = root.first_child().unwrap().into();
    serialize(
        &mut result,
        &document,
        SerializeOpts {
            scripting_enabled: true,
            traversal_scope: TraversalScope::IncludeNode,
            create_missing_parent: false,
        },
    )
    .unwrap();
    assert_eq!(String::from_utf8(result).unwrap(), "<!DOCTYPE html>");

    let validity_check = dom.tree.validate();
    assert!(
        validity_check.is_ok(),
        "Tree is not valid: {}",
        validity_check.unwrap_err()
    );
}
