// Take a look at the license at the top of the repository in the LICENSE file.

use crate::Menu;
use crate::Widget;
use glib::object::Cast;
use glib::translate::*;
use glib::IsA;
use libc::c_int;
use std::boxed::Box as Box_;
use std::ptr;

mod sealed {
    pub trait Sealed {}
    impl<T: glib::IsA<crate::Menu>> Sealed for T {}
}

pub trait GtkMenuExtManual: IsA<Menu> + sealed::Sealed + 'static {
    #[doc(alias = "gtk_menu_popup")]
    fn popup<
        T: IsA<Widget>,
        U: IsA<Widget>,
        F: FnOnce(&Self, &mut i32, &mut i32) -> bool + 'static,
    >(
        &self,
        parent_menu_shell: Option<&T>,
        parent_menu_item: Option<&U>,
        f: F,
        button: u32,
        activate_time: u32,
    ) {
        unsafe extern "C" fn position_callback<
            T,
            F: FnOnce(&T, &mut i32, &mut i32) -> bool + 'static,
        >(
            this: *mut ffi::GtkMenu,
            x: *mut c_int,
            y: *mut c_int,
            push_in: *mut glib::ffi::gboolean,
            f: glib::ffi::gpointer,
        ) where
            T: IsA<Menu>,
        {
            let mut f: Box<Option<F>> = Box::from_raw(f as *mut _);
            let f = f.take().expect("No callback");
            *push_in = f(
                &Menu::from_glib_none(this).unsafe_cast(),
                x.as_mut().unwrap(),
                y.as_mut().unwrap(),
            )
            .into_glib();
        }
        unsafe {
            let f: Box_<Option<F>> = Box_::new(Some(f));
            ffi::gtk_menu_popup(
                self.as_ref().to_glib_none().0,
                parent_menu_shell.map(|p| p.as_ref()).to_glib_none().0,
                parent_menu_item.map(|p| p.as_ref()).to_glib_none().0,
                Some(position_callback::<Self, F>),
                Box_::into_raw(f) as *mut _,
                button,
                activate_time,
            )
        }
    }

    #[doc(alias = "gtk_menu_popup_easy")]
    fn popup_easy(&self, button: u32, activate_time: u32) {
        unsafe {
            ffi::gtk_menu_popup(
                self.as_ref().to_glib_none().0,
                ptr::null_mut(),
                ptr::null_mut(),
                None,
                ptr::null_mut(),
                button,
                activate_time,
            )
        }
    }
}

impl<O: IsA<Menu>> GtkMenuExtManual for O {}
