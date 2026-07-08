// Take a look at the license at the top of the repository in the LICENSE file.

use glib::subclass::prelude::*;

use super::bin::BinImpl;

use crate::EventBox;

pub trait EventBoxImpl: BinImpl {}

unsafe impl<T: EventBoxImpl> IsSubclassable<T> for EventBox {
    fn class_init(class: &mut ::glib::Class<Self>) {
        Self::parent_class_init::<T>(class);

        if !crate::rt::is_initialized() {
            panic!("GTK has to be initialized first");
        }
    }
}
