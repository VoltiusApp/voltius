use serialize_to_javascript::Template;

#[derive(Template)]
pub struct Foo<'a> {
    foo1: &'a str,
    foo2: usize,
    #[raw]
    foo3: &'static str,
}
