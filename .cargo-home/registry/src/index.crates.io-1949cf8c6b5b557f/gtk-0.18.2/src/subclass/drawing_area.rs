// Take a look at the license at the top of the repository in the LICENSE file.

use glib::subclass::prelude::*;

use super::widget::WidgetImpl;
use crate::DrawingArea;

pub trait DrawingAreaImpl: WidgetImpl {}

unsafe impl<T: DrawingAreaImpl> IsSubclassable<T> for DrawingArea {
    fn class_init(class: &mut ::glib::Class<Self>) {
        Self::parent_class_init::<T>(class);

        if !crate::rt::is_initialized() {
            panic!("GTK has to be initialized first");
        }
    }
}
