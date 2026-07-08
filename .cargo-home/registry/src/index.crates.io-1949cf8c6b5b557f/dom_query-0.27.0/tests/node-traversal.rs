use dom_query::{Document, NodeData, Selection};

mod data;
use data::{ANCESTORS_CONTENTS, DMC_CONTENTS, MINI_TABLE_CONTENTS};

#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::*;

mod alloc;

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_first_element_child_edge_cases() {
    let html = r#"
        <div id="empty"></div>
        <div id="text-only">Some text</div>
        <div id="multiple">
            <span>First</span>
            <span>Second</span>
        </div>
        <div id="nested">
            <div>
                <span>Nested</span>
            </div>
        </div>
    "#;

    let doc: Document = html.into();

    // Test empty parent
    let empty_sel = doc.select("#empty");
    let empty = empty_sel.nodes().first().unwrap();
    assert!(empty.first_element_child().is_none());

    // Test text-only parent
    let text_only_sel = doc.select("#text-only");
    let text_only = text_only_sel.nodes().first().unwrap();
    assert!(text_only.first_element_child().is_none());

    // Test multiple children
    let multiple_sel = doc.select("#multiple");
    let multiple = multiple_sel.nodes().first().unwrap();
    let first = multiple.first_element_child().unwrap();
    assert_eq!(&first.text(), "First");
    assert!(first.is_element());

    // Test nested elements
    let nested_sel = doc.select("#nested");
    let nested = nested_sel.nodes().first().unwrap();
    let first_nested = nested.first_element_child().unwrap();
    assert!(first_nested.is_element());
    assert_eq!(
        &first_nested.first_element_child().unwrap().text(),
        "Nested"
    );
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_descendants_iter() {
    let doc: Document = ANCESTORS_CONTENTS.into();

    let ancestor = doc.select("#great-ancestor");
    assert!(ancestor.exists());

    let ancestor_node = ancestor.nodes().first().unwrap();

    // with no depth limit
    let descendants_id_names = ancestor_node
        .descendants_it()
        .filter(|n| n.is_element())
        .map(|n| n.attr_or("id", "").to_string())
        .collect::<Vec<_>>();

    let expected_id_names = vec![
        "grand-parent",
        "parent",
        "first-child",
        "second-child",
        "grand-parent-sibling",
    ];
    assert_eq!(descendants_id_names, expected_id_names);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_descendants() {
    let doc: Document = ANCESTORS_CONTENTS.into();

    let ancestor = doc.select("#great-ancestor");
    assert!(ancestor.exists());

    let ancestor_node = ancestor.nodes().first().unwrap();

    let expected_id_names = vec![
        "grand-parent-sibling",
        "second-child",
        "first-child",
        "parent",
        "grand-parent",
    ];

    // if you want to reuse descendants then use `descendants` which returns a vector of nodes
    let descendants = ancestor_node.descendants();

    let text_nodes_count = descendants
        .iter()
        .filter(|n| n.is_text() && n.text().trim() != "")
        .count();
    let offsets_count = descendants
        .iter()
        .filter(|n| n.is_text() && n.text().trim() == "")
        .count();
    // Descendants include not only element nodes, but also text nodes.
    // Whitespace characters between element nodes are also considered as text nodes.
    // Therefore, the number of descendants is usually not equal to the number of element descendants.
    assert_eq!(
        descendants.len(),
        expected_id_names.len() + text_nodes_count + offsets_count
    );

    // with no depth limit
    let descendants_id_names = descendants
        .iter()
        .rev()
        .filter(|n| n.is_element())
        .map(|n| n.attr_or("id", "").to_string())
        .collect::<Vec<_>>();

    assert_eq!(descendants_id_names, expected_id_names);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_descendants_bound() {
    // previously `DescendantNodes` could traverse beyond the initial node when iterating over descendants.
    let doc: Document = ANCESTORS_CONTENTS.into();

    // multiple descendants, no siblings
    let parent = doc.select("#parent");
    let parent_node = parent.nodes().first().unwrap();
    let descendants_id_names: Vec<String> = parent_node
        .descendants_it()
        .filter(|n| n.is_element())
        .map(|n| n.attr_or("id", "").to_string())
        .collect();
    let expected_id_names = vec!["first-child", "second-child"];
    assert_eq!(descendants_id_names, expected_id_names);

    // one descendant, text
    let child_sel = doc.select("#first-child");
    let child_node = child_sel.nodes().first().unwrap();
    assert_eq!(child_node.descendants_it().count(), 1);

    // no descendants
    let no_descendants_sel = doc.select("#grand-parent-sibling");
    let no_descendants_node = no_descendants_sel.nodes().first().unwrap();
    assert_eq!(no_descendants_node.descendants_it().count(), 0);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_descendants_after_mod() {
    // previously `DescendantNodes` could traverse beyond the initial node when iterating over descendants.
    let doc: Document = ANCESTORS_CONTENTS.into();

    let parent = doc.select_single("#parent");
    let parent_node = parent.nodes().first().unwrap();

    let grand_parent = doc.select_single("#grand-parent");
    let grand_parent_node = grand_parent.nodes().first().unwrap();

    grand_parent_node.replace_with(parent_node);
    parent_node.append_child(grand_parent_node);

    let descendants_id_names: Vec<String> = parent_node
        .descendants_it()
        .filter(|n| n.is_element())
        .map(|n| n.attr_or("id", "").to_string())
        .collect();
    let expected_id_names = vec!["first-child", "second-child", "grand-parent"];
    assert_eq!(descendants_id_names, expected_id_names);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_last_child() {
    let doc: Document = ANCESTORS_CONTENTS.into();

    let parent_sel = doc.select_single("#parent");
    assert!(parent_sel.exists());
    let last_child = parent_sel.nodes().first().and_then(|n| n.last_child());

    // when dealing with formatted documents, the last child may be a text node like "\n   "
    assert!(last_child.unwrap().is_text());

    let parent_sel = doc.select_single("#grand-parent-sibling");
    assert!(parent_sel.exists());
    let last_child = parent_sel.nodes().first().and_then(|n| n.last_child());

    assert!(last_child.is_none());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_last_sibling() {
    let doc: Document = ANCESTORS_CONTENTS.into();
    let first_sel = doc.select_single("#first-child");
    assert!(first_sel.exists());
    let last_sibling = first_sel.nodes().first().and_then(|n| n.last_sibling());
    // when dealing with formatted documents, the last node may be a text node like "\n   "
    assert!(last_sibling.unwrap().is_text());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_is_comment() {
    let doc: Document = ANCESTORS_CONTENTS.into();
    let ancestor_sel = doc.select_single("body");
    let ancestor_node = ancestor_sel.nodes().first().unwrap();
    let first_comment = ancestor_node
        .children_it(false)
        .find(|n| n.is_comment())
        .unwrap();

    let comment = first_comment.query_or("".to_string(), |n| match n.data {
        NodeData::Comment { ref contents } => contents.to_string(),
        _ => "".to_string(),
    });

    assert_eq!(comment, "Ancestors");
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_element_children() {
    let doc: Document = r#"<!DOCTYPE html>
    <html>
        <head><title>Test</title></head>
        <body>
            <div class="main"><div>1</div><div>2</div><div>3</div>Inline text</div>
        <body>
    </html>"#
        .into();
    let sel = doc.select_single("div.main");

    // our main node
    let main_node = sel.nodes().first().unwrap();
    // `Node::children` includes all children nodes of its, not only element, but also text
    // tabs and newlines considered as text.
    assert_eq!(main_node.children().len(), 4);

    // `Node::element_children` includes only elements nodes
    assert_eq!(main_node.element_children().len(), 3);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_prev_sibling() {
    let doc = Document::from(ANCESTORS_CONTENTS);
    let last_child_sel = doc.select_single("#second-child");
    let last_child = last_child_sel.nodes().first().unwrap();

    let prev_sibling = last_child.prev_sibling().unwrap();
    let prev_sibling_sel = Selection::from(prev_sibling);
    // in this case prev element is not an element but a text node with whitespace (indentation)
    assert!(!prev_sibling_sel.is("#first-child"));

    // so, more convenient way to get previous element sibling is:
    let prev_element_sibling = last_child.prev_element_sibling().unwrap();
    let prev_element_sibling_sel = Selection::from(prev_element_sibling);
    assert!(prev_element_sibling_sel.is("#first-child"));
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_is() {
    let doc = Document::from(ANCESTORS_CONTENTS);
    let parent_sel = doc.select_single("#parent");
    let parent_node = parent_sel.nodes().first().unwrap();
    assert!(parent_node.is("div#parent"));
    assert!(parent_node.is(":has(#first-child)"));
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_text_node_is() {
    let doc = Document::from(ANCESTORS_CONTENTS);
    let sel = doc.select_single("#first-child");
    let node = sel.nodes().first().unwrap();
    let first_child = node.first_child().unwrap();
    assert!(first_child.is_text());

    assert!(!first_child.is("#text"));
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_is_nonempty_text() {
    let doc = Document::from(ANCESTORS_CONTENTS);
    let sel = doc.select_single("#first-child");
    let node = sel.nodes().first().unwrap();
    assert!(!node.is_nonempty_text());
    let first_child = node.first_child().unwrap();
    assert!(first_child.is_nonempty_text());

    let body_sel = doc.select_single("body");
    let body_node = body_sel.nodes().first().unwrap();
    let body_first_child = body_node.first_child().unwrap();
    assert!(body_first_child.is_text() && !body_first_child.is_nonempty_text());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_has_name() {
    let doc = Document::from(ANCESTORS_CONTENTS);
    let sel = doc.select_single("#first-child");
    let node = sel.nodes().first().unwrap();
    assert!(node.has_name("div"));
    assert!(!node.has_name("p"));
    let text_child = node.first_child().unwrap();
    assert!(!text_child.has_name("div"));
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_get_qual_name() {
    let doc = Document::from(ANCESTORS_CONTENTS);
    let sel = doc.select_single("#first-child");
    let node = sel.nodes().first().unwrap();
    let node_qual_name = node.qual_name_ref().unwrap();
    assert_eq!(node_qual_name.local.as_ref(), "div");
    assert_ne!(node_qual_name.local.as_ref(), "p");
    let text_child = node.first_child().unwrap();
    assert!(!text_child.has_name("div"));
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_base_uri() {
    let contents: &str = r#"<!DOCTYPE html>
    <html>
        <head>
            <base href="https://www.example.com/"/>
            <title>Test</title>
        </head>
        <body>
            <div id="main"></div>
        </body>
    </html>"#;
    let doc = Document::from(contents);

    // It may be called from document level.
    let base_uri = doc.base_uri().unwrap();
    assert_eq!(base_uri.as_ref(), "https://www.example.com/");

    let sel = doc.select_single("#main");
    let node = sel.nodes().first().unwrap();
    // Accessible from any node of the tree.
    let base_uri = node.base_uri().unwrap();
    assert_eq!(base_uri.as_ref(), "https://www.example.com/");
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_base_uri_none() {
    let doc = Document::from(ANCESTORS_CONTENTS);
    assert!(doc.base_uri().is_none());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_find() {
    let html_contents = include_str!("../test-pages/hacker_news.html");
    let doc = Document::from(html_contents);
    let a_sel = doc.select("body td a");
    let expected_ids: Vec<dom_query::NodeId> = a_sel.nodes().iter().map(|n| n.id).collect();

    let root = doc.root();
    let got_ids: Vec<dom_query::NodeId> = root
        .find(&["body", "td", "a"])
        .iter()
        .map(|n| n.id)
        .collect();

    assert_eq!(got_ids, expected_ids);

    let got_ids_a: Vec<dom_query::NodeId> = root.find(&["a"]).iter().map(|n| n.id).collect();
    assert_eq!(got_ids_a, expected_ids);

    let len_fin_ne = root.find(&["body", "td", "p"]).len();
    assert_eq!(len_fin_ne, 0);
    let len_sel_ne = doc.select("body td p").length();
    assert_eq!(len_sel_ne, 0)
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_normalized_char_count() {
    let contents: &str = r#"
        <div id="main">
        A           very 
                                messy content
            <span>. A something       that</span>
            <p>
            asks to be     normalized     </p>


        </div>
    "#;

    let doc = Document::from(contents);
    let main_sel = doc.select_single("#main");
    let main_node = main_sel.nodes().first().unwrap();
    let expected = main_node
        .text()
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
        .len();
    let got = main_node.normalized_char_count();
    assert_eq!(got, expected);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_doc_formatted_text() {
    let doc = Document::from(DMC_CONTENTS);
    let text = doc.formatted_text();
    let expected = r#"Listen up y'all, it's time to get down
'Bout that normalized_char_count in this town
Traversing nodes with style and grace
Counting chars at a steady pace

No split whitespace, that's old school
Direct counting's our golden rule
Skip them nodes that ain't text or element
That's how we keep our code development!

            WORD!"#;

    assert_eq!(text.as_ref(), expected);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_doc_formatted_text_complex() {
    let contents = "<p>The <code><span>match</span></code> and <code><span>if</span><span> </span>\
    <span>let</span></code> expressions can be used for <a>pattern matching</a>. For example, \
    <code><span>match</span></code> can be used to double an optional integer value if present, \
    and return zero otherwise:<sup><a ><span>&#91;</span>57<span>&#93;</span></a></sup>
</p>";
    let doc = Document::from(contents);
    let text = doc.formatted_text();
    let expected = "The match and if let expressions can be used for pattern matching. \
    For example, match can be used to double an optional integer value if present, and return zero otherwise:[57]";

    assert_eq!(text.as_ref(), expected);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_doc_formatted_text_table() {
    let contents = "<table>
    <tr>
        <td><span>
                <span>568 points</span> by <a>sbarre</a> <span><a>\
                14 hours ago</a></span> <span></span> | <a>hide</a> | <a>167&nbsp;comments</a>
            </span>
        </td>
    </tr>
</table>";
    let doc = Document::from(contents);
    let text = doc.formatted_text();
    let expected = "568 points by sbarre 14 hours ago | hide | 167 comments";

    assert_eq!(text.as_ref(), expected);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_doc_table_formatted_text() {
    let doc = Document::from(MINI_TABLE_CONTENTS);
    let text = doc.formatted_text();
    let expected = "1 2 3\n4 5 6";
    assert_eq!(text.as_ref(), expected);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_formatted_text_div_after_inline() {
    let contents = "<table>
    <tr>
        <td>&nbsp;</td>
        <td>        <a>https://example.com</a>
            <div>
                <p><span></span>         Some text</p>
            </div>
        </td>
    </tr>
</table>";
    let doc = Document::from(contents);
    let text = doc.formatted_text();
    let expected = "https://example.com \n\nSome text";
    assert_eq!(text.as_ref(), expected);
}

#[cfg(feature = "markdown")]
#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_doc_format_md_table() {
    let doc = Document::from(MINI_TABLE_CONTENTS);
    let text = doc.md(None);
    let expected = "|   |   |   |\n\
    | - | - | - |\n\
    | 1 | 2 | 3 |\n\
    | 4 | 5 | 6 |";
    assert_eq!(text.as_ref(), expected);
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_html_root() {
    let doc = Document::from(MINI_TABLE_CONTENTS);
    let html_node = doc.html_root();
    assert!(html_node.has_name("html"));

    let empty_doc = Document::from("");
    let html_node = empty_doc.html_root();
    assert!(html_node.has_name("html"));

    let fragment = Document::fragment(MINI_TABLE_CONTENTS);
    let html_node = fragment.html_root();
    assert!(html_node.has_name("html"));

    let empty_fragment = Document::fragment("");
    let html_node = empty_fragment.html_root();
    assert!(html_node.has_name("html"));

    let bad_contents = "<something-bad";

    let bad_doc = Document::from(bad_contents);
    let html_node = bad_doc.html_root();
    assert!(html_node.has_name("html"));

    let bad_fragment = Document::fragment(bad_contents);
    let html_node = bad_fragment.html_root();
    assert!(html_node.has_name("html"));

    let contents_wo_html = "<div></div>";

    let doc = Document::from(contents_wo_html);
    let html_node = doc.html_root();
    assert!(html_node.has_name("html"));

    let fragment = Document::fragment(contents_wo_html);
    let html_node = fragment.html_root();
    assert!(html_node.has_name("html"));
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_copy_fragment() {
    let src_frag = Document::fragment(ANCESTORS_CONTENTS);
    assert!(src_frag.html_root().has_name("html"));
    assert!(src_frag.tree.validate().is_ok());

    let src_sel = src_frag.select("#grand-parent");
    let src_node = src_sel.nodes().first().unwrap();

    let dst_frag = src_node.to_fragment();
    assert!(dst_frag.html_root().has_name("html"));

    let dst_sel = dst_frag.select("#grand-parent");
    let dst_node = dst_sel.nodes().first().unwrap();
    assert_eq!(src_node.html(), dst_node.html());
    assert_eq!(
        src_node.children_it(false).count(),
        dst_node.children_it(false).count()
    );

    let frag = src_frag.root().to_fragment();
    assert_eq!(frag.select("html").length(), 1);

    let frag = src_frag.html_root().to_fragment();
    assert_eq!(frag.select("html").length(), 1);

    assert!(dst_frag.tree.validate().is_ok());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_body() {
    let contents: &str = r#"
    <html>
        <body>
            <div class="bg-dark"><p>Paragraph</p></div>
        </body>
    </html>"#;
    let doc = Document::from(contents);

    // It may be called from document level.
    let body = doc.body().unwrap();
    assert!(body.is("body"));

    // html5ever will create html and body elements, even if source content is empty.
    let doc = Document::from("");
    assert!(doc.body().is_some());

    let frag_contents: &str = r#"<div class="bg-dark"><p>Paragraph</p></div>"#;
    // fragment will not create a body element.
    let fragment = Document::fragment(frag_contents);
    assert!(fragment.body().is_none());

    let frag_contents: &str = r#"<html><body class="bg-dark"><p>Paragraph</p></body></html>"#;
    // fragment ignores `body` and puts its content directly into `html`.
    let fragment = Document::fragment(frag_contents);
    assert!(fragment.body().is_none());
    assert!(fragment.select("html > p").exists());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_node_head() {
    let contents: &str = r#"
    <html>
        <head>
            <title>Test Document</title>
            <meta charset="UTF-8">
        </head>
        <body>
        </body>
    </html>"#;
    let doc = Document::from(contents);

    // It may be called from document level.
    let body = doc.head().unwrap();
    assert!(body.is("head:has(title)"));

    // html5ever will create html and head elements, even if source content is empty.
    let doc = Document::from("");
    assert!(doc.head().is_some());

    let frag_contents: &str = r#"<html><head>
            <title>Test Document</title>
        </head></html>"#;
    // fragment will not create a head element.
    let fragment = Document::fragment(frag_contents);
    assert!(fragment.head().is_none());
    assert!(fragment.select("html > title").exists());
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_mathml_integration_point() {
    let contents: &str = include_str!("../test-pages/mathml.html");
    let doc = Document::from(contents);

    // It may be called from document level.
    let math_sel = doc.select_single(r#"math annotation-xml[encoding="application/xhtml+xml"]"#);
    let math_node = math_sel.nodes().first().unwrap();
    assert!(doc
        .tree
        .is_mathml_annotation_xml_integration_point(&math_node.id));
}

#[cfg_attr(not(target_arch = "wasm32"), test)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
fn test_text_node_immediate_text() {
    let contents: &str = r#"
<!DOCTYPE html>
<html>
    <head>
        <title>Test</title>
    </head>
    <body>
        <p>Test content</p>
    </body>
</html>
"#;
    let doc = Document::from(contents);

    let p_sel = doc.select("p");
    let p_node = p_sel.nodes().first().unwrap();

    let text_node = p_node.first_child().unwrap();

    let expected = "Test content";
    assert_eq!(&text_node.text(), expected);
    assert_eq!(&text_node.immediate_text(), expected);
}
