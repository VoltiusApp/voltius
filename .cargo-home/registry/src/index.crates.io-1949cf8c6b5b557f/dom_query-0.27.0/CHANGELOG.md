# Changelog

All notable changes to the `dom_query` crate will be documented in this file.

## [0.27.0] - 2026-03-17

### Added
- Implemented `Tree::new_element_qualname`, which allows to create a new element with specific `html5ever::QualName`.

### Changed
- Improved performance of `Element::add_class` for both empty and pre-existing class attributes.
- `Element::remove_class` now uses a `Vec`-based approach to remove classes, preserving the original order and improving performance.

### Fixed
- Fixed incorrect namespace in `Tree::new_element` that caused manually created void elements 
to serialize with closing tags (elements created during parsing were not affected).


## [0.26.0] - 2026-03-09

### Changed
- Update dependencies:
  - `html5ever`: 0.36.1 -> 0.38.0
  - `tendril`: 0.4.3 -> 0.5.0
  - `selectors`: 0.35.0 -> 0.36.0


- Refactor internal `TreeNodeOps` methods. No functional changes.

### Fixed
- `NodeRef::immediate_text` now returns text for text nodes, not just immediate text of elements.

## [0.25.1] - 2026-01-18

### Changed
- Rollback of dependencies (the reason descibed in [#168](https://github.com/niklak/dom_query/pull/168)):
    - `html5ever`: 0.37.1 -> 0.36.1
    - `tendril`: 0.5.0 -> 0.4.3
- Revert code changes related to `html5ever` and `tendril` compatibility.

## [0.25.0] - 2026-01-17

### Added
- **Markdown**: handle block elements inside list elements (ul, ol).

### Changed
- Update dependencies:
  - `selectors`: 0.33.0 -> 0.35.0
  - `html5ever`: 0.36.1 -> 0.37.1
  - `tendril`: 0.4.3 -> 0.5.0

- Refactored code to be compatible with the latest changes in `html5ever` and `tendril`.
- Change internal code structure for `markdown` feature.

## [0.24.0] - 2025-11-21

### Added
- Added a benchmark for `Selection`.
- Added a benchmark for `NodeRef::normalized_char_count`.
- Added a *parsing* benchmark for `Document::from`.
- Added a benchmark for `Document::html`.

### Changed
- Change internal implementation of `NodeRef::find` method.
- Expose `TreeNode`.
- Update dependencies:
  - `selectors`: 0.31.1 -> 0.33.0
  - `cssparser`: 0.35.0 -> 0.36.0
  - `html5ever`: 0.35.0 -> 0.36.1

## [0.23.1] - 2025-10-12

### Added
- **Markdown**: `MDSerializer::find_code_language` now uses `MDSerializer::find_code_language_css_class` as a fallback when it fails to detect the `code` language from the ancestors (by @justahero).

### Fixed
- **Markdown**: Escape double quotes in `title` attributes of `<a>` elements (by @justahero).

### Changed
- `markdown` is a default crate feature.

## [0.23.0] - 2025-09-28

### Added
- Implemented `Element::attr_ref` method which returns an `&str` reference to the attribute value by `html5ever::LocalName`.
- Re-exported `html5ever::LocalName` and `html5ever::local_name`.
- **Markdown**: Enhanced `<pre>`-block parsing by checking its associated `data-lang` and `data-language` attributes (by @justahero)
- **Markdown**: Multiline `<code>` blocks are now parsed as `<pre>` blocks (by @justahero).
### Changed
- Revised `NodeRef::find_descendants` (requires `mini_selector` feature). This method now supports `Adjacent (+)` and `Sibling (~)` combinators.

### Fixed
- **Markdown**: fixed block element linebreak handling.

## [0.22.0] - 2025-09-03

### Added
- Implemented `Tree::is_mathml_annotation_xml_integration_point` method, which checks whether a node is a MathML annotation XML integration point.

### Changed
- Updated dependencies:
  - `foldhash`: 0.1.5 -> 0.2.0
  - `hashbrown`: 0.15.3 -> 0.16.0 (features unchanged)
- Refactored `dom_tree::helpers::normalized_char_count`.
- Set MSRV to 1.75.

## [0.21.0] - 2025-08-20

### Added
- Introduced `Tree::head` and `Tree::body` methods, which return `None` if the corresponding element is absent (e.g., fragments typically lack `<head>`/`<body>`). Added equivalent `Document::head` and `Document::body` methods.

### Fixed
- Revised `Document::create_element`. Now the `template` element precedes its `Fragment`, allowing HTML trees with templates to be merged more predictably.
- Skip merging trees (and all related operations) when the main tree is empty (e.g., a document created via `Document::default()`).

### Changed
- Minor refactor of `TreeNode::adjust` method; no functional or API changes.

## [0.20.2] - 2025-08-10

### Fixed
- Fixed `TreeNode::adjust` behavior, now considering that another tree may contain `template` elements.

## [0.20.1] - 2025-08-05

### Changed
- Refactored `TreeNodeOps::normalized_char_count`, `TreeNodeOps::text_of` and `NodeRef::has_text` methods to use iterator-based traversal.
- Refactored `NodeRef::is_nonempty_text`.

## [0.20.0] - 2025-08-01

### Added
- Introduced the `Selection::select_matcher_iter` method, which returns an iterator over all nodes matching the given matcher, without collecting them into a result vector. Useful for read-only operations.


### Changed
- `NodeRef` implements `Copy` trait.
- Minor code refactoring.

## [0.19.2] - 2025-07-08

### Changed
- Updated the dependencies:
  - `selectors` from 0.27.0 to 0.30.0
  - `html5ever` from 0.31.0 to 0.35.0

## [0.19.1] - 2025-05-21

### Fixed

- Fixed the behavior of `NodeRef::to_fragment` when the node is an `<html>` element or the root itself.

## [0.19.0] - 2025-05-20

### Added
- Introduced `Tree::html_root` and `Document::html_root` methods to get the root element (`<html>`) node of a document.
- Implemented the `NodeRef::to_fragment` method to create a full copy of a node's contents as a `Document` fragment.

### Removed
- Deprecated methods removed for clarity and maintenance: `Tree::append_prev_sibling_of`, `NodeRef::append_prev_sibling`, `NodeRef::append_prev_siblings`, `Selection::next`.

## [0.18.0] - 2025-04-26

### Added
- Introduced `NodeRef::wrap_node`, `NodeRef::wrap_html`, and `NodeRef::unwrap_node` methods, allowing a node to be wrapped with another node or HTML fragment, and unwrapped (by @phayes).
- Introduced `Tree::validate`, a method for performing comprehensive integrity checks on node relationships, links, and cycles within the DOM tree (by @phayes).

### Changed
- Updated `selectors` dependency to version 0.27.0.
- Updated `cssparser` dependency to version 0.35.0.
- Updated `html5ever` dependency to version 0.31.0.
- Improved `mini_selector::Attribute`: attribute values can now be enclosed in either double or single quotes, or left unquoted.
- Changed `entities::Attr` visibility to `pub`.
- `TreeNodeOps::append_child_of` and `TreeNodeOps::prepend_child_of` now internally call `TreeNodeOps::remove_from_parent` on the new child to ensure it is safely detached from the tree before being reattached. This guarantees that the node has no lingering references (parent or siblings).

### Fixed
- Fixed `template` serialization in `NodeRef::html` and `NodeRef::inner_html` methods.

## [0.17.0] - 2025-03-31

### Added
- Introduced the `NodeRef::strip_elements(&[&str])` method, which removes matched elements while retaining their children in the document tree.
- Introduced the `Selection::strip_elements(&[&str])` method, which performs the same operation as `NodeRef::strip_elements(&[&str])` but for every node in the `Selection`.
- Introduced the `NodeRef::retain_attrs` method, which allows retaining only the specified attributes of a node.
- Introduced the `Selection::retain_attrs` method, which performs the same operation as `NodeRef::retain_attrs` but for every node in the `Selection`.

## [0.16.0] - 2025-03-09

### Added
- `NodeRef::element_ref` method, which returns a reference to the underlying `Element` if the node is an element node.
- `NodeRef::qual_name_ref` method, which returns a reference to the qualified name of the node.
- `NodeRef::has_name` method, which checks if the node is an element with the given local name.
- `NodeRef::is_nonempty_text` method, which checks if the node is a non-empty text node.

### Changed

- Revised internal code related to element matching. Now, if there is only one root node, `DescendantMatches` (based on `DescendantNodes`) will be used as the internal iterator, which provides a faster approach and doesn't require an additional check for result duplicates. In the other case, `Matches` will be used, which, as previously, performs a check for duplicates.
- Revised `<NodeRef as selectors::Element>::is_link`, which now always returns `false` since its effect on matching elements is unclear and it adds some overhead.

## [0.15.2] - 2025-03-06

### Fixed
- Fixed another issue where `DescendantNodes` could traverse beyond the initial node when iterating over descendants, affecting `NodeRef::descendants` and `NodeRef::descendants_it`, e.g., when the tree had been modified.

## [0.15.1] - 2025-03-02

### Fixed
- Improved `markdown` serialization for `NodeRef`:
  - No longer adds `\n\n\` after elements that require a newline at the end if `\n\n` is already present.
  - Now avoids encoding strings inside `code` elements, except for the \` character.

## [0.15.0] - 2025-03-01

### Added
- Implemented the `markdown` feature, which allows serializing a `Document` or `NodeRef` into Markdown text using the `md()` method.
- Implemented the `mini_selector` feature, providing a lightweight and faster alternative for element matching with limited CSS selector support.
This includes `NodeRef` additional methods: `find_descendants`, `try_find_descendants`, `mini_is`, and `mini_match`.

### Fixed
-  `Selection::select` now returns nodes in ascending order if there were multiple underlying root nodes. If there was only one root node, it still returns nodes in ascending order, just as before.

## [0.14.0] - 2025-02-16

### Added
- Implemented the `Node::id_attr` and `Node::class` methods, which return the `id` and `class` attributes of the node, respectively. `The Selection::id` and `Selection::class` methods do the same for the **first** node in the selection.

### Changed
- Use `bit_set::BitSet` instead of `foldhash::HashSet` for the `Matches::next` method. Since it is necessary to ensure there are no duplicates in the `Matches` result, and this check needs to be as cheap as possible, `bit-set` was chosen.
- Revised the `NodeRef::formatted_text` implementation: moved related code to a separate module, extended the formatting logic, and added more test cases.

### Fixed
- Issue where `DescendantNodes` could traverse beyond the initial node when iterating over descendants. This affected `NodeRef::descendants` and `NodeRef::descendants_it`.

## [0.13.3] - 2025-02-07

## Fixed
- Improved `NodeRef::formatted_text` behavior.

## [0.13.2] - 2025-02-04

### Changed
- Updated `html5ever` dependency to version 0.29.1.


### Fixed
- Fixed `NodeRef::find` to correctly collect nodes when there is only one item in the path slice.

## [0.13.1] - 2025-02-02

### Fixed
- Corrected `NodeRef::normalized_char_count` behavior for various cases.


## [0.13.0] - 2025-02-02

### Added
- Implemented `NodeRef::normalized_char_count` which estimates the number of characters in the text of descendant nodes as if the total string were normalized.
- Implemented `Document::formatted_text`, `Selection::formatted_text`, and `NodeRef::formatted_text`, which return formatted text of the document, selection, or node respectively.

## [0.12.0] - 2025-01-16

### Added

- Implemented `NodeRef::is_match` and `NodeRef::is` methods, which allow checking if a node matches
a given matcher (`&Matcher`) or selector (`&str`) without creating a `Selection` object.
- Implemented `Tree::base_uri`, a quick method that returns the base URI of the document based on the `href` attribute of the `<base>` element. `Document::base_uri` and `NodeRef::base_uri` provide the same functionality. Inspired by [Node: baseURI property]( https://developer.mozilla.org/en-US/docs/Web/API/Node/baseURI).
- `NodeRef::find` an experimental method to find all descendant elements of a node that match a given path. It is much faster than `Selection::select` method.

### Changed

- `Selection`'s internal code changes aimed at reducing calls to `RefCell::borrow` and `RefCell::borrow_mut`.
- Internal code changes in `Matches` aimed at increasing selection performance.

## [0.11.0] - 2024-12-10

### Added
- Implemented the `atomic` feature which switches `NodeData` from using `StrTendril` to `Tendril<tendril::fmt::UTF8, tendril::Atomic>`.
This allows `NodeData` and all ascending structures, including `Document`, to implement the `Send` trait.
- Implemented `Selection::set_text` method, which sets the content of each node in the selection to specified content.
- Implemented `NodeRef::insert_siblings_after` method, which allows inserting a node and its siblings after the selected node.
- Implemented `NodeRef::before_html` method, which allows inserting contents of an HTML fragment before the selected node.
`Selection::before_html` does the same thing for the **every** node inside selection.
- Implemented `NodeRef::after_html` method, which allows inserting contents of an HTML fragment after the selected node.
`Selection::after_html` does the same thing for the **every** node inside selection.
- Implemented `Selection::prepend_selection` method, which prepends nodes from another selection to the nodes in the current selection.

### Changed
- Internal code changes aimed at reducing calls to `RefCell::borrow` and `RefCell::borrow_mut`.


## [0.10.0] - 2024-11-25

### Changed

- `NodeRef::append_prev_sibling` is deprecated, please use `NodeRef::insert_before` instead.
- `NodeRef::append_prev_siblings` is deprecated, please use `NodeRef::insert_siblings_before` instead.
- `Tree::append_prev_sibling_of` is deprecated, please use `Tree::insert_before_of` instead.
- `Document::from` and `Document::fragment` now call `html5ever::parse_document` with the `tree_builder` option `scripting_enabled` set to `false`.
This allows querying into the `noscript` element.

### Added
- Implemented `Ord` trait for `NodeId`
- Implemented `NodeRef::insert_after` method, which allows to insert a node after the selected node.
- Implemented `NodeRef::descendants_it` method, which allows iterating over all descendants of a node.
- Implemented `NodeRef::descendants` method, which returns a vector of all descendants of a node.
- Implemented `NodeRef::normalize` method, which merges adjacent text nodes and removes empty text nodes.
`Document::normalize` does the same thing, but across all the document.

### Fixed
- `Document::text` method now returns the text content, whereas previously it returned an empty string.

## [0.9.1] - 2024-11-10

### Fixed
- Hide visibility of `Tree::nodes`, which was accidentally exposed in the previous version.


## [0.9.0] - 2024-11-09

### Changed

- Using `Tree::merge_with_fn` instead of `Tree::merge` to reduce code duplication.
- `Tree::child_ids_of_it` now require `rev` argument. Set `true` to iterate children in reverse order.
- `NodeRef::children_it` now require `rev` argument. Set `true` to iterate children in reverse order.
- Improved internal logic of `Selection::append_selection` and `Selection::replace_with_selection`.

### Added
- Introduced new `NodeRef::prepend_child` method, that inserts a child at the beginning of node content.
- Introduced new `NodeRef::prepend_children` method, that inserts a child and its siblings at the beginning of the node content.
- Introduced new `NodeRef::prepend_html` method, that parses html string and inserts its parsed nodes at the beginning of the node content.
- Introduced new `Selection::prepend_html` method, which parses an HTML string and inserts its parsed nodes at the beginning of the content of all matched nodes.
- Introduced new selection methods: `Selection::add_selection`, `Selection:add_matcher`, `Selection::add` and `Selection::try_add` to extend current selection with other selections.

### Fixed
- Fixed `Selection::append_selection` to work with selections with multiple nodes and selections from another tree.
- Fixed `Selection::replace_with_selection` to work with selections with multiple nodes and selections from another tree.
- Fixed `Node::append_child`, `Node::append_children`, `Node::prepend_child`, and `Node::prepend_children`: these methods now internally remove the child/children from their previous parent node before attachment.
- Critical fix for `NodeRef::first_element_child`: Previously, due to a logic error, the method checked the node itself instead of its child nodes. This could have caused:
  - Incorrect element selection in DOM traversal
  - Unexpected behavior in code relying on first element child detection
  - Note: Code that depends on this method's behavior should be reviewed after upgrading

## [0.8.0] - 2024-11-03

### Changed
- Simplified `Node::has_text`.
- Replaced generic types with the concrete type `NodeData`, simplifying code and improving readability without affecting the public API.
- Replaced implementations for `Node` with implementations for `NodeRef`. `Node` is just an alias for `NodeRef`.
- Simplified internal logic of `Selection::replace_with_html`, `Selection::set_html`,
`Selection::append_html`, `Node::set_html`, `Node::append_html`, and `Node::replace_with_html` by using `Tree::merge`.

### Added
- Added `Selection::filter` , `Selection::filter_matcher` and `Selection::try_filter` methods that filter a current selection.
- Added `Selection::filter_selection` method that filters a current selection with another selection.
- Added `NodeRef::replace_with` method that allows to replace a node with another one.
- Added `NodeRef::replace_with_html` method that allows to replace a node with a new node created from the given HTML.
- Added `NodeIdProver` trait and implementations for `NodeRef` and `Node`. Which allows to call some node functions with a `&NodeRef` and `&NodeId`.
Previously these functions required `NodeId` as a parameter.
- Added a new pseudo-class `:only-text` that allows selecting a node with no child elements except a single **text** child node.
- Added the `NodeRef::set_text` method, which sets the text content of a node, replacing any existing content.
- Added `NodeRef::append_prev_siblings` method, which allows to prepend other nodes and their siblings before the selected node.

### Fixed
- Fixed `<NodeRef<'a> as selectors::Element>::is_empty` to correctly handle line breaks, whitespace, and ensure only elements pass the check.

### Removed
- Removed `Tree::append_children_from_another_tree` method.
- Removed `Tree::append_prev_siblings_from_another_tree` method.
- Removed `Node::append_children_from_another_tree` method.
- Removed `Node::append_prev_siblings_from_another_tree` method.

## [0.7.0] - 2024-10-27

### Changed
- Exposed `Matcher::match_element` since it can be useful outside the crate.
- Changed `impl<'a> selectors::Element for Node<'a>::opaque` to work with `:has` pseudo-element from `selectors` crate.
- Switched to `:has` implementation from `selectors` crate.
- Internal changes due to switch to `selectors` v0.26.0 switch.
- `Selection` methods that required `&mut` now doesn't require `&mut`, finally.
- Improve performance for `Document::from`, `Selection::select` and others.
- Switched from using `rustc-hash` to `foldhash`.

### Added
- Added `Node::ancestors` method, that allows to get all or limited number of ancestors of a node.
- Added `From<Vec<NodeRef<'a, NodeData>>> for Selection<'a>`
- Enable support for `:is()` and `:where()` pseudo-classes.
- Added `Node::element_children` method that returns children nodes, that are `node_data::Element`s.
- Added `Node::children_it` method that returns an iterator over children nodes.
- Added `Node::ancestors_it` method that returns an iterator over ancestors nodes.
- Added `Tree:child_ids_of` and `Tree:child_ids_of_it` methods that returns ids of the child nodes as vec and as iterator respectively.
- Added `Tree:ancestor_ids_of` and `Tree:ancestor_ids_of_it` methods that returns ids of the ancestor nodes as vec and as iterator respectively.
- Added `Node::immediate_text` method returns text of the node without it's descendants.
`Selection::immediate_text` does the same thing for the **every** node inside selection.

## [0.6.0] - 2024-10-19

### Changed
- Exposed `Document::tree`.
- `Selection` methods that required `&mut` now doesn't require `&mut`.
- Changed the project structure, now modules are divided based on the `struct` implementations.

### Added
- Added `Node::append_html` and `Node::set_html` methods for creating children nodes of a single selected node.
- Added `Tree<NodeData>::new_element`, an easy way to create an empty element with a given name.
- Added `NodeRef::last_child`.
- Added `Node::has_attr` method, which returns `true` if an attribute exists on the node element.
`Selection::has_attr` does the same thing for the **first** node inside selection.
- Added `Node::remove_all_attrs` method for removing all attributes of a node.
`Selection::remove_all_attrs` does the same thing for the **every** node inside selection.
- Added `Node::remove_attrs` method, a convenient way to remove multiple attributes from the node element.
`Selection::remove_attrs` does the same thing for the **every** node inside selection.
- Added `Node::rename` method, which allows to change node's name.
`Selection::rename` does the same thing for the **every** node inside selection.


## [0.5.0] - 2024-10-10

### Added
- Added `select_single_matcher` and `select_single` methods for `Document` and `Selection`.
- Added `Document::fragment` which allows to create a document fragment.

### Changed
- Update documentation
- *A small breaking change*: `From` implementation for `Document`, now it is based on `Into<StrTendril>` and because of that, previous `From<&String>` implementation will not work anymore (they are in config). If your code consumes `&String`, you should use `String::as_str()` instead.
- Refactored the code (`NodeData::Element`).

## [0.4.2] - 2024-10-05

### Removed
- Removed a `readability` examples and related dev-dependencies.

### Added
- Added `Selection::inner_html`, `Selection::try_html`, and `Selection::try_inner` methods.
- Added more examples and doc-tests.

### Changed
- Improved the documentation.

## [0.4.1] - 2024-10-04

### Fixed
- Fixed `Iterator::next` for `Matches`

### Added
- Added doc-tests

## [0.4.0] - 2024-10-01

### Changed
- Update dependencies.
- Refactor code due to major changes in html5ever 0.29.0


## [0.3.6] - 2024-07-19

### Changed
- Update dependencies.

## [0.3.5] - 2024-04-04

### Changed
- Update dependencies.

## [0.3.4] - 2024-02-17

### Added
- Add support for `:has-text` and `:contains` pseudo-classes, which allow to search elements by their text contents. Some example are [here](./tests/pseudo-class.rs).

## [0.3.3] - 2024-02-10

### Fixed
- Fix `:has` selector name comparison. Previously `:has` behavior worked, even if pseudo-class just started from `:has`.

## [0.3.2] - 2024-01-19

### Added

- add `InnerNode<NodeData>.is_comment`.

### Changed

- expose `dom_tree::NodeData`.
- minor adjustments.
- revise `matcher::Matcher` usage, now `selection::Selection`'s underlying `select` methods uses `matcher::Matcher` reference if it possible.
- `css::CssString` now wraps `String` instead of `StrTendril`. Because `StrTendril` can't be shared between multiple threads without mutex.

## [0.3.1] - 2024-01-03

### Changed

- Minor refactoring.

### Fixed

- Fix spelling.

## [0.3.0] - 2023-12-31

### Changed

- Refactor dom_tree.rs -- remove internal macro, revise some functions for better performance.
- Improve performance for some functions inside, traversal.rs (switching from  hashmaps to vecs).
- Add optional feature `hashbrown` -- which replace standard `HashSet` and `HashMap` with it's own implementation.

## [0.2.1] - 2023-12-30

### Changed

- `CssString` now wraps a `StrTendril` instead of a `String`.
- Use `rustc_hash::FxHashSet` instead of `std::collections::HashSet`.
- Use `rustc_hash::FxHashMap` instead of `std::collections::HashMap`.

## [0.2.0] - 2023-12-26

### Changed

- Replace unsafe code with safe code.
