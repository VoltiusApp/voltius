use super::connect::{generation_is_current, SerialSessionManager};

fn open_port() -> Box<dyn serialport::SerialPort> {
    let (port, _peer) = serialport::TTYPort::pair().expect("pty pair");
    Box::new(port)
}

// Reopening a port leaves the previous read thread alive on its cloned fd. It
// has to notice a newer generation owns the id and stop, or two threads split
// the device's output between them (#192 made this reachable from a button).
#[test]
fn reopening_a_session_supersedes_the_previous_generation() {
    let manager = SerialSessionManager::new();

    let first = manager.insert("s1", open_port());
    assert!(generation_is_current(&manager.sessions, "s1", first));

    let second = manager.insert("s1", open_port());
    assert!(!generation_is_current(&manager.sessions, "s1", first));
    assert!(generation_is_current(&manager.sessions, "s1", second));
}

#[test]
fn a_removed_session_is_no_longer_current() {
    let manager = SerialSessionManager::new();
    let generation = manager.insert("s1", open_port());

    manager.remove("s1");

    assert!(!generation_is_current(&manager.sessions, "s1", generation));
}
