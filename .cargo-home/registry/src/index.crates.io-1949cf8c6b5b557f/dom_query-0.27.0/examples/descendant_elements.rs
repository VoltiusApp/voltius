use std::error::Error;

use dom_query::Document;

fn main() -> Result<(), Box<dyn Error>> {
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
    let uls = document.select("ul");

    // descendent elements may have more precise selectors
    for el in uls.select("body ul.list-b li").iter() {
        println!("{}", el.text());
    }

    Ok(())
}
