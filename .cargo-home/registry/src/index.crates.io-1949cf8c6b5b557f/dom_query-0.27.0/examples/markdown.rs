use dom_query::Document;

fn main() {
    let html = include_str!("../test-pages/hacker_news.html");
    let document = Document::from(html);
    let md = document.md(None);
    println!("{md}");
}
