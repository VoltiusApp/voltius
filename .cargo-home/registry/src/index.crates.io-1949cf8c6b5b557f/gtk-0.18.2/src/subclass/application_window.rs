// Take a look at the license at the top of the repository in the LICENSE file.

use glib::subclass::prelude::*;

use super::window::WindowImpl;
use crate::ApplicationWindow;

pub trait ApplicationWindowImpl: WindowImpl {}

unsafe impl<T: ApplicationWindowImpl> IsSubclassable<T> for ApplicationWindow {
    fn class_init(class: &mut ::glib::Class<Self>) {
        Self::parent_class_init::<T>(class);

        if !crate::rt::is_initialized() {
            panic!("GTK has to be initialized first");
        }
    }
}
