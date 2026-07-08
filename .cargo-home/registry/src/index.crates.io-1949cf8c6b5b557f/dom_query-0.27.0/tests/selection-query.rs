mod data;

use std::collections::HashSet;

use data::{doc, ANCESTORS_CONTENTS, HEADING_CONTENTS};

use dom_query::{Document, Selection};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::*;

mod alloc;

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_is() {
    let doc = doc();
    let sel = doc.select(".footer p:nth-child(1)");
    assert!(sel.is("p"), "Expected .footer p:nth-child(1) to be a p.");
    assert!(!doc.select("#non-existing").is("#non-existing"));
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_is_invalid() {
    let doc = doc();
    let sel = doc.select(".footer p:nth-child(1)");
    assert!(
        !sel.is(""),
        "is should not succeed with invalid selector string"
    );
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_is_selection() {
    let doc = doc();
    let sel = doc.select("div");
    let sel2 = doc.select(".pvk-gutter");

    assert!(
        sel.is_selection(&sel2),
        "Expected some div to have a pvk-gutter class."
    );
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_is_selection_not() {
    let doc = doc();
    let sel = doc.select("div");
    let sel2 = doc.select("a");

    assert!(
        !sel.is_selection(&sel2),
        "Expected some div NOT to be an anchor."
    );
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_filter_selection() {
    let doc: Document = HEADING_CONTENTS.into();
    // we captured 2 divs with `.content` class
    let sel = doc.select("div.content");
    assert!(sel.select("h1").exists());

    // create a new filtered selection, that will contain only elements with `.text-content` class
    let filtered_sel = sel.filter("div.text-content");

    // filtered selection does not contain any `h1`
    assert!(!filtered_sel.select("h1").exists());
    // while original selection contains `h1`
    assert!(sel.select("h1").exists());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_try_filter_selection() {
    let doc: Document = HEADING_CONTENTS.into();
    // we captured 2 divs with `.content` class
    let sel = doc.select("div.content");
    assert!(sel.select("h1").exists());
    let filtered_sel = sel.try_filter("div.text-content").unwrap();
    assert!(!filtered_sel.select("h1").exists());
    assert!(sel.select("h1").exists());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_filter_selection_other() {
    let doc: Document = r#"<!DOCTYPE html>
    <html lang="en">
        <head><title>Test</title></head>
        <body>
            <div class="content">
                <p>Content text has a <a href="/0">link</a></p>
            </div>
            <footer>
                <a href="/1">Footer Link</a>
            </footer>
        </body>
    </html>
    "#
    .into();

    // selecting all links in the document
    let sel_with_links = doc.select("a[href]");

    assert_eq!(sel_with_links.length(), 2);
    // selecting every element inside `.content`
    let content_sel = doc.select("div.content *");

    // filter selection by content selection, so now we get only links (actually only 1 link) that are inside `.content`
    let filtered_sel = sel_with_links.filter_selection(&content_sel);

    assert_eq!(filtered_sel.length(), 1);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_is_empty() {
    let doc: Document = ANCESTORS_CONTENTS.into();
    let sel = doc.select("#parent > #first-child");
    assert!(!sel.is_empty());
    assert!(!sel.is("#third-child"));
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_is_empty_selection() {
    let doc: Document = ANCESTORS_CONTENTS.into();
    let first_child_sel = doc.select("#parent > #first-child");
    assert!(!first_child_sel.is_empty());

    let third_child_sel = doc.select("#parent > #third-child");
    assert!(third_child_sel.is_empty());

    assert!(!first_child_sel.is_selection(&third_child_sel));
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_is_has() {
    let contents = r#"<!DOCTYPE html>
    <html>
        <body>
            <div><img src="image.png"></div>
            <div id="anchor"></div>
        </body>
    </html>"#;
    let doc: Document = contents.into();
    let sel = doc.select("#anchor");

    let anchor_node = sel.nodes().first().unwrap();

    let prev_sibling = anchor_node.prev_element_sibling().unwrap();
    let prev_sel = Selection::from(prev_sibling);

    assert!(prev_sel.is("*:has( > img:only-child)"));
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_selection_unique() {
    // This document contains many nested div elements and was taken from the dom_smoothie test data.
    // I was investigating whether an additional uniqueness check during selection was necessary,
    // as the results looked correct and unique without it, while the check added overhead.
    // However, after removing the `set.contains` check from `Matches::next`, the dom_smoothie::Readability tests started failing.
    // Therefore, the current `Matches` implementation requires the uniqueness check despite the overhead.

    let contents = include_str!("../test-pages/002.html");
    let doc: Document = contents.into();

    let div_sel = doc.select(".page").select("div").select("div > div");

    let sel_ids = div_sel.nodes().iter().map(|n| n.id).collect::<Vec<_>>();

    let unique_ids = sel_ids.iter().cloned().collect::<HashSet<_>>();
    assert_eq!(sel_ids.len(), unique_ids.len());
}
