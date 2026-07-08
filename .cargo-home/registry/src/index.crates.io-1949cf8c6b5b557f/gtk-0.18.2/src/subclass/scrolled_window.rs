// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;

use glib::subclass::prelude::*;

use glib::Cast;

use super::bin::BinImpl;
use crate::DirectionType;
use crate::ScrollType;
use crate::ScrolledWindow;

pub trait ScrolledWindowImpl: ScrolledWindowImplExt + BinImpl {
    fn move_focus_out(&self, direction_type: DirectionType) {
        self.parent_move_focus_out(direction_type)
    }

    fn scroll_child(&self, scroll: ScrollType, horizontal: bool) -> bool {
        self.parent_scroll_child(scroll, horizontal)
    }
}

mod sealed {
    pub trait Sealed {}
    impl<T: super::ScrolledWindowImpl> Sealed for T {}
}

pub trait ScrolledWindowImplExt: ObjectSubclass + sealed::Sealed {
    fn parent_move_focus_out(&self, direction_type: DirectionType) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkScrolledWindowClass;
            if let Some(f) = (*parent_class).move_focus_out {
                f(
                    self.obj()
                        .unsafe_cast_ref::<ScrolledWindow>()
                        .to_glib_none()
                        .0,
                    direction_type.into_glib(),
                )
            }
        }
    }
    fn parent_scroll_child(&self, scroll: ScrollType, horizontal: bool) -> bool {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkScrolledWindowClass;
            if let Some(f) = (*parent_class).scroll_child {
                from_glib(f(
                    self.obj()
                        .unsafe_cast_ref::<ScrolledWindow>()
                        .to_glib_none()
                        .0,
                    scroll.into_glib(),
                    horizontal.into_glib(),
                ))
            } else {
                false
            }
        }
    }
}

impl<T: ScrolledWindowImpl> ScrolledWindowImplExt for T {}

unsafe impl<T: ScrolledWindowImpl> IsSubclassable<T> for ScrolledWindow {
    fn class_init(class: &mut ::glib::Class<Self>) {
        Self::parent_class_init::<T>(class);

        let klass = class.as_mut();
        klass.move_focus_out = Some(window_move_focus_out::<T>);
        klass.scroll_child = Some(window_scroll_child::<T>);
    }
}

unsafe extern "C" fn window_move_focus_out<T: ScrolledWindowImpl>(
    ptr: *mut ffi::GtkScrolledWindow,
    directiontypeptr: ffi::GtkDirectionType,
) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();
    let direction_type: DirectionType = from_glib(directiontypeptr);

    imp.move_focus_out(direction_type)
}

unsafe extern "C" fn window_scroll_child<T: ScrolledWindowImpl>(
    ptr: *mut ffi::GtkScrolledWindow,
    scrollptr: ffi::GtkScrollType,
    horizontalptr: glib::ffi::gboolean,
) -> glib::ffi::gboolean {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();
    let scroll: ScrollType = from_glib(scrollptr);
    let horizontal: bool = from_glib(horizontalptr);

    imp.scroll_child(scroll, horizontal).into_glib()
}
