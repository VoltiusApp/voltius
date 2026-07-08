// Take a look at the license at the top of the repository in the LICENSE file.

use glib::subclass::prelude::*;

use super::cell_renderer::CellRendererImpl;

use crate::CellRendererSpinner;

pub trait CellRendererSpinnerImpl: CellRendererImpl {}

unsafe impl<T: CellRendererSpinnerImpl> IsSubclassable<T> for CellRendererSpinner {
    fn class_init(class: &mut ::glib::Class<Self>) {
        Self::parent_class_init::<T>(class);

        if !crate::rt::is_initialized() {
            panic!("GTK has to be initialized first");
        }
    }
}
