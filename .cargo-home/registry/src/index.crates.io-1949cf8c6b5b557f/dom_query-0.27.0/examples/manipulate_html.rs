use dom_query::Document;

fn main() {
    let html_contents = r#"<!DOCTYPE html>
    <html>
        <head><title>Test</title></head>
        <body>
            <div class="content">
                <p>9,8,7</p>
            </div>
            <div class="remove-it">
                Remove me
            </div>
            <div class="replace-it">
                <div>Replace me</div>
            </div>
        </body>
    </html>"#;

    let doc = Document::from(html_contents);

    // Add a new html block to the selection
    let content_selection = doc.select("body .content");
    content_selection.append_html(r#"<div class="inner">inner block</div>"#);

    assert!(doc.select("body .content .inner").exists());

    let set_selection = doc.select(".inner");
    // Delete all child nodes of a selection and replace with a new html block
    set_selection.set_html(r#"<p>1,2,3</p>"#);

    assert_eq!(
        &doc.select(".inner").html(),
        r#"<div class="inner"><p>1,2,3</p></div>"#
    );

    // Remove selection from the document
    doc.select(".remove-it").remove();
    assert!(!doc.select(".remove-it").exists());

    // Replacing inner block content with new content, current selection remains the same
    let replace_selection = doc.select(".replace-it");
    replace_selection.replace_with_html(r#"<div class="replaced">Replaced</div>"#);

    assert_eq!(replace_selection.text().trim(), "Replace me");
}
