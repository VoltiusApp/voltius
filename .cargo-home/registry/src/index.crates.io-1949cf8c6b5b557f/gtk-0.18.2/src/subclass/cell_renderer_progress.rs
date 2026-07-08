// Take a look at the license at the top of the repository in the LICENSE file.

use glib::subclass::prelude::*;

use super::cell_renderer::CellRendererImpl;

use crate::CellRendererProgress;

pub trait CellRendererProgressImpl: CellRendererImpl {}

unsafe impl<T: CellRendererProgressImpl> IsSubclassable<T> for CellRendererProgress {
    fn class_init(class: &mut ::glib::Class<Self>) {
        Self::parent_class_init::<T>(class);

        if !crate::rt::is_initialized() {
            panic!("GTK has to be initialized first");
        }
    }
}
