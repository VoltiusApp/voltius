use std::cell::Ref;
use std::io;

use html5ever::serialize::TraversalScope;
use html5ever::serialize::{Serialize, Serializer};
use html5ever::QualName;

use super::node_data::NodeData;
use super::node_ref::NodeRef;
use super::{child_nodes, NodeId};

pub(crate) enum SerializeOp<'a> {
    Open(NodeId),
    Close(&'a QualName),
}
/// Serializable wrapper of Node.
pub struct SerializableNodeRef<'a>(NodeRef<'a>);

impl<'a> From<NodeRef<'a>> for SerializableNodeRef<'a> {
    fn from(h: NodeRef<'a>) -> SerializableNodeRef<'a> {
        SerializableNodeRef(h)
    }
}

impl Serialize for SerializableNodeRef<'_> {
    fn serialize<S>(&self, serializer: &mut S, traversal_scope: TraversalScope) -> io::Result<()>
    where
        S: Serializer,
    {
        let nodes = self.0.tree.nodes.borrow();
        let id = self.0.id;

        // Initialize ops stack
        let mut ops = match traversal_scope {
            TraversalScope::IncludeNode => vec![SerializeOp::Open(id)],
            TraversalScope::ChildrenOnly(_) => child_nodes(Ref::clone(&nodes), &id, true)
                .map(SerializeOp::Open)
                .collect(),
        };
        while let Some(op) = ops.pop() {
            match op {
                SerializeOp::Open(id) => {
                    let Some(node) = nodes.get(id.value) else {
                        continue;
                    };

                    match &node.data {
                        NodeData::Element(e) => {
                            serializer.start_elem(
                                e.name.clone(),
                                e.attrs.iter().map(|at| (&at.name, &at.value[..])),
                            )?;

                            ops.push(SerializeOp::Close(&e.name));
                            ops.extend(
                                child_nodes(Ref::clone(&nodes), &id, true).map(SerializeOp::Open),
                            );

                            if let Some(tpl_doc_root) = e.template_contents {
                                ops.push(SerializeOp::Open(tpl_doc_root));
                            }

                            Ok(())
                        }
                        NodeData::Doctype { name, .. } => serializer.write_doctype(name),
                        NodeData::Text { contents } => serializer.write_text(contents),
                        NodeData::Comment { contents } => serializer.write_comment(contents),
                        NodeData::ProcessingInstruction { target, contents } => {
                            serializer.write_processing_instruction(target, contents)
                        }
                        NodeData::Document | NodeData::Fragment => {
                            // Push children in reverse order
                            ops.extend(
                                child_nodes(Ref::clone(&nodes), &id, true).map(SerializeOp::Open),
                            );
                            Ok(())
                        }
                    }?;
                }
                SerializeOp::Close(name) => serializer.end_elem(name.clone())?,
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::Document;

    #[test]
    fn test_template_serialization() {
        let contents = r#"<html>
                <head></head>
                <body>
                    <template>
                        <p>template content</p>
                    </template>
                </body>
            </html>"#;
        let doc = Document::from(contents);
        let got_html = doc.html();
        assert_eq!(
            got_html
                .split_ascii_whitespace()
                .collect::<Vec<&str>>()
                .join(""),
            contents
                .split_ascii_whitespace()
                .collect::<Vec<&str>>()
                .join("")
        );
    }
}
