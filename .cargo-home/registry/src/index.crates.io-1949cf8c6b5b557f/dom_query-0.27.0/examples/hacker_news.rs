use dom_query::Document;

fn main() {
    let html = include_str!("../test-pages/hacker_news.html");
    let document = Document::from(html);

    for news in document.select("tr.athing:has(a[href][id])").iter() {
        let link = news.select(".title  a.storylink");
        let source = news.select(".sitebit a");
        println!("{:<6} => {}", "title", link.text());
        println!("{:<6} => {}", "link", link.attr("href").unwrap_or_default());
        println!("{:<6} => {}\n", "source", source.text());
    }
}
