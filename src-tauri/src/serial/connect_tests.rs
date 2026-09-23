use std::time::Duration;

use serialport::FlowControl;

use super::connect::{
    generation_is_current, send_break, set_line, with_session, SerialLine, SerialLines,
    SerialSessionManager,
};

const LINES: SerialLines = SerialLines {
    dtr: true,
    rts: true,
};

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

    let first = manager.insert("s1", open_port(), LINES);
    assert!(generation_is_current(&manager.sessions, "s1", first));

    let second = manager.insert("s1", open_port(), LINES);
    assert!(!generation_is_current(&manager.sessions, "s1", first));
    assert!(generation_is_current(&manager.sessions, "s1", second));
}

#[test]
fn a_removed_session_is_no_longer_current() {
    let manager = SerialSessionManager::new();
    let generation = manager.insert("s1", open_port(), LINES);

    manager.remove("s1");

    assert!(!generation_is_current(&manager.sessions, "s1", generation));
}

#[test]
fn a_posix_open_reports_both_lines_raised_whatever_the_flow_control() {
    for flow in [
        FlowControl::None,
        FlowControl::Software,
        FlowControl::Hardware,
    ] {
        assert_eq!(SerialLines::on_open(false, flow), LINES);
    }
}

#[test]
fn a_windows_open_reports_dtr_low_and_rts_only_for_hardware_flow() {
    let lowered = SerialLines {
        dtr: false,
        rts: false,
    };
    assert_eq!(SerialLines::on_open(true, FlowControl::None), lowered);
    assert_eq!(SerialLines::on_open(true, FlowControl::Software), lowered);
    assert_eq!(
        SerialLines::on_open(true, FlowControl::Hardware),
        SerialLines {
            dtr: false,
            rts: true
        }
    );
}

// A pty has no modem lines and refuses TIOCMBIS; the UI must not show a flip that never happened.
#[test]
fn a_line_write_the_device_rejects_keeps_the_recorded_state() {
    let manager = SerialSessionManager::new();
    manager.insert("s1", open_port(), LINES);

    assert!(set_line(&manager.sessions, "s1", SerialLine::Dtr, false).is_err());
    let recorded = with_session(&manager.sessions, "s1", |s| Ok(s.lines)).unwrap();
    assert_eq!(recorded, LINES);
}

#[test]
fn line_control_on_an_unknown_session_is_an_error() {
    let manager = SerialSessionManager::new();

    assert!(set_line(&manager.sessions, "nope", SerialLine::Dtr, false).is_err());
    assert!(send_break(&manager.sessions, "nope", Duration::ZERO).is_err());
}
