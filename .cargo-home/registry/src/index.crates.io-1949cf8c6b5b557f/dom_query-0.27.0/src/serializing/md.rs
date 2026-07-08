mod constants;
mod serializer;
mod text_utils;

use tendril::StrTendril;

use crate::node::NodeRef;

pub(crate) fn serialize_md(
    root_node: &NodeRef,
    include_node: bool,
    skip_tags: Option<&[&str]>,
) -> StrTendril {
    serializer::MDSerializer::new(root_node, skip_tags).serialize(include_node)
}

#[cfg(test)]
mod tests {

    use crate::Document;

    use super::*;

    #[track_caller]
    fn html_2md_compare(html_contents: &str, expected: &str) {
        let doc = Document::from(html_contents);
        let root_node = &doc.root();
        let md_text = serialize_md(root_node, false, None);
        assert_eq!(md_text.as_ref(), expected);
    }

    #[test]
    fn test_headings() {
        // when passing include_node: true, leading and trailing whitespaces will be kept.
        let contents = r"<h1>Heading 1</h1>
        <h2>Heading 2</h2>
        <h3>Heading 3</h3>
        <h4>Heading 4</h4>
        <h5>Heading 5</h5>
        <h6>Heading 6</h6>
        <h3><span>III.</span> Heading With Span</h3>
        <h3><span></span>Early years (2006–2009)</h3>
        <h3><span> </span> Early years (2006–2009)</h3>
        <hr>";

        let expected = "\n\n# Heading 1\n\n\
        ## Heading 2\n\n\
        ### Heading 3\n\n\
        #### Heading 4\n\n\
        ##### Heading 5\n\n\
        ###### Heading 6\n\n\
        ### III\\. Heading With Span\n\n\
        ### Early years \\(2006–2009\\)\n\n\
        ### Early years \\(2006–2009\\)\n\n\
        ---\n\n";

        let doc = Document::from(contents);
        let body_sel = &doc.select("body");
        let body_node = body_sel.nodes().first().unwrap();
        let md_text = serialize_md(body_node, true, None);
        assert_eq!(md_text.as_ref(), expected);
    }

    #[test]
    fn test_italic() {
        let contents = r"<h4><i>Italic Text</i></h4>";
        let expected = "#### *Italic Text*";

        html_2md_compare(contents, expected);
    }

    #[test]
    fn test_span_italic() {
        let contents = r"<span>It`s like <i>that</i></span>";
        let expected = r"It\`s like *that*";

        html_2md_compare(contents, expected);
    }

    #[test]
    fn test_bold_italic() {
        let contents = r"<span>It`s like <b><i>that</i></b></span>";
        let expected = r"It\`s like ***that***";

        html_2md_compare(contents, expected);
    }

    #[test]
    fn test_simple_code() {
        let contents = r"<span>It`s like <code>that</code></span>";
        let expected = r"It\`s like `that`";
        html_2md_compare(contents, expected);
    }

    #[test]
    fn test_false_multiline_code() {
        let contents = r"<span>
        It`s like 
        <code>
        that
        </code>
        </span>";
        let expected = r"It\`s like `that`";
        html_2md_compare(contents, expected);
    }

    #[test]
    fn test_multiline_code() {
        let contents = r"<code>$ cargo new hello
    Created binary (application) `hello` package

$ cd hello</code>";
        let expected = r"```
$ cargo new hello
    Created binary (application) `hello` package

$ cd hello
```";
        html_2md_compare(contents, expected);
    }

    #[test]
    fn test_ul() {
        let contents = "<h3>Pizza Margherita Ingredients</h3>\
        <ul>\
            <li>Pizza Dough</li>\
            <li>Mozzarella cheese</li>\
            <li>Tomatoes</li>\
            <li>Olive Oil</li>\
            <li><i>Basil</i></li>\
            <li><b>Salt</b></li>\
        </ul>";

        let expected = "### Pizza Margherita Ingredients\n\n\
        - Pizza Dough\n\
        - Mozzarella cheese\n\
        - Tomatoes\n\
        - Olive Oil\n\
        - *Basil*\n\
        - **Salt**";

        html_2md_compare(contents, expected);
    }

    #[test]
    fn test_ol() {
        let contents = "<h3>Pizza Margherita Ingredients</h3>\
        <ol>\
            <li>Pizza Dough</li>\
            <li>Mozzarella cheese</li>\
            <li>Tomatoes</li>\
            <li>Olive Oil</li>\
            <li><i>Basil</i></li>\
            <li><b>Salt</b></li>\
        </ol>";

        let expected = "### Pizza Margherita Ingredients\n\n\
        1. Pizza Dough\n\
        1. Mozzarella cheese\n\
        1. Tomatoes\n\
        1. Olive Oil\n\
        1. *Basil*\n\
        1. **Salt**";

        html_2md_compare(contents, expected);
    }

    #[test]
    fn test_bad_ol() {
        let contents = "<h3>Pizza Margherita Ingredients</h3>\
        <ol>\
            <li>Pizza Dough</li>\
            <li>Mozzarella cheese</li>\
            <li>Tomatoes</li>\
            <li>Olive Oil</li>\
            <div><i>Basil</i></div>\
            <li><b>Salt</b></li>\
        </ol>";

        let expected = "### Pizza Margherita Ingredients\n\n\
        1. Pizza Dough\n\
        1. Mozzarella cheese\n\
        1. Tomatoes\n\
        1. Olive Oil\n\
        \n*Basil*\n\n\
        1. **Salt**";

        html_2md_compare(contents, expected);
    }

    #[test]
    fn test_list_inline() {
        let contents = "
        <ol>\
            <li>Item 1</li>\
            <li>Item 2</li>\
            <li>Item 3\
                <div>\
                    <ol>\
                        <li>Item 3-1</li>\
                        <li>Item 3-2</li>\
                        <li>Item 3-3\
                            <ol>\
                                <li>Item 3-3-1</li>\
                                <li>Item 3-3-2</li>\
                                <li>Item 3-3-3</li>\
                            </ol>
                        </li>\
                    </ol>\
                </div>
            </li>\
        </ol>";

        let expected = "\
1. Item 1
1. Item 2
1. Item 3

    1. Item 3-1
    1. Item 3-2
    1. Item 3-3

        1. Item 3-3-1
        1. Item 3-3-2
        1. Item 3-3-3";

        html_2md_compare(contents, expected);
    }

    #[test]
    fn test_list_with_paragraphs() {
        let contents = "<ol>
            <li>
                <p>Paragraph 1-1</p>
                <p>Paragraph 1-2</p>
            </li>
            <li><p>Paragraph 2-1</p><p>Paragraph 2-2</p></li>
            <li><p>Paragraph 3-1</p></li>
        </ol>
        <p>Another Paragraph</p>";

        let expected = "\
1. Paragraph 1-1

   Paragraph 1-2

1. Paragraph 2-1

   Paragraph 2-2

1. Paragraph 3-1

Another Paragraph";

        html_2md_compare(contents, expected);
    }

    #[test]
    fn test_paragraphs() {
        let contents =
            "<p>To create paragraphs, use a blank line to separate one or more lines of text.</p>
        <p>I really like using <span>Markdown</span><span>  text</span>.</p>

        <p>I think I'll use it to format all of my documents from now on.</p>";

        let expected =
            "To create paragraphs, use a blank line to separate one or more lines of text\\.\n\n\
        I really like using Markdown text\\.\n\n\
        I think I'll use it to format all of my documents from now on\\.";

        html_2md_compare(contents, expected);
    }

    #[test]
    fn test_links() {
        let simple_contents = r#"<p>My favorite search engine is <a href="https://duckduckgo.com">Duck Duck Go</a>.</p>"#;
        let simple_expected =
            r"My favorite search engine is [Duck Duck Go](https://duckduckgo.com)\.";
        html_2md_compare(simple_contents, simple_expected);

        // link with title attribute
        let title_contents = r#"<p>My favorite search engine is <a href="https://duckduckgo.com" title="Duck Duck Go">Duck Duck Go</a>.</p>"#;
        let title_expected = r#"My favorite search engine is [Duck Duck Go](https://duckduckgo.com "Duck Duck Go")\."#;
        html_2md_compare(title_contents, title_expected);

        let bold_contents = r#"<p>My favorite search engine is <b><a href="https://duckduckgo.com">Duck Duck Go</a></b>.</p>"#;
        let bold_expected =
            r"My favorite search engine is **[Duck Duck Go](https://duckduckgo.com)**\.";
        html_2md_compare(bold_contents, bold_expected);

        // bold inside of link is not supported.
        let bold_ignored_contents = r#"<p>My favorite search engine is <a href="https://duckduckgo.com"><b>Duck Duck Go</b></a>.</p>"#;
        let bold_ignored_expected =
            r"My favorite search engine is [Duck Duck Go](https://duckduckgo.com)\.";
        html_2md_compare(bold_ignored_contents, bold_ignored_expected);

        // any elements inside `a` elements are also ignored,
        // html5ever transforms a > div to div > a, and there is no way to determine how it was.
        // This is an open question.
        let ignored_contents = r#"<p>My favorite search engine is <a href="https://duckduckgo.com"><div>Duck Duck Go</div></a>.</p>"#;
        let ignored_expected =
            "My favorite search engine is\n\n[Duck Duck Go](https://duckduckgo.com)\n\n\\.";
        html_2md_compare(ignored_contents, ignored_expected);

        let no_href_contents = r#"<p>My favorite search engine is <a>Duck Duck Go</a>.</p>"#;
        let no_href_expected = "My favorite search engine is Duck Duck Go\\.";
        html_2md_compare(no_href_contents, no_href_expected);

        let complex_contents =
            r#"<a href="https://duckduckgo.com" title="My &quot;Search&quot;">Duck Duck Go</a>"#;
        let comptex_expected = r#"[Duck Duck Go](https://duckduckgo.com "My \"Search\"")"#;
        html_2md_compare(complex_contents, comptex_expected);
    }

    #[test]
    fn test_images() {
        let simple_contents = r#"<p>Image: <img src="/path/to/img.jpg" alt="Alt text"></p>"#;
        let simple_expected = "Image: ![Alt text](/path/to/img.jpg)";
        html_2md_compare(simple_contents, simple_expected);

        // with title
        let simple_contents =
            r#"<p>Image: <img src="/path/to/img.jpg" alt="Alt text" title="Title"></p>"#;
        let simple_expected = r#"Image: ![Alt text](/path/to/img.jpg "Title")"#;
        html_2md_compare(simple_contents, simple_expected);

        // without alt
        let simple_contents = r#"<p>Image: <img src="/path/to/img.jpg"></p>"#;
        let simple_expected = r#"Image: ![](/path/to/img.jpg)"#;
        html_2md_compare(simple_contents, simple_expected);

        // no img
        let simple_contents = r#"<p>Image:  <img alt="Alt text" title="Title"></p>"#;
        let simple_expected = "Image:";
        html_2md_compare(simple_contents, simple_expected);
    }

    #[test]
    fn test_pre_code() {
        let simple_contents = "<pre>\
<span>fn</span> <span>main</span><span>()</span><span> </span><span>{</span>\n\
<span>    </span><span>println!</span><span>(</span><span>\"Hello, World!\"</span><span>);</span>\n\
<span>}</span>\
</pre>";
        let simple_expected = "```
fn main() {
    println!(\"Hello, World!\");
}
```";
        html_2md_compare(simple_contents, simple_expected);
    }

    #[test]
    fn test_pre_code_with_data_lang_attribute() {
        let simple_contents = "<pre data-lang=\"rust\">\
<span>fn</span> <span>main</span><span>()</span><span> </span><span>{</span>\n\
<span>    </span><span>println!</span><span>(</span><span>\"Hello, World!\"</span><span>);</span>\n\
<span>}</span>\n\
</pre>";
        let simple_expected = "```rust
fn main() {
    println!(\"Hello, World!\");
}

```";
        html_2md_compare(simple_contents, simple_expected);
    }

    #[test]
    fn test_pre_code_with_data_lang_attribute_in_parent_tag() {
        let simple_contents = "<div data-lang=\"rust\"><pre>\
<span>fn</span> <span>main</span><span>()</span><span> </span><span>{</span>\n\
<span>    </span><span>println!</span><span>(</span><span>\"Hello, World!\"</span><span>);</span>\n\
<span>}</span>\n\
</pre></div>";
        let simple_expected = "```rust
fn main() {
    println!(\"Hello, World!\");
}

```";
        html_2md_compare(simple_contents, simple_expected);
    }

    #[test]
    fn test_pre_code_with_language_css_class_in_child_code_tag() {
        let contents = "<pre><code class=\"language-rust something else\">\
<span>fn</span> <span>main</span><span>()</span><span> </span><span>{</span>\n\
<span>    </span><span>println!</span><span>(</span><span>\"Hello, World!\"</span><span>);</span>\n\
<span>}</span>\n\
</code></pre>";
        let expected = "```rust
fn main() {
    println!(\"Hello, World!\");
}

```";
        html_2md_compare(contents, expected);
    }

    #[test]
    fn test_blockquote() {
        let simple_contents = "<blockquote><p>Quoted text</p></blockquote>";
        let simple_expected = "> Quoted text";
        html_2md_compare(simple_contents, simple_expected);

        let complex_contents = "<blockquote>
<p>
Who has seen the wind?<br>
Neither I nor you:<br>
But when the leaves hang trembling,<br>
The wind is passing through.
</p>
<p>
Who has seen the wind?<br>
Neither you nor I:<br>
But when the trees bow down their heads,<br>
The wind is passing by.
</p>
</blockquote>
<p><i>Christina Rossetti</i></p>";
        let complex_expected = r"> Who has seen the wind?  
> Neither I nor you:  
> But when the leaves hang trembling,  
> The wind is passing through\.
> 
> Who has seen the wind?  
> Neither you nor I:  
> But when the trees bow down their heads,  
> The wind is passing by\.

*Christina Rossetti*";
        html_2md_compare(complex_contents, complex_expected);

        let empty_contents = "<blockquote></blockquote>";
        let empty_expected = "";
        html_2md_compare(empty_contents, empty_expected);
    }

    #[test]
    fn test_inline_blockquote() {
        let contents = "<blockquote>
<p>
Who has seen the wind?<br>
Neither I nor you:<br>
But when the leaves hang trembling,<br>
The wind is passing through.
</p>
<blockquote>
<p>
Who has seen the wind?<br>
Neither you nor I:<br>
But when the trees bow down their heads,<br>
The wind is passing by.
</p>
</blockquote>
</blockquote>";
        let expected = r"> Who has seen the wind?  
> Neither I nor you:  
> But when the leaves hang trembling,  
> The wind is passing through\.
> 
> > Who has seen the wind?  
> > Neither you nor I:  
> > But when the trees bow down their heads,  
> > The wind is passing by\.";
        html_2md_compare(contents, expected);
    }

    #[test]
    fn test_table() {
        let contents = "<table>
    <tr>
        <th>Column 1</th>
        <th>Column 2</th>
        <th>Column 3</th>
    </tr>
    <tr>
        <td>R 1, <i>C 1</i></td>
        <td>R 1, <i>C 2</i></td>
        <td>R 1, <i>C 3</i></td>
    </tr>
    <tr>
        <td>R 2, <i>C 1</i></td>
        <td>R 2, <i>C 2</i></td>
        <td>R 2, <i>C 3</i></td>
    </tr>
</table>";
        let expected = "| Column 1 | Column 2 | Column 3 |
| -------- | -------- | -------- |
| R 1, *C 1* | R 1, *C 2* | R 1, *C 3* |
| R 2, *C 1* | R 2, *C 2* | R 2, *C 3* |";

        html_2md_compare(contents, expected);
    }

    #[test]
    fn test_table_inside_table() {
        let contents = "<table>
    <tr>
        <td>
            <table>
                <tr>
                    <th>Column 1</th>
                    <th>Column 2</th>
                    <th>Column 3</th>
                </tr>
                <tr>
                    <td>R 1, <i>C 1</i></td>
                    <td>R 1, <i>C 2</i></td>
                    <td>R 1, <i>C 3</i></td>
                </tr>
                <tr>
                    <td>R 2, <i>C 1</i></td>
                    <td>R 2, <i>C 2</i></td>
                    <td>R 2, <i>C 3</i></td>
                </tr>
            </table>
        </td>
    </tr>
</table>";
        let expected = "| Column 1 | Column 2 | Column 3 |
| -------- | -------- | -------- |
| R 1, *C 1* | R 1, *C 2* | R 1, *C 3* |
| R 2, *C 1* | R 2, *C 2* | R 2, *C 3* |";
        html_2md_compare(contents, expected);
    }

    #[test]
    fn test_table_without_headings() {
        let contents = "<table>
    <tr>
        <td>R 1, <i>C 1</i></td>
        <td>R 1, <i>C 2</i></td>
        <td>R 1, <i>C 3</i></td>
    </tr>
    <tr>
        <td>R 2, <i>C 1</i></td>
        <td>R 2, <i>C 2</i></td>
        <td>R 2, <i>C 3</i></td>
    </tr>
</table>";
        let expected = "|   |   |   |
| - | - | - |
| R 1, *C 1* | R 1, *C 2* | R 1, *C 3* |
| R 2, *C 1* | R 2, *C 2* | R 2, *C 3* |";
        html_2md_compare(contents, expected);
    }

    #[test]
    fn test_table_skip() {
        let contents = "<table>
    <tr>
        <td>R 1, <i>C 1</i></td>
        <td>R 1, <i>C 2</i></td>
        <td>R 1, <i>C 3</i></td>
    </tr>
    <tr>
        <td>R 2, <i>C 1</i></td>
        <td>R 2, <i>C 2</i></td>
    </tr>
</table>";
        let expected = "R 1, *C 1* R 1, *C 2* R 1, *C 3*  
R 2, *C 1* R 2, *C 2*";
        html_2md_compare(contents, expected);
    }

    #[test]
    fn test_table_empty() {
        let contents = "<table>
    <tr></tr>
    <tr></tr>
</table>";
        let expected = "";
        html_2md_compare(contents, expected);
    }

    #[test]
    fn test_table_with_list() {
        let contents = "<table>
    <tr>
        <td>1</td>
        <td>
            <ul><li>Lemon</li></ul>
            <ul><li>Lime</li></ul>
            <ul><li>Grapefruit</li></ul>
            <ul><li>Orange</li></ul>
        </td>
    </tr>
</table>";
        let expected =
            "|   |   |\n| - | - |\n| 1 | + Lemon<br>+ Lime<br>+ Grapefruit<br>+ Orange<br> |";
        html_2md_compare(contents, expected);
    }

    #[test]
    fn test_skip_tags_default() {
        // By default, formatter will skip ["script", "style", "meta", "head"]
        let contents = "
        <style>p {color: blue;}</style>
        <p>I really like using <b>Markdown</b>.</p>

        <p>I think I'll use it to format all of my documents from now on.</p>";

        let expected = "I really like using **Markdown**\\.\n\n\
        I think I'll use it to format all of my documents from now on\\.";

        html_2md_compare(contents, expected);
    }

    #[test]
    fn test_skip_tags() {
        // If you need all text content of the elements, you need to pass Some(&vec![]) to `md`.
        // If you pass a structure like this into `Document::from`, the html5ever will create html > head > style.
        // If you want to preserve order use `Document::fragment`.
        let contents = "<style>p {color: blue;}</style>\
        <div><h1>Content Heading<h1></div>\
        <p>I really like using Markdown.</p>\
        <p>I think I'll use it to format all of my documents from now on.</p>";

        let expected = "p \\{color: blue;\\}\n\n\
        I really like using Markdown\\.\n\n\
        I think I'll use it to format all of my documents from now on\\.";

        let doc = Document::fragment(contents);
        let html_node = &doc.root();
        let md_text = serialize_md(html_node, false, Some(&["div"]));
        assert_eq!(md_text.as_ref(), expected);
    }
    #[test]
    fn test_linebreak_after_lists() {
        let contents = r#"Influenced
        <ul>
         <li>Idris (programming language)</li>
         <li>Project Verona</li>
         <li>Spark</li>
         <li>Swift</li>
         <li>V</li>
         <li>Zig</li>
        </ul>
        <p><b>Rust</b> is a general-purpose programming language</p>"#;
        let expected = "Influenced\n\n\
- Idris \\(programming language\\)
- Project Verona
- Spark
- Swift
- V
- Zig

**Rust** is a general-purpose programming language";

        html_2md_compare(contents, expected);
    }

    #[test]
    fn test_pre_code_without_new_line() {
        let simple_contents = r#"<pre>
<span>fn</span> <span>main</span><span>()</span><span> </span><span>{</span>
<span>    </span><span>println!</span><span>(</span><span>"Hello, World!"</span><span>);</span>
<span>}</span></pre>"#;
        let simple_expected = "```
fn main() {
    println!(\"Hello, World!\");
}
```";
        html_2md_compare(simple_contents, simple_expected);
    }
}
