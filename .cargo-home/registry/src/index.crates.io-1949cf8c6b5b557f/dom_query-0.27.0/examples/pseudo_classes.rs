use dom_query::Document;

fn main() {
    let html = include_str!("../test-pages/rustwiki_2024.html");
    let doc = Document::from(html);

    // searching list items inside a `tr` element which has a `a` element
    // with title="Programming paradigm"
    let paradigm_selection =
        doc.select(r#"table tr:has(a[title="Programming paradigm"]) td.infobox-data ul > li"#);

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
        doc.select(r#"p:contains("Rust has a foreign function interface") a[href^="/"]"#);

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
}
