// Take a look at the license at the top of the repository in the LICENSE file.

use crate::Fixed;
use crate::Widget;
use glib::translate::*;
use glib::IsA;

// All this is in order to avoid the segfault. More info in :
// https://github.com/gtk-rs/gtk/issues/565
fn has_widget<O: IsA<Fixed>, T: IsA<Widget>>(c: &O, item: &T) -> bool {
    skip_assert_initialized!();
    unsafe {
        let glist = ffi::gtk_container_get_children(c.to_glib_none().0 as *mut _);
        let found = !glib::ffi::g_list_find(glist, item.to_glib_none().0 as _).is_null();
        glib::ffi::g_list_free(glist);
        found
    }
}

mod sealed {
    pub trait Sealed {}
    impl<T: glib::IsA<crate::Fixed>> Sealed for T {}
}

pub trait FixedExtManual: IsA<Fixed> + sealed::Sealed + 'static {
    #[doc(alias = "get_child_x")]
    fn child_x<T: IsA<Widget>>(&self, item: &T) -> i32 {
        assert!(
            has_widget(self, item),
            "this item isn't in the Fixed's widget list"
        );
        let mut value = glib::Value::from(&0);
        unsafe {
            ffi::gtk_container_child_get_property(
                self.to_glib_none().0 as *mut _,
                item.as_ref().to_glib_none().0,
                "x".to_glib_none().0,
                value.to_glib_none_mut().0,
            );
        }
        value
            .get()
            .expect("Return Value for `FixedExtManual::get_child_x`")
    }

    fn set_child_x<T: IsA<Widget>>(&self, item: &T, x: i32) {
        assert!(
            has_widget(self, item),
            "this item isn't in the Fixed's widget list"
        );
        unsafe {
            ffi::gtk_container_child_set_property(
                self.to_glib_none().0 as *mut _,
                item.as_ref().to_glib_none().0,
                "x".to_glib_none().0,
                glib::Value::from(&x).to_glib_none().0,
            );
        }
    }

    #[doc(alias = "get_child_y")]
    fn child_y<T: IsA<Widget>>(&self, item: &T) -> i32 {
        assert!(
            has_widget(self, item),
            "this item isn't in the Fixed's widget list"
        );
        let mut value = glib::Value::from(&0);
        unsafe {
            ffi::gtk_container_child_get_property(
                self.to_glib_none().0 as *mut _,
                item.as_ref().to_glib_none().0,
                "y".to_glib_none().0,
                value.to_glib_none_mut().0,
            );
        }
        value
            .get()
            .expect("Return Value for `FixedExtManual::get_child_y`")
    }

    fn set_child_y<T: IsA<Widget>>(&self, item: &T, y: i32) {
        assert!(
            has_widget(self, item),
            "this item isn't in the Fixed's widget list"
        );
        unsafe {
            ffi::gtk_container_child_set_property(
                self.to_glib_none().0 as *mut _,
                item.as_ref().to_glib_none().0,
                "y".to_glib_none().0,
                glib::Value::from(&y).to_glib_none().0,
            );
        }
    }
}

impl<O: IsA<Fixed>> FixedExtManual for O {}
