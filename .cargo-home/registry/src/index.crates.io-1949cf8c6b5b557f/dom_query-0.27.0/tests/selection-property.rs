mod data;

use data::doc;
use data::doc_with_siblings;

use data::{ANCESTORS_CONTENTS, ATTRS_CONTENTS};
use dom_query::Document;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::*;

mod alloc;

mod utils;
use utils::squash_whitespace;

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_attr_exists() {
    let doc = doc();
    assert!(doc.select("a").attr("href").is_some());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_attr_or() {
    let doc = doc();
    let attr1: &str = &doc.select("a").attr_or("fake-attribute", "alternative");
    let attr2: &str = &doc.select("zz").attr_or("fake-attribute", "alternative");
    assert_eq!(attr1, "alternative");
    assert_eq!(attr2, "alternative");
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_attr_not_exist() {
    let doc = doc();
    assert!(doc.select("div.row-fluid").attr("href").is_none());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_remove_attr() {
    let doc = doc_with_siblings();
    let sel = doc.select("div");

    sel.remove_attr("id");

    assert!(sel.attr("id").is_none());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_remove_attr_empty_string() {
    let doc = doc_with_siblings();
    let sel = doc.select("div");

    sel.remove_attr("");

    assert!(sel.attr("id").is_some());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_set_attr() {
    let doc = doc_with_siblings();
    let sel = doc.select("#main");
    sel.set_attr("id", "not-main");

    let id: &str = &sel.attr("id").expect("got an attribute");
    assert_eq!(id, "not-main");
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_set_attr2() {
    let doc = doc_with_siblings();
    let sel = doc.select("#main");

    sel.set_attr("foo", "bar");

    let id: &str = &sel.attr("foo").expect("got an attribute");
    assert_eq!(id, "bar");
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_text() {
    let doc = doc();
    let txt: &str = &doc.select("h1").text();

    assert_eq!(txt.trim(), "Provok.in");
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_add_class() {
    let doc = doc_with_siblings();
    let sel = doc.select("#main");

    sel.add_class("main main main");
    let class: &str = &sel.attr("class").unwrap();
    assert_eq!(class, "main");
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_add_class_similar() {
    let doc = doc_with_siblings();
    let sel = doc.select("#nf5");

    sel.add_class("odd");

    assert!(sel.has_class("odd"));
    assert!(sel.has_class("odder"));
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_add_empty_class() {
    let doc = doc_with_siblings();
    let sel = doc.select("#main");

    sel.add_class("");
    assert!(sel.attr("class").is_none());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_add_classes() {
    let doc = doc_with_siblings();
    let sel = doc.select("#main");

    sel.add_class("a b");
    assert!(sel.has_class("a"));
    assert!(sel.has_class("b"));
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_has_class() {
    let doc = doc();
    let sel = doc.select("div");
    assert!(sel.has_class("span12"));
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn has_class_none() {
    let doc = doc();
    let sel = doc.select("toto");
    assert!(!sel.has_class("toto"));
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn has_class_not_first() {
    let doc = doc();
    let sel = doc.select(".alert");
    assert!(sel.has_class("alert-error"));
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_remove_class() {
    let doc = doc_with_siblings();
    let sel = doc.select("#nf1");
    sel.remove_class("one row");

    assert!(sel.has_class("even"));
    assert!(!sel.has_class("one"));
    assert!(!sel.has_class("row"));
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_remove_class_similar() {
    let doc = doc_with_siblings();
    let sel = doc.select("#nf5, #nf6");
    assert_eq!(sel.length(), 2);

    sel.remove_class("odd");
    assert!(sel.has_class("odder"));
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_has_attr() {
    let doc: Document = r#"<!DOCTYPE html>
    <html>
        <head><title>Test</title></head>
        <body>
             <p hidden>This paragraph should be hidden.</p> 
        <body>
    </html>"#
        .into();
    let sel = doc.select("p");
    let is_hidden = sel.has_attr("hidden");
    assert!(is_hidden);
    let has_title = sel.has_attr("title");
    assert!(!has_title);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_immediate_text() {
    let doc: Document = r#"<!DOCTYPE html>
    <html>
        <head><title>Test</title></head>
        <body>
            <div>
                <h3>Hello <span>World</span>!</h3>
                <h3>Hello <span>World</span>!</h3>
            </div>
        <body>
    </html>"#
        .into();
    let sel = doc.select("h3");

    assert_eq!(&sel.immediate_text(), "Hello !Hello !");

    let immediate_text: String = sel
        .nodes()
        .iter()
        .map(|n| n.immediate_text().to_string())
        .collect();

    assert_eq!(immediate_text, "Hello !Hello !");
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_all_attrs() {
    let doc: Document = ATTRS_CONTENTS.into();
    let sel = doc.select(r#"font[face="Arial"][size="8"][color="red"]"#);

    let attrs = sel.attrs();

    let got_attrs: Vec<(&str, &str)> = attrs
        .iter()
        .map(|a| (a.name.local.as_ref(), a.value.as_ref()))
        .collect();
    let expected_attrs = vec![("face", "Arial"), ("size", "8"), ("color", "red")];
    assert_eq!(got_attrs, expected_attrs);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_remove_all_attrs() {
    let doc: Document = ATTRS_CONTENTS.into();
    let empty_sel = doc.select(r#"font[face="Verdana"]"#);
    assert!(!empty_sel.exists());
    // removing on empty sel does nothing
    empty_sel.remove_all_attrs();

    let sel = doc.select(r#"font[face]"#);

    assert!(sel.exists());
    // removing all attributes of all nodes within selection
    sel.remove_all_attrs();

    assert!(!doc.select(r#"font[face]"#).exists());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_selection_query() {
    let doc: Document = ATTRS_CONTENTS.into();

    // this is not convenient for single operations
    let sel = doc.select(r#"font[face]"#);

    let mut font_faces = vec![];
    for node in sel.nodes() {
        if let Some(face) = node
            .query(|tree_node| tree_node.as_element().and_then(|el| el.attr("face")))
            .flatten()
        {
            font_faces.push(face.to_string());
        }
    }
    assert_eq!(font_faces, vec!["Times", "Arial", "Courier"]);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_doc_try_serialize_html() {
    let doc: Document = ANCESTORS_CONTENTS.into();

    let html = doc.try_html();
    assert!(html.is_some());

    let inner_html = doc.try_inner_html();
    assert!(inner_html.is_some());
    // because of whitespace serialization serialized content will be different from the original content.
    let got_html = squash_whitespace(&html.unwrap());
    let expected = squash_whitespace(ANCESTORS_CONTENTS);
    assert_eq!(expected, got_html);

    // Calling `try_inner_html` and `try_html` on `Document` will produce the same result.
    // The same thing applies to the `inner_html` and `html` methods.
    let got_inner_html = squash_whitespace(&inner_html.unwrap());
    assert_eq!(expected, got_inner_html);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_doc_serialize_html() {
    let doc: Document = ANCESTORS_CONTENTS.into();

    let html = doc.html();

    let inner_html = doc.inner_html();
    // because of whitespace serialization serialized content will be different from the original content.
    let got_html = squash_whitespace(&html);
    let expected = squash_whitespace(ANCESTORS_CONTENTS);
    assert_eq!(expected, got_html);

    // Calling `try_inner_html` and `try_html` on `Document` will produce the same result.
    // The same thing applies to the `inner_html` and `html` methods.
    let got_inner_html = squash_whitespace(&inner_html);
    assert_eq!(expected, got_inner_html);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_doc_text() {
    let doc: Document = ANCESTORS_CONTENTS.into();

    // normalizing text for testing purpose.
    let text = doc.text().split_whitespace().collect::<Vec<_>>().join(" ");
    // The result includes html > head > title, just like goquery does.
    // Therefore, it must contain the text from the title and the texts from the two blocks.
    assert_eq!("Test Child Child", text);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_selection_try_html() {
    let doc: Document = ANCESTORS_CONTENTS.into();

    let sel = doc.select("#parent > #third-child");
    assert_eq!(sel.try_html(), None);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_selection_try_inner_html() {
    let doc: Document = ANCESTORS_CONTENTS.into();

    let sel = doc.select("#parent > #third-child");
    assert_eq!(sel.try_inner_html(), None);
}
