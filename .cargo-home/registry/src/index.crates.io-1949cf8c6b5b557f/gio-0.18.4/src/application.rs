// Take a look at the license at the top of the repository in the LICENSE file.

use std::{boxed::Box as Box_, mem::transmute};

use glib::{
    prelude::*,
    signal::{connect_raw, SignalHandlerId},
    translate::*,
    ExitCode, GString,
};

use crate::{Application, File};

mod sealed {
    pub trait Sealed {}
    impl<T: super::IsA<super::Application>> Sealed for T {}
}

pub trait ApplicationExtManual: sealed::Sealed + IsA<Application> {
    #[doc(alias = "g_application_run")]
    fn run(&self) -> ExitCode {
        self.run_with_args(&std::env::args().collect::<Vec<_>>())
    }
    #[doc(alias = "g_application_run")]
    fn run_with_args<S: AsRef<str>>(&self, args: &[S]) -> ExitCode {
        let argv: Vec<&str> = args.iter().map(|a| a.as_ref()).collect();
        let argc = argv.len() as i32;
        let exit_code = unsafe {
            ffi::g_application_run(self.as_ref().to_glib_none().0, argc, argv.to_glib_none().0)
        };
        ExitCode::from(exit_code)
    }
    fn connect_open<F: Fn(&Self, &[File], &str) + 'static>(&self, f: F) -> SignalHandlerId {
        unsafe extern "C" fn open_trampoline<P, F: Fn(&P, &[File], &str) + 'static>(
            this: *mut ffi::GApplication,
            files: *const *mut ffi::GFile,
            n_files: libc::c_int,
            hint: *mut libc::c_char,
            f: glib::ffi::gpointer,
        ) where
            P: IsA<Application>,
        {
            let f: &F = &*(f as *const F);
            let files: Vec<File> = FromGlibContainer::from_glib_none_num(files, n_files as usize);
            f(
                Application::from_glib_borrow(this).unsafe_cast_ref(),
                &files,
                &GString::from_glib_borrow(hint),
            )
        }
        unsafe {
            let f: Box_<F> = Box_::new(f);
            connect_raw(
                self.as_ptr() as *mut _,
                b"open\0".as_ptr() as *const _,
                Some(transmute::<_, unsafe extern "C" fn()>(
                    open_trampoline::<Self, F> as *const (),
                )),
                Box_::into_raw(f),
            )
        }
    }

    #[doc(alias = "g_application_hold")]
    fn hold(&self) -> ApplicationHoldGuard {
        unsafe {
            ffi::g_application_hold(self.as_ref().to_glib_none().0);
        }
        ApplicationHoldGuard(self.as_ref().downgrade())
    }

    #[doc(alias = "g_application_mark_busy")]
    fn mark_busy(&self) -> ApplicationBusyGuard {
        unsafe {
            ffi::g_application_mark_busy(self.as_ref().to_glib_none().0);
        }
        ApplicationBusyGuard(self.as_ref().downgrade())
    }
}

impl<O: IsA<Application>> ApplicationExtManual for O {}

#[derive(Debug)]
#[must_use = "if unused the Application will immediately be released"]
pub struct ApplicationHoldGuard(glib::WeakRef<Application>);

impl Drop for ApplicationHoldGuard {
    #[inline]
    fn drop(&mut self) {
        if let Some(application) = self.0.upgrade() {
            unsafe {
                ffi::g_application_release(application.to_glib_none().0);
            }
        }
    }
}

#[derive(Debug)]
#[must_use = "if unused the Application will immediately be unmarked busy"]
pub struct ApplicationBusyGuard(glib::WeakRef<Application>);

impl Drop for ApplicationBusyGuard {
    #[inline]
    fn drop(&mut self) {
        if let Some(application) = self.0.upgrade() {
            unsafe {
                ffi::g_application_unmark_busy(application.to_glib_none().0);
            }
        }
    }
}
