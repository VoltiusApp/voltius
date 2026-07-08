// Take a look at the license at the top of the repository in the LICENSE file.

use std::rc::Rc;

use glib::clone;

#[test]
fn clone() {
    let v = Rc::new(1);
    let _ = clone!(@strong v => @default-return None::<i32>, move || {println!("foo"); 1});

    let v = Rc::new(1);
    let _ = clone!(@weak v => @default-return None::<i32>, move || {println!("foo"); Some(1)});

    let v = "123";
    let _ = clone!(@to-owned v => @default-return None::<i32>, move || {println!("foo"); 1});
}

const TESTS: &[(&str, &str)] = &[
    (
        "clone!( => move || {})",
        "If you have nothing to clone, no need to use this macro!",
    ),
    (
        "clone!(|| {})",
        "If you have nothing to clone, no need to use this macro!",
    ),
    (
        "clone!(|a, b| {})",
        "If you have nothing to clone, no need to use this macro!",
    ),
    (
        "clone!(@weak a, @weak b => |x| {})",
        r#"error: Closure needs to be "moved" so please add `move` before closure
 --> test_3.rs:1:86
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(@weak a, @weak b => |x| {}); }
  |                                                                                      ^"#,
    ),
    (
        "clone!(@weak a, @weak b => || {})",
        r#"error: Closure needs to be "moved" so please add `move` before closure
 --> test_4.rs:1:86
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(@weak a, @weak b => || {}); }
  |                                                                                      ^"#,
    ),
    (
        "clone!(@weak a, @weak b => |x| println!(\"a\"))",
        r#"error: Closure needs to be "moved" so please add `move` before closure
 --> test_5.rs:1:86
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(@weak a, @weak b => |x| println!("a")); }
  |                                                                                      ^"#,
    ),
    (
        "clone!(@weak a, @weak b => || println!(\"a\"))",
        r#"error: Closure needs to be "moved" so please add `move` before closure
 --> test_6.rs:1:86
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(@weak a, @weak b => || println!("a")); }
  |                                                                                      ^"#,
    ),
    (
        "clone!(@weak a => |x| {})",
        r#"error: Closure needs to be "moved" so please add `move` before closure
 --> test_7.rs:1:77
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(@weak a => |x| {}); }
  |                                                                             ^"#,
    ),
    (
        "clone!(@weak a => || {})",
        r#"error: Closure needs to be "moved" so please add `move` before closure
 --> test_8.rs:1:77
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(@weak a => || {}); }
  |                                                                             ^"#,
    ),
    (
        "clone!(@weak a => |x| println!(\"a\"))",
        r#"error: Closure needs to be "moved" so please add `move` before closure
 --> test_9.rs:1:77
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(@weak a => |x| println!("a")); }
  |                                                                             ^"#,
    ),
    (
        "clone!(@weak a => || println!(\"a\"))",
        r#"error: Closure needs to be "moved" so please add `move` before closure
 --> test_10.rs:1:77
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(@weak a => || println!("a")); }
  |                                                                             ^"#,
    ),
    (
        "clone!(@strong self => move |x| {})",
        r#"error: Can't use `self` as variable name. Try storing it in a temporary variable or rename it using `as`.
 --> test_11.rs:1:74
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(@strong self => move |x| {}); }
  |                                                                          ^^^^
"#,
    ),
    (
        "clone!(@strong self.v => move |x| {})",
        r#"error: `self.v`: Field accesses are not allowed as is, you must rename it!
 --> test_12.rs:1:79
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(@strong self.v => move |x| {}); }
  |                                                                               ^
"#,
    ),
    (
        "clone!(@weak v => @default-return false, || {})",
        r#"error: Closure needs to be "moved" so please add `move` before closure
 --> test_13.rs:1:100
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(@weak v => @default-return false, || {}); }
  |                                                                                                    ^"#,
    ),
    (
        "clone!(@weak v => @default-return false, || println!(\"a\"))",
        r#"error: Closure needs to be "moved" so please add `move` before closure
 --> test_14.rs:1:100
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(@weak v => @default-return false, || println!("a")); }
  |                                                                                                    ^"#,
    ),
    (
        "clone!(@weak v => @default-return false, |bla| {})",
        r#"error: Closure needs to be "moved" so please add `move` before closure
 --> test_15.rs:1:100
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(@weak v => @default-return false, |bla| {}); }
  |                                                                                                    ^
"#,
    ),
    (
        "clone!(@weak v => @default-return false, |bla| println!(\"a\"))",
        r#"error: Closure needs to be "moved" so please add `move` before closure
 --> test_16.rs:1:100
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(@weak v => @default-return false, |bla| println!("a")); }
  |                                                                                                    ^
"#,
    ),
    (
        "clone!(@weak v => default-return false, move || {})",
        r#"error: Missing `@` before `default-return`
 --> test_17.rs:1:77
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(@weak v => default-return false, move || {}); }
  |                                                                             ^^^^^^^
"#,
    ),
    (
        "clone!(@weak v => @default-return false move || {})",
        r#"error: Expected `,` after `@default-return false`, found `move`
 --> test_18.rs:1:99
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(@weak v => @default-return false move || {}); }
  |                                                                                                   ^^^^
"#,
    ),
    (
        "clone!(@yolo v => move || {})",
        r#"error: Unknown keyword `yolo`, only `weak`, `weak-allow-none`, `to-owned` and `strong` are allowed
 --> test_19.rs:1:67
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(@yolo v => move || {}); }
  |                                                                   ^^^^
"#,
    ),
    (
        "clone!(v => move || {})",
        r#"error: Unexpected ident `v`: you need to specify if this is a weak or a strong clone.
 --> test_20.rs:1:66
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(v => move || {}); }
  |                                                                  ^
"#,
    ),
    (
        "clone!(@strong v => {println!(\"foo\");})",
        r#"error: Missing `move` and closure declaration
 --> test_21.rs:1:79
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(@strong v => {println!("foo");}); }
  |                                                                               ^^^^^^^^^^^^^^^^^^
"#,
    ),
    (
        "clone!(@strong v, @default-return lol => move || {println!(\"foo\");})",
        r#"error: `@default-return` should be after `=>`
 --> test_22.rs:1:78
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(@strong v, @default-return lol => move || {println!("foo");}); }
  |                                                                              ^^^^^^^
"#,
    ),
    (
        "clone!(@default-return lol, @strong v => move || {println!(\"foo\");})",
        r#"error: `@default-return` should be after `=>`
 --> test_23.rs:1:67
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(@default-return lol, @strong v => move || {println!("foo");}); }
  |                                                                   ^^^^^^^
"#,
    ),
    // The async part!
    (
        "clone!(@strong v => async || {println!(\"foo\");})",
        r#"error: Expected `move` after `async`, found `|`
 --> test_24.rs:1:85
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(@strong v => async || {println!("foo");}); }
  |                                                                                     ^"#,
    ),
    (
        "clone!(@strong v => async {println!(\"foo\");})",
        r#"error: Expected `move` after `async`, found `{`
 --> test_25.rs:1:85
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(@strong v => async {println!("foo");}); }
  |                                                                                     ^^^^^^^^^^^^^^^^^^
"#,
    ),
    (
        "clone!(@strong v => move || async {println!(\"foo\");})",
        r#"error: Expected `move` after `async`, found `{`
 --> test_26.rs:1:93
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(@strong v => move || async {println!("foo");}); }
  |                                                                                             ^^^^^^^^^^^^^^^^^^
"#,
    ),
    (
        "clone!(@strong v => move || async println!(\"foo\");)",
        r#"error: Expected `move` after `async`, found `println`
 --> test_27.rs:1:93
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(@strong v => move || async println!("foo");); }
  |                                                                                             ^^^^^^^
"#,
    ),
    (
        "clone!(@strong v => move || async move println!(\"foo\");)",
        r#"error: Expected block after `| async move`
 --> test_28.rs:1:98
  |
1 | fn main() { use glib::clone; let v = std::rc::Rc::new(1); clone!(@strong v => move || async move println!("foo");); }
  |                                                                                                  ^^^^^^^
"#,
    ),
];

#[test]
fn clone_failures() {
    let t = trybuild2::TestCases::new();

    for (index, (expr, err)) in TESTS.iter().enumerate() {
        let prefix = "fn main() { use glib::clone; let v = std::rc::Rc::new(1); ";
        let suffix = "; }";
        let output = format!("{prefix}{expr}{suffix}");

        t.compile_fail_inline_check_sub(&format!("test_{index}"), &output, err);
    }
}

const NO_WARNING: &[&str] = &[
    "clone!(@weak v => @default-return (), move || println!(\"{}\", v);)",
    "clone!(@weak v => @default-return (()), move || println!(\"{}\", v);)",
    "clone!(@weak v => @default-return ( () ), move || println!(\"{}\", v);)",
    "clone!(@weak v => @default-return (  ), move || println!(\"{}\", v);)",
];

// Ensures that no warning are emitted if the default-return is a unit tuple.
#[test]
fn clone_unit_tuple_return() {
    let t = trybuild2::TestCases::new();

    for (index, expr) in NO_WARNING.iter().enumerate() {
        let prefix = "fn main() { use glib::clone; let v = std::rc::Rc::new(1); ";
        let suffix = "; }";
        let output = format!("{prefix}{expr}{suffix}");

        t.pass_inline(&format!("test_{index}"), &output);
    }
}
