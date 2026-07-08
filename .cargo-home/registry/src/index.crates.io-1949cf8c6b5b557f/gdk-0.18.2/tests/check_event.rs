#[test]
fn check_event() {
    gdk::init();
    let base_ev = gdk::Event::new(gdk::EventType::KeyPress);
    let mut ev: gdk::EventKey = base_ev.downcast().unwrap();
    ev.as_mut().keyval = *gdk::keys::constants::A;

    let keyval_unicode = ev.keyval().to_unicode();

    assert_eq!(keyval_unicode, Some('A'));

    let keyval_name = ev.keyval().name();

    assert_eq!(keyval_name, Some("A".into()));
}
