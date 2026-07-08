use dom_query::Document;

fn main() {
    let html_contents = r#"<!DOCTYPE html>
    <html>
        <head><title>Test</title></head>
        <body>
            <div class="content">
                <h1>Test Page</h1>
            </div>
            <div class="content">
                <p>This is a test page contents.</p>
            </div
        </body>
    </html>"#;

    let doc = Document::from(html_contents);

    let content_selection = doc.select("div.content");

    println!("HTML contents:");
    //prints the first occurrence of div with class "content", including its own tag
    println!("{}", content_selection.html());
    println!("{:-<50}", "");

    println!("Inner HTML contents:");
    //prints the first occurrence of div with class "content", same behavior as goquery's Html()
    println!("{}", content_selection.inner_html());
    println!("{:-<50}", "");

    println!("Iterating over all matched elements:");
    //printing inner html of every matched element
    for el in content_selection.iter() {
        println!("{}", el.inner_html())
    }
}
