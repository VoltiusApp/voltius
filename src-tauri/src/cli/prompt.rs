use std::io::{self, BufRead, IsTerminal, Write};
use zeroize::Zeroizing;

pub(crate) trait Prompt {
    fn tty(&self) -> bool;
    fn line(&self, label: &str) -> io::Result<String>;
    fn hidden(&self, label: &str) -> io::Result<Zeroizing<String>>;
}

pub(crate) struct Terminal;

pub(crate) fn ask(label: &str) -> io::Result<Zeroizing<String>> {
    let mut err = io::stderr();
    err.write_all(label.as_bytes())?;
    err.flush()?;
    let mut line = Zeroizing::new(String::with_capacity(256));
    if io::stdin().lock().read_line(&mut line)? == 0 {
        return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "input ended"));
    }
    let end = line.trim_end_matches(['\r', '\n']).len();
    line.truncate(end);
    Ok(line)
}

impl Prompt for Terminal {
    fn tty(&self) -> bool {
        io::stdin().is_terminal()
    }

    fn line(&self, label: &str) -> io::Result<String> {
        ask(label).map(|l| l.as_str().to_owned())
    }

    fn hidden(&self, label: &str) -> io::Result<Zeroizing<String>> {
        let _quiet = EchoOff::new()?;
        ask(label)
    }
}

#[cfg(unix)]
use echo_unix::EchoOff;

#[cfg(unix)]
mod echo_unix {
    use std::cell::UnsafeCell;
    use std::io;
    use std::mem::MaybeUninit;
    use std::sync::atomic::{AtomicBool, AtomicI32, Ordering::SeqCst};

    const SIGNALS: [libc::c_int; 3] = [libc::SIGINT, libc::SIGTERM, libc::SIGHUP];

    struct Saved(UnsafeCell<MaybeUninit<libc::termios>>);
    // Written only while ARMED is false; the signal handler reads it only while ARMED is true.
    unsafe impl Sync for Saved {}

    static SAVED: Saved = Saved(UnsafeCell::new(MaybeUninit::uninit()));
    static FD: AtomicI32 = AtomicI32::new(-1);
    static ARMED: AtomicBool = AtomicBool::new(false);

    fn restore_saved() {
        if ARMED.load(SeqCst) {
            unsafe { libc::tcsetattr(FD.load(SeqCst), libc::TCSANOW, (*SAVED.0.get()).as_ptr()) };
        }
    }

    extern "C" fn restore_and_reraise(sig: libc::c_int) {
        restore_saved();
        unsafe { libc::raise(sig) };
    }

    fn handler() -> libc::sighandler_t {
        restore_and_reraise as extern "C" fn(libc::c_int) as libc::sighandler_t
    }

    pub(crate) struct EchoOff {
        previous: Vec<(libc::c_int, libc::sigaction)>,
    }

    impl EchoOff {
        pub(crate) fn new() -> io::Result<Self> {
            Self::on(libc::STDIN_FILENO)
        }

        pub(crate) fn on(fd: libc::c_int) -> io::Result<Self> {
            let mut saved = MaybeUninit::<libc::termios>::uninit();
            if unsafe { libc::tcgetattr(fd, saved.as_mut_ptr()) } != 0 {
                return Err(io::Error::last_os_error());
            }
            let saved = unsafe { saved.assume_init() };
            unsafe { (*SAVED.0.get()).write(saved) };
            FD.store(fd, SeqCst);
            ARMED.store(true, SeqCst);
            let echo = EchoOff {
                previous: SIGNALS.iter().filter_map(|&s| catch(s)).collect(),
            };
            let mut quiet = saved;
            quiet.c_lflag &= !libc::ECHO;
            quiet.c_lflag |= libc::ECHONL;
            if unsafe { libc::tcsetattr(fd, libc::TCSANOW, &quiet) } != 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(echo)
        }
    }

    // A signal the shell set to be ignored (nohup) stays ignored.
    fn catch(sig: libc::c_int) -> Option<(libc::c_int, libc::sigaction)> {
        unsafe {
            let mut action: libc::sigaction = std::mem::zeroed();
            action.sa_sigaction = handler();
            action.sa_flags = libc::SA_RESETHAND;
            libc::sigemptyset(&mut action.sa_mask);
            let mut previous: libc::sigaction = std::mem::zeroed();
            if libc::sigaction(sig, &action, &mut previous) != 0 {
                return None;
            }
            if previous.sa_sigaction == libc::SIG_IGN {
                libc::sigaction(sig, &previous, std::ptr::null_mut());
                return None;
            }
            Some((sig, previous))
        }
    }

    impl Drop for EchoOff {
        fn drop(&mut self) {
            restore_saved();
            ARMED.store(false, SeqCst);
            for (sig, previous) in &self.previous {
                unsafe { libc::sigaction(*sig, previous, std::ptr::null_mut()) };
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn pty() -> (libc::c_int, libc::c_int) {
            let (mut leader, mut follower) = (0, 0);
            let made = unsafe {
                libc::openpty(
                    &mut leader,
                    &mut follower,
                    std::ptr::null_mut(),
                    std::ptr::null(),
                    std::ptr::null(),
                )
            };
            assert_eq!(made, 0);
            (leader, follower)
        }

        fn echoes(fd: libc::c_int) -> bool {
            let mut t = MaybeUninit::<libc::termios>::uninit();
            assert_eq!(unsafe { libc::tcgetattr(fd, t.as_mut_ptr()) }, 0);
            unsafe { t.assume_init() }.c_lflag & libc::ECHO != 0
        }

        fn installed(sig: libc::c_int) -> libc::sighandler_t {
            let mut current: libc::sigaction = unsafe { std::mem::zeroed() };
            unsafe { libc::sigaction(sig, std::ptr::null(), &mut current) };
            current.sa_sigaction
        }

        #[test]
        fn echo_comes_back_on_drop_and_on_a_signal() {
            let (_leader, tty) = pty();
            assert!(echoes(tty));
            let before = installed(libc::SIGTERM);
            {
                let _quiet = EchoOff::on(tty).unwrap();
                assert!(!echoes(tty));
                assert_eq!(installed(libc::SIGTERM), handler());
            }
            assert!(echoes(tty));
            assert_eq!(installed(libc::SIGTERM), before);

            let child = unsafe { libc::fork() };
            if child == 0 {
                let quiet = EchoOff::on(tty);
                if quiet.is_ok() {
                    unsafe { libc::raise(libc::SIGTERM) };
                }
                unsafe { libc::_exit(0) };
            }
            let mut status = 0;
            assert_eq!(unsafe { libc::waitpid(child, &mut status, 0) }, child);
            assert!(libc::WIFSIGNALED(status), "child exited: {status}");
            assert_eq!(libc::WTERMSIG(status), libc::SIGTERM);
            assert!(echoes(tty));
        }
    }
}

#[cfg(windows)]
use echo_windows::EchoOff;

#[cfg(windows)]
mod echo_windows {
    use std::io;
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering::SeqCst};
    use windows_sys::Win32::Foundation::{BOOL, HANDLE};
    use windows_sys::Win32::System::Console::{
        GetConsoleMode, GetStdHandle, SetConsoleCtrlHandler, SetConsoleMode, ENABLE_ECHO_INPUT,
        STD_INPUT_HANDLE,
    };

    static MODE: AtomicU32 = AtomicU32::new(0);
    static ARMED: AtomicBool = AtomicBool::new(false);

    fn restore_saved() {
        if ARMED.load(SeqCst) {
            unsafe { SetConsoleMode(GetStdHandle(STD_INPUT_HANDLE), MODE.load(SeqCst)) };
        }
    }

    // FALSE hands the event on to the default handler, which ends the process.
    unsafe extern "system" fn on_ctrl(_event: u32) -> BOOL {
        restore_saved();
        0
    }

    pub(crate) struct EchoOff(HANDLE);

    impl EchoOff {
        pub(crate) fn new() -> io::Result<Self> {
            let handle = unsafe { GetStdHandle(STD_INPUT_HANDLE) };
            let mut mode = 0;
            if unsafe { GetConsoleMode(handle, &mut mode) } == 0 {
                return Err(io::Error::last_os_error());
            }
            MODE.store(mode, SeqCst);
            ARMED.store(true, SeqCst);
            unsafe { SetConsoleCtrlHandler(Some(on_ctrl), 1) };
            let echo = EchoOff(handle);
            if unsafe { SetConsoleMode(handle, mode & !ENABLE_ECHO_INPUT) } == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(echo)
        }
    }

    impl Drop for EchoOff {
        fn drop(&mut self) {
            unsafe { SetConsoleMode(self.0, MODE.load(SeqCst)) };
            ARMED.store(false, SeqCst);
            unsafe { SetConsoleCtrlHandler(Some(on_ctrl), 0) };
            eprintln!();
        }
    }
}
