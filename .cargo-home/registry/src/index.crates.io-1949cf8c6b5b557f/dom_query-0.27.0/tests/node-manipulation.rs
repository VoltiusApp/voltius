mod data;

use data::{doc_with_siblings, ANCESTORS_CONTENTS, REPLACEMENT_CONTENTS};
use dom_query::{Document, NodeRef};

use html5ever::{local_name, ns, QualName};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::*;

mod alloc;

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_create_element() {
    let contents = r#"<!DOCTYPE html>
    <html lang="en">
        <head></head>
        <body>
            <div id="main">
            <div>
        </body>
    </html>"#;

    let doc = Document::from(contents);

    let main_id = doc.select_single("#main").nodes().iter().next().unwrap().id;

    let el = doc.tree.new_element("p");
    el.set_attr("id", "inline");
    doc.tree.append_child_of(&main_id, &el.id);

    assert!(doc.select("#main #inline").exists());
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_append_existing_element() {
    let doc = Document::from(REPLACEMENT_CONTENTS);
    let origin_sel = doc.select_single("p#origin");
    let origin_node = origin_sel.nodes().first().unwrap();

    assert_eq!(&doc.select_single("#origin").text(), "Something");

    let span_sel = doc.select_single(" #after-origin span");
    let span_node = span_sel.nodes().first().unwrap();

    origin_node.append_child(span_node);

    assert_eq!(&doc.select_single("#origin").text(), "SomethingAbout");
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_append_existing_children() {
    let doc = Document::from(REPLACEMENT_CONTENTS);
    let origin_sel = doc.select_single("p#origin");
    let origin_node = origin_sel.nodes().first().unwrap();

    assert_eq!(&doc.select_single("#origin").text(), "Something");

    let span_sel = doc.select_single(" #after-origin span");
    let span_node = span_sel.nodes().first().unwrap();

    // this thing adds a child element and its sibling after existing child nodes.
    origin_node.append_children(span_node);

    assert_eq!(&doc.select_single("#origin").text(), "SomethingAboutMe");
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_prepend_existing_element() {
    let doc = Document::from(REPLACEMENT_CONTENTS);
    let origin_sel = doc.select_single("p#origin");
    let origin_node = origin_sel.nodes().first().unwrap();

    assert_eq!(&doc.select_single("#origin").text(), "Something");

    let span_sel = doc.select_single(" #after-origin span");
    let span_node = span_sel.nodes().first().unwrap();

    origin_node.prepend_child(span_node);

    assert_eq!(&doc.select_single("#origin").text(), "AboutSomething");
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_prepend_existing_children() {
    let doc = Document::from(REPLACEMENT_CONTENTS);
    let origin_sel = doc.select_single("p#origin");
    let origin_node = origin_sel.nodes().first().unwrap();

    assert_eq!(&doc.select_single("#origin").text(), "Something");

    let span_sel = doc.select_single(" #after-origin span");
    let span_node = span_sel.nodes().first().unwrap();

    // this thing adds a child element and its sibling before existing child nodes.
    origin_node.prepend_children(span_node);

    assert_eq!(&doc.select_single("#origin").text(), "AboutMeSomething");
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_append_element_html() {
    let contents = r#"<!DOCTYPE html>
    <html lang="en">
        <head></head>
        <body>
            <div id="main">
                <p id="first">It's</p>
            <div>
        </body>
    </html>"#;

    let doc = Document::from(contents);
    let main_sel = doc.select_single("#main");
    let main_node = main_sel.nodes().first().unwrap();
    main_node.append_html(r#"<p id="second">Wonderful</p>"#);
    assert_eq!(doc.select("#main #second").text().as_ref(), "Wonderful");
    assert!(doc.select("#first").exists());
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_set_element_html() {
    let contents = r#"<!DOCTYPE html>
    <html lang="en">
        <head></head>
        <body>
            <div id="main">
                <p id="first">It's</p>
            </div>
        </body>
    </html>"#;

    let doc = Document::from(contents);
    let main_sel = doc.select_single("#main");
    let main_node = main_sel.nodes().first().unwrap();
    main_node.set_html(r#"<p id="second">Wonderful</p>"#);
    assert_eq!(doc.select("#main #second").text().as_ref(), "Wonderful");
    assert!(!doc.select("#first").exists());
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_change_parent_node() {
    let doc = Document::from(REPLACEMENT_CONTENTS);

    let origin_sel = doc.select_single("#origin");
    let origin_node = origin_sel.nodes().first().unwrap();

    // create a new `p` element with id:
    let p = doc.tree.new_element("p");
    p.set_attr("id", "outline");

    // taking origin_node's place
    origin_node.insert_before(&p.id);
    // remove it from it's current parent
    origin_node.remove_from_parent();
    // append it to new p element
    p.append_child(&origin_node.id);

    assert!(doc.select("#outline > #origin > #inline").exists());
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_replace_with_by_node_id() {
    // It's actually the same test as `test_change_parent_node`,
    // using `replace_with` instead of `append_prev_sibling` and `remove_from_parent`
    let doc = Document::from(REPLACEMENT_CONTENTS);

    let origin_sel = doc.select_single("#origin");
    let origin_node = origin_sel.nodes().first().unwrap();

    // create a new `p` element with id:
    let p = doc.tree.new_element("p");
    p.set_attr("id", "outline");

    // replacing origin_node with `p` node, detaching `origin_node` from the tree
    origin_node.replace_with(&p.id);

    // append `origin_node` it to the new `p` node
    p.append_child(&origin_node.id);

    assert!(doc.select("#outline > #origin > #inline").exists());
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_replace_with_by_node() {
    // It's actually the same test as `test_node_replace_with_by_node`,
    // using but using &node instead of &node.id in node methods.
    // which i find more readable
    let doc = Document::from(REPLACEMENT_CONTENTS);

    let origin_sel: dom_query::Selection<'_> = doc.select_single("#origin");
    let origin_node: &dom_query::NodeRef<'_> = origin_sel.nodes().first().unwrap();

    // create a new `p` element with id:
    let p: dom_query::NodeRef<'_> = doc.tree.new_element("p");
    p.set_attr("id", "outline");

    // replacing origin_node with `p` node, detaching `origin_node` from the tree
    origin_node.replace_with(&p);

    // append `origin_node` it to the new `p` node
    p.append_child(origin_node);

    assert!(doc.select("#outline > #origin > #inline").exists());
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_replace_with_html() {
    // It's actually the same test as `test_change_parent_node`,
    // using `replace_with` instead of `append_prev_sibling` and `remove_from_parent`
    let doc = Document::from(REPLACEMENT_CONTENTS);

    let origin_sel = doc.select_single("#origin");
    let origin_node = origin_sel.nodes().first().unwrap();
    // replacing origin_node with `p` node, detaching `origin_node` from the tree, origin node is detached
    origin_node.replace_with_html(r#"<p id="replaced"><span id="inline">Something</span></p>"#);
    // checking if #replaced can be access as next sibling of #before-origin
    assert!(doc.select("#before-origin + #replaced > #inline").exists());
    // checking if #after-origin can be access after it's new previous sibling
    assert!(doc.select("#replaced + #after-origin").exists());
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_replace_with_reparent() {
    let doc = Document::from(REPLACEMENT_CONTENTS);

    let origin_sel = doc.select_single("#origin");
    let origin_node = origin_sel.nodes().first().unwrap();

    // create a new `p` element with id:
    let p = doc.tree.new_element("p");
    p.set_attr("id", "outline");

    //taking node's place
    // taking origin_node's place
    origin_node.insert_before(&p.id);
    // remove it from it's current parent
    origin_node.remove_from_parent();
    // attach all children nodes to new p element
    doc.tree.reparent_children_of(&origin_node.id, Some(p.id));

    // #origin is not in the tree now
    assert!(!doc.select("#origin").exists());
    // #inline is a child of #outline now
    assert!(doc.select("#outline > #inline").exists());
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_replace_text_node() {
    let content = r#"<!DOCTYPE html>
    <html lang="en">
        <head></head>
        <body>
            <div id="main">
                <p><a href="javascript:void(0)">Some text</a></p>
            </div>
        </body>
    </html>"#;
    let doc = Document::from(content);
    // :only-text pseudo-class allows to select nodes that contain only one text node
    let a_sel = doc.select_single(r#"a[href^="javascript:"]:only-text"#);
    assert!(a_sel.exists());
    let a_node = a_sel.nodes().first().unwrap();
    let text_node = a_node.first_child().unwrap();
    assert!(text_node.is_text());
    a_node.replace_with(&text_node);

    assert_eq!(&doc.select("#main > p").inner_html(), "Some text");
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_set_text() {
    //! replacing existing content with text content
    let content = r#"<!DOCTYPE html>
    <html lang="en">
        <head></head>
        <body>
            <div id="main">
                <div id="content"><b>Original</b> content</div>
            </div>
        </body>
    </html>"#;
    let doc = Document::from(content);
    let content_sel = doc.select("#content");
    let content_node = content_sel.nodes().first().unwrap();

    let text = "New content";
    content_node.set_text(text);
    assert_eq!(&content_node.inner_html(), text);
    assert_eq!(&doc.select("#content").inner_html(), text);
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_prepend() {
    let doc = Document::from(REPLACEMENT_CONTENTS);

    let origin_sel = doc.select_single("#origin");
    let origin_node = origin_sel.nodes().first().unwrap();

    // create a new `span` element with id:
    let span = doc.tree.new_element("span");
    span.set_attr("id", "first");

    //taking node's place
    // taking origin_node's place
    origin_node.prepend_child(&span);

    // #origin is not in the tree now
    assert!(doc.select("#origin").exists());
    // #inline is a child of #outline now
    assert!(doc.select("#origin > #first  + #inline").exists());
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_prepend_html() {
    let doc = Document::from(REPLACEMENT_CONTENTS);

    let origin_sel = doc.select_single("#origin");
    let origin_node = origin_sel.nodes().first().unwrap();

    // you may prepend html fragment with one element inside,
    origin_node.prepend_html(r#"<span id="third">3</span>"#);

    // or more...
    origin_node.prepend_html(r#"<span id="first">1</span><span id="second">2</span>"#);
    assert!(doc
        .select("#origin > #first + #second + #third + #inline")
        .exists());
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_insert_before() {
    let doc = Document::from(REPLACEMENT_CONTENTS);

    let sel = doc.select_single("#before-origin");
    let node = sel.nodes().first().unwrap();

    let new_node = doc.tree.new_element("p");
    new_node.set_attr("id", "before-before-origin");

    node.insert_before(&new_node);

    assert!(doc
        .select("#before-before-origin + #before-origin + #origin + #after-origin")
        .exists());
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_insert_after() {
    let doc = Document::from(REPLACEMENT_CONTENTS);

    let sel = doc.select_single("#after-origin");
    let node = sel.nodes().first().unwrap();

    let new_node = doc.tree.new_element("p");
    new_node.set_attr("id", "after-after-origin");
    node.insert_after(&new_node);

    // Choosing the very last sibling is usually unnecessary, but this is a test to cover it.
    let last_sibling = node.last_sibling().unwrap();

    let new_last_node = doc.tree.new_element("p");
    new_last_node.set_attr("id", "last");
    last_sibling.insert_after(&new_last_node);

    assert!(doc
        .select("#before-origin + #origin + #after-origin + #after-after-origin + #last")
        .exists());
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_remove_descendants() {
    // The purpose of this test is to ensure that there is no BorrowMutError
    // during iteration through descendants, if `descendants()` is used
    let doc = Document::from(ANCESTORS_CONTENTS);

    let body_sel = doc.select_single("body");
    let body_node = body_sel.nodes().first().unwrap();

    for (i, node) in body_node.descendants().iter().enumerate() {
        // Modifying descendant elements during iteration.
        node.update(|n| {
            n.as_element_mut()
                .map(|el| el.set_attr("data-descendant", &i.to_string()))
        });
    }
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
#[should_panic]
fn test_node_remove_descendants_it_panic() {
    // The purpose of this test is to ensure that there is a BorrowMutError
    // during iteration through descendants, if `descendants_it()` is used.

    // This can be resolved at any time by borrowing from `RefCell`
    // on each iteration, but this will be a little bit slower.
    let doc = Document::from(ANCESTORS_CONTENTS);

    let body_sel = doc.select_single("body");
    let body_node = body_sel.nodes().first().unwrap();

    for (i, node) in body_node.descendants_it().enumerate() {
        // Modifying descendant elements during iteration.
        node.update(|n| {
            n.as_element_mut()
                .map(|el| el.set_attr("data-descendant", &i.to_string()))
        });
    }
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_normalize() {
    let doc = Document::from(ANCESTORS_CONTENTS);

    let first_child_sel = doc.select_single("#first-child");
    let first_child = first_child_sel.nodes().first().unwrap();

    assert_eq!(first_child.children_it(false).count(), 1);

    let text_1 = doc.tree.new_text(" and a");
    let text_2 = doc.tree.new_text(" ");
    let text_3 = doc.tree.new_text("tail");
    first_child.append_child(&text_1);
    first_child.append_child(&text_2);
    first_child.append_child(&text_3);
    assert_eq!(&first_child.text(), "Child and a tail");

    assert_eq!(first_child.children_it(false).count(), 4);
    doc.normalize();

    assert_eq!(first_child.children_it(false).count(), 1);
    assert_eq!(&first_child.text(), "Child and a tail");

    let grand_sel = doc.select_single("#grand-parent-sibling");
    let grand_node = grand_sel.nodes().first().unwrap();
    assert_eq!(grand_node.children_it(false).count(), 0);

    let total_empty_text_nodes = 5;

    for _ in 0..total_empty_text_nodes {
        let empty_text = doc.tree.new_text("");
        grand_node.append_child(&empty_text);
    }

    assert_eq!(
        grand_node.children_it(false).count(),
        total_empty_text_nodes
    );

    grand_node.normalize();
    assert_eq!(grand_node.children_it(false).count(), 0);
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_before_html() {
    let doc = Document::from(REPLACEMENT_CONTENTS);

    let sel = doc.select_single("#before-origin");
    let node = sel.nodes().first().unwrap();

    node.before_html(r#"<p id="before-before-origin"></p><p id="also-before-origin"></p>"#);

    assert!(doc
        .select("#before-before-origin + #also-before-origin + #before-origin + #origin + #after-origin")
        .exists());
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_after_html() {
    let doc = Document::from(REPLACEMENT_CONTENTS);

    let sel = doc.select_single("#after-origin");
    let node = sel.nodes().first().unwrap();

    node.after_html(r#"<p id="after-after-origin"></p><p id="also-after-origin"></p>"#);

    assert!(doc
        .select(
            "#before-origin + #origin + #after-origin + #after-after-origin + #also-after-origin"
        )
        .exists());
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_insert_siblings_before() {
    let doc = Document::from(REPLACEMENT_CONTENTS);

    let sel = doc.select_single("#before-origin");
    let node = sel.nodes().first().unwrap();

    let new_node_0 = doc.tree.new_element("p");
    new_node_0.set_attr("id", "before-0");

    let new_node_1 = doc.tree.new_element("p");
    new_node_1.set_attr("id", "before-1");

    new_node_0.insert_after(&new_node_1);

    node.insert_siblings_before(&new_node_0);

    assert!(doc
        .select("#before-0 + #before-1 + #before-origin + #origin + #after-origin")
        .exists());
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_insert_siblings_after() {
    let doc = Document::from(REPLACEMENT_CONTENTS);

    let sel = doc.select_single("#after-origin");
    let node = sel.nodes().first().unwrap();

    let new_node_0 = doc.tree.new_element("p");
    new_node_0.set_attr("id", "after-0");

    let new_node_1 = doc.tree.new_element("p");
    new_node_1.set_attr("id", "after-1");

    new_node_0.insert_after(&new_node_1);

    node.insert_siblings_after(&new_node_0);

    assert!(doc
        .select("#before-origin + #origin + #after-origin + #after-0 + #after-1")
        .exists());
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_add_class() {
    let doc = Document::from(ANCESTORS_CONTENTS);

    let sel = doc.select_single("#parent .child");
    let node = sel.nodes().first().unwrap();
    node.add_class("blue");
    assert_eq!(doc.select("#parent .blue.child").length(), 1);
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_remove_class() {
    let doc = Document::from(ANCESTORS_CONTENTS);

    let sel = doc.select("#parent .child");
    assert_eq!(sel.length(), 2);
    let node = sel.nodes().first().unwrap();
    node.remove_class("child");
    assert_eq!(doc.select("#parent .child").length(), 1);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_remove_attr() {
    let doc = Document::from(ANCESTORS_CONTENTS);

    let sel = doc.select("#parent [class]");
    assert_eq!(sel.length(), 2);
    let node = sel.nodes().first().unwrap();
    node.remove_attr("class");
    assert_eq!(doc.select("#parent [class]").length(), 1);
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_remove_attrs() {
    let doc = Document::from(ANCESTORS_CONTENTS);

    let sel = doc.select("#parent [class][id]");
    assert_eq!(sel.length(), 2);
    let first_child = sel.nodes().first().unwrap();
    first_child.remove_attrs(&["class", "id"]);
    assert_eq!(doc.select("#parent [class][id]").length(), 1);
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_retain_attrs() {
    let doc = Document::from(ANCESTORS_CONTENTS);

    let sel = doc.select("#parent [class][id]");
    assert_eq!(sel.length(), 2);
    let node = sel.nodes().first().unwrap();
    node.retain_attrs(&["id"]);
    assert_eq!(doc.select("#parent [class][id]").length(), 1);
    assert_eq!(doc.select("#parent [id]").length(), 2);
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_remove_all_attrs() {
    let doc = Document::from(ANCESTORS_CONTENTS);

    let sel = doc.select("#parent [class][id]");
    assert_eq!(sel.length(), 2);
    let node = sel.nodes().first().unwrap();
    node.remove_all_attrs();
    assert_eq!(doc.select("#parent [class][id]").length(), 1);
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_rename() {
    let doc = Document::from(ANCESTORS_CONTENTS);

    let sel = doc.select("#parent div");
    assert_eq!(sel.length(), 2);
    let node = sel.nodes().first().unwrap();
    node.rename("p");
    assert_eq!(doc.select("#parent div").length(), 1);
    assert_eq!(doc.select("#parent p").length(), 1);
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_strip_elements() {
    let doc = Document::from(ANCESTORS_CONTENTS);

    let sel = doc.select("body");
    let node = sel.nodes().first().unwrap();
    let descendants_before = node.descendants();
    // nothing to strip, so nothing should change
    node.strip_elements(&[]);
    assert_eq!(descendants_before.len(), node.descendants().len());
    // stripping all div elements inside `body`
    node.strip_elements(&["div"]);
    assert_eq!(doc.select("body div").length(), 0);
    assert_eq!(doc.select("body").text().matches("Child").count(), 2);
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_wrap_node() {
    let doc = Document::from(ANCESTORS_CONTENTS);

    let sel = doc.select("#first-child");
    let node = sel.nodes().first().unwrap();

    // Create a wrapper directly in the same tree
    let wrapper = doc.tree.new_element("div");
    wrapper.set_attr("id", "wrapper");

    node.wrap_node(&wrapper);

    // Wrapper should now exist
    assert_eq!(doc.select("#parent #wrapper").length(), 1);
    // Wrapper should contain the first-child
    assert_eq!(doc.select("#wrapper > #first-child").length(), 1);
    // Parent should still have two children, one being the wrapper
    assert_eq!(doc.select("#parent > *").length(), 2);

    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_wrap_node_existing() {
    let doc = Document::from(ANCESTORS_CONTENTS);

    let sel = doc.select("#first-child");
    let node = sel.nodes().first().unwrap();

    // Use the second-child as a wrapper
    let wrapper_sel = doc.select("#second-child");
    let wrapper = wrapper_sel.nodes().first().unwrap();

    node.wrap_node(wrapper);

    // Wrapper should now exist
    assert_eq!(doc.select("#parent #second-child").length(), 1);
    // Wrapper should contain the first-child
    assert_eq!(doc.select("#second-child > #first-child").length(), 1);
    // Parent should only have one child, the second-child wrapper
    assert_eq!(doc.select("#parent > *").length(), 1);

    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_wrap_html() {
    let doc = Document::from(ANCESTORS_CONTENTS);

    let sel = doc.select("#first-child");
    let node = sel.nodes().first().unwrap();

    // Wrap with an HTML fragment
    node.wrap_html("<div id='wrapper-html' class='wrapper'></div>");

    // Check wrapper exists in the DOM
    assert_eq!(doc.select("#parent #wrapper-html").length(), 1);

    // Check the wrapper contains the original node
    assert_eq!(doc.select("#wrapper-html > #first-child").length(), 1);

    // The wrapper should have class attribute
    let wrapper_sel = doc.select("#wrapper-html");
    let wrapper_node = wrapper_sel.nodes().first().unwrap();

    assert!(wrapper_node.has_class("wrapper"));
    // The parent should still have two children (wrapper and second-child)
    assert_eq!(doc.select("#parent > *").length(), 2);

    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_unwrap_node() {
    let doc = Document::from(ANCESTORS_CONTENTS);

    let sel = doc.select("#first-child");
    let node = sel.nodes().first().unwrap();
    node.unwrap_node();

    // The parent of #first-child (id="parent") should be removed
    assert!(doc.select("#parent").is_empty());

    // The grand-parent (id="grand-parent") should now directly contain #first-child and #second-child
    assert_eq!(doc.select("#grand-parent > #first-child").length(), 1);
    assert_eq!(doc.select("#grand-parent > #second-child").length(), 1);

    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_unwrap_node_noop_if_no_parent() {
    let doc = Document::from(ANCESTORS_CONTENTS);

    let root = doc.root();
    root.unwrap_node();

    // Nothing should change, root cannot be unwrapped
    assert_eq!(doc.select("html").length(), 1);
    assert_eq!(doc.select("#great-ancestor").length(), 1);

    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_set_html_empty() {
    let doc = doc_with_siblings();
    let main_sel = doc.select("#main");
    let main_node = main_sel.nodes().first().unwrap();
    main_node.set_html("");
    assert_eq!(doc.select("#main").length(), 1);
    assert_eq!(doc.select("#main").children().length(), 0);
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_empty_doc_append() {
    let injection = r#"<p>text</p>"#;

    let doc = Document::default();
    assert!(doc.html().is_empty());
    doc.root().append_html(injection);
    // Currently merging with empty document (without elements), or created with `Document::default()` is not supported.
    assert!(doc.html().is_empty());
    // Ensure internal links are sound when templates are injected.
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_add_meta_element() {
    let contents: &str = r#"
<!DOCTYPE html>
<html>
    <head>
        <title>Test</title>
    </head>
    <body>
    </body>
</html>
"#;
    let doc = Document::from(contents);
    let head = doc.head().unwrap();
    let meta_node = doc.tree.new_element("meta");
    meta_node.set_attr("name", "viewport");
    meta_node.set_attr("content", "width=1120");
    head.prepend_child(&meta_node);
    let actual = doc.html();
    assert!(actual.contains(r#"<meta name="viewport" content="width=1120">"#));
    assert!(!actual.contains(r#"</meta>"#));
    doc.tree.validate().unwrap();
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_add_svg() {
    let contents: &str = r#"
<!DOCTYPE html>
<html>
    <head>
        <title>Test</title>
    </head>
    <body>
        <svg><circle cx="50" cy="50" r="40"/></svg>
    </body>
</html>
"#;
    let doc = Document::from(contents);
    let body_node = doc.body().unwrap();

    // creating a new element with `append_html`
    let svg_contents = r#"<svg><circle cx="50" cy="50" r="40"/></svg>"#;
    body_node.append_html(svg_contents);
    let svg_sel = doc.select("body > svg > circle");
    let first_circle = svg_sel.nodes().first().unwrap();
    let second_circle = svg_sel.nodes().last().unwrap();

    let cmp_qual_names = |a: &NodeRef, b: &NodeRef| {
        assert_ne!(a.id, b.id);
        let a_qual_name = a.qual_name_ref().unwrap();
        let b_qual_name = b.qual_name_ref().unwrap();
        assert!(a_qual_name.eq(&b_qual_name));
    };

    cmp_qual_names(first_circle, second_circle);

    // creating a new element manually with qual_name
    let svg_qual_name = QualName {
        prefix: None,
        ns: ns!(svg),
        local: local_name!("svg"),
    };
    let new_svg = doc.tree.new_element_qualname(svg_qual_name);

    let circle_qual_name = QualName {
        prefix: None,
        ns: ns!(svg),
        local: local_name!("circle"),
    };
    let new_circle = doc.tree.new_element_qualname(circle_qual_name);
    new_circle.set_attr("cx", "50");
    new_circle.set_attr("cy", "50");
    new_circle.set_attr("r", "40");
    new_svg.append_child(&new_circle);
    body_node.append_child(&new_svg);

    let svg_sel = doc.select("body > svg > circle");
    assert_eq!(svg_sel.length(), 3);
    let third_circle = svg_sel.nodes().last().unwrap();
    assert_eq!(new_circle.id, third_circle.id);
    cmp_qual_names(first_circle, third_circle);

    // creating a new svg element with **wrong** xhtml namespace
    let new_svg = doc.tree.new_element("svg");
    let new_circle = doc.tree.new_element("circle");
    new_circle.set_attr("cx", "50");
    new_circle.set_attr("cy", "50");
    new_circle.set_attr("r", "40");
    new_svg.append_child(&new_circle);
    body_node.append_child(&new_svg);

    let svg_sel = doc.select("body > svg > circle");
    assert_eq!(svg_sel.length(), 4);

    let fourth_circle = svg_sel.nodes().last().unwrap();
    assert_eq!(new_circle.id, fourth_circle.id);

    let first_qn = first_circle.qual_name_ref().unwrap();
    let fourth_qn = fourth_circle.qual_name_ref().unwrap();
    assert!(!first_qn.eq(&fourth_qn));
}
