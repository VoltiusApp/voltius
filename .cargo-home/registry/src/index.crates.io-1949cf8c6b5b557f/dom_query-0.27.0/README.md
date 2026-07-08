
# DOM_QUERY: A Flexible Rust Crate for DOM Querying and Manipulation

[![Crates.io version](https://img.shields.io/crates/v/dom_query.svg?style=flat)](https://crates.io/crates/dom_query)
[![Download](https://img.shields.io/crates/d/dom_query.svg?style=flat)](https://crates.io/crates/dom_query)
[![docs.rs docs](https://img.shields.io/badge/docs-latest-blue.svg?style=flat)](https://docs.rs/dom_query)
[![codecov](https://codecov.io/gh/niklak/dom_query/graph/badge.svg?token=CFAVOIE61O)](https://codecov.io/gh/niklak/dom_query)

[![Build Status](https://github.com/niklak/dom_query/actions/workflows/rust.yml/badge.svg?branch=main)](https://github.com/niklak/dom_query/actions/workflows/rust.yml)
[![Rust CI ARM64](https://github.com/niklak/dom_query/actions/workflows/rust-arm64.yml/badge.svg)](https://github.com/niklak/dom_query/actions/workflows/rust-arm64.yml)
[![wasm ci](https://github.com/niklak/dom_query/actions/workflows/wasm.yml/badge.svg)](https://github.com/niklak/dom_query/actions/workflows/wasm.yml)


DOM_QUERY is a flexible Rust crate that simplifies HTML parsing, DOM querying and manipulation by providing a high-level jQuery-like API. It uses the `html5ever` crate for HTML parsing and the `selectors` crate for efficient DOM traversal and element selection.

## Features

- Parse HTML documents and fragments
- Query DOM elements using CSS selectors
- Traverse the DOM tree (ancestors, parents, children, siblings)
- Manipulate elements and their attributes:
  - Add/remove/modify attributes
  - Change element content
  - Add/remove elements
  - Rename elements
  - Move elements within the DOM tree

> [!NOTE]
> This crate is a significantly enhanced fork of [nipper](https://crates.io/crates/nipper),
> featuring expanded CSS selector support, enhanced DOM traversal  and improved DOM manipulation capabilities.


## Examples


<details>
<summary><b>Parsing a document</b></summary>

```rust
use dom_query::Document;
use tendril::StrTendril;
// Document may consume &str, String, StrTendril
let contents_str = r#"<!DOCTYPE html>
<html><head><title>Test Page</title></head><body></body></html>"#;
let doc = Document::from(contents_str);

let contents_string = contents_str.to_string();
let doc = Document::from(contents_string);

let contents_tendril = StrTendril::from(contents_str);
let doc = Document::from(contents_tendril);

// The root element for the `Document` is a Document
assert!(doc.root().is_document());

// if the source has DocType, then the Document will also have one
// as a first child.
assert!(doc.root().first_child().unwrap().is_doctype());

//both of them are not elements.
```
</details>


<details>
<summary><b>Parsing a fragment</b></summary>

```rust
use dom_query::Document;
use tendril::StrTendril;
// fragment can be created with Document::fragment(), which accepts &str, String, StrTendril
let contents_str = r#"<!DOCTYPE html>
<html><head><title>Test Page</title></head><body></body></html>"#;
let fragment = Document::fragment(contents_str);

let contents_string = contents_str.to_string();
let fragment = Document::fragment(contents_string);

let contents_tendril = StrTendril::from(contents_str);
let fragment = Document::fragment(contents_tendril);

// The root element for the  fragment is not a Document but a Fragment
assert!(!fragment.root().is_document());
assert!(fragment.root().is_fragment());

// and when it parses a fragment, it drops Doctype
assert!(!fragment.root().first_child().unwrap().is_doctype());
```
</details>


<details>
<summary><b>Selecting elements</b></summary>

```rust
use dom_query::Document;
let html = r#"<!DOCTYPE html>
<html>
    <head>
        <meta charset="utf-8">
        <title>Test Page</title>
    </head>
    <body>
        <h1>Test Page</h1>
        <ul>
            <li>One</li>
            <li><a href="/2">Two</a></li>
            <li><a href="/3">Three</a></li>
        </ul>
    </body>
</html>"#;
let document = Document::from(html);
// select a single element
let a = document.select("ul li:nth-child(2)");
let text = a.text().to_string();
assert!(text == "Two");
// selecting multiple elements
document.select("ul > li:has(a)").iter().for_each(|el| {
    assert!(el.is("li"));
})

// there is also `try_select` which returns an Option
let no_sel = document.try_select("p");
assert!(no_sel.is_none());

```
</details>


<details>
<summary><b>Selecting a single match and multiple matches</b></summary>

```rust
use dom_query::Document;
let doc: Document = r#"<!DOCTYPE html>
<html lang="en">
<head></head>
<body>
    <ul class="list">
        <li>1</li><li>2</li><li>3</li>
    </ul>
    <ul class="list">
        <li>4</li><li>5</li><li>6</li>
    </ul>
</body>
</html>"#
    .into();
// if you need to select only the first, single match, you can use following:
let single_selection = doc.select_single(".list");

// access is only for the first matching:
assert_eq!(single_selection.length(), 1);
assert_eq!(single_selection.inner_html().to_string().trim(), "<li>1</li><li>2</li><li>3</li>");

// simple selection contains all matches:
let selection = doc.select(".list");
assert_eq!(selection.length(), 2);

// but if you call inner_html() on it, you will get the inner_html of the first match:
assert_eq!(selection.inner_html().to_string().trim(), "<li>1</li><li>2</li><li>3</li>");

//this approach is using the first node from nodes vec and `select_single` consumes one iteration instead.
let first_selection = doc.select(".list").first();
assert_eq!(first_selection.length(), 1);
assert_eq!(first_selection.inner_html().to_string().trim(), "<li>1</li><li>2</li><li>3</li>");

// this approach is consuming all nodes into vec at first, and then you can call `iter().next()` to get the first one.
let next_selection = doc.select(".list").iter().next().unwrap();
assert_eq!(next_selection.length(), 1);
assert_eq!(next_selection.inner_html().to_string().trim(), "<li>1</li><li>2</li><li>3</li>");

// currently, to get data from all matches you need to iterate over them, either:
let all_matched: String = selection.iter().map(|s| s.inner_html().trim().to_string()).collect();
assert_eq!(
all_matched,
"<li>1</li><li>2</li><li>3</li><li>4</li><li>5</li><li>6</li>"
);

// or:
let all_matched: String = selection.nodes().iter().map(|s| s.inner_html().trim().to_string()).collect();
// which is more efficient.
assert_eq!(
all_matched,
"<li>1</li><li>2</li><li>3</li><li>4</li><li>5</li><li>6</li>"
);
```
</details>

<details>
<summary><b>Selecting descendent elements</b></summary>

```rust
 use dom_query::Document;

 let html = r#"<!DOCTYPE html>
 <html>
     <head>
         <meta charset="utf-8">
         <title>Test Page</title>
     </head>
     <body>
         <h1>Test Page</h1>
         <ul class="list-a">
             <li>One</li>
             <li><a href="/2">Two</a></li>
             <li><a href="/3">Three</a></li>
         </ul>
         <ul class="list-b">
             <li><a href="/4">Four</a></li>
         </ul>
     </body>
 </html>"#;
 let document = Document::from(html);
 // select a parent element
 let ul = document.select("ul");

 // selecting multiple elements
 ul.select("li").iter().for_each(|el| {
     assert!(el.is("li"));
 });

 // also descendant selector may be specified starting from the parent elements
 let el = ul.select("body ul.list-b li").first();
 let text = el.text();
 assert_eq!("Four", text.to_string());

```
</details>


<details>
    <summary><b>Selecting ancestors</b></summary>


```rust
use dom_query::Document;

let doc: Document = r#"<!DOCTYPE html>
<html>
    <head>Test</head>
    <body>
        <div id="great-ancestor">
            <div id="grand-parent">
                <div id="parent">
                    <div id="child">Child</div>
                </div>
            </div>
        </div>
    </body>
</html>
"#.into();

// selecting an element
let child_sel = doc.select("#child");
assert!(child_sel.exists());

let child_node = child_sel.nodes().first().unwrap();

// getting all ancestors
let ancestors = child_node.ancestors(None);

let ancestor_sel = Selection::from(ancestors);

// or just: let ancestor_sel = child_sel.ancestors(None);

// in this case ancestors includes all ancestral nodes including html

// the root html element is presented in the ancestor selection
assert!(ancestor_sel.is("html"));

// also the direct parent of our starting node is presented
assert!(ancestor_sel.is("#parent"));

// `Selection::is` matches only the current selection without descending down the tree,
// so it won't match the #child node.
assert!(!ancestor_sel.is("#child"));


// if you don't require all ancestors, you can specify a number of ancestors you need -- `max_limit`
let ancestors = child_node.ancestors(Some(2));
let ancestor_sel = Selection::from(ancestors);

// in this case ancestors includes only two ancestral nodes: #grand-parent and #parent
assert!(ancestor_sel.is("#grand-parent #parent"));

assert!(!ancestor_sel.is("#great-ancestor"));

```
</details>



<details>
<summary><b>Selecting with precompiled matchers (for reuse)</b></summary>

```rust
use dom_query::{Document, Matcher};
let html1 = r#"<!DOCTYPE html><html><head><title>Test Page 1</title></head><body></body></html>"#;
let html2 = r#"<!DOCTYPE html><html><head><title>Test Page 2</title></head><body></body></html>"#;

let doc1 = Document::from(html1);
let doc2 = Document::from(html2);
// create a matcher once, reuse on different documents
let title_matcher = Matcher::new("title").unwrap();

let title_el1 = doc1.select_matcher(&title_matcher);
assert_eq!(&title_el1.text(), "Test Page 1");

let title_el2 = doc2.select_matcher(&title_matcher);
assert_eq!(&title_el2.text(), "Test Page 2");
// selecting a single match
let title_single = doc1.select_single_matcher(&title_matcher);
assert_eq!(&title_single.text(), "Test Page 1");
```
</details>


<details>
<summary><b>Selecting with pseudo-classes (:has, :has-text, :contains, :only-text)</b></summary>

```rust
use dom_query::Document;

let html = include_str!("../test-pages/rustwiki_2024.html");
let doc = Document::from(html);

// searching list items inside a `tr` element which has a `a` element
// with title="Programming paradigm"
let paradigm_selection =
    doc.select(
        r#"table tr:has(a[title="Programming paradigm"]) td.infobox-data ul > li"#
    );

println!("Rust programming paradigms:");
for item in paradigm_selection.iter() {
    println!(" {}", item.text());
}
println!("{:-<50}", "");

//since `th` contains text "Paradigms" without sibling tags, we can use `:has-text` pseudo class
let influenced_by_selection =
    doc.select(r#"table tr:has-text("Influenced by") + tr td  ul > li > a"#);

println!("Rust influenced by:");
for item in influenced_by_selection.iter() {
    println!(" {}", item.text());
}
println!("{:-<50}", "");

// Extract all links from the block that contains certain text.
// Since `foreign function interface` located in its own tag,
// we have to use `:contains` pseudo class
let links_selection =
    doc.select(
        r#"p:contains("Rust has a foreign function interface") a[href^="/"]"#
    );

println!("Links in the FFI block:");
for item in links_selection.iter() {
    println!(" {}", item.attr("href").unwrap());
}
println!("{:-<50}", "");

// :only-text selects an element that contains only a single text node,
// with no child elements.
// It can be combined with other pseudo-classes to achieve more specific selections.
// For example, to select a <div> inside an <a>
//that has no siblings and no child elements other than text.
println!("Single <div> inside an <a> with text only:");
for el in doc.select("a div:only-text:only-child").iter() {
    println!("{}", el.text().trim());
}
```

</details>


<details>
<summary><b>Serializing to HTML</b></summary>

```rust
use dom_query::Document;
let html = r#"<!DOCTYPE html>
<html>
    <head><title>Test</title></head>
    <body><div class="content"><h1>Test Page</h1></div></body>
</html>"#;
let doc = Document::from(html);
let heading_selector = doc.select("div.content");
// serializing including the outer html tag
let content = heading_selector.html();
assert_eq!(content.to_string(), r#"<div class="content"><h1>Test Page</h1></div>"#);
// serializing without the outer html tag
let inner_content = heading_selector.inner_html();
assert_eq!(inner_content.to_string(), "<h1>Test Page</h1>");

// there is also `try_html()` method, which returns an `Option<StrTendril>`,
// and if there is no matching selection it returns None
let opt_no_content = doc.select("div.no-content").try_html();
assert_eq!(opt_no_content, None);

//`html()` method will return an empty `StrTendril` if there is no matching selection
let no_content = doc.select("div.no-content").html();
assert_eq!(&no_content, "");

//Same things works for `inner_html()` and `try_inner_html()` method.
assert_eq!(doc.select("div.no-content").try_inner_html(), None);
assert_eq!(&doc.select("div.no-content").inner_html(), "");
```
</details>



<details>
<summary><b>Accessing descendent text</b></summary>

```rust
use dom_query::Document;

let html = r#"<!DOCTYPE html>
<html>
    <head><title>Test</title></head>
    <body><div><h1>Test <span>Page</span></h1></div></body>
</html>"#;
let doc = Document::from(html);
let body_selection = doc.select("body div").first();
let text = body_selection.text();
assert_eq!(text.to_string(), "Test Page");
```
</details>


<details>
<summary><b>Accessing immediate text</b></summary>

```rust
use dom_query::Document;

let html = r#"<!DOCTYPE html>
<html>
    <head><title>Test</title></head>
    <body><div><h1>Test <span>Page</span></h1></div></body>
</html>"#;

let doc = Document::from(html);

let body_selection = doc.select("body div h1").first();
// accessing immediate text without descendants
let text = body_selection.immediate_text();
assert_eq!(text.to_string(), "Test ");

```

</details>



<details>
<summary><b>Manipulating the attribute of an HTML element</b></summary>

```rust
use dom_query::Document;
let html = r#"<!DOCTYPE html>
<html>
    <head><title>Test</title></head>
    <body><input hidden="" id="k" class="important" type="hidden" name="k" data-k="100"></body>
</html>"#;

let doc = Document::from(html);
let mut input_selection = doc.select("input[name=k]");

// get the value of attribute "data-k"
let val = input_selection.attr("data-k").unwrap();
assert_eq!(val.to_string(), "100");

// remove the attribute "data-k" from the element
input_selection.remove_attr("data-k");

// get the value of attribute "data-k", if missing, return default value
let val_or = input_selection.attr_or("data-k", "0");
assert_eq!(val_or.to_string(), "0");

// remove a list of attributes from the element
input_selection.remove_attrs(&["id", "class"]);
// set a attribute "data-k" with value "200"
input_selection.set_attr("data-k", "200");

assert_eq!(&input_selection.html(), r#"<input hidden="" type="hidden" name="k" data-k="200">"#);

// check if attribute "hidden" exists on the element
let is_hidden = input_selection.has_attr("hidden");
assert!(is_hidden);
let has_title = input_selection.has_attr("title");
assert!(!has_title);


// remove all attributes from the element
input_selection.remove_all_attrs();
assert_eq!(&input_selection.html(), r#"<input>"#);

```
</details>

<details>
    <summary><b>Manipulating the DOM</b></summary>

```rust
use dom_query::Document;
let html_contents = r#"<!DOCTYPE html>
    <html>
        <head><title>Test</title></head>
        <body>
            <div class="content">
            </div>
            <div class="remove-it">
                Remove me
            </div>
            <div class="replace-it">
                <div>Replace me</div>
            </div>
        </body>
    </html>"#;;

let doc = Document::from(html_contents);

let mut content_selection = doc.select("body .content");
// append a new html node to the selection
content_selection.append_html(r#"<div class="inner">inner block</div>"#);
assert!(doc.select("body .content .inner").exists());

// set a new content to the selection, replacing existing content
let mut set_selection = doc.select(".inner");
set_selection.set_html(r#"<p>1,2,3</p>"#);
assert_eq!(&doc.select(".inner").html(), r#"<div class="inner"><p>1,2,3</p></div>"#);

// remove the selection
doc.select(".remove-it").remove();
assert!(!doc.select(".remove-it").exists());

// replace the selection with a new html, current selection will not change.
let mut replace_selection = doc.select(".replace-it");
replace_selection.replace_with_html(r#"<div class="replaced">Replaced</div>"#);
assert_eq!(replace_selection.text().trim(), "Replace me");

//but the document will change
assert_eq!(&doc.select(".replaced").text(),"Replaced");

//instead of appending content, you can prepend it
let mut content_selection = doc.select_single("body .content");
// you can prepend one element or,
content_selection.prepend_html(r#"<p class="third">3</p>"#);
// more:
content_selection.prepend_html(r#"<p class="first">2</p><p class="second">2</p>"#);

// Also you can insert html before selection:
let first = content_selection.select(".first");
first.before_html(r#"<p class="none">None</p>"#);
// or after:
let third = content_selection.select(".third");
third.after_html(r#"<p class="fourth">4</p>"#);

// now the added paragraphs standing in front of `div`
assert!(doc.select(r#".content > .none + .first + .second + .third + .fourth + div:has-text("1,2,3")"#).exists());

// to set a text to the selection you can use `set_html` but `set_text` is preferable:
let p_sel = content_selection.select("p");
let total_p = p_sel.length();
p_sel.set_text("test content");
assert_eq!(doc.select(r#"p:has-text("test content")"#).length(), total_p);

```
</details>


<details>
    <summary><b>Node manipulations: Creating an empty element, adding a single element to a single node</b></summary>

```rust
use dom_query::Document;

let doc: Document = r#"<!DOCTYPE html>
<html lang="en">
<head></head>
<body>
    <div id="main">
        <p id="first">It's</p>
    </div>
</body>
</html>"#.into();

// selecting a node we want to attach a new element
let main_sel = doc.select_single("#main");
let main_node = main_sel.nodes().first().unwrap();

// if you need just to create a simple element, then you can use the following:
let el = doc.tree.new_element("p");
// you still able to deal with element's attributes:
el.set_attr("id", "second");
// and set text
el.set_text("test");
main_node.append_child(&el);
// also main_node.append_child(&el);
assert!(doc.select(r#"#main #second:has-text("test")"#).exists());
// because this method doesn't parse anything it is much more cheaper than following approaches.

// if you need to add a more complex element, you can use `node.append_html`,
// which is much more convenient, then previous approach:

main_node.append_html(r#"<p id="third">Wonderful</p>"#);
assert_eq!(doc.select("#main #third").text().as_ref(), "Wonderful");
// There is also a `prepend_child` and `prepend_html` methods which allows
// to insert content to the begging of the node.
main_node.prepend_html(r#"<p id="minus-one">-1</p><p id="zero">0</p>"#);
assert!(doc.select("#main > #minus-one + #zero + #first + #second + #third").exists());

// if we need to replace existing element content inside a node with a new one, then use `node.set_html`.
// It changes the inner html contents of the node.
main_node.set_html(r#"<p id="the-only">Wonderful</p>"#);
assert_eq!(doc.select("#main #the-only").text().as_ref(), "Wonderful");
assert!(!doc.select("#first").exists());

// To completely replace contents of the node,
// including itself use `node.replace_with_html`.
// Also we can specify more than one element in the string for methods
// like `replace_with_html`, `set_html` and `append_html`.
main_node.replace_with_html(r#"<span>Tweedledum</span> and <span>Tweedledee</span>"#);
assert!(!doc.select("#main").exists());
assert_eq!(doc.select("span + span").text().as_ref(), "Tweedledee");
```
</details>


<details>
    <summary><b>Renaming selected elements without changing the contents</b></summary>


```rust
use dom_query::Document;

let doc: Document = r#"<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
    <div class="content">
        <div>1</div>
        <div>2</div>
        <div>3</div>
        <span>4</span>
    </div>
<body>
</html>"#
.into();
let mut sel = doc.select("div.content > div, div.content > span");
// before renaming, there are 3 `div` and 1 `span`
assert_eq!(sel.length(), 4);

sel.rename("p");

// after renaming, there are no `div` and `span` elements
assert_eq!(doc.select("div.content > div, div.content > span").length(), 0);
// but there are four `p` elements
assert_eq!(doc.select("div.content > p").length(), 4);
```
</details>

<details>
    <summary><b>Retrieving The Base URI</b></summary>


```rust
use dom_query::Document;

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
// This method is a much faster alternative to
// `doc.select("html > head > base").attr("href")`.
// Currently, it does not cache the result, so each time you call it,
// it will traverse the tree again.
// The reason it is not cached is to keep `Document` implementing the `Send` trait.

// It may be called from the document level.
let base_uri = doc.base_uri().unwrap();
assert_eq!(base_uri.as_ref(), "https://www.example.com/");

let sel = doc.select_single("#main");
let node = sel.nodes().first().unwrap();

// Also it is accessible from any node of the tree.
let base_uri = node.base_uri().unwrap();
assert_eq!(base_uri.as_ref(), "https://www.example.com/");
```
</details>


<details>
    <summary><b>Verifying Selection and Node Matches</b></summary>


```rust
use dom_query::Document;

let contents: &str = r#"<!DOCTYPE html>
<html>
    <head>
        <title>Test</title>
    </head>
    <body>
        <div id="main" dir="ltr"></div>
        <div id="extra"></div>
    </body>
</html>"#;
let doc = Document::from(contents);

let main_sel = doc.select_single("#main");
let extra_sel = doc.select_single("#extra");

// The `is()` method is available for `Selection` and `NodeRef`.
// For `Selection`, it verifies that at least one of the nodes in the selection
// matches the selector.
assert!(main_sel.is("div#main"));
assert!(!extra_sel.is("div#main"));

// For `NodeRef`, the `is` method verifies that the node matches the selector.
// This method is useful if you need to combine several checks into one expression.
// It can check for having a certain position in the DOM tree,
// having a certain attribute, or a certain element name all at once.
let main_node = main_sel.nodes().first().unwrap();
let extra_node = extra_sel.nodes().first().unwrap();

assert!(main_node.is("html > body > div#main[dir=ltr]"));
assert!(extra_node.is("html > body > div#main + div"));
```
</details>


<details>
    <summary><b>Fast Finding Child Elements</b></summary>


```rust
use dom_query::Document;

let doc: Document = r#"<!DOCTYPE html>
<html>
    <head><title>Test</title></head>
    <body>
        <div id="main"></div>
    </body>
</html>"#.into();

let main_sel = doc.select_single("#main");
let main_node = main_sel.nodes().first().unwrap();

// create 10 child blocks with links
let total_links = 10usize;
for i in 0..total_links {
    let content = format!(r#"<div><a href="/{0}">{0} link</a></div>"#, i);
    main_node.append_html(content);
}
let selected_count = doc.select("html body a").nodes().len();
assert_eq!(selected_count, total_links);

// `find` currently can deal only with paths that start after the current node.
// In the following example, `&["html", "body", "div", "a"]` will fail,
// while `&["a"]` or `&["div", "a"]` are okay.
let found_count = main_node.find(&["div", "a"]).len();
assert_eq!(found_count, total_links);
```
</details>


<details>
    <summary><b>Serializing a document to Markdown</b></summary>

*This example requires `markdown` feature.*

```rust
use dom_query::Document;

let contents = "
<style>p {color: blue;}</style>
<p>I really like using <b>Markdown</b>.</p>

<p>I think I'll use it to format all of my documents from now on.</p>";

let expected = "I really like using **Markdown**\\.\n\n\
I think I'll use it to format all of my documents from now on\\.";

let doc = Document::from(contents);
// Passing `None` into md allows to use default skip tags, which are:
// `["script", "style", "meta", "head"]`.
let got = doc.md(None);
assert_eq!(got.as_ref(), expected);

// If you need the full text content of the elements, pass `Some(&vec![])` to `md`.
// If you pass content like the example below to `Document::from`,
// `html5ever` will create a `<head>` element and place your `<style>` element inside it.
// To preserve the original order, use `Document::fragment`.

let contents = "<style>p {color: blue;}</style>\
<div><h1>Content Heading<h1></div>\
<p>I really like using Markdown.</p>\
<p>I think I'll use it to format all of my documents from now on.</p>";

let expected = "p \\{color: blue;\\}\n\
I really like using Markdown\\.\n\n\
I think I'll use it to format all of my documents from now on\\.";

let doc = Document::fragment(contents);
let got = doc.md(Some(&["div"]));
assert_eq!(got.as_ref(), expected);

```

</details>

- **[more examples](./examples/)**
- **[dom_query by example](https://niklak.github.io/dom_query_by_example/)**


## Crate features

- `hashbrown` — optional,replaces standard hashmaps and hashsets with `hashbrown` hashmaps and hashsets.
- `atomic` — optional, switches `NodeData` from using `StrTendril` to `Tendril<tendril::fmt::UTF8, tendril::Atomic>`.
This allows `NodeData` and all ascending structures, including `Document`, to implement the `Send` trait;
- `markdown` — optional, enables the `Document::md` and `NodeRef::md` methods, allowing serialization of a document or node to `Markdown` text.
- `mini_selector` — optional, provides a lightweight and faster alternative for element matching with limited CSS selector support.
  This includes additional `NodeRef` methods: `find_descendants`, `try_find_descendants`, `mini_is`, and `mini_match`.
  *This is an experimental feature that may change in future releases.*

## Possible issues
* [wasm32 compilation](https://niklak.github.io/dom_query_by_example/WASM32-compilation.html)


## Changelog
[Changelog](./CHANGELOG.md)

## License

Licensed under MIT ([LICENSE](LICENSE) or http://opensource.org/licenses/MIT)


## Contribution

Any contribution intentionally submitted for inclusion in the work by you, shall be
licensed with MIT license, without any additional terms or conditions.
