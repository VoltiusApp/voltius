#[test]
fn test_get() {
    let id = machine_uid::get().unwrap();
    for _ in 1..100 {
        let id2 = machine_uid::get().unwrap();
        assert_eq!(id, id2);
    }
}

#[test]
fn test_not_empty() {
    let id = machine_uid::get().unwrap();
    assert_ne!(id, String::new());
}
