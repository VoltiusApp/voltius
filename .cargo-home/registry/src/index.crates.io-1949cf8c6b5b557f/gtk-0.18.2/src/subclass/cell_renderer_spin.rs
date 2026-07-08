// Take a look at the license at the top of the repository in the LICENSE file.

use glib::subclass::prelude::*;

use super::cell_renderer_text::CellRendererTextImpl;
use crate::CellRendererSpin;

pub trait CellRendererSpinImpl: CellRendererTextImpl {}

unsafe impl<T: CellRendererSpinImpl> IsSubclassable<T> for CellRendererSpin {
    fn class_init(class: &mut ::glib::Class<Self>) {
        Self::parent_class_init::<T>(class);

        if !crate::rt::is_initialized() {
            panic!("GTK has to be initialized first");
        }
    }
}
