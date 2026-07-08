// Take a look at the license at the top of the repository in the LICENSE file.

use glib::subclass::prelude::*;

use super::cell_renderer::CellRendererImpl;

use crate::CellRendererPixbuf;

pub trait CellRendererPixbufImpl: CellRendererImpl {}

unsafe impl<T: CellRendererPixbufImpl> IsSubclassable<T> for CellRendererPixbuf {
    fn class_init(class: &mut ::glib::Class<Self>) {
        Self::parent_class_init::<T>(class);

        if !crate::rt::is_initialized() {
            panic!("GTK has to be initialized first");
        }
    }
}
