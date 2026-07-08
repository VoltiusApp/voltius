mod data;

use data::doc;
use data::doc_wiki;
use data::DMC_CONTENTS;
use data::{ANCESTORS_CONTENTS, LIST_CONTENTS};
use dom_query::Document;

use dom_query::NodeId;
use dom_query::Selection;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::*;

mod alloc;

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_select() {
    let doc = doc();
    let sel = doc.select("div.row-fluid");
    assert_eq!(sel.length(), 9);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_select_not_self() {
    let doc = doc();
    let sel = doc.select("h1").select("h1");
    assert_eq!(sel.length(), 0);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
#[should_panic]
fn test_select_invalid() {
    let doc = doc();
    let sel = doc.select(":+ ^");
    assert_eq!(sel.length(), 0);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_select_big() {
    let doc = doc_wiki();
    let sel = doc.select("li");
    assert_eq!(sel.length(), 420);
    let sel = doc.select("span");
    assert_eq!(sel.length(), 706);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_chained_select() {
    let doc = doc();
    let sel = doc.select("div.hero-unit").select(".row-fluid");
    assert_eq!(sel.length(), 4);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
#[should_panic]
fn test_chained_select_invalid() {
    let doc = doc();
    let sel = doc.select("div.hero-unit").select("");
    assert_eq!(sel.length(), 0);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_children() {
    let doc = doc();
    let sel = doc.select(".pvk-content").children();
    assert_eq!(sel.length(), 5)
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_children_empty() {
    let doc = doc();
    let sel = doc.select(".non-existing").children();
    assert_eq!(sel.length(), 0)
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_parent() {
    let doc = doc();
    let sel = doc.select(".container-fluid").parent();
    assert_eq!(sel.length(), 3)
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_parent_non_existing() {
    let doc = doc();
    let sel = doc.select(".non-existing").parent();
    assert_eq!(sel.length(), 0)
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_next() {
    let doc = doc();
    let sel = doc.select("h1").next_sibling();
    assert_eq!(sel.length(), 1)
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_next2() {
    let doc = doc();
    let sel = doc.select(".close").next_sibling();
    assert_eq!(sel.length(), 1)
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_next_none() {
    let doc = doc();
    let sel = doc.select("small").next_sibling();
    assert_eq!(sel.length(), 0)
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_nth_child() {
    let doc: Document = r#"<!DOCTYPE html>
    <html lang="en">
        <head></head>
    
        <body>
            <div id="bggrad"></div>
            <div class="container container-header"></div>
            <div class="container container-main">
                <nav class="navbar navbar-default navbar-static-top"></nav>
                <div class="row">
                    <div class="col-xs-12"></div>
                    <div class="col-xs-12"></div>
                    <div class="col-md-10">
                        <a href="\#">foo</a>
                    </div>
                </div>
            </div>
        </body>
    </html>"#
        .into();

    let a = doc
        .select("body > div.container.container-main > div.row:nth-child(2) > div.col-md-10 > a");

    assert!(a.length() == 1);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_doc_select_single() {
    let doc: Document = LIST_CONTENTS.into();

    let single_selection_count = doc.select_single(".list").length();
    assert_eq!(single_selection_count, 1);

    let multiple_selection_count = doc.select(".list").length();
    assert_eq!(multiple_selection_count, 2);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_select_single() {
    let doc: Document = LIST_CONTENTS.into();

    let single_selection_count = doc.select("div").select_single(".list").length();
    assert_eq!(single_selection_count, 1);

    let multiple_selection_count = doc.select("div").select(".list").length();
    assert_eq!(multiple_selection_count, 2);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_try_select_doc() {
    let doc: Document = LIST_CONTENTS.into();
    let selection = doc.try_select(".list");
    assert!(selection.is_some());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_try_select_doc_none() {
    let doc: Document = LIST_CONTENTS.into();
    let selection = doc.try_select(".none");
    assert!(selection.is_none());
    if let Some(sel) = selection {
        assert_eq!(&sel.text(), "not a chance")
    }
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_try_select_selection() {
    let doc: Document = LIST_CONTENTS.into();
    let selection = doc
        .try_select("div")
        .and_then(|sel| sel.try_select(".list"));
    assert!(selection.is_some());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_try_select_selection_none() {
    let doc: Document = LIST_CONTENTS.into();
    let selection = doc
        .try_select("div")
        .and_then(|sel| sel.try_select(".none"));
    assert!(selection.is_none());
    if let Some(sel) = selection {
        assert_eq!(&sel.text(), "not a chance")
    }
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_try_select_invalid() {
    let doc: Document = LIST_CONTENTS.into();
    let selection = doc.try_select(":+ ^");
    assert!(selection.is_none());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_handle_selection() {
    let doc: Document = LIST_CONTENTS.into();

    let all_matched: String = doc
        .select(".list")
        .iter()
        .map(|s| s.inner_html().trim().to_string())
        .collect();

    assert_eq!(
        all_matched,
        "<li>1</li><li>2</li><li>3</li><li>4</li><li>5</li><li>6</li>"
    );
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_handle_selection_nodes() {
    let doc: Document = LIST_CONTENTS.into();
    // same thing as previous but a little bit faster, because it doesn't create intermediate selections.
    let all_matched: String = doc
        .select(".list")
        .nodes()
        .iter()
        .map(|s| s.inner_html().trim().to_string())
        .collect();

    assert_eq!(
        all_matched,
        "<li>1</li><li>2</li><li>3</li><li>4</li><li>5</li><li>6</li>"
    );
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_doc_uppercase() {
    let contents = LIST_CONTENTS.to_uppercase();
    let doc: Document = contents.into();

    let all_matched: String = doc
        .select(r#"ul"#)
        .iter()
        .map(|s| s.inner_html().trim().to_string())
        .collect();

    //TODO: to search by case-insensitive classes a matcher with quirks-mode need to be implemented
    assert_eq!(
        all_matched,
        "<li>1</li><li>2</li><li>3</li><li>4</li><li>5</li><li>6</li>"
    );
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_select_empty() {
    let contents = r#"<!DOCTYPE html>
    <html>
       <head><title>Test</title></head>
        <body>
           <div></div>
           <div>Some text</div>
        </body>
    </html>
    "#;
    let doc: Document = contents.into();

    let sel_with_empty = doc.select("div:empty");
    assert!(sel_with_empty.exists());
    sel_with_empty.remove();
    assert!(doc.select(r#"div:has-text("Some text")"#).exists());
    assert!(!doc.select(r#"div:empty"#).exists());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_children_size() {
    let contents = r#"
           <div class="main"><div><span> </span></div></div>
    "#;
    let doc: Document = contents.into();

    let sel = doc.select("div.main");
    let node = sel.nodes().first().unwrap();

    assert_eq!(node.children().len(), 1)
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_all_ancestors() {
    let doc: Document = ANCESTORS_CONTENTS.into();

    let child_sel = doc.select("#first-child");
    assert!(child_sel.exists());

    let child_node = child_sel.nodes().first().unwrap();

    let ancestors = child_node.ancestors(None);

    let ancestor_sel = Selection::from(ancestors);

    // ancestors includes all ancestral nodes including html

    // the root html element is presented in the ancestor selection
    assert!(ancestor_sel.is("html"));

    // also the direct parent of our starting node is presented
    assert!(ancestor_sel.is("#parent"));

    // `Selection::is` matches only the current selection without descending down the tree,
    // so it won't match the #child node.
    assert!(!ancestor_sel.is("#first-child"));
    // empty selection provide empty ancestors result
    assert!(doc.select("#third-child").ancestors(None).is_empty())
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_ancestors_with_limit() {
    let doc: Document = ANCESTORS_CONTENTS.into();

    let child_sel = doc.select("#first-child");
    assert!(child_sel.exists());

    let child_node = child_sel.nodes().first().unwrap();

    let ancestors = child_node.ancestors(Some(2));

    // got 2 ancestors
    assert!(ancestors.len() == 2);

    let ancestor_sel = Selection::from(ancestors);

    // in this case ancestors includes only two ancestral nodes: #grand-parent and #parent
    assert!(ancestor_sel.is("#grand-parent"));
    assert!(ancestor_sel.is("#parent"));
    assert!(!ancestor_sel.is("#great-ancestor"));
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_ancestor_iter_with_limit() {
    let doc: Document = ANCESTORS_CONTENTS.into();

    let child_sel = doc.select("#first-child");
    assert!(child_sel.exists());

    let child_node = child_sel.nodes().first().unwrap();
    let ancestors = child_node.ancestors_it(Some(2));
    // utilizing ancestors iterator (without intermediate collection)
    // got 2 ancestors
    assert!(ancestors.count() == 2);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_ancestors_selection_with_limit() {
    let doc: Document = ANCESTORS_CONTENTS.into();

    let child_sel = doc.select("#first-child, #second-child");
    assert_eq!(child_sel.length(), 2);
    // in this case two children has common ancestors
    let ancestor_sel = child_sel.ancestors(Some(2));
    // and we require only first two of them
    assert_eq!(ancestor_sel.length(), 2);

    // in this case ancestors includes only two ancestral nodes: #grand-parent and #parent
    assert!(ancestor_sel.is("#grand-parent"));
    assert!(ancestor_sel.is("#parent"));
    assert!(!ancestor_sel.is("#great-ancestor"));
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_selection_add_selection() {
    let doc: Document = ANCESTORS_CONTENTS.into();

    let first_sel = doc.select("#first-child");
    assert_eq!(first_sel.length(), 1);
    let second_sel = doc.select("#second-child");
    assert_eq!(second_sel.length(), 1);
    let children_sel = first_sel.add_selection(&second_sel);
    assert_eq!(children_sel.length(), 2);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
#[should_panic]
fn test_selection_add_selection_other_tree() {
    let doc: Document = ANCESTORS_CONTENTS.into();

    let first_sel = doc.select("#first-child");

    let other_doc: Document = ANCESTORS_CONTENTS.into();
    let other_sel = other_doc.select("#second-child");

    first_sel.add_selection(&other_sel);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_selection_add() {
    let doc: Document = ANCESTORS_CONTENTS.into();

    let children_sel = doc.select("#first-child").add("#second-child");
    assert_eq!(children_sel.length(), 2);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
#[should_panic]
fn test_selection_add_panic() {
    let doc: Document = ANCESTORS_CONTENTS.into();

    doc.select("#first-child").add(":;'");
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_selection_try_add() {
    let doc: Document = ANCESTORS_CONTENTS.into();

    let first_child_sel = doc.select("#first-child");
    assert_eq!(first_child_sel.length(), 1);

    let children_sel = first_child_sel.try_add(":;'");
    assert!(children_sel.is_none());

    let children_sel = first_child_sel.try_add("#second-child");
    assert_eq!(children_sel.unwrap().length(), 2);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_select_inside_noscript() {
    let doc: Document = r#"<!DOCTYPE html>
    <html>
        <head><title>Test</title></head>
        <body>
            <noscript>
                <div>Please enable javascript to run this site</div>
            </noscript>
        </body>
    </html>
    "#
    .into();

    let sel = doc.select("noscript div");
    assert_eq!(&sel.text(), "Please enable javascript to run this site");
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_selection_last() {
    let doc: Document = ANCESTORS_CONTENTS.into();

    let sel = doc.select("#parent > div").last();
    assert!(sel.is("#second-child"));

    let empty_sel = doc.select("#non-existing > div").last();
    assert!(empty_sel.is_empty());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_selection_prev_sibling() {
    let doc: Document = ANCESTORS_CONTENTS.into();

    let sel = doc.select("#parent > #second-child").prev_sibling();
    assert!(sel.is("#first-child"));

    // Test element without previous siblings
    let no_prev_sibling = doc.select("#first-child").prev_sibling();
    assert!(no_prev_sibling.is_empty());

    // Test non-existent element
    let non_existing = doc.select("#non-existing").prev_sibling();
    assert!(non_existing.is_empty());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_selection_get_node() {
    let doc: Document = ANCESTORS_CONTENTS.into();

    let sel = doc.select("#parent > div");

    let second = sel.get(1);

    assert!(second.is_some());

    let third = sel.get(2);
    assert!(third.is_none());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_selection_formatted_text() {
    let doc = Document::from(DMC_CONTENTS);
    let sel = doc.select("p");
    let text = sel.formatted_text();
    let expected = r#"Listen up y'all, it's time to get down
'Bout that normalized_char_count in this town
Traversing nodes with style and grace
Counting chars at a steady pace

No split whitespace, that's old school
Direct counting's our golden rule
Skip them nodes that ain't text or element
That's how we keep our code development!

"#;
    assert_eq!(text.as_ref(), expected);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_selection_class() {
    let doc: Document = ANCESTORS_CONTENTS.into();

    let sel = doc.select("#parent > #first-child");
    assert_eq!(&sel.class().unwrap(), "child");

    assert_eq!(doc.select("#parent").class(), None);
    assert_eq!(doc.select("#non-existing").class(), None);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_selection_id() {
    let doc: Document = ANCESTORS_CONTENTS.into();

    let sel = doc.select("#parent > #first-child");
    assert_eq!(&sel.id().unwrap(), "first-child");

    assert_eq!(doc.select("body").id(), None);
    assert_eq!(doc.select("#non-existing").id(), None);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_selection_is_sorted() {
    let is_sorted = |v: &[NodeId]| -> bool { v.windows(2).all(|w| w[0] <= w[1]) };
    let doc: Document = ANCESTORS_CONTENTS.into();

    let sel_0 = doc.select("div");
    let nodes_id_0 = sel_0.nodes().iter().map(|n| n.id).collect::<Vec<_>>();
    assert!(is_sorted(&nodes_id_0));

    let sel_1 = doc.select("#great-ancestor > div").select("div > div");
    let nodes_id_1 = sel_1.nodes().iter().map(|n| n.id).collect::<Vec<_>>();
    assert!(is_sorted(&nodes_id_1));

    let sel_2 = doc.select("#great-ancestor div").select("div > div");
    let nodes_id_2 = sel_2.nodes().iter().map(|n| n.id).collect::<Vec<_>>();
    assert!(is_sorted(&nodes_id_2));
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_select_single_ancestors() {
    let doc: Document = ANCESTORS_CONTENTS.into();

    let nonexisting_sel = doc
        .select("#ancestor")
        .select("#parent")
        .select_single("div");
    assert!(!nonexisting_sel.exists());

    let div_sel = doc.select_single("#great-ancestor").select_single("div");
    assert!(div_sel.exists());

    let p_sel = doc.select_single("#great-ancestor").select_single("p");
    assert!(!p_sel.exists());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_select_iter() {
    let doc: Document = LIST_CONTENTS.into();

    let li_matcher = dom_query::Matcher::new("li").unwrap();

    // a base selection with one element
    let body_sel = doc.select_single("body");

    let li_count_a = body_sel.select_matcher(&li_matcher).size();
    // li_count_b does the same thing as above but is more efficient because it doesn't allocate a result vector.
    let li_count_b = body_sel.select_matcher_iter(&li_matcher).count();

    assert_eq!(li_count_a, li_count_b);

    // a base selection with multiple elements
    let div_sel = doc.select("div");

    let li_count_a = div_sel.select_matcher(&li_matcher).size();
    let li_count_b = div_sel.select_matcher_iter(&li_matcher).count();

    assert_eq!(li_count_a, li_count_b);

    // no matches (there are no `p` elements in the document)
    let a_matcher = dom_query::Matcher::new("a").unwrap();
    assert_eq!(doc.select("p").select_matcher_iter(&a_matcher).count(), 0);
}
