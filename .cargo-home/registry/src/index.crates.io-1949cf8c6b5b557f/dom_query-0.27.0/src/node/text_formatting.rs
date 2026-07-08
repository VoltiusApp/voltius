use std::cell::Ref;

use html5ever::{local_name, QualName};
use tendril::StrTendril;

use crate::TreeNodeOps;

use super::SerializeOp;
use super::{child_nodes, NodeData, NodeRef};

pub(crate) fn format_text(root_node: &NodeRef, include_node: bool) -> StrTendril {
    let id = root_node.id;
    let nodes = root_node.tree.nodes.borrow();
    let mut ops = if include_node {
        vec![SerializeOp::Open(id)]
    } else {
        child_nodes(Ref::clone(&nodes), &id, true)
            .map(SerializeOp::Open)
            .collect()
    };

    let mut text = StrTendril::new();

    while let Some(op) = ops.pop() {
        match op {
            SerializeOp::Open(id) => {
                let node = match nodes.get(id.value) {
                    Some(node) => node,
                    None => continue,
                };

                match node.data {
                    NodeData::Text { ref contents } => {
                        push_normalized_text(&mut text, contents.as_ref());
                    }
                    NodeData::Element(ref e) => {
                        if !(text.is_empty() || text.ends_with("\n\n"))
                            && elem_require_linebreak(&e.name)
                        {
                            text.push_char('\n');
                        }

                        ops.push(SerializeOp::Close(&e.name));

                        if matches!(e.name.local, local_name!("pre")) {
                            text.push_tendril(&TreeNodeOps::text_of(Ref::clone(&nodes), id));
                            continue;
                        }

                        ops.extend(
                            child_nodes(Ref::clone(&nodes), &id, true).map(SerializeOp::Open),
                        );
                    }
                    _ => {}
                }
            }
            SerializeOp::Close(name) => {
                adjust_element_offset(&mut text, name);
            }
        }
    }
    if !include_node {
        while !text.is_empty() && text.ends_with(char::is_whitespace) {
            text.pop_back(1);
        }
    }
    text
}

fn push_normalized_text(text: &mut StrTendril, new_text: &str) {
    let follows_newline = text.ends_with(['\n', ' ']) || text.is_empty();
    let push_start_whitespace = !follows_newline && new_text.starts_with(char::is_whitespace);
    let push_end_whitespace = new_text.ends_with(char::is_whitespace);

    let mut result = StrTendril::with_capacity(new_text.len() as u32);
    let mut iter = new_text.split_whitespace();

    if let Some(first) = iter.next() {
        if push_start_whitespace {
            result.push_char(' ');
        }
        result.push_slice(first);
        for word in iter {
            result.push_char(' ');
            result.push_slice(word);
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

fn trim_right_tendril_space(s: &mut StrTendril) {
    while !s.is_empty() && s.ends_with(' ') {
        s.pop_back(1);
    }
}

fn adjust_element_offset(text: &mut StrTendril, name: &QualName) {
    if text.is_empty() || text.ends_with("\n\n") {
        return;
    }

    if elem_require_linebreak(name) {
        trim_right_tendril_space(text);
        text.push_slice("\n\n");
    } else if matches!(
        name.local,
        local_name!("br") | local_name!("hr") | local_name!("li") | local_name!("tr")
    ) {
        trim_right_tendril_space(text);
        text.push_char('\n');
    } else if matches!(name.local, local_name!("td") | local_name!("th"))
        && !text.ends_with(['\n', ' '])
    {
        text.push_char(' ');
    }
}

fn elem_require_linebreak(name: &QualName) -> bool {
    matches!(
        name.local,
        local_name!("article")
            | local_name!("blockquote")
            | local_name!("section")
            | local_name!("div")
            | local_name!("p")
            | local_name!("pre")
            | local_name!("h1")
            | local_name!("h2")
            | local_name!("h3")
            | local_name!("h4")
            | local_name!("h5")
            | local_name!("h6")
            | local_name!("ul")
            | local_name!("ol")
            | local_name!("dl")
            | local_name!("table")
    )
}
