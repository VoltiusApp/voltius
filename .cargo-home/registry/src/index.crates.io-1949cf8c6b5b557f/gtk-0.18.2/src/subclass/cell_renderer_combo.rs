// Take a look at the license at the top of the repository in the LICENSE file.

use glib::subclass::prelude::*;

use super::cell_renderer_text::CellRendererTextImpl;
use crate::CellRendererCombo;

pub trait CellRendererComboImpl: CellRendererTextImpl {}

unsafe impl<T: CellRendererComboImpl> IsSubclassable<T> for CellRendererCombo {
    fn class_init(class: &mut ::glib::Class<Self>) {
        Self::parent_class_init::<T>(class);

        if !crate::rt::is_initialized() {
            panic!("GTK has to be initialized first");
        }
    }
}
