use dom_query::Document;
use tendril::StrTendril;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::*;

mod alloc;

mod data;
use data::HEADING_CONTENTS;

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn parse_doc_str() {
    let doc = Document::from(HEADING_CONTENTS);
    assert!(doc.root().is_document());
    // document has a <!DOCTYPE html>
    let doc_type_el = doc.root().first_child().unwrap();
    assert!(doc_type_el.is_doctype());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn parse_doc_no_doctype() {
    let contents = r#"
    <html>
        <head><title>Test</title></head>
        <body>
            <div class="content">
                <h1>Test Page</h1>
            </div>
            <div class="content">
                <p>This is a test page contents.</p>
            </div
        </body>
    </html>"#;
    let doc = Document::from(contents);
    assert!(doc.root().is_document());
    // if the source doesn't have a DocType, then the Document also doesn't have one
    let doc_type_el = doc.root().first_child().unwrap();
    assert!(!doc_type_el.is_doctype());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn parse_fragment_str() {
    let fragment = Document::fragment(HEADING_CONTENTS);
    assert!(fragment.root().is_fragment());
    // <!DOCTYPE html> is dropped in fragments
    assert!(!fragment.root().first_child().unwrap().is_doctype());
    let element_name = fragment.root().first_child().unwrap().node_name().unwrap();
    assert_eq!(&element_name, "html");
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn parse_doc_string() {
    let contents = String::from(HEADING_CONTENTS);
    let doc = Document::from(contents);
    assert!(doc.root().is_document());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn parse_fragment_string() {
    let contents = String::from(HEADING_CONTENTS);
    let fragment = Document::fragment(contents);
    assert!(!fragment.root().first_child().unwrap().is_doctype());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn parse_doc_str_tendril() {
    let contents = StrTendril::from(HEADING_CONTENTS);
    let doc = Document::from(contents);
    assert!(doc.root().is_document());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn parse_fragment_str_tendril() {
    let contents = StrTendril::from(HEADING_CONTENTS);
    let fragment = Document::fragment(contents);
    assert!(!fragment.root().first_child().unwrap().is_doctype());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn parse_doc_meta_charset() {
    let contents = r#"<!DOCTYPE html>
    <html>
        <head>
            <title>Test</title>
            <meta charset="UTF-8" />
            <link type="text/css" rel="stylesheet" charset="UTF-8" href="/static/translateelement.css" />
            <script type="text/javascript" charset="UTF-8" src="/static/js/element/main.js"></script>
        </head>
        <body>
            <p>This is a test page contents.</p>
        </body>
    </html>"#;
    let doc = Document::from(contents);
    assert!(doc.root().is_document());
}

#[cfg(feature = "atomic")]
#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn doc_is_send() {
    fn is_send<T: Send>() {}
    is_send::<Document>();
}
